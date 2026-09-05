// ╔══════════════════════════════════════════════════════════╗
// ║  proxy.mjs — deployed to Render (render.yaml)            ║
// ║                                                          ║
// ║  [DESKTOP]  OAuth proxy — Google login / Gmail / Outlook ║
// ║             Holds secrets; redirects back to localhost   ║
// ║                                                          ║
// ║  [MOBILE]   Relay + extraction + mobile web UI           ║
// ║             Supabase JWT auth, in-memory queue, 5-day TTL║
// ╚══════════════════════════════════════════════════════════╝
import dns from "dns";
dns.setDefaultResultOrder("ipv4first"); // Render has no IPv6 outbound; prefer IPv4 for all DNS

import express from "express";
import multer from "multer";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, "..", "dist");

const PORT = process.env.PORT ?? 3000;
const LOCAL_APP = "http://localhost:7823";

const RENDER_URL = process.env.RENDER_EXTERNAL_URL ?? process.env.RENDER_URL ?? null;

function sanitizeReturnTo(raw) {
  try {
    const url = new URL(raw);
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return raw;
    if (RENDER_URL && raw.startsWith(RENDER_URL)) return raw;
  } catch {}
  return RENDER_URL ?? LOCAL_APP;
}

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET } = process.env;
const SUPABASE_URL         = process.env.SUPABASE_URL         ?? "";
const SUPABASE_ANON_KEY    = process.env.SUPABASE_ANON_KEY    ?? "";
const SUPABASE_SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY  ?? "";
const GMAIL_USER            = process.env.GMAIL_USER            ?? "";
const GMAIL_APP_PASSWORD    = process.env.GMAIL_APP_PASSWORD    ?? "";
const STRIPE_SECRET_KEY      = process.env.STRIPE_SECRET_KEY      ?? "";
const STRIPE_WEBHOOK_SECRET  = process.env.STRIPE_WEBHOOK_SECRET  ?? "";
const STRIPE_PRICES = {
  shared_monthly: process.env.STRIPE_PRICE_SHARED_MONTHLY ?? "",
  shared_yearly:  process.env.STRIPE_PRICE_SHARED_YEARLY  ?? "",
  own_monthly:    process.env.STRIPE_PRICE_OWN_MONTHLY    ?? "",
  own_yearly:     process.env.STRIPE_PRICE_OWN_YEARLY     ?? "",
};

const GMAIL_SCOPE        = "https://www.googleapis.com/auth/gmail.readonly email openid";
const GOOGLE_LOGIN_SCOPE = "openid email profile";
const OUTLOOK_SCOPE      = "openid email Mail.Read offline_access";

// ── Session token helpers (email-keyed, no Supabase auth required) ────────────
const SESSION_SECRET = process.env.SESSION_SECRET || (SUPABASE_SERVICE_KEY ? SUPABASE_SERVICE_KEY.slice(-32) : "jinvoice-dev-secret");

function _signToken(email) {
  const ts  = Date.now().toString(36);
  const b64 = Buffer.from(email).toString("base64url");
  const sig  = crypto.createHmac("sha256", SESSION_SECRET).update(`${b64}:${ts}`).digest("hex");
  return `${b64}.${ts}.${sig}`;
}

function _verifyToken(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [b64, ts, sig] = parts;
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(`${b64}:${ts}`).digest("hex");
  if (sig !== expected) return null;
  if (Date.now() - parseInt(ts, 36) > 90 * 24 * 60 * 60 * 1000) return null;
  try { return Buffer.from(b64, "base64url").toString("utf8"); } catch { return null; }
}

// Service-key Supabase fetch — bypasses RLS, server use only
async function _sbService(path, opts = {}) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return { ok: false, data: null };
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
      ...opts,
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
        ...opts.headers,
      },
    });
    const text = await r.text();
    return { ok: r.ok, status: r.status, data: text ? JSON.parse(text) : null };
  } catch (e) { return { ok: false, data: null, error: String(e) }; }
}

// Upsert a user_plans row — inserts if missing, updates if found.
// Always include email in fields. Returns the saved row or null.
async function _upsertPlan(email, fields) {
  const body = { email: email.toLowerCase(), ...fields };
  // ?on_conflict=email tells PostgREST which column to use for ON CONFLICT DO UPDATE
  const { ok, status, data } = await _sbService("/user_plans?on_conflict=email", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(body),
  });
  if (!ok) console.error("[user_plans] upsert failed:", status, JSON.stringify(data));
  return { ok, status, data: Array.isArray(data) ? data[0] : (data ?? null) };
}

// Insert one row into user_plan_events — fire-and-forget, never blocks the caller.
// event: "plan_created" | "trial_started" | "trial_expired" | "pro_activated" | "cancelled"
function _logPlanEvent(email, event, meta = {}) {
  _sbService("/user_plan_events", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ email: email.toLowerCase(), event, meta, created_at: new Date().toISOString() }),
  }).then(({ ok, status, data }) => {
    if (!ok) console.error("[plan_events] insert failed:", status, JSON.stringify(data));
  }).catch((e) => console.error("[plan_events] insert error:", e));
}

const app = express();

// ── Stripe webhook (must be before express.json) ──────────────────────────────
app.post("/api/stripe-webhook", express.raw({ type: "application/json" }), async (req, res) => {
  if (!STRIPE_WEBHOOK_SECRET) return res.status(503).json({ error: "STRIPE_WEBHOOK_SECRET not set" });
  const sig = req.headers["stripe-signature"] ?? "";
  const parts = Object.fromEntries(sig.split(",").map((p) => p.split("=")));
  const payload = `${parts.t}.${req.body}`;
  const expected = crypto.createHmac("sha256", STRIPE_WEBHOOK_SECRET).update(payload).digest("hex");
  if (expected !== parts.v1) return res.status(400).json({ error: "invalid signature" });
  let event;
  try { event = JSON.parse(req.body); } catch { return res.status(400).json({ error: "bad json" }); }
  if (event.type === "checkout.session.completed" || event.type === "invoice.paid") {
    const obj = event.data.object;
    const customerId = obj.customer;
    const subscriptionId = obj.subscription ?? null;
    if (customerId && SUPABASE_URL && SUPABASE_SERVICE_KEY) {
      try {
        const lookup = await fetch(
          `${SUPABASE_URL}/rest/v1/subscriptions?stripe_customer_id=eq.${customerId}&select=user_id`,
          { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } }
        );
        const rows = await lookup.json();
        if (rows?.[0]?.user_id) {
          const paidUntil = new Date(Date.now() + 32 * 24 * 60 * 60 * 1000).toISOString();
          await fetch(`${SUPABASE_URL}/rest/v1/subscriptions?user_id=eq.${rows[0].user_id}`, {
            method: "PATCH",
            headers: {
              apikey: SUPABASE_SERVICE_KEY,
              Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              plan: "pro_paid", status: "active",
              stripe_subscription_id: subscriptionId,
              paid_from: new Date().toISOString(),
              paid_until: paidUntil,
              cancelled_at: null,
              updated_at: new Date().toISOString(),
            }),
          });
        }
      } catch (e) { console.error("webhook patch failed", e); }
    }
  }
  res.json({ received: true });
});

// ── Stripe checkout session ────────────────────────────────────────────────────
// Shared with prod.mjs — needs auth token. Called from PricingScreen.
async function validateSupabaseJWT_proxy(token) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !token) return null;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
    });
    if (!r.ok) return null;
    const user = await r.json();
    return user.id ?? null;
  } catch { return null; }
}

async function sbFetch_proxy(path, token, opts = {}) {
  const method = (opts.method ?? "GET").toUpperCase();
  const isWrite = method === "POST" || method === "PATCH" || method === "PUT" || method === "DELETE";
  const authKey = isWrite && SUPABASE_SERVICE_KEY ? SUPABASE_SERVICE_KEY : token;
  const r = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...opts,
    headers: {
      apikey: isWrite && SUPABASE_SERVICE_KEY ? SUPABASE_SERVICE_KEY : SUPABASE_ANON_KEY,
      Authorization: `Bearer ${authKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...opts.headers,
    },
  });
  const text = await r.text();
  return { ok: r.ok, status: r.status, data: text ? JSON.parse(text) : null };
}

app.post("/api/stripe-checkout", async (req, res) => {
  if (!STRIPE_SECRET_KEY) return res.status(503).json({ error: "STRIPE_SECRET_KEY not set" });
  const token = (req.headers.authorization ?? "").replace("Bearer ", "");
  const userId = await validateSupabaseJWT_proxy(token);
  if (!userId) return res.status(401).json({ error: "unauthorized" });
  const { plan = "shared", billing = "monthly" } = req.body ?? {};
  const priceId = STRIPE_PRICES[`${plan}_${billing}`];
  if (!priceId) return res.status(400).json({ error: "unknown plan/billing or price ID not configured" });
  const sub = await sbFetch_proxy(`/subscriptions?user_id=eq.${userId}&limit=1`, token);
  const existing = sub.data?.[0];
  const origin = RENDER_URL ?? `${req.protocol}://${req.headers.host}`;
  const body = new URLSearchParams({
    mode: "subscription",
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    success_url: `${origin}/pricing?payment=success`,
    cancel_url: `${origin}/pricing`,
    "metadata[user_id]": userId,
    ...(existing?.stripe_customer_id ? { customer: existing.stripe_customer_id } : {}),
  });
  try {
    const r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const session = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: session.error?.message ?? "stripe error" });
    if (session.customer && existing && !existing.stripe_customer_id) {
      await sbFetch_proxy(`/subscriptions?user_id=eq.${userId}`, token, {
        method: "PATCH",
        body: JSON.stringify({ stripe_customer_id: session.customer, updated_at: new Date().toISOString() }),
      });
    }
    res.json({ url: session.url });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.use(express.json({ limit: "20mb" }));

// CORS for desktop app (http://localhost:7823) calling cross-origin Render endpoints
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", LOCAL_APP);
  res.header("Access-Control-Allow-Headers", "Content-Type, x-jinvoice-key, x-gemini-key, Authorization");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ── [MOBILE] Per-user relay — in-memory, no cloud writes ──────────────────────
// Mobile saves invoices in phone localStorage; taps "Send to Desktop" to queue
// here; desktop polls and acks. 5-day TTL, max 5 per user.

const relay = new Map(); // Map<userId, [{id,ts,...snakeCaseFields}]>
let _relayId = 0;
const RELAY_TTL_MS       = 5 * 24 * 60 * 60 * 1000;
const MAX_RELAY_PER_USER = 5;

function pruneRelay() {
  const cutoff = Date.now() - RELAY_TTL_MS;
  for (const [uid, rows] of relay) {
    const fresh = rows.filter(r => r.ts > cutoff);
    if (fresh.length) relay.set(uid, fresh); else relay.delete(uid);
  }
}
setInterval(pruneRelay, 60 * 60 * 1000).unref();

async function validateSupabaseJWT(token) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !token) return null;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
    });
    if (!r.ok) return null;
    const user = await r.json();
    return user.id ?? null;
  } catch {
    return null;
  }
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

app.get("/mobile", (_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.send(MOBILE_HTML);
});

// Upload: OpenAI (images) / Gemini (PDFs) extraction → return data (not stored server-side)
app.post("/api/mobile/upload", upload.single("file"), async (req, res) => {
  const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  const userId = await validateSupabaseJWT(token);
  if (!userId) return res.status(401).json({ error: "Unauthorized. Please sign in again." });

  if (!req.file) return res.status(400).json({ error: "no file attached" });
  const isImage = req.file.mimetype.startsWith("image/");
  const profileMode = (req.body?.mode ?? "").toString().trim() || "personal";
  const uploadFilename = (req.file.originalname ?? "").toString();
  try {
    let data;
    if (isImage) {
      const apiKey = (req.headers["x-openai-key"] ?? "").toString().trim() || OPENAI_API_KEY;
      if (!apiKey) return res.status(503).json({ error: "No OpenAI API key configured on server." });
      data = await extractWithOpenAI(req.file.buffer, req.file.mimetype, apiKey, profileMode, uploadFilename);
    } else {
      const apiKey = (req.headers["x-gemini-key"] ?? "").toString().trim() || GEMINI_API_KEY;
      if (!apiKey) return res.status(503).json({ error: "No Gemini API key configured on server." });
      data = await extractWithGemini(req.file.buffer, req.file.mimetype, apiKey, profileMode, uploadFilename);
    }

    // Strip item details for free users on finance/tax documents
    const isPro = await isMobileUserPro(userId);
    const items = (isPro || !isTaxOrFinanceDoc(data)) ? (data.items ?? []) : [];

    const inv = {
      id:               ++_relayId,
      user_id:          userId,
      filename:         req.file.originalname || "upload",
      shop_name:        data.shopName        ?? null,
      address:          data.address         ?? null,
      pincode:          data.pincode         ?? null,
      phone:            data.phone           ?? null,
      invoice_number:   data.invoiceNumber   ?? null,
      gst_number:       data.gstNumber       ?? null,
      gst_percent:      data.gstPercent      ?? null,
      gst_amount_inr:   data.gstAmountInr    ?? null,
      subtotal_inr:     data.subtotalInr     ?? null,
      discount_inr:     data.discountInr     ?? null,
      final_payment_inr: data.finalPaymentInr ?? null,
      date_of_purchase: data.dateOfPurchase  ?? null,
      items,
      uploaded_at:      new Date().toISOString(),
      pending_sync:     false,
      synced_at:        null,
    };
    res.json({ ok: true, invoice: inv });
  } catch (e) {
    console.error("[mobile upload]", e);
    res.status(500).json({ error: e.message });
  }
});

// Queue an invoice for desktop pickup
app.post("/api/mobile/queue", async (req, res) => {
  const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  const userId = await validateSupabaseJWT(token);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const inv = req.body;
  if (!inv || typeof inv !== "object") return res.status(400).json({ error: "no data" });
  const entry = { ...inv, id: ++_relayId, ts: Date.now(), user_id: userId, pending_sync: true, synced_at: null };
  const existing = relay.get(userId) ?? [];
  const trimmed = existing.length >= MAX_RELAY_PER_USER
    ? existing.slice(existing.length - MAX_RELAY_PER_USER + 1)
    : existing;
  relay.set(userId, [...trimmed, entry]);
  res.json({ ok: true, id: entry.id });
});

// Desktop polls this to get invoices waiting to sync
app.get("/api/mobile/pending", async (req, res) => {
  const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  const userId = await validateSupabaseJWT(token);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  pruneRelay();
  res.json({ invoices: relay.get(userId) ?? [] });
});

// Desktop calls this after saving invoices locally
app.post("/api/mobile/ack", async (req, res) => {
  const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  const userId = await validateSupabaseJWT(token);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const { ids } = req.body ?? {};
  if (Array.isArray(ids) && ids.length) {
    const rows = relay.get(userId) ?? [];
    relay.set(userId, rows.filter(r => !ids.includes(r.id)));
  }
  res.json({ ok: true });
});

// ── [MOBILE] Gemini extraction ────────────────────────────────────────────────

const GEMINI_MODEL = "gemini-3.6-flash";

const EXTRACTION_PROMPT_INVOICE = `You are an invoice data extractor for Indian businesses. Extract the following fields and respond ONLY with valid JSON, no explanation or markdown.

{
  "shopName": <business/merchant name as string or null>,
  "address": <full merchant/seller address as string or null>,
  "pincode": <6-digit Indian PIN code from merchant address as string or null>,
  "phone": <merchant phone number as string or null>,
  "invoiceNumber": <invoice/bill/receipt number as string or null>,
  "gstNumber": <merchant GSTIN e.g. 22AAAAA0000A1Z5 as string or null>,
  "gstPercent": <tax rate e.g. "18%" as string or null>,
  "gstAmountInr": <total GST/tax amount as number in INR or null>,
  "subtotalInr": <subtotal before GST/discount as number in INR or null>,
  "dateOfPurchase": <purchase date in YYYY-MM-DD format, assume ${new Date().getFullYear()} if year missing, or null>,
  "discountInr": <total discount as number in INR or null>,
  "finalPaymentInr": <grand total / net payable as number in INR or null>,
  "items": [
    {
      "name": <item/product/service name as string>,
      "quantity": <quantity as number, use 1 if not shown>,
      "unitPriceInr": <unit price in INR as number or null>,
      "discountInr": <per-item discount in INR as number or null>,
      "amountInr": <line total in INR as number>
    }
  ]
}

Rules: extract merchant/seller details only (NOT buyer). Amounts must be numbers in INR.`;

const EXTRACTION_PROMPT_SOCIETY = `You are a document data extractor for Indian residential societies and housing expenses.
This document may be a maintenance bill, rent receipt/agreement, insurance policy receipt, lift/equipment AMC invoice, utility bill, vendor quotation, AGM/meeting minutes, or other housing/society-related financial record.
Extract the following fields and respond ONLY with valid JSON, no explanation or markdown.

{
  "shopName": <society name / vendor / landlord / insurer / service company as string or null>,
  "address": <society or property address as string or null>,
  "pincode": <6-digit Indian PIN code as string or null>,
  "phone": <contact phone number as string or null>,
  "invoiceNumber": <bill number / receipt number / quotation number / agreement number / policy number as string or null>,
  "gstNumber": <GSTIN if present as string or null>,
  "gstPercent": <GST rate if shown e.g. "18%" as string or null>,
  "gstAmountInr": <GST/tax amount as number in INR or null>,
  "subtotalInr": <subtotal before taxes as number in INR or null>,
  "dateOfPurchase": <bill date / receipt date / quotation date / meeting date in YYYY-MM-DD format, assume ${new Date().getFullYear()} if year missing, or null>,
  "discountInr": <discount amount as number in INR or null>,
  "finalPaymentInr": <total amount due — maintenance total / monthly rent / insurance premium / AMC charge / quotation total — as number in INR or null>,
  "items": [{"name": <charge/scope description e.g. "Monthly Maintenance" / "Water Charges" / "Sinking Fund" / "Exterior Painting" / "Labour Charges">,"quantity": <qty, 1 if not shown>,"unitPriceInr": <unit price or null>,"discountInr": <discount or null>,"amountInr": <line amount>}],
  "validUntil": <quotation validity date in YYYY-MM-DD or null — quotations only>,
  "paymentTerms": <payment terms e.g. "50% advance, balance on completion" as string or null>,
  "warrantyPeriod": <warranty/defect-liability period e.g. "1 year" as string or null — quotations only>,
  "resolutionNo": <resolution number from meeting minutes as string or null — meeting records only>,
  "attendeeCount": <number of members present at meeting as string e.g. "42" or null — meeting records only>,
  "meetingType": <"AGM" / "SGM" / "EGM" / "Committee Meeting" or null — meeting records only>
}

Rules:
- Maintenance bills: shopName = society name; list each charge type as a separate item
- Rent receipts: shopName = landlord/property name; finalPaymentInr = monthly rent
- Insurance receipts: shopName = insurance company; finalPaymentInr = premium paid
- AMC/service: shopName = service vendor; finalPaymentInr = AMC amount
- Vendor quotations: shopName = vendor/contractor; finalPaymentInr = quoted total; populate validUntil, paymentTerms, warrantyPeriod where present
- AGM/meeting minutes: shopName = society name; dateOfPurchase = meeting date; populate resolutionNo, attendeeCount, meetingType; finalPaymentInr = null unless a specific expenditure was approved
- Leave quotation/meeting fields null for documents where they don't apply
- Amounts must be numbers in INR`;

const EXTRACTION_PROMPT_TAX = `You are a tax document data extractor for Indian tax and compliance documents.
This document may be an ITR acknowledgment, Challan 280, TDS certificate (Form 16/16A), Form 26AS, advance tax receipt, or GST filing receipt.
Extract the following fields and respond ONLY with valid JSON, no explanation or markdown.

{
  "shopName": <assessee name (taxpayer/employee) or deductor/employer name as string or null>,
  "address": <assessee or deductor address as string or null>,
  "pincode": <6-digit Indian PIN code as string or null>,
  "phone": null,
  "invoiceNumber": <challan number / acknowledgment number / TDS certificate number / BSR code as string or null>,
  "gstNumber": <PAN of assessee or deductor e.g. ABCDE1234F as string or null>,
  "gstPercent": <tax rate or surcharge rate if shown as string or null>,
  "gstAmountInr": <education cess + surcharge combined as number in INR or null>,
  "subtotalInr": <basic tax before cess/surcharge as number in INR or null>,
  "dateOfPurchase": <filing date / payment date in YYYY-MM-DD format, assume ${new Date().getFullYear()} if year missing, or null>,
  "discountInr": <TDS already deducted or advance tax paid as number in INR or null>,
  "finalPaymentInr": <total tax paid / TDS deducted / net tax amount as number in INR or null>,
  "items": [{"name": <tax component e.g. "Income Tax" / "Surcharge" / "Education Cess" / "Interest u/s 234B" / "TDS Deducted" / "Advance Tax Paid">,"quantity": 1,"unitPriceInr": null,"discountInr": null,"amountInr": <amount in INR>}]
}

Rules: ITR ack → shopName = assessee, invoiceNumber = ack number, gstNumber = PAN. Challan 280 → invoiceNumber = CRN/challan number, list each tax head as item. Form 16/16A → shopName = employer/deductor, gstNumber = employee PAN. Amounts must be numbers in INR.`;

const EXTRACTION_PROMPT_LEGAL = `You are a legal document data extractor for Indian property and legal documents.
This document may be a property sale deed, lease or rent agreement, vakalatnama, stamp duty receipt, property registration certificate, court fee receipt, or bar council membership receipt.
Extract the following fields and respond ONLY with valid JSON, no explanation or markdown.

{
  "shopName": <primary party name — seller / developer / landlord / client / authority / court as string or null>,
  "address": <property address or party address as string or null>,
  "pincode": <6-digit Indian PIN code as string or null>,
  "phone": null,
  "invoiceNumber": <deed number / registration number / case number / agreement number / receipt number as string or null>,
  "gstNumber": <registration number / stamp duty reference / CIN / bar council number / case number as string or null>,
  "gstPercent": <stamp duty rate or GST rate if shown as string or null>,
  "gstAmountInr": <stamp duty amount as number in INR or null>,
  "subtotalInr": <consideration / agreement value before charges as number in INR or null>,
  "dateOfPurchase": <execution date / registration date / agreement date in YYYY-MM-DD format, assume ${new Date().getFullYear()} if year missing, or null>,
  "discountInr": null,
  "finalPaymentInr": <total consideration / total fees paid / total amount as number in INR or null>,
  "items": [{"name": <charge e.g. "Stamp Duty" / "Registration Fee" / "Legal Fee" / "Court Fee" / "Bar Council Fee" / "Property Value">,"quantity": 1,"unitPriceInr": null,"discountInr": null,"amountInr": <amount in INR>}]
}

Rules: Sale deed → shopName = seller/developer, finalPaymentInr = total sale consideration, list stamp duty + registration fee as items. Lease/rent → shopName = landlord, finalPaymentInr = monthly rent or agreement value. Court fee → shopName = court name, invoiceNumber = case number. Amounts must be numbers in INR.`;

const EXTRACTION_PROMPT_CORPORATE = `You are a corporate document data extractor for Indian company and professional documents.
This document may be a share certificate, audit engagement letter, ICAI/ICSI membership receipt, ROC filing receipt, company incorporation document, or professional fee invoice.
Extract the following fields and respond ONLY with valid JSON, no explanation or markdown.

{
  "shopName": <company name / ICAI / ICSI / issuing authority as string or null>,
  "address": <company registered address as string or null>,
  "pincode": <6-digit Indian PIN code as string or null>,
  "phone": null,
  "invoiceNumber": <certificate number / membership number / receipt number / SRN / DIN as string or null>,
  "gstNumber": <CIN / folio number / PAN / GSTIN of company as string or null>,
  "gstPercent": <GST rate if applicable as string or null>,
  "gstAmountInr": <GST amount if applicable as number in INR or null>,
  "subtotalInr": null,
  "dateOfPurchase": <issue date / membership date / filing date in YYYY-MM-DD format, assume ${new Date().getFullYear()} if year missing, or null>,
  "discountInr": null,
  "finalPaymentInr": <total paid-up share value / membership fee / filing fee / audit fee as number in INR or null>,
  "items": [{"name": <component e.g. "Equity Shares" / "Preference Shares" / "Annual Membership Fee" / "Filing Fee" / "Audit Fee">,"quantity": <shares count or 1>,"unitPriceInr": <face value per share or null>,"discountInr": null,"amountInr": <total amount in INR>}]
}

Rules: Share certificate → shopName = company name, invoiceNumber = certificate number, gstNumber = folio number, items = share classes with quantity = number of shares and unitPriceInr = face value. ICAI/ICSI → invoiceNumber = membership number. Amounts must be numbers in INR.`;

const EXTRACTION_PROMPT_PAYROLL = `You are a payroll document data extractor for Indian salary payslips and compensation statements.
This document is a salary payslip, pay stub, or compensation statement.
Extract the following fields and respond ONLY with valid JSON, no explanation or markdown.

{
  "shopName": <employer / company name as string or null>,
  "address": <company address as string or null>,
  "pincode": <6-digit Indian PIN code as string or null>,
  "phone": null,
  "invoiceNumber": <employee ID / payslip number as string or null>,
  "gstNumber": <PAN of employee e.g. ABCDE1234F as string or null>,
  "gstPercent": null,
  "gstAmountInr": null,
  "subtotalInr": <total gross earnings (sum of all earnings) as number in INR or null>,
  "dateOfPurchase": <last day of pay period month in YYYY-MM-DD e.g. 2026-05-31 for May 2026, or null>,
  "discountInr": <total deductions amount as number in INR or null>,
  "finalPaymentInr": <net pay / take-home salary as number in INR or null>,
  "items": [{"name": <prefix ALL earnings with "EARN: " and ALL deductions with "DED: " e.g. "EARN: Basic Salary" / "EARN: HRA" / "DED: Provident Fund" / "DED: Income Tax">,"quantity": 1,"unitPriceInr": null,"discountInr": null,"amountInr": <positive amount in INR>}]
}

Rules: List ALL earnings first (prefixed "EARN: ") then ALL deductions (prefixed "DED: "). subtotalInr = total gross earnings. discountInr = total deductions. finalPaymentInr = net pay. gstNumber = employee PAN. Amounts must be positive numbers in INR.`;

const EXTRACTION_PROMPT_REALESTATE = `You are a real estate document data extractor for Indian property transactions. This document may be a sale deed, registration receipt, stamp duty challan, RERA payment, home loan statement, rental agreement, TDS 194IA challan, or capital gains worksheet. Extract the following fields and respond ONLY with valid JSON, no explanation or markdown.

{
  "shopName": <seller / developer / bank / registrar name as string or null>,
  "address": <property address as string or null>,
  "pincode": <6-digit property PIN code as string or null>,
  "phone": null,
  "invoiceNumber": <registration / challan / receipt number as string or null>,
  "gstNumber": <seller GSTIN or PAN as string or null>,
  "gstPercent": <GST percent as number or null>,
  "gstAmountInr": <GST amount in INR as number or null>,
  "subtotalInr": <property value / loan principal / stamp duty base as number in INR or null>,
  "dateOfPurchase": <transaction date in YYYY-MM-DD or null>,
  "discountInr": null,
  "finalPaymentInr": <total amount paid in INR as number or null>,
  "items": [{"name": <component e.g. "Stamp Duty" / "Registration Fee" / "TDS 194IA" / "RERA Advance" / "EMI Principal" / "EMI Interest" / "Property Value">,"quantity": 1,"unitPriceInr": null,"discountInr": null,"amountInr": <positive INR amount>}]
}

Rules: shopName = seller/developer/bank/registrar. invoiceNumber = document/challan/receipt number. subtotalInr = base property value or stamp duty base. TDS 194IA applies when property value > ₹50,00,000. Split EMI into "EMI Principal" and "EMI Interest" items. List stamp duty and registration fee as separate items. All amounts positive INR.`;

const EXTRACTION_PROMPT_ADVOCATE = `You are a legal professional document data extractor for Indian advocates and law firms. This document may be a court fee receipt, process fee receipt, stamp paper, vakalatnama, advocate fee invoice, law library subscription, or disbursement receipt. Extract the following fields and respond ONLY with valid JSON, no explanation or markdown.

{
  "shopName": <court / law firm / vendor / party name as string or null>,
  "address": <address as string or null>,
  "pincode": <6-digit PIN code as string or null>,
  "phone": null,
  "invoiceNumber": <case number / matter number / receipt number as string or null>,
  "gstNumber": <vendor GSTIN or bar registration number as string or null>,
  "gstPercent": <GST percent as number or null>,
  "gstAmountInr": <GST amount in INR as number or null>,
  "subtotalInr": <amount before GST in INR as number or null>,
  "dateOfPurchase": <date in YYYY-MM-DD or null>,
  "discountInr": null,
  "finalPaymentInr": <total amount paid in INR as number or null>,
  "items": [{"name": <component e.g. "Court Filing Fee" / "Process Fee" / "Stamp Paper" / "Advocate Fee" / "SCC Online Subscription" / "Manupatra Subscription" / "Travel Disbursement">,"quantity": 1,"unitPriceInr": null,"discountInr": null,"amountInr": <positive INR amount>}]
}

Rules: shopName = court/law firm/vendor. invoiceNumber = case/matter/receipt number. gstNumber = vendor GSTIN if available. subtotalInr = amount before GST. finalPaymentInr = total paid. All amounts positive INR.`;

const EXTRACTION_PROMPT_CA = `You are a professional services document data extractor for Indian Chartered Accountants and accounting firms. This document may be a professional fee invoice, audit fee invoice, ICAI seminar/CPE receipt, software subscription (Tally, ClearTax, Computax, MCA portal), DSC renewal, or GST challan. Extract the following fields and respond ONLY with valid JSON, no explanation or markdown.

{
  "shopName": <firm / client / vendor / ICAI / software vendor name as string or null>,
  "address": <address as string or null>,
  "pincode": <6-digit PIN code as string or null>,
  "phone": null,
  "invoiceNumber": <invoice / engagement / receipt number as string or null>,
  "gstNumber": <vendor GSTIN as string or null>,
  "gstPercent": <GST percent as number (usually 18% on professional services) or null>,
  "gstAmountInr": <GST amount in INR as number or null>,
  "subtotalInr": <amount before GST in INR as number or null>,
  "dateOfPurchase": <date in YYYY-MM-DD or null>,
  "discountInr": null,
  "finalPaymentInr": <total amount paid in INR as number or null>,
  "items": [{"name": <service e.g. "Statutory Audit Fee" / "Tax Audit Fee" / "GST Filing Fee" / "Tally Prime Subscription" / "ClearTax Subscription" / "ICAI CPE Seminar" / "DSC Renewal" / "Professional Fee">,"quantity": 1,"unitPriceInr": null,"discountInr": null,"amountInr": <positive INR amount>}]
}

Rules: gstNumber = vendor GSTIN. 18% GST typically applies on professional services. subtotalInr = amount before GST. finalPaymentInr = total including GST. Identify audit type in item name (statutory/tax/internal). All amounts positive INR.`;

const EXTRACTION_PROMPT_BOOKKEEPER = `You are a vendor invoice data extractor for Indian bookkeepers managing multiple client accounts. Extract all fields with special attention to GSTIN, HSN/SAC codes, and GST breakdown for purchase register compliance. Extract the following fields and respond ONLY with valid JSON, no explanation or markdown.

{
  "shopName": <vendor / supplier name as string or null>,
  "address": <vendor address as string or null>,
  "pincode": <6-digit vendor PIN code as string or null>,
  "phone": null,
  "invoiceNumber": <vendor invoice number as string or null>,
  "gstNumber": <vendor GSTIN — critical, extract carefully as 15-char code or null>,
  "gstPercent": <GST rate as number (0/5/12/18/28) or null>,
  "gstAmountInr": <total GST amount CGST+SGST or IGST in INR as number or null>,
  "subtotalInr": <taxable value before GST in INR as number or null>,
  "dateOfPurchase": <invoice date in YYYY-MM-DD or null>,
  "discountInr": <discount in INR as number or null>,
  "finalPaymentInr": <total invoice amount including GST in INR as number or null>,
  "items": [{"name": <item description with HSN/SAC code if visible e.g. "Office Supplies [HSN 4820]">,"quantity": <quantity as number>,"unitPriceInr": <unit price or null>,"discountInr": null,"amountInr": <positive line total in INR>}]
}

Rules: gstNumber = full 15-character GSTIN — extract with full accuracy. gstPercent = rate applied. subtotalInr = taxable value (for ITC). gstAmountInr = CGST+SGST or IGST total. Include HSN/SAC in item name. All amounts positive INR.`;

const EXTRACTION_PROMPT_FREELANCER = `You are an expense document data extractor for Indian freelancers and independent professionals. This document may be a software/tool subscription, project expense, professional fee receipt, co-working space invoice, internet/utility bill, or hardware purchase. Extract the following fields and respond ONLY with valid JSON, no explanation or markdown.

{
  "shopName": <vendor / client / service provider name as string or null>,
  "address": <vendor address as string or null>,
  "pincode": <6-digit PIN code as string or null>,
  "phone": null,
  "invoiceNumber": <invoice / order / receipt number as string or null>,
  "gstNumber": <vendor GSTIN as string or null>,
  "gstPercent": <GST percent as number or null>,
  "gstAmountInr": <GST amount in INR as number or null>,
  "subtotalInr": <amount before GST in INR as number or null>,
  "dateOfPurchase": <date in YYYY-MM-DD or null>,
  "discountInr": <discount in INR as number or null>,
  "finalPaymentInr": <total paid in INR as number or null>,
  "items": [{"name": <prefixed item e.g. "SOFTWARE: Figma Pro" / "SOFTWARE: GitHub Copilot" / "HARDWARE: External SSD" / "COWORK: Seat Rental" / "UTIL: Internet Bill" / "CLIENT FEE: Project Name">,"quantity": <quantity>,"unitPriceInr": <unit price or null>,"discountInr": null,"amountInr": <positive INR amount>}]
}

Rules: Prefix items with category: SOFTWARE / HARDWARE / COWORK / UTIL / CLIENT FEE / TRAVEL / MISC. Include billing period in software item name if visible. subtotalInr = amount before GST. finalPaymentInr = total paid. All amounts positive INR.`;

const EXTRACTION_PROMPT_NGO = `You are a financial document data extractor for Indian NGOs, charitable trusts, and non-profit societies. This document may be a donation receipt, 80G certificate, CSR grant receipt, project expense invoice, FCRA receipt, or staff payroll slip. Extract the following fields and respond ONLY with valid JSON, no explanation or markdown.

{
  "shopName": <donor / grantor / vendor / NGO name as string or null>,
  "address": <address as string or null>,
  "pincode": <6-digit PIN code as string or null>,
  "phone": null,
  "invoiceNumber": <receipt / certificate / grant reference / invoice number as string or null>,
  "gstNumber": <GSTIN or PAN of the organization as string or null>,
  "gstPercent": <GST percent or null>,
  "gstAmountInr": <GST amount in INR as number or null>,
  "subtotalInr": <amount before GST or total grant before deductions in INR as number or null>,
  "dateOfPurchase": <receipt or transaction date in YYYY-MM-DD or null>,
  "discountInr": null,
  "finalPaymentInr": <total amount received or paid in INR as number or null>,
  "items": [{"name": <description e.g. "Donation — General Corpus" / "CSR Grant — Health Camp" / "80G Certificate" / "Project Expense — Food Kits" / "FCRA Foreign Grant" / "Staff Salary">,"quantity": 1,"unitPriceInr": null,"discountInr": null,"amountInr": <positive INR amount>}]
}

Rules: Donation receipts — shopName = donor name; gstNumber = NGO PAN. 80G certificates — capture certificate number in invoiceNumber. CSR/grant — shopName = corporate or funding agency. FCRA — convert to INR equivalent. All amounts positive INR.`;

const EXTRACTION_PROMPT_PERSONAL = `You are a personal expense data extractor for individual household purchases in India. This document may be a grocery bill, pharmacy receipt, restaurant bill, utility bill, online order invoice, clothing receipt, or any personal purchase receipt. Extract the following fields and respond ONLY with valid JSON, no explanation or markdown.

{
  "shopName": <store / merchant / app name as string or null>,
  "address": <store address as string or null>,
  "pincode": <6-digit PIN code as string or null>,
  "phone": null,
  "invoiceNumber": <bill / order ID / receipt number as string or null>,
  "gstNumber": <merchant GSTIN if printed as string or null>,
  "gstPercent": <GST rate as string e.g. "18%" or null>,
  "gstAmountInr": <total GST amount in INR as number or null>,
  "subtotalInr": <subtotal before GST and discount in INR as number or null>,
  "dateOfPurchase": <purchase date in YYYY-MM-DD or null>,
  "discountInr": <discount / coupon / cashback in INR as number or null>,
  "finalPaymentInr": <grand total / amount paid in INR as number or null>,
  "items": [{"name": <product or service name>,"quantity": <quantity or 1>,"unitPriceInr": <unit price or null>,"discountInr": <per-item discount or null>,"amountInr": <line total in INR>}]
}

Rules: Capture all visible line items. For restaurant bills list each dish separately. For utility bills list each charge component separately. Amounts must be numbers in INR.`;

function getExtractionPrompt(mode, filename = "") {
  if (filename && /payslip|payroll|salaryslip|salary.?slip|paystub/i.test(filename)) return EXTRACTION_PROMPT_PAYROLL;
  if (mode === "society")        return EXTRACTION_PROMPT_SOCIETY;
  if (mode === "tax_consultant") return EXTRACTION_PROMPT_TAX;
  if (mode === "ca")             return EXTRACTION_PROMPT_CA;
  if (mode === "real_estate")    return EXTRACTION_PROMPT_REALESTATE;
  if (mode === "advocate")       return EXTRACTION_PROMPT_ADVOCATE;
  if (mode === "bookkeeper")     return EXTRACTION_PROMPT_BOOKKEEPER;
  if (mode === "freelancer")     return EXTRACTION_PROMPT_FREELANCER;
  if (mode === "ngo")            return EXTRACTION_PROMPT_NGO;
  if (mode === "personal")       return EXTRACTION_PROMPT_PERSONAL;
  return EXTRACTION_PROMPT_INVOICE;
}

const EXTRACTION_PROMPT = EXTRACTION_PROMPT_INVOICE;

async function extractWithGemini(fileBuf, mimeType, apiKey, mode, filename = "") {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [
        { inline_data: { mime_type: mimeType, data: fileBuf.toString("base64") } },
        { text: getExtractionPrompt(mode, filename) },
      ]}],
      generationConfig: { maxOutputTokens: 4096 },
    }),
  });
  if (!resp.ok) {
    const err = await resp.text().catch(() => resp.statusText);
    throw new Error(`Gemini ${resp.status}: ${err}`);
  }
  const d = await resp.json();
  let raw = (d?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}");
  raw = raw.replace(/^```json?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  if (!raw.startsWith("{")) {
    const m = raw.match(/\{[\s\S]*\}/);
    raw = m ? m[0] : "{}";
  }
  try { return JSON.parse(raw); } catch { return {}; }
}

async function extractWithOpenAI(fileBuf, mimeType, apiKey, mode, filename = "") {
  const b64 = fileBuf.toString("base64");
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: [
        { type: "image_url", image_url: { url: `data:${mimeType};base64,${b64}`, detail: "high" } },
        { type: "text", text: getExtractionPrompt(mode, filename) },
      ]}],
      max_tokens: 4096,
    }),
  });
  if (!resp.ok) {
    const err = await resp.text().catch(() => resp.statusText);
    throw new Error(`OpenAI ${resp.status}: ${err}`);
  }
  const d = await resp.json();
  let raw = (d?.choices?.[0]?.message?.content ?? "{}");
  raw = raw.replace(/^```json?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  if (!raw.startsWith("{")) { const m = raw.match(/\{[\s\S]*\}/); raw = m ? m[0] : "{}"; }
  try { return JSON.parse(raw); } catch { return {}; }
}

function isTaxOrFinanceDoc(data) {
  const text = [data.shopName ?? "", ...(data.items ?? []).map(it => it.name ?? "")].join(" ").toLowerCase();
  return [
    "income tax", "tds", "form 16", "form 26as", "gstr", "itr", "challan",
    "advance tax", "tax refund", "tax certificate",
    "insurance premium", "insurance policy", "bank statement", "mutual fund",
    "loan statement", "credit card statement", "salary slip", "payslip",
  ].some(k => text.includes(k));
}

async function getMobileUserEmail(userId) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !userId) return null;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` },
    });
    if (!r.ok) return null;
    return (await r.json()).email ?? null;
  } catch { return null; }
}

async function isMobileUserPro(userId) {
  const email = await getMobileUserEmail(userId);
  if (!email) return false;
  const { data } = await _sbService(`/user_plans?email=eq.${encodeURIComponent(email.toLowerCase())}&limit=1`);
  if (!data?.[0]) return false;
  const row = data[0];
  if (row.plan === "pro_paid" && row.status === "active") return true;
  if (row.plan === "pro_trial") {
    const endsAt = row.trial_ends_at ? new Date(row.trial_ends_at) : null;
    return endsAt ? endsAt > new Date() : false;
  }
  return false;
}

function base(req) {
  const proto = req.headers["x-forwarded-proto"] ?? req.protocol;
  const host  = req.headers["x-forwarded-host"]  ?? req.headers.host;
  return `${proto}://${host}`;
}

// ── [DESKTOP] Google login ────────────────────────────────────────────────────

app.get("/auth/google/login/start", (req, res) => {
  const returnTo = sanitizeReturnTo(req.query.return_to ?? LOCAL_APP);
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
    client_id:     GOOGLE_CLIENT_ID,
    redirect_uri:  `${base(req)}/auth/google/login/callback`,
    response_type: "code",
    scope:         GOOGLE_LOGIN_SCOPE,
    access_type:   "online",
    state:         JSON.stringify({ flow: "google_login", returnTo }),
  })}`);
});

app.get("/auth/google/login/callback", async (req, res) => {
  const { code } = req.query;
  let returnTo = LOCAL_APP;
  try { returnTo = sanitizeReturnTo(JSON.parse(req.query.state ?? "{}").returnTo ?? LOCAL_APP); } catch {}
  if (!code) return res.redirect(`${returnTo}/#error=oauth_denied`);
  try {
    const t = await (await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, redirect_uri: `${base(req)}/auth/google/login/callback`, grant_type: "authorization_code" }),
    })).json();
    if (!t.access_token) throw new Error("no token");
    const p = await (await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${t.access_token}` },
    })).json();
    res.redirect(`${returnTo}/#${new URLSearchParams({ google_login_email: p.email ?? "", google_login_name: p.name ?? "" })}`);
  } catch { res.redirect(`${returnTo}/#error=oauth_failed`); }
});

// ── [DESKTOP] Gmail ───────────────────────────────────────────────────────────

app.get("/auth/gmail/start", (req, res) => {
  const returnTo = sanitizeReturnTo(req.query.return_to ?? LOCAL_APP);
  const params = new URLSearchParams({
    client_id:     GOOGLE_CLIENT_ID,
    redirect_uri:  `${base(req)}/auth/gmail/callback`,
    response_type: "code",
    scope:         GMAIL_SCOPE,
    access_type:   "offline",
    prompt:        "consent",
    state:         JSON.stringify({ flow: "gmail", returnTo }),
  });
  if (req.query.login_hint) params.set("login_hint", req.query.login_hint);
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

app.get("/auth/gmail/callback", async (req, res) => {
  const { code } = req.query;
  let returnTo = LOCAL_APP;
  try { returnTo = sanitizeReturnTo(JSON.parse(req.query.state ?? "{}").returnTo ?? LOCAL_APP); } catch {}
  if (!code) return res.redirect(`${returnTo}/#error=oauth_denied`);
  try {
    const t = await (await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, redirect_uri: `${base(req)}/auth/gmail/callback`, grant_type: "authorization_code" }),
    })).json();
    if (!t.access_token) throw new Error("no token");
    const prof = await (await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${t.access_token}` },
    })).json();
    const hp = { gmail_access_token: t.access_token, gmail_email: prof.email ?? "" };
    if (t.refresh_token) hp.gmail_refresh_token = t.refresh_token;
    res.redirect(`${returnTo}/#${new URLSearchParams(hp)}`);
  } catch { res.redirect(`${returnTo}/#error=oauth_failed`); }
});

app.get("/auth/gmail/refresh", async (req, res) => {
  const { refresh_token } = req.query;
  if (!refresh_token) return res.status(400).end();
  try {
    const t = await (await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, refresh_token, grant_type: "refresh_token" }),
    })).json();
    if (!t.access_token) throw new Error("no token");
    res.json({ access_token: t.access_token });
  } catch { res.status(401).end(); }
});

// ── [DESKTOP] Outlook ─────────────────────────────────────────────────────────

app.get("/auth/outlook/start", (req, res) => {
  const returnTo = sanitizeReturnTo(req.query.return_to ?? LOCAL_APP);
  const params = new URLSearchParams({
    client_id:     AZURE_CLIENT_ID,
    redirect_uri:  `${base(req)}/auth/outlook/callback`,
    response_type: "code",
    scope:         OUTLOOK_SCOPE,
    response_mode: "query",
    state:         JSON.stringify({ flow: "outlook", returnTo }),
  });
  if (req.query.login_hint) params.set("login_hint", req.query.login_hint);
  res.redirect(`https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params}`);
});

app.get("/auth/outlook/callback", async (req, res) => {
  const { code } = req.query;
  let returnTo = LOCAL_APP;
  try { returnTo = sanitizeReturnTo(JSON.parse(req.query.state ?? "{}").returnTo ?? LOCAL_APP); } catch {}
  if (!code) return res.redirect(`${returnTo}/#error=oauth_denied`);
  try {
    const t = await (await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: AZURE_CLIENT_ID, client_secret: AZURE_CLIENT_SECRET, redirect_uri: `${base(req)}/auth/outlook/callback`, grant_type: "authorization_code", scope: OUTLOOK_SCOPE }),
    })).json();
    if (!t.access_token) throw new Error("no token");
    const prof = await (await fetch("https://graph.microsoft.com/v1.0/me", {
      headers: { Authorization: `Bearer ${t.access_token}` },
    })).json();
    res.redirect(`${returnTo}/#${new URLSearchParams({ outlook_access_token: t.access_token, outlook_email: prof.mail ?? prof.userPrincipalName ?? "" })}`);
  } catch { res.redirect(`${returnTo}/#error=oauth_failed`); }
});

// ── [DESKTOP] Gemini proxy (keeps API key server-side, avoids CORS) ──────────

const GEMINI_API_KEY  = process.env.GEMINI_API_KEY  || process.env.VITE_GEMINI_API_KEY  || "";
const OPENAI_API_KEY  = process.env.OPENAI_API_KEY  || "";

// Strip personal identifiers from invoice text before sending to Gemini (DPDPA compliance)
function sanitizePII(text) {
  if (typeof text !== "string") return text;
  const GSTIN_RE = /\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]\b/g;
  const gstins = [];
  const guarded = text.replace(GSTIN_RE, (m) => { gstins.push(m); return `__G${gstins.length - 1}__`; });
  let out = guarded
    .replace(/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, "[AADHAAR]")
    .replace(/\b\d{4}[\s-]\d{4}[\s-]\d{4}[\s-]\d{4}\b/g, "[CARD]")
    .replace(/\b[A-Z]{5}\d{4}[A-Z]\b/g, "[PAN]");
  gstins.forEach((g, i) => { out = out.replace(`__G${i}__`, g); });
  return out;
}

function sanitizeGeminiBody(body) {
  const contents = body?.contents;
  if (!Array.isArray(contents)) return body;
  return {
    ...body,
    contents: contents.map((c) => ({
      ...c,
      parts: Array.isArray(c.parts)
        ? c.parts.map((p) => p.text ? { ...p, text: sanitizePII(p.text) } : p)
        : c.parts,
    })),
  };
}

app.post("/api/gemini", async (req, res) => {
  const userKey = (req.headers["x-gemini-key"] ?? "").toString().trim();
  const effectiveKey = userKey || GEMINI_API_KEY;
  if (!effectiveKey) return res.status(503).json({ error: "No Gemini API key configured. Add your key in Settings → API Keys." });
  const { model = "gemini-3.5-flash-lite", ...body } = req.body ?? {};
  try {
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${effectiveKey}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sanitizeGeminiBody(body)) },
    );
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── Sarvam AI proxy (Indian-language LLM — avoids CORS + keeps key server-side) ─
const SARVAM_API_KEY = process.env.SARVAM_API_KEY ?? "";

app.post("/api/sarvam", async (req, res) => {
  if (!SARVAM_API_KEY) return res.status(503).json({ error: "SARVAM_API_KEY not configured on server" });
  try {
    const upstream = await fetch("https://api.sarvam.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-subscription-key": SARVAM_API_KEY },
      body: JSON.stringify(req.body ?? {}),
    });
    const data = await upstream.json();
    if (!upstream.ok) console.error("[sarvam] error", upstream.status, JSON.stringify(data));
    res.status(upstream.status).json(data);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.post("/api/openai", async (req, res) => {
  const userKey = (req.headers["x-openai-key"] ?? "").toString().trim();
  const effectiveKey = userKey || OPENAI_API_KEY;
  if (!effectiveKey) return res.status(503).json({ error: "No OpenAI API key configured on the server." });
  try {
    const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${effectiveKey}` },
      body: JSON.stringify(req.body ?? {}),
    });
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── [WEB] Custom OTP auth — bypasses Supabase SMTP ───────────────────────────
//  Flow: client → POST /api/auth/send-otp  → server generates code, emails via Resend
//        client → POST /api/auth/verify-otp → server verifies code, returns Supabase token_hash
//        client → sb.auth.verifyOtp({ token_hash, type:"magiclink" }) → gets session

const _otpStore = new Map(); // email → { code, expiresAt }

const RESEND_API_KEY    = process.env.RESEND_API_KEY    ?? "";
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? "onboarding@resend.dev";
const ADMIN_EMAIL       = process.env.ADMIN_EMAIL       ?? "ajaythak75@gmail.com";
// Super admin has full access; falls back to ADMIN_EMAIL so existing deploys stay super-admin by default.
const SUPER_ADMIN_EMAIL = (process.env.SUPER_ADMIN_EMAIL ?? ADMIN_EMAIL).toLowerCase();

async function _sendEmail(to, subject, html) {
  if (!RESEND_API_KEY) throw new Error("Email service not configured (RESEND_API_KEY missing).");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from:    `jInvoice <${RESEND_FROM_EMAIL}>`,
      to:      [to],
      subject,
      html,
    }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message ?? `Resend error ${res.status}`);
  }
}

app.post("/api/auth/send-otp", async (req, res) => {
  const { email } = req.body ?? {};
  if (!email || !email.includes("@")) return res.status(400).json({ error: "Valid email required" });

  // Allowlist check — only users in allowed_users can log in.
  // Admin email always bypasses the check.
  const emailLower = email.toLowerCase();
  const isAdmin = (ADMIN_EMAIL && emailLower === ADMIN_EMAIL.toLowerCase()) ||
                  emailLower === SUPER_ADMIN_EMAIL;
  if (!isAdmin && SUPABASE_URL && SUPABASE_SERVICE_KEY) {
    try {
      const chk = await fetch(
        `${SUPABASE_URL}/rest/v1/allowed_users?email=eq.${encodeURIComponent(emailLower)}&select=email&limit=1`,
        { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } }
      );
      const rows = await chk.json();
      if (!chk.ok || !Array.isArray(rows)) {
        console.error("[auth] allowed_users check error:", JSON.stringify(rows));
        return res.status(503).json({ error: "Access check unavailable. Please try again shortly." });
      }
      if (rows.length === 0) {
        return res.status(403).json({ error: "This email is not registered for access. Contact the admin to request access." });
      }
    } catch (e) {
      console.error("[auth] allowed_users fetch failed:", e);
      return res.status(503).json({ error: "Access check unavailable. Please try again shortly." });
    }
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  _otpStore.set(email.toLowerCase(), { code, expiresAt: Date.now() + 600_000 });
  // Hard 20-second timeout so a blocked SMTP port doesn't hang the browser
  const timeout = setTimeout(() => {
    if (!res.headersSent) res.status(504).json({ error: "Email send timed out. Try again." });
  }, 20_000);
  try {
    await _sendEmail(
      email,
      "Your jInvoice login code",
      `<div style="font-family:sans-serif;max-width:420px;margin:40px auto;padding:32px;border:1px solid #e5e7eb;border-radius:12px">
        <h2 style="margin:0 0 8px;color:#111">jInvoice</h2>
        <p style="margin:0 0 24px;color:#555">Your one-time login code:</p>
        <p style="font-size:36px;font-weight:700;letter-spacing:10px;color:#4f46e5;margin:0 0 24px">${code}</p>
        <p style="margin:0;color:#888;font-size:13px">Expires in 10 minutes. Do not share this code.</p>
      </div>`
    );
    clearTimeout(timeout);
    if (!res.headersSent) res.json({ ok: true });
  } catch (e) {
    clearTimeout(timeout);
    if (!res.headersSent) res.status(500).json({ error: String(e) });
  }
});

app.post("/api/auth/verify-otp", async (req, res) => {
  const { email, code } = req.body ?? {};
  if (!email || !code) return res.status(400).json({ error: "email and code required" });
  const stored = _otpStore.get(email.toLowerCase());
  if (!stored || stored.code !== String(code) || Date.now() > stored.expiresAt) {
    return res.status(401).json({ error: "Invalid or expired code" });
  }
  _otpStore.delete(email.toLowerCase());
  // TODO: magic link — re-enable when Resend domain is verified
  // if (!SUPABASE_SERVICE_KEY || !SUPABASE_URL) {
  //   return res.json({ ok: true });
  // }
  // try {
  //   await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
  //     method: "POST",
  //     headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json" },
  //     body: JSON.stringify({ email, email_confirm: true }),
  //   });
  //   const linkRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
  //     method: "POST",
  //     headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json" },
  //     body: JSON.stringify({ type: "magiclink", email }),
  //   });
  //   if (!linkRes.ok) {
  //     console.error("[auth] generate_link failed:", await linkRes.text());
  //     return res.status(500).json({ error: "Session creation failed" });
  //   }
  //   const linkData = await linkRes.json();
  //   res.json({ token_hash: linkData.hashed_token });
  // } catch (e) {
  //   res.status(500).json({ error: String(e) });
  // }

  // Issue a signed session token
  const sessionToken = _signToken(email.toLowerCase());

  // Upsert user_plans — create free row on first login, ignore if already exists
  _sbService("/user_plans", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
    body: JSON.stringify({ email: email.toLowerCase(), plan: "free", status: "active", trial_used: false, updated_at: new Date().toISOString() }),
  }).then(({ status }) => {
    // status 201 = row was created (genuine first login); 200 with ignore-duplicates = already existed
    if (status === 201) _logPlanEvent(email.toLowerCase(), "plan_created", { plan: "free" });
  }).catch((e) => console.error("[auth] user_plans upsert:", e));

  res.json({ ok: true, token: sessionToken });
});

// ── Reminder email ─────────────────────────────────────────────────────────────

app.post("/api/send-reminder", async (req, res) => {
  const { email, subject, html } = req.body ?? {};
  if (!email || !subject) return res.status(400).json({ error: "email and subject required" });
  try {
    await _sendEmail(email, subject, html ?? `<p>${subject}</p>`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── Subscription / plan endpoints ─────────────────────────────────────────────

function _planToken(req) {
  return ((req.headers.authorization ?? "").replace(/^Bearer\s+/i, "").trim() || "");
}

const _FREE_PLAN = { plan: "free", status: "active", trial_used: false, trial_started_at: null, trial_ends_at: null, paid_from: null, paid_until: null, cancelled_at: null, refund_requested_at: null };

app.get("/api/subscription", async (req, res) => {
  const email = _verifyToken(_planToken(req));
  if (!email) return res.status(401).json({ error: "unauthorized" });
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return res.json(_FREE_PLAN);
  const { data } = await _sbService(`/user_plans?email=eq.${encodeURIComponent(email)}&limit=1`);
  const row = Array.isArray(data) ? data[0] : null;
  if (!row) {
    // First login via old path — create row now
    await _sbService("/user_plans", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=representation" }, body: JSON.stringify({ email, ...Object.fromEntries(Object.entries(_FREE_PLAN)), updated_at: new Date().toISOString() }) });
    return res.json(_FREE_PLAN);
  }
  res.json(row);
});

// Returns true if the email is in the allowed_users table (Pro access whitelist).
// Falls open (allow) only when Supabase is not configured at all.
async function _isAllowedForPro(email) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return true;
  const r = await _sbService(`/allowed_users?email=eq.${encodeURIComponent(email.toLowerCase())}&select=email&limit=1`);
  return Array.isArray(r.data) && r.data.length > 0;
}

app.post("/api/subscription/start-trial", async (req, res) => {
  const email = _verifyToken(_planToken(req));
  if (!email) return res.status(401).json({ error: "unauthorized" });
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return res.status(503).json({ error: "Supabase not configured" });

  // Whitelist check — only allowed users can start Pro trial
  const allowed = await _isAllowedForPro(email);
  if (!allowed) return res.status(403).json({ error: "approval_required" });

  const { data: rows } = await _sbService(`/user_plans?email=eq.${encodeURIComponent(email)}&limit=1`);
  const row = Array.isArray(rows) ? rows[0] : null;
  if (row?.trial_used) return res.status(400).json({ error: "Trial already used for this account." });
  const settings = await _getConfig("plan_settings");
  const trialDays = (settings?.trial_days ?? 14);
  const now = new Date();
  const trialEnds = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000);
  const patch = { plan: "pro_trial", status: "active", trial_used: true, trial_started_at: now.toISOString(), trial_ends_at: trialEnds.toISOString(), updated_at: now.toISOString() };
  const { ok: uok, status: ustatus, data: updated } = await _upsertPlan(email, patch);
  if (!uok) return res.status(500).json({ error: "DB update failed", detail: updated, dbStatus: ustatus });
  _logPlanEvent(email, "trial_started", { trial_ends_at: trialEnds.toISOString() });
  res.json(updated ?? { ...row, ...patch });
});

// POST /api/subscription/request-pro — user requests Pro access; emails admin
app.post("/api/subscription/request-pro", async (req, res) => {
  const email = _verifyToken(_planToken(req));
  if (!email) return res.status(401).json({ error: "unauthorized" });
  try {
    await _sendEmail(
      ADMIN_EMAIL,
      `jInvoice Pro Access Request — ${email}`,
      `<div style="font-family:sans-serif;max-width:480px;margin:40px auto;padding:32px;border:1px solid #e5e7eb;border-radius:12px">
        <h2 style="margin:0 0 8px;color:#111">Pro Access Request</h2>
        <p style="color:#555;margin-top:0">A user is requesting Pro access on jInvoice:</p>
        <p style="font-size:20px;font-weight:700;color:#4f46e5;margin:16px 0">${email}</p>
        <p style="color:#555">To approve, add this email to the <strong>allowed_users</strong> table in Supabase:</p>
        <pre style="background:#f3f4f6;padding:12px;border-radius:6px;font-size:13px;overflow-x:auto">INSERT INTO allowed_users (email)
VALUES ('${email.replace(/'/g, "''")}')
ON CONFLICT (email) DO NOTHING;</pre>
        <p style="color:#888;font-size:12px;margin-top:16px">Once added, the user can start their 14-day Pro trial from the Pricing screen.</p>
      </div>`
    );
    res.json({ ok: true });
  } catch (e) {
    console.error("[request-pro] email failed:", e);
    res.status(500).json({ error: "Failed to send request email. Try again." });
  }
});

app.post("/api/subscription/cancel", async (req, res) => {
  const email = _verifyToken(_planToken(req));
  if (!email) return res.status(401).json({ error: "unauthorized" });
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return res.status(503).json({ error: "Supabase not configured" });
  const now = new Date().toISOString();
  const { data: current } = await _sbService(`/user_plans?email=eq.${encodeURIComponent(email)}&limit=1`);
  const currentPlan = (Array.isArray(current) ? current[0] : null)?.plan ?? "unknown";
  const patch = { plan: "free", status: "cancelled", cancelled_at: now, updated_at: now };
  const { ok: uok, status: ustatus, data: updated } = await _upsertPlan(email, patch);
  if (!uok) return res.status(500).json({ error: "DB update failed", detail: updated, dbStatus: ustatus });
  _logPlanEvent(email, "cancelled", { from_plan: currentPlan });
  res.json(updated ?? { ..._FREE_PLAN, ...patch });
});

// ── Dummy payment ─────────────────────────────────────────────────────────────
app.post("/api/payment/dummy-activate", async (req, res) => {
  const email = _verifyToken(_planToken(req));
  if (!email) return res.status(401).json({ error: "unauthorized" });
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return res.status(503).json({ error: "Supabase not configured" });
  const now = new Date().toISOString();
  const paidUntil = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  const { apiOption, billing } = req.body ?? {};
  const patch = {
    plan: "pro_paid",
    status: "active",
    trial_used: true,
    paid_from: now,
    paid_until: paidUntil,
    cancelled_at: null,
    updated_at: now,
  };
  const { ok: uok, status: ustatus, data: updated } = await _upsertPlan(email, patch);
  if (!uok) return res.status(500).json({ error: "DB update failed", detail: updated, dbStatus: ustatus });
  _logPlanEvent(email, "pro_activated", { via: "dummy_payment", api_option: apiOption ?? "shared", billing: billing ?? "monthly" });
  res.json(updated ?? { email, ...patch });
});

// ── Admin endpoints ────────────────────────────────────────────────────────────

// Returns the caller's email if they are admin OR super admin; null otherwise.
function _requireAdmin(req, res) {
  const email = _verifyToken(_planToken(req));
  if (!email) { res.status(401).json({ error: "unauthorized" }); return null; }
  const em = email.toLowerCase();
  const isAdminRole = (ADMIN_EMAIL && em === ADMIN_EMAIL.toLowerCase()) || em === SUPER_ADMIN_EMAIL;
  if (!isAdminRole) { res.status(403).json({ error: "forbidden" }); return null; }
  return email;
}

// Returns the caller's email only if they are the super admin; null otherwise.
function _requireSuperAdmin(req, res) {
  const email = _verifyToken(_planToken(req));
  if (!email) { res.status(401).json({ error: "unauthorized" }); return null; }
  if (email.toLowerCase() !== SUPER_ADMIN_EMAIL) {
    res.status(403).json({ error: "forbidden: super admin only" }); return null;
  }
  return email;
}

// GET /api/admin/role — returns caller's admin role
app.get("/api/admin/role", (req, res) => {
  const email = _verifyToken(_planToken(req));
  if (!email) return res.status(401).json({ error: "unauthorized" });
  const em = email.toLowerCase();
  if (em === SUPER_ADMIN_EMAIL) return res.json({ role: "super_admin" });
  if (ADMIN_EMAIL && em === ADMIN_EMAIL.toLowerCase()) return res.json({ role: "admin" });
  return res.status(403).json({ error: "forbidden" });
});

// GET /api/admin/users — all users with current plan
app.get("/api/admin/users", async (req, res) => {
  if (!_requireAdmin(req, res)) return;
  const { data } = await _sbService("/user_plans?order=updated_at.desc&limit=200");
  res.json(Array.isArray(data) ? data : []);
});

// GET /api/admin/users/:email/events — plan history for one user
app.get("/api/admin/users/:email/events", async (req, res) => {
  if (!_requireAdmin(req, res)) return;
  const email = decodeURIComponent(req.params.email).toLowerCase();
  const { data } = await _sbService(`/user_plan_events?email=eq.${encodeURIComponent(email)}&order=created_at.desc&limit=50`);
  res.json(Array.isArray(data) ? data : []);
});

// POST /api/admin/users/add — add user to allowed_users and create free plan row
app.post("/api/admin/users/add", async (req, res) => {
  if (!_requireAdmin(req, res)) return;
  const { email } = req.body ?? {};
  if (!email || !email.includes("@")) return res.status(400).json({ error: "Invalid email" });
  const emailLower = email.toLowerCase();
  await _sbService("/allowed_users", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify({ email: emailLower }),
  });
  const { status } = await _sbService("/user_plans", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify({ email: emailLower, plan: "free", status: "active", trial_used: false, updated_at: new Date().toISOString() }),
  });
  if (status === 201) _logPlanEvent(emailLower, "plan_created", { plan: "free", by: "admin" });
  res.json({ ok: true });
});

// PATCH /api/admin/users/:email/plan — manually set a user's plan
app.patch("/api/admin/users/:email/plan", async (req, res) => {
  if (!_requireAdmin(req, res)) return;
  const email = decodeURIComponent(req.params.email).toLowerCase();
  const { plan } = req.body ?? {};
  if (!["free", "pro_trial", "pro_paid"].includes(plan)) return res.status(400).json({ error: "Invalid plan" });
  const now = new Date();
  const patch = { plan, status: "active", updated_at: now.toISOString() };
  if (plan === "pro_trial") {
    const settings = await _getConfig("plan_settings");
    const trialDays = settings?.trial_days ?? 14;
    const trialEnds = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000);
    patch.trial_used = true;
    patch.trial_started_at = now.toISOString();
    patch.trial_ends_at = trialEnds.toISOString();
  }
  if (plan === "pro_paid") {
    patch.paid_from = now.toISOString();
    patch.paid_until = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString();
  }
  if (plan === "free") {
    patch.status = "cancelled";
    patch.cancelled_at = now.toISOString();
  }
  const { ok: uok, status: ustatus, data: saved } = await _upsertPlan(email, patch);
  if (!uok) return res.status(500).json({ error: "DB update failed", detail: saved, dbStatus: ustatus });
  const eventName = plan === "pro_paid" ? "pro_activated" : plan === "pro_trial" ? "trial_started" : "cancelled";
  _logPlanEvent(email, eventName, { by: "admin", plan });
  res.json(saved ?? patch);
});

// PATCH /api/admin/users/:email/features — toggle per-user feature flags (cloud_upload_enabled, etc.)
app.patch("/api/admin/users/:email/features", async (req, res) => {
  if (!_requireAdmin(req, res)) return;
  const email = decodeURIComponent(req.params.email).toLowerCase();
  const allowed = ["cloud_upload_enabled"];
  const patch = {};
  for (const key of allowed) {
    if (key in (req.body ?? {})) patch[key] = Boolean(req.body[key]);
  }
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: "No valid feature flags provided" });
  patch.updated_at = new Date().toISOString();
  const { ok, data } = await _upsertPlan(email, patch);
  if (!ok) return res.status(500).json({ error: "DB update failed" });
  res.json(data ?? patch);
});

// PATCH /api/subscription/profile — authenticated user reports their active profile;
// stored in user_plans.profile so admin bulk-apply can target by profile type.
app.patch("/api/subscription/profile", async (req, res) => {
  const email = _verifyToken(_planToken(req));
  if (!email) return res.status(401).json({ error: "unauthorized" });
  const profile = (req.body?.profile ?? "personal").toString().trim() || "personal";
  const { ok } = await _upsertPlan(email, { profile, updated_at: new Date().toISOString() });
  res.json({ ok });
});

// POST /api/admin/profiles/apply-cloud-upload — reads profile_cloud_upload config and
// bulk-updates user_plans.cloud_upload_enabled for all users per their stored profile.
app.post("/api/admin/profiles/apply-cloud-upload", async (req, res) => {
  if (!_requireSuperAdmin(req, res)) return;
  const cfg = await _getConfig("profile_cloud_upload");
  if (!cfg) return res.status(500).json({ error: "profile_cloud_upload config not found" });
  const results = {};
  for (const [profile, cloudEnabled] of Object.entries(cfg)) {
    const { ok, status } = await _sbService(
      `/user_plans?profile=eq.${encodeURIComponent(profile)}`,
      { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ cloud_upload_enabled: Boolean(cloudEnabled), updated_at: new Date().toISOString() }) },
    );
    results[profile] = ok ? "ok" : `error:${status}`;
  }
  res.json({ applied: results });
});

// DELETE /api/admin/users/:email/access — remove from allowed_users
app.delete("/api/admin/users/:email/access", async (req, res) => {
  if (!_requireAdmin(req, res)) return;
  const email = decodeURIComponent(req.params.email).toLowerCase();
  await _sbService(`/allowed_users?email=eq.${encodeURIComponent(email)}`, { method: "DELETE" });
  res.json({ ok: true });
});

// ── App config (pricing, upload limits, profiles) ─────────────────────────────

const CONFIG_DEFAULTS = {
  plan_pricing: {
    shared: { monthly: 999,  yearly: 9999 },
    own:    { monthly: 499,  yearly: 4999 },
  },
  upload_limits: { free: 5, pro_trial: 50, pro_paid: -1 },
  profile_enabled: {
    personal: true, society: true, shopkeeper: true, tax_consultant: true,
    ca: true, real_estate: true, advocate: true, bookkeeper: true, freelancer: true, ngo: true,
  },
  profile_cloud_upload: {
    personal: true, society: true, shopkeeper: true, tax_consultant: true,
    ca: true, real_estate: true, advocate: true, bookkeeper: true, freelancer: true, ngo: true,
  },
  plan_settings: {
    trial_days: 14,
    support_response: { free: "7 days", pro_trial: "7 days", pro: "48 hours" },
  },
};

async function _getConfig(key) {
  const { ok, data } = await _sbService(`/app_config?key=eq.${key}&select=value`);
  if (ok && Array.isArray(data) && data.length > 0) return data[0].value;
  return CONFIG_DEFAULTS[key] ?? null;
}

async function _setConfig(key, value) {
  return _sbService("/app_config?on_conflict=key", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }),
  });
}

// GET /api/config/:key — public read (for PricingScreen, upload enforcement)
app.get("/api/config/:key", async (req, res) => {
  const allowed = Object.keys(CONFIG_DEFAULTS);
  if (!allowed.includes(req.params.key)) return res.status(404).json({ error: "Unknown config key" });
  res.json(await _getConfig(req.params.key));
});

// GET /api/admin/config/:key — super admin read
app.get("/api/admin/config/:key", async (req, res) => {
  if (!_requireSuperAdmin(req, res)) return;
  const allowed = Object.keys(CONFIG_DEFAULTS);
  if (!allowed.includes(req.params.key)) return res.status(404).json({ error: "Unknown config key" });
  res.json(await _getConfig(req.params.key));
});

// PUT /api/admin/config/:key — super admin write
app.put("/api/admin/config/:key", async (req, res) => {
  if (!_requireSuperAdmin(req, res)) return;
  const allowed = Object.keys(CONFIG_DEFAULTS);
  if (!allowed.includes(req.params.key)) return res.status(404).json({ error: "Unknown config key" });
  const { ok, data } = await _setConfig(req.params.key, req.body);
  if (!ok) return res.status(500).json({ error: "Failed to save config" });
  res.json(Array.isArray(data) ? data[0] : data);
});

// ── IMAP — credentials passed in request body, stored in client localStorage ──
//  No Supabase JWT required. Client stores { email, appPassword } in localStorage
//  and sends them with every test/poll request.

// ImapFlow stores struct.type as the full MIME type string, e.g. "text/html",
// "application/pdf", "multipart/alternative" — there is no separate subtype field.
// struct.part is the IMAP part number ("1", "1.2", etc.); absent on the root node.
function _findPdfParts(struct) {
  if (!struct) return [];
  const mime = (struct.type ?? "").toLowerCase();
  const filename = struct.disposition?.parameters?.filename
    ?? struct.parameters?.name
    ?? struct.disposition?.parameters?.["filename*"] ?? "";
  const isPdf = mime === "application/pdf"
    || (mime === "application/octet-stream" && filename.toLowerCase().endsWith(".pdf"));
  if (isPdf) return [{ id: struct.part || "1", name: filename || "invoice.pdf" }];
  const parts = [];
  for (const child of (struct.childNodes ?? [])) parts.push(..._findPdfParts(child));
  return parts;
}

// Find the first text/html part in a MIME tree (for HTML invoice fallback)
function _findHtmlPart(struct) {
  if (!struct) return null;
  if ((struct.type ?? "").toLowerCase() === "text/html") return { id: struct.part || "1" };
  for (const child of (struct.childNodes ?? [])) {
    const found = _findHtmlPart(child);
    if (found) return found;
  }
  return null;
}

// Heuristic: does the HTML content look like an invoice, receipt, or financial transaction?
function _looksLikeInvoice(html) {
  const lower = html.toLowerCase();
  const hits = [
    // Standard invoice/receipt terms
    "invoice", "receipt", "bill", "payment", "amount due", "total", "order",
    "subscription", "tax", "due date",
    // Investment / transaction terms (Groww, Zerodha, Kite, mutual funds, etc.)
    "transaction", "purchase", "statement", "amount", "debit", "credit",
    "units", "folio", "confirmation", "invested", "redeemed", "sip",
    "mutual fund", "nav", "₹", "inr",
  ].filter(kw => lower.includes(kw)).length;
  return hits >= 2;
}

// Diagnostic: list mailboxes + count emails + sample attachment status
app.post("/api/imap/diagnose", async (req, res) => {
  const { email, appPassword } = req.body ?? {};
  if (!email || !appPassword) return res.status(400).json({ error: "email and appPassword required" });
  const { ImapFlow } = await import("imapflow");
  const client = new ImapFlow({
    host: "imap.gmail.com", port: 993, secure: true,
    auth: { user: email, pass: appPassword },
    logger: false,
  });
  try {
    await client.connect();
    const list = await client.list("", "*");
    const mailboxes = list.map(m => ({
      path: m.path,
      name: m.name,
      specialUse: m.specialUse ?? null,
      flags: m.flags ? [...m.flags] : [],
    }));

    const since = new Date();
    since.setMonth(since.getMonth() - 3);

    // Find All Mail folder (same logic as poll)
    const allMailFolder = list.find(m => /all\s*mail/i.test(m.name) || m.specialUse === "\\All");
    const targetFolder = allMailFolder?.path ?? "INBOX";

    // Count emails in ALL accessible folders so we can see where the email landed
    const counts = {};
    const allPaths = [...new Set([targetFolder, "INBOX", ...list.map(m => m.path)])];
    for (const path of allPaths) {
      try {
        const lock = await client.getMailboxLock(path);
        try {
          const seqs = await client.search({ since });
          counts[path] = seqs.length;
        } finally { lock.release(); }
      } catch (e) { counts[path] = `err: ${e.message.slice(0, 40)}`; }
    }

    // Sample emails from ALL folders that have emails, deduplicated by message-id
    const sampleFolder = targetFolder;
    const samples = [];
    const seenSampleIds = new Set();
    const sampleFolders = [...new Set([targetFolder, "INBOX", ...Object.keys(counts).filter(k => counts[k] > 0)])];
    for (const sf of sampleFolders) {
      try {
        const lock = await client.getMailboxLock(sf);
        try {
          const seqs = await client.search({ since });
          const slice = seqs.slice(-200);
          if (slice.length) {
            for await (const msg of client.fetch(slice, { envelope: true, bodyStructure: true })) {
              const msgId = msg.envelope.messageId ?? `${sf}:${msg.seq}`;
              if (seenSampleIds.has(msgId)) continue;
              seenSampleIds.add(msgId);
              const pdfParts = _findPdfParts(msg.bodyStructure);
              const htmlPart = _findHtmlPart(msg.bodyStructure);
              const mimeTree = (msg.bodyStructure?.childNodes ?? [])
                .map((c, i) => `${i + 1}:${c.type}/${c.subtype}${c.disposition?.value ? `(${c.disposition.value})` : ""}`)
                .join(", ") || `${msg.bodyStructure?.type}/${msg.bodyStructure?.subtype}`;
              samples.push({
                subject: msg.envelope.subject ?? "(no subject)",
                from: (msg.envelope.from ?? [])[0]?.address ?? "",
                date: msg.envelope.date?.toISOString().slice(0, 10) ?? "",
                hasPdf: pdfParts.length > 0,
                pdfCount: pdfParts.length,
                hasHtml: !!htmlPart,
                mimeTree,
                folder: sf,
              });
            }
          }
        } finally { lock.release(); }
      } catch (e) {
        samples.push({ subject: `error sampling ${sf}: ${e.message}`, from: "", date: "", hasPdf: false, pdfCount: 0, hasHtml: false, folder: sf });
      }
    }
    // Sort combined samples by date ascending so newest is at the bottom
    samples.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    await client.logout();
    res.json({ mailboxes, counts, since: since.toISOString(), targetFolder, sampleFolder, samples });
  } catch (e) {
    try { await client.logout(); } catch {}
    res.status(500).json({ error: String(e) });
  }
});

// Verify credentials reach the server and the IMAP handshake succeeds.
app.post("/api/imap/test", async (req, res) => {
  const { email, appPassword } = req.body ?? {};
  if (!email || !appPassword) return res.status(400).json({ error: "email and appPassword required" });
  try {
    const { ImapFlow } = await import("imapflow");
    const client = new ImapFlow({
      host: "imap.gmail.com", port: 993, secure: true,
      auth: { user: email, pass: appPassword },
      logger: false,
    });
    await client.connect();
    await client.logout();
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

// List available IMAP folders (excluding system/spam/trash), so the client can show a picker.
app.post("/api/imap/folders", async (req, res) => {
  const { email, appPassword } = req.body ?? {};
  if (!email || !appPassword) return res.status(400).json({ error: "email and appPassword required" });
  const SYSTEM_EXCLUDE = new Set(["Spam", "Trash", "Junk", "Deleted Items", "Deleted Messages", "Archive", "All Mail"]);
  const SYSTEM_SPECIAL_USE = new Set(["\\Spam", "\\Trash", "\\Junk", "\\Archive", "\\All"]);
  try {
    const { ImapFlow } = await import("imapflow");
    const client = new ImapFlow({
      host: "imap.gmail.com", port: 993, secure: true,
      auth: { user: email, pass: appPassword },
      logger: false,
    });
    await client.connect();
    const list = await client.list();
    await client.logout();
    const ALLOWED_SPECIAL_USE = new Set(["\\Sent", "\\Drafts"]);
    const SPECIAL_USE_NAME = { "\\Sent": "Sent", "\\Drafts": "Drafts" };
    const folders = list
      .filter((m) => {
        // Allow [Gmail]/Sent Mail and [Gmail]/Drafts (identified by specialUse); exclude all other [Gmail]/* folders
        if (m.path.startsWith("[Gmail]") || m.path.startsWith("[IMAP]")) {
          return m.specialUse ? ALLOWED_SPECIAL_USE.has(m.specialUse) : false;
        }
        if (m.specialUse && SYSTEM_SPECIAL_USE.has(m.specialUse)) return false;
        if (SYSTEM_EXCLUDE.has(m.name)) return false;
        return true;
      })
      .map((m) => ({ path: m.path, name: (m.specialUse && SPECIAL_USE_NAME[m.specialUse]) || m.name }));
    // Always include INBOX first
    const hasInbox = folders.some((f) => f.path === "INBOX");
    const result = hasInbox ? folders : [{ path: "INBOX", name: "INBOX" }, ...folders];
    res.json({ folders: result });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Poll Gmail for PDF attachments (or HTML invoice bodies). Credentials come from the client.
app.post("/api/imap/poll", async (req, res) => {
  const { email, appPassword, months = 3, folderPaths } = req.body ?? {};
  if (!email || !appPassword) return res.status(400).json({ error: "email and appPassword required" });
  const since = new Date();
  since.setMonth(since.getMonth() - months);
  console.log(`[IMAP] poll start: ${email}, since=${since.toISOString()}, months=${months}`);
  const { ImapFlow } = await import("imapflow");
  const client = new ImapFlow({
    host: "imap.gmail.com", port: 993, secure: true,
    auth: { user: email, pass: appPassword },
    logger: false,
  });
  try {
    await client.connect();

    // List folders: All Mail + INBOX + custom (non-[Gmail]/*) labels only.
    // Avoid [Gmail]/Promotions, [Gmail]/Social etc — they share messages with All Mail
    // and opening them via IMAP can put the connection in a bad state.
    let allMailPath = null;
    let customLabels = [];
    try {
      const list = await client.list();
      const allMail = list.find(m => /all\s*mail/i.test(m.name) || m.specialUse === "\\All");
      if (allMail) { allMailPath = allMail.path; console.log(`[IMAP] All Mail: ${allMail.path}`); }
      // Only user-created labels (no [Gmail]/* system folders)
      customLabels = list
        .filter(m => !m.path.startsWith("[Gmail]") && m.path !== "INBOX")
        .map(m => m.path);
      console.log(`[IMAP] custom labels: ${customLabels.join(", ") || "none"}`);
    } catch (e) {
      console.log("[IMAP] list() failed:", e.message);
    }

    const results = [];
    const seenMsgIds = new Set();
    let totalScanned = 0;

    // Process one mailbox: fetch envelopes, download PDF/HTML attachments, deduplicate.
    async function processMailbox(mb) {
      const lock = await client.getMailboxLock(mb);
      const toProcess = [];
      try {
        const seqNos = await client.search({ since });
        console.log(`[IMAP] ${mb}: found ${seqNos.length} messages since ${since.toDateString()}, processing last 200`);
        const slice = seqNos.slice(-200);
        if (!slice.length) return;
        for await (const msg of client.fetch(slice, { envelope: true, bodyStructure: true })) {
          totalScanned++;
          const pdfParts = _findPdfParts(msg.bodyStructure);
          if (!pdfParts.length) continue;
          const msgId = `imap:${email}:${msg.envelope.messageId ?? msg.seq}`;
          if (seenMsgIds.has(msgId)) continue;
          seenMsgIds.add(msgId);
          toProcess.push({
            seq: msg.seq, msgId,
            subject: msg.envelope.subject ?? "",
            senderEmail: (msg.envelope.from ?? [])[0]?.address ?? "",
            receivedAt: msg.envelope.date?.toISOString() ?? new Date().toISOString(),
            pdfParts,
          });
        }
        console.log(`[IMAP] ${mb}: ${toProcess.length} messages to process`);

        for (const { seq, msgId, subject, senderEmail, receivedAt, pdfParts } of toProcess) {
          const attachments = [];
          for (const part of pdfParts) {
            try {
              const { content } = await client.download(`${seq}`, part.id);
              const chunks = [];
              for await (const chunk of content) chunks.push(chunk);
              const bytes = Buffer.concat(chunks);
              console.log(`[IMAP] pdf downloaded: seq=${seq} part=${part.id} "${part.name}" ${bytes.length}B`);
              attachments.push({ filename: part.name, data: bytes.toString("base64") });
            } catch (e) {
              console.error(`[IMAP] pdf download failed seq=${seq} part=${part.id}:`, e.message);
            }
          }
          if (attachments.length) {
            results.push({ messageId: msgId, subject, senderEmail, receivedAt, attachments });
          }
        }
      } finally {
        lock.release();
      }
    }

    // Use caller-provided folder paths if given; otherwise auto-discover INBOX + All Mail + custom labels.
    const foldersToSearch = Array.isArray(folderPaths) && folderPaths.length > 0
      ? [...new Set(folderPaths)]
      : [...new Set(["INBOX", ...(allMailPath ? [allMailPath] : []), ...customLabels])];
    for (const mb of foldersToSearch) {
      try {
        await processMailbox(mb);
      } catch (e) {
        console.log(`[IMAP] ${mb} skipped: ${e.message}`);
      }
    }
    await client.logout();
    console.log(`[IMAP] poll complete: scanned=${totalScanned} results=${results.length}`);
    res.json({ results, scanned: totalScanned });
  } catch (e) {
    console.error("[IMAP] poll error:", e.message);
    try { await client.logout(); } catch {}
    res.status(500).json({ error: String(e) });
  }
});

// ── Root: send mobile UA to the mobile UI; desktop gets the React SPA ─────────

app.get("/", (req, res, next) => {
  const ua = req.headers["user-agent"] ?? "";
  if (/android|iphone|ipad|ipod|mobile/i.test(ua)) return res.redirect("/mobile");
  next();
});

// ── Health check ──────────────────────────────────────────────────────────────

app.get("/health", (_req, res) => res.send("ok"));

// ── App config (Supabase creds for the React client) ─────────────────────────

app.get("/api/app-config", (_req, res) => {
  res.json({ supabaseUrl: SUPABASE_URL, supabaseAnonKey: SUPABASE_ANON_KEY });
});

// ── Desktop SPA (React build) ─────────────────────────────────────────────────

app.use(express.static(DIST));
app.get("/*path", (_req, res) => res.sendFile(join(DIST, "index.html")));

app.listen(PORT, () => console.log(`jInvoice proxy+relay running on port ${PORT}`));

// ── [MOBILE] HTML — auth UI + invoice list + upload + sync ───────────────────
// SB_URL and SB_ANON are injected so the client can call Supabase REST directly.
// Invoices are saved to phone localStorage only; relay holds them for desktop pickup.

const MOBILE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<title>jInvoice</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
:root{
  --bg:#f0eeff;--surface:#fff;--surface2:#f7f5ff;--border:#e0daf8;
  --text:#0d0d1c;--text2:#4a4a6a;--text3:#9898b8;
  --accent:#5c3ef0;--accent-light:#ede9fe;
  --danger:#ef4444;--success:#22c55e;--warn:#f59e0b;
  --radius:14px;--shadow:0 2px 12px rgba(92,62,240,.1);
}
@media(prefers-color-scheme:dark){
  :root{--bg:#0a0a14;--surface:#14141f;--surface2:#1c1c2e;--border:#2a2a40;
    --text:#f0f0f8;--text2:#9898b8;--text3:#4a4a6a;--accent-light:#1e1a3f;}
}
.auth-tabs{display:flex;width:100%;border:1.5px solid var(--border);border-radius:12px;overflow:hidden;margin-bottom:16px}
.auth-tab{flex:1;padding:10px;border:none;background:transparent;color:var(--text2);font-size:14px;font-weight:600;cursor:pointer;transition:all .15s;touch-action:manipulation}
.auth-tab.active{background:var(--accent);color:#fff}
html{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:16px}
body{min-height:100dvh;padding-bottom:calc(env(safe-area-inset-bottom)+16px)}
.screen{display:none;flex-direction:column;min-height:100dvh}
.screen.active{display:flex}
.auth-wrap{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:32px 24px}
.logo{width:64px;height:64px;background:var(--accent);border-radius:18px;display:flex;align-items:center;justify-content:center;font-size:30px;font-weight:800;color:#fff;margin-bottom:24px;box-shadow:0 6px 24px rgba(92,62,240,.35)}
.auth-title{font-size:24px;font-weight:700;margin-bottom:6px;text-align:center}
.auth-sub{font-size:14px;color:var(--text2);text-align:center;margin-bottom:32px;line-height:1.5}
.inp{width:100%;padding:14px 16px;border:1.5px solid var(--border);border-radius:12px;background:var(--surface);color:var(--text);font-size:15px;outline:none;-webkit-appearance:none}
.inp:focus{border-color:var(--accent)}
.btn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:15px;border:none;border-radius:12px;font-size:15px;font-weight:600;cursor:pointer;transition:opacity .15s;-webkit-appearance:none}
.btn-primary{background:var(--accent);color:#fff;margin-top:12px}
.btn-primary:active{opacity:.85}
.btn-secondary{background:var(--surface2);color:var(--accent);border:1.5px solid var(--border);margin-top:8px}
.err{color:var(--danger);font-size:13px;margin-top:10px;text-align:center}
header{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;padding-top:calc(16px + env(safe-area-inset-top));background:var(--surface);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:10}
header h1{font-size:18px;font-weight:700;letter-spacing:-.3px}
header h1 span{color:var(--accent)}
.icon-btn{width:38px;height:38px;border:none;background:var(--surface2);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px;cursor:pointer;border:1px solid var(--border)}
.list{flex:1;padding:12px 16px;display:flex;flex-direction:column;gap:10px;overflow-y:auto}
.card{background:var(--surface);border:1.5px solid var(--border);border-radius:var(--radius);overflow:hidden;box-shadow:var(--shadow)}
.card.pending-sync{border-color:var(--accent)}
.card-top{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;padding:14px 14px 10px;cursor:pointer}
.card-name{font-size:14px;font-weight:700;flex:1;line-height:1.3}
.card-amount{font-size:15px;font-weight:700;color:var(--accent);white-space:nowrap;font-variant-numeric:tabular-nums}
.card-meta{font-size:12px;color:var(--text3);padding:0 14px 10px;display:flex;gap:10px}
.card-detail{padding:0 14px 14px;display:none;flex-direction:column;gap:10px}
.card.open .card-detail{display:flex}
.detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 16px}
.field label{display:block;font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px}
.field span{font-size:13px;color:var(--text)}
.items-table{width:100%;border-collapse:collapse;font-size:12px}
.items-table th{text-align:left;padding:4px 0;color:var(--text3);font-size:10px;text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid var(--border)}
.items-table td{padding:5px 0;border-bottom:1px solid var(--border);color:var(--text)}
.items-table td:last-child{text-align:right;font-variant-numeric:tabular-nums;font-weight:500}
.sync-btn{display:block;width:100%;padding:10px;background:var(--accent-light);border:1.5px solid var(--accent);color:var(--accent);border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;text-align:center}
.synced-badge{font-size:11px;font-weight:600;text-align:center;padding:6px}
.toggle-row{text-align:center;padding:8px;font-size:12px;color:var(--accent);font-weight:600;border-top:1px solid var(--border)}
.empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;color:var(--text3);padding:48px;text-align:center}
.empty-icon{font-size:48px}
.fab{position:fixed;bottom:calc(24px + env(safe-area-inset-bottom));right:24px;width:58px;height:58px;background:var(--accent);border:none;border-radius:18px;display:flex;align-items:center;justify-content:center;font-size:26px;color:#fff;box-shadow:0 6px 20px rgba(92,62,240,.4);cursor:pointer;transition:transform .1s}
.fab:active{transform:scale(.94)}
.overlay{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:50;display:none}
.overlay.open{display:block}
.sheet{position:fixed;bottom:0;left:0;right:0;background:var(--surface);border-radius:20px 20px 0 0;padding:0 0 calc(env(safe-area-inset-bottom)+24px);z-index:51;max-height:92dvh;overflow-y:auto;transform:translateY(100%);transition:transform .3s ease}
.sheet.open{transform:translateY(0)}
.sheet-handle{width:36px;height:4px;background:var(--border);border-radius:4px;margin:12px auto 0}
.sheet-body{padding:20px 20px 0}
.sheet-title{font-size:18px;font-weight:700;margin-bottom:6px}
.sheet-sub{font-size:13px;color:var(--text2);margin-bottom:20px;line-height:1.5}
.upload-options{display:flex;flex-direction:column;gap:12px;margin-bottom:16px}
.upload-opt{display:flex;align-items:center;gap:14px;padding:16px;background:var(--surface2);border:1.5px solid var(--border);border-radius:14px;cursor:pointer;width:100%;text-align:left;transition:border-color .15s}
.upload-opt:active{border-color:var(--accent);background:var(--accent-light)}
.upload-opt-icon{font-size:28px;line-height:1;flex-shrink:0}
.upload-opt-label{font-size:15px;font-weight:700;color:var(--text)}
.upload-opt-sub{font-size:12px;color:var(--text2);margin-top:2px}
.result-card{background:var(--surface2);border:1.5px solid var(--accent);border-radius:12px;padding:14px;margin-bottom:16px}
.result-name{font-size:16px;font-weight:700;margin-bottom:10px}
.result-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 16px}
.spinner{display:inline-block;width:20px;height:20px;border:2.5px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin .7s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.loading-row{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:32px;color:var(--text2);font-size:14px;text-align:center}
.loading-label{font-size:13px;color:var(--text3)}
.cam-preview{width:100%;max-height:220px;object-fit:cover;border-radius:10px;margin-bottom:14px;border:1.5px solid var(--border);display:none}
/* Bottom nav */
.bottom-nav{position:fixed;bottom:0;left:0;right:0;background:var(--surface);border-top:1.5px solid var(--border);z-index:30;display:none;padding-bottom:env(safe-area-inset-bottom)}
.bottom-nav.visible{display:flex}
.nb{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;padding:8px 2px 10px;border:none;background:none;cursor:pointer;color:var(--text3);font-size:9.5px;font-weight:600;letter-spacing:.02em;-webkit-tap-highlight-color:transparent;touch-action:manipulation}
.nb.active{color:var(--accent)}
.nb-icon{font-size:21px;line-height:1}
body.nav-visible{padding-bottom:calc(env(safe-area-inset-bottom)+60px)}
body.nav-visible .fab{bottom:calc(72px + env(safe-area-inset-bottom))}
.info-scroll{flex:1;overflow-y:auto;padding-bottom:8px}
/* More drawer */
.more-ov{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:31;display:none}
.more-ov.open{display:block}
.more-drw{position:fixed;bottom:0;left:0;right:0;background:var(--surface);border-radius:20px 20px 0 0;z-index:32;transform:translateY(100%);transition:transform .3s ease;padding-bottom:calc(env(safe-area-inset-bottom)+8px)}
.more-drw.open{transform:translateY(0)}
.more-hnd{width:36px;height:4px;background:var(--border);border-radius:4px;margin:12px auto 8px}
.more-grd{display:grid;grid-template-columns:1fr 1fr;border-top:1px solid var(--border)}
.more-itm{display:flex;flex-direction:column;align-items:center;gap:6px;padding:18px 12px;background:var(--surface);border:none;cursor:pointer;color:var(--text2);font-size:12.5px;font-weight:600;border-bottom:1px solid var(--border);-webkit-tap-highlight-color:transparent}
.more-itm:nth-child(odd){border-right:1px solid var(--border)}
.more-itm:active{background:var(--accent-light)}
.more-mi{font-size:28px;line-height:1}
/* FAQ */
.faq-item{border-bottom:1px solid var(--border)}
.faq-q{width:100%;display:flex;justify-content:space-between;align-items:center;gap:8px;padding:14px 16px;background:none;border:none;cursor:pointer;text-align:left;font-size:13.5px;font-weight:600;color:var(--text);-webkit-tap-highlight-color:transparent}
.faq-chev{font-size:16px;transition:transform .2s;flex-shrink:0}
.faq-a{padding:0 16px 14px;font-size:13px;color:var(--text2);line-height:1.6;display:none}
.faq-item.open .faq-a{display:block}
/* Stars */
.star-btn{font-size:30px;border:none;background:none;cursor:pointer;padding:0 2px;color:var(--border);-webkit-tap-highlight-color:transparent}
.star-btn.on{color:#f59e0b}
</style>
</head>
<body>
<div class="screen active" id="screen-auth">
  <div class="auth-wrap">
    <div class="logo">j</div>
    <div class="auth-title">jInvoice Mobile</div>
    <div class="auth-sub">Sign in or create an account to capture and sync invoices.</div>
    <div style="width:100%">
      <div class="auth-tabs">
        <button class="auth-tab active" id="tab-signin" onclick="switchTab('signin')">Sign In</button>
        <button class="auth-tab" id="tab-signup" onclick="switchTab('signup')">Create Account</button>
      </div>
      <input id="email-input" class="inp" type="email" placeholder="your@email.com" autocomplete="email" inputmode="email">
      <input id="password-input" class="inp" type="password" placeholder="Password" autocomplete="current-password" style="margin-top:10px" onkeydown="if(event.key==='Enter'){event.preventDefault();doAuth();}">
      <div id="auth-err" class="err"></div>
      <button id="connect-btn" class="btn btn-primary" onclick="doAuth()">Sign In &#x2192;</button>
    </div>
    <div style="margin-top:16px;text-align:center">
      <button type="button" onclick="toggleGeminiField()" style="background:none;border:none;color:var(--accent);font-size:13px;cursor:pointer;padding:4px 8px">&#x2699; Gemini AI key (optional)</button>
      <div id="gemini-section" style="display:none;margin-top:8px">
        <input id="gemini-input" class="inp" type="password" placeholder="Paste your Gemini API key" autocomplete="off">
        <div style="font-size:11px;color:var(--text3);margin-top:6px;text-align:center">Used for invoice extraction. Leave blank to use server key.</div>
      </div>
    </div>
  </div>
</div>
<div class="screen" id="screen-home">
  <header>
    <h1>j<span>Invoice</span></h1>
    <button class="icon-btn" onclick="signOut()" title="Sign out">&#x2935;</button>
  </header>
  <div class="list" id="invoice-list">
    <div class="empty"><div class="empty-icon">&#x1F9FE;</div><div>No invoices yet.<br>Tap + to photograph or upload an invoice.</div></div>
  </div>
  <button class="fab" onclick="openSheet()" aria-label="Add invoice">+</button>
</div>

<!-- ── Rewards screen ─────────────────── -->
<div class="screen" id="screen-rewards">
  <header><h1>j<span>Invoice</span></h1><span style="font-size:13px;font-weight:600;color:var(--text2)">Rewards</span></header>
  <div class="info-scroll" id="rewards-body"><div class="loading-row"><div class="spinner"></div><div>Loading rewards&hellip;</div></div></div>
</div>

<!-- ── Price screen ───────────────────── -->
<div class="screen" id="screen-price">
  <header><h1>j<span>Invoice</span></h1><span style="font-size:13px;font-weight:600;color:var(--text2)">Pricing</span></header>
  <div class="info-scroll"><div style="padding:16px;display:flex;flex-direction:column;gap:12px">
    <div style="background:var(--surface);border:1.5px solid var(--border);border-radius:14px;padding:20px">
      <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Free</div>
      <div style="font-size:28px;font-weight:800;color:var(--text);line-height:1">&#x20B9;0</div>
      <div style="font-size:12px;color:var(--text2);margin:4px 0 14px">forever</div>
      <div style="display:flex;flex-direction:column;gap:7px;font-size:13px;color:var(--text)">
        <div>&#x2713; 5 invoices per day</div><div>&#x2713; 3 months data history</div>
        <div>&#x2713; Mobile invoice capture</div><div>&#x2713; Cloud sync</div>
        <div>&#x2713; Rewards program</div><div>&#x2713; 7-day support response</div>
      </div>
    </div>
    <div style="background:var(--surface);border:2px solid var(--accent);border-radius:14px;padding:20px;position:relative">
      <div style="position:absolute;top:12px;right:12px;background:var(--accent);color:#fff;font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;text-transform:uppercase;letter-spacing:.05em">PRO</div>
      <div style="font-size:11px;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Shared API</div>
      <div style="font-size:28px;font-weight:800;color:var(--text);line-height:1">&#x20B9;399</div>
      <div style="font-size:12px;color:var(--text2);margin:4px 0 14px">per month</div>
      <div style="display:flex;flex-direction:column;gap:7px;font-size:13px;color:var(--text)">
        <div>&#x2713; Unlimited invoices/day</div><div>&#x2713; 6+ months data history</div>
        <div>&#x2713; Up to 5 email accounts</div><div>&#x2713; Advanced GST reports</div>
        <div>&#x2713; AI via shared Gemini quota</div><div>&#x2713; 48-hour support response</div>
      </div>
    </div>
    <div style="background:var(--surface);border:1.5px solid var(--border);border-radius:14px;padding:20px;position:relative">
      <div style="position:absolute;top:12px;right:12px;background:var(--accent);color:#fff;font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;text-transform:uppercase;letter-spacing:.05em">PRO</div>
      <div style="font-size:11px;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Own API Key</div>
      <div style="font-size:28px;font-weight:800;color:var(--text);line-height:1">&#x20B9;249</div>
      <div style="font-size:12px;color:var(--text2);margin:4px 0 14px">per month</div>
      <div style="display:flex;flex-direction:column;gap:7px;font-size:13px;color:var(--text)">
        <div>&#x2713; Everything in Shared plan</div><div>&#x2713; Your own Gemini API key</div><div>&#x2713; No shared quota limits</div>
      </div>
    </div>
    <div style="font-size:11.5px;color:var(--text3);text-align:center;line-height:1.5;padding:4px 8px">Prices in INR inclusive of all taxes. Upgrade via the desktop app.</div>
  </div></div>
</div>

<!-- ── Settings screen ────────────────── -->
<div class="screen" id="screen-settings">
  <header><h1>j<span>Invoice</span></h1><span style="font-size:13px;font-weight:600;color:var(--text2)">Settings</span></header>
  <div class="info-scroll"><div style="padding:16px;display:flex;flex-direction:column;gap:14px">
    <div style="background:var(--surface);border:1.5px solid var(--border);border-radius:14px;padding:18px">
      <div style="font-size:12px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">AI Settings</div>
      <div style="font-size:13px;color:var(--text2);line-height:1.6">Activate Pro from the <strong style="color:var(--text)">Pricing</strong> tab to use your own API keys.</div>
    </div>
    <div style="background:var(--surface);border:1.5px solid var(--border);border-radius:14px;padding:18px">
      <div style="font-size:12px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px">Account</div>
      <button class="btn" style="background:#fee2e2;color:#dc2626;border:1.5px solid #fca5a5" onclick="signOut()">Sign Out</button>
    </div>
  </div></div>
</div>

<!-- ── FAQ & Support screen ──────────────── -->
<div class="screen" id="screen-faq">
  <header><h1>j<span>Invoice</span></h1><span style="font-size:13px;font-weight:600;color:var(--text2)">FAQ &amp; Support</span></header>
  <div class="info-scroll"><div style="padding:16px">
    <div style="border:1.5px solid var(--border);border-radius:14px;overflow:hidden;margin-bottom:20px">
      <div class="faq-item"><button class="faq-q" onclick="faqToggle(this)">What file types can I import?<span class="faq-chev">&#x2303;</span></button><div class="faq-a">jInvoice supports PDF invoices (text-based and scanned) and images captured via the camera. Gmail and Outlook attachments are handled automatically on the desktop app.</div></div>
      <div class="faq-item"><button class="faq-q" onclick="faqToggle(this)">What is the jInvoice Secret?<span class="faq-chev">&#x2303;</span></button><div class="faq-a">The jInvoice Secret is a password you set in Settings &rarr; API Keys on the desktop. It secures the mobile sync endpoint so only your devices can push invoices.</div></div>
      <div class="faq-item"><button class="faq-q" onclick="faqToggle(this)">What is the Cloud URL for mobile sync?<span class="faq-chev">&#x2303;</span></button><div class="faq-a">The Cloud URL lets your phone send invoices from anywhere &mdash; on mobile data or any Wi-Fi. Find it in Settings &rarr; Mobile Sync &rarr; Copy Cloud URL on the desktop app.</div></div>
      <div class="faq-item"><button class="faq-q" onclick="faqToggle(this)">What is the Local URL for mobile sync?<span class="faq-chev">&#x2303;</span></button><div class="faq-a">The Local URL works only when your phone and desktop are on the same Wi-Fi network. It is faster because it transfers directly without going through the internet.</div></div>
      <div class="faq-item"><button class="faq-q" onclick="faqToggle(this)">Is my data stored on the cloud?<span class="faq-chev">&#x2303;</span></button><div class="faq-a">Invoices are stored locally on your desktop using IndexedDB. Cloud sync (Supabase) is available on both Free and Pro plans as a backup and for mobile access.</div></div>
      <div class="faq-item" style="border-bottom:none"><button class="faq-q" onclick="faqToggle(this)">What is the daily invoice limit?<span class="faq-chev">&#x2303;</span></button><div class="faq-a">Free plan: up to 5 invoices per day (resets at midnight). Pro plan: unlimited.</div></div>
    </div>
    <!-- Support -->
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
      <div style="flex:1;height:1px;background:var(--border)"></div>
      <span style="font-size:10.5px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.07em">Support</span>
      <div style="flex:1;height:1px;background:var(--border)"></div>
    </div>
    <a href="mailto:support@jinvoice.app" style="display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:12px;border:1.5px solid var(--border);background:var(--surface);text-decoration:none;color:var(--text);margin-bottom:10px">
      <span style="font-size:20px">&#x2709;&#xFE0F;</span>
      <div><div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.05em">Email</div><div style="font-size:13px;font-weight:600;margin-top:2px">support@jinvoice.app</div></div>
    </a>
    <div style="display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:12px;border:1.5px solid var(--border);background:var(--surface);margin-bottom:16px">
      <span style="font-size:20px">&#x1F550;</span>
      <div><div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.05em">Response time</div><div style="font-size:13px;font-weight:600;margin-top:2px">Pro: 48 hrs &bull; Free: 7 days</div></div>
    </div>
  </div></div>
</div>

<!-- ── About & Feedback screen ───────────── -->
<div class="screen" id="screen-about">
  <header><h1>j<span>Invoice</span></h1><span style="font-size:13px;font-weight:600;color:var(--text2)">About &amp; Feedback</span></header>
  <div class="info-scroll"><div style="padding:16px">
    <div style="text-align:center;padding:20px 0 16px">
      <div style="width:68px;height:68px;background:var(--accent);border-radius:20px;display:flex;align-items:center;justify-content:center;font-size:32px;font-weight:800;color:#fff;margin:0 auto 12px;box-shadow:0 6px 24px rgba(92,62,240,.3)">j</div>
      <div style="font-size:22px;font-weight:800;color:var(--text);letter-spacing:-.3px">jInvoice</div>
      <div style="font-size:13px;color:var(--text2);margin-top:3px">Version 1.0.0 &bull; Mobile</div>
    </div>
    <div style="background:var(--surface);border:1.5px solid var(--border);border-radius:14px;padding:16px;margin-bottom:10px">
      <p style="font-size:13.5px;color:var(--text);line-height:1.7;margin:0">jInvoice is a private, AI-powered invoice manager for individuals and small businesses in India. Import invoices from email, camera, or file &mdash; jInvoice extracts the details automatically.</p>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:10px">
      <div style="background:var(--surface);border:1.5px solid var(--border);border-radius:12px;padding:12px 14px;display:flex;gap:12px">
        <span style="font-size:18px">&#x1F512;</span>
        <div><div style="font-size:13px;font-weight:700;color:var(--text)">Privacy First</div><div style="font-size:12px;color:var(--text2);margin-top:2px;line-height:1.5">Your invoices are stored on your device. Cloud sync is opt-in.</div></div>
      </div>
      <div style="background:var(--surface);border:1.5px solid var(--border);border-radius:12px;padding:12px 14px;display:flex;gap:12px">
        <span style="font-size:18px">&#x1F1EE;&#x1F1F3;</span>
        <div><div style="font-size:13px;font-weight:700;color:var(--text)">Built for India</div><div style="font-size:12px;color:var(--text2);margin-top:2px;line-height:1.5">GST extraction, INR amounts, and Indian tax categories handled natively.</div></div>
      </div>
    </div>
    <div style="text-align:center;font-size:11px;color:var(--text3);margin-bottom:20px;line-height:1.6">&copy; 2025 jInvoice. Built with care in India.</div>

    <!-- Feedback section -->
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
      <div style="flex:1;height:1px;background:var(--border)"></div>
      <span style="font-size:10.5px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.07em">Feedback</span>
      <div style="flex:1;height:1px;background:var(--border)"></div>
    </div>
    <div id="fb-thanks" style="display:none;text-align:center;padding:32px 0">
      <div style="font-size:44px;margin-bottom:12px">&#x1F64F;</div>
      <div style="font-size:18px;font-weight:700;color:var(--text);margin-bottom:8px">Thank you!</div>
      <div style="font-size:13.5px;color:var(--text2);line-height:1.6">Your feedback helps make jInvoice better for everyone.</div>
      <button class="btn btn-primary" onclick="resetFeedback()" style="margin-top:16px">Send Another</button>
    </div>
    <div id="fb-form">
      <div style="background:var(--surface);border:1.5px solid var(--border);border-radius:14px;padding:16px;margin-bottom:10px">
        <div style="font-size:11.5px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">Overall Rating</div>
        <div style="display:flex;gap:4px" id="star-row">
          <button class="star-btn" onclick="setFbRating(1)">&#x2606;</button>
          <button class="star-btn" onclick="setFbRating(2)">&#x2606;</button>
          <button class="star-btn" onclick="setFbRating(3)">&#x2606;</button>
          <button class="star-btn" onclick="setFbRating(4)">&#x2606;</button>
          <button class="star-btn" onclick="setFbRating(5)">&#x2606;</button>
        </div>
      </div>
      <div style="background:var(--surface);border:1.5px solid var(--border);border-radius:14px;padding:16px;margin-bottom:10px">
        <div style="font-size:11.5px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Category</div>
        <select id="fb-cat" class="inp"><option>Bug report</option><option>Feature request</option><option>Suggestion</option><option>Compliment</option><option>Other</option></select>
      </div>
      <div style="background:var(--surface);border:1.5px solid var(--border);border-radius:14px;padding:16px;margin-bottom:10px">
        <div style="font-size:11.5px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Message <span style="color:var(--danger)">*</span></div>
        <textarea id="fb-message" class="inp" rows="4" placeholder="Tell us what you think&hellip;" style="resize:vertical;font-family:inherit"></textarea>
        <div id="fb-err" style="font-size:12px;color:var(--danger);margin-top:6px;min-height:16px"></div>
      </div>
      <button class="btn btn-primary" onclick="submitFeedback()">Send Feedback &#x2192;</button>
      <div style="font-size:11px;color:var(--text3);margin-top:10px;text-align:center;line-height:1.5">Opens your email client with the message pre-filled.</div>
    </div>
  </div></div>
</div>

<div class="overlay" id="overlay" onclick="closeSheet()"></div>
<div class="sheet" id="upload-sheet">
  <div class="sheet-handle"></div>
  <div class="sheet-body" id="sheet-body"></div>
</div>
<input type="file" id="camera-input" accept="image/*" capture="environment" style="display:none" onchange="onFileChosen(event)">
<input type="file" id="folder-input" accept="application/pdf,image/*" style="display:none" onchange="onFileChosen(event)">

<!-- ── Bottom nav ─────────────────────── -->
<nav class="bottom-nav" id="bottom-nav">
  <button class="nb active" data-nav="home" onclick="navTo('home')"><span class="nb-icon">&#x1F3E0;</span>Home</button>
  <button class="nb" data-nav="rewards" onclick="navTo('rewards')"><span class="nb-icon">&#x2B50;</span>Rewards</button>
  <button class="nb" data-nav="price" onclick="navTo('price')"><span class="nb-icon">&#x1F48E;</span>Price</button>
  <button class="nb" data-nav="more" onclick="openMore()"><span class="nb-icon">&#x22EF;</span>More</button>
</nav>
<div class="more-ov" id="more-ov" onclick="closeMore()"></div>
<div class="more-drw" id="more-drw">
  <div class="more-hnd"></div>
  <div class="more-grd">
    <button class="more-itm" onclick="navMore('settings')"><span class="more-mi">&#x2699;&#xFE0F;</span>Settings</button>
    <button class="more-itm" onclick="navMore('faq')"><span class="more-mi">&#x2753;</span>FAQ &amp; Support</button>
    <button class="more-itm" onclick="navMore('about')"><span class="more-mi">&#x2139;&#xFE0F;</span>About &amp; Feedback</button>
  </div>
</div>

<script>
const API=window.location.origin;
const SB_URL='${SUPABASE_URL}';
const SB_ANON='${SUPABASE_ANON_KEY}';
let TOKEN=sessionStorage.getItem('sb_token')||'';
let GEMINI_KEY=sessionStorage.getItem('jgk')||'';
let _authBusy=false;
let _authMode='signin';

function switchTab(mode){
  _authMode=mode;
  document.getElementById('tab-signin').classList.toggle('active',mode==='signin');
  document.getElementById('tab-signup').classList.toggle('active',mode==='signup');
  const btn=document.getElementById('connect-btn');
  btn.textContent=mode==='signin'?'Sign In →':'Create Account →';
  document.getElementById('password-input').setAttribute('autocomplete',mode==='signin'?'current-password':'new-password');
  document.getElementById('auth-err').textContent='';
}
async function doAuth(){
  if(_authBusy)return;
  const email=document.getElementById('email-input').value.trim();
  const password=document.getElementById('password-input').value;
  const gk=document.getElementById('gemini-input').value.trim();
  const errEl=document.getElementById('auth-err');
  const btn=document.getElementById('connect-btn');
  if(!email||!email.includes('@')){errEl.textContent='Enter a valid email address.';return;}
  if(!password||password.length<6){errEl.textContent='Password must be at least 6 characters.';return;}
  _authBusy=true;errEl.textContent='';btn.textContent='Please wait…';btn.disabled=true;
  try{
    let d;
    if(_authMode==='signup'){
      const r=await fetch(SB_URL+'/auth/v1/signup',{method:'POST',headers:{'Content-Type':'application/json',apikey:SB_ANON},body:JSON.stringify({email,password})});
      d=await r.json();
      if(!r.ok)throw new Error(d.error_description||d.msg||'Sign up failed');
      const r2=await fetch(SB_URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json',apikey:SB_ANON},body:JSON.stringify({email,password})});
      d=await r2.json();
      if(!r2.ok)throw new Error(d.error_description||d.msg||'Sign in failed after signup');
    }else{
      const r=await fetch(SB_URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json',apikey:SB_ANON},body:JSON.stringify({email,password})});
      d=await r.json();
      if(!r.ok)throw new Error(d.error_description||d.msg||'Sign in failed');
    }
    TOKEN=d.access_token;
    sessionStorage.setItem('sb_token',TOKEN);
    sessionStorage.setItem('sb_email',email);
    if(gk){GEMINI_KEY=gk;sessionStorage.setItem('jgk',gk);}else{GEMINI_KEY=sessionStorage.getItem('jgk')||'';}
    showHome();
  }catch(e){
    errEl.textContent=e.message||'Authentication failed';
    btn.textContent=_authMode==='signin'?'Sign In →':'Create Account →';
    btn.disabled=false;_authBusy=false;
  }
}
async function signOut(){
  try{await fetch(SB_URL+'/auth/v1/logout',{method:'POST',headers:{apikey:SB_ANON,Authorization:'Bearer '+TOKEN}});}catch{}
  sessionStorage.removeItem('sb_token');sessionStorage.removeItem('sb_email');
  TOKEN='';_authBusy=false;show('screen-auth');hideNav();
}
function toggleGeminiField(){var s=document.getElementById('gemini-section');s.style.display=s.style.display==='none'?'block':'none';}
(function(){
  var vt=document.createElement('div');
  vt.textContent='jInvoice v2.5';
  vt.style.cssText='position:fixed;top:env(safe-area-inset-top,12px);left:50%;transform:translateX(-50%);background:var(--accent);color:#fff;font-size:12px;font-weight:600;padding:6px 14px;border-radius:20px;z-index:999;opacity:1;transition:opacity 1s';
  document.body.appendChild(vt);
  setTimeout(function(){vt.style.opacity='0';setTimeout(function(){vt.remove();},1000);},3000);
  if(TOKEN){
    if(GEMINI_KEY){document.getElementById('gemini-section').style.display='block';document.getElementById('gemini-input').value=GEMINI_KEY;}
    showHome();
  }
})();
function show(id){document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));document.getElementById(id).classList.add('active');}
function showNav(){var n=document.getElementById('bottom-nav');if(n){n.classList.add('visible');document.body.classList.add('nav-visible');}}
function hideNav(){var n=document.getElementById('bottom-nav');if(n){n.classList.remove('visible');document.body.classList.remove('nav-visible');}}
function showHome(){show('screen-home');loadInvoices();showNav();setNavActive('home');}
function navTo(id){
  show('screen-'+id);
  setNavActive(id);
  if(id==='home')loadInvoices();
  else if(id==='rewards')loadRewardsScreen();
  else if(id==='settings')initSettingsScreen();
}
function setNavActive(id){
  var primary=['home','rewards','price'];
  document.querySelectorAll('.nb[data-nav]').forEach(function(b){
    var isMore=!primary.includes(id)&&b.dataset.nav==='more';
    b.classList.toggle('active',b.dataset.nav===id||isMore);
  });
}
function openMore(){
  document.getElementById('more-ov').classList.add('open');
  setTimeout(function(){document.getElementById('more-drw').classList.add('open');},10);
}
function closeMore(){document.getElementById('more-drw').classList.remove('open');document.getElementById('more-ov').classList.remove('open');}
function navMore(id){closeMore();navTo(id);}
function listKey(){return'jinvoice_list_'+(sessionStorage.getItem('sb_email')||'anon');}
function saveList(list){try{localStorage.setItem(listKey(),JSON.stringify(list));}catch{}}
function readList(){try{return JSON.parse(localStorage.getItem(listKey())||'[]');}catch{return[];}}
function loadInvoices(){renderList(readList());}
function fmt(v){return v!=null&&v!==''?'&#x20B9;'+Number(v).toFixed(2):'&#x2014;';}
function fmtDate(s){if(!s)return'&#x2014;';try{return new Date(s).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});}catch{return s;}}
function esc(s){return s?String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'):'&#x2014;';}
function renderList(list){
  const el=document.getElementById('invoice-list');
  if(!list.length){el.innerHTML='<div class="empty"><div class="empty-icon">&#x1F9FE;</div><div>No invoices yet.<br>Tap + to photograph or upload an invoice.</div></div>';return;}
  el.innerHTML=list.map((inv,i)=>{
    const items=(inv.items||[]).map(it=>'<tr><td>'+esc(it.name)+'</td><td>'+fmt(it.amountInr)+'</td></tr>').join('');
    const syncPart=inv.synced_at
      ?'<div class="synced-badge" style="color:var(--success)">&#x2713; Synced to desktop '+fmtDate(inv.synced_at)+'</div>'
      :inv.pending_sync
      ?'<div class="synced-badge" style="color:var(--warn)">&#x23F3; Waiting for desktop sync&hellip;</div>'
      :'<button class="sync-btn" onclick="markSync('+inv.id+',this)">Send to Desktop &#x2192;</button>';
    return '<div class="card '+(inv.pending_sync&&!inv.synced_at?'pending-sync':'')+'" id="inv-'+i+'">'+
      '<div class="card-top" onclick="toggleCard('+i+')">'+
        '<div class="card-name">'+esc(inv.shop_name||inv.filename||'Invoice')+'</div>'+
        '<div class="card-amount">'+fmt(inv.final_payment_inr)+'</div>'+
      '</div>'+
      '<div class="card-meta">'+(inv.date_of_purchase?'<span>'+fmtDate(inv.date_of_purchase)+'</span>':'')+
        '<span>'+esc(inv.filename||'')+'</span></div>'+
      '<div class="card-detail">'+
        '<div class="detail-grid">'+
          (inv.address?'<div class="field" style="grid-column:1/-1"><label>Address</label><span>'+esc(inv.address)+'</span></div>':'')+
          '<div class="field"><label>GST No.</label><span>'+esc(inv.gst_number)+'</span></div>'+
          '<div class="field"><label>GST %</label><span>'+esc(inv.gst_percent)+'</span></div>'+
          '<div class="field"><label>GST Amt</label><span>'+fmt(inv.gst_amount_inr)+'</span></div>'+
          '<div class="field"><label>Discount</label><span>'+fmt(inv.discount_inr)+'</span></div>'+
          '<div class="field"><label>Total</label><span style="color:var(--accent);font-weight:700">'+fmt(inv.final_payment_inr)+'</span></div>'+
        '</div>'+
        (items?'<table class="items-table"><thead><tr><th>Item</th><th style="text-align:right">Amt</th></tr></thead><tbody>'+items+'</tbody></table>':'')+
        syncPart+
      '</div>'+
      '<div class="toggle-row" onclick="toggleCard('+i+')">Details &#x25BE;</div>'+
    '</div>';
  }).join('');
}
function toggleCard(i){const c=document.getElementById('inv-'+i);c.querySelector('.toggle-row').textContent=c.classList.toggle('open')?'Hide ▴':'Details ▾';}
async function markSync(id,btn){
  btn.disabled=true;btn.textContent='Sending…';
  const list=readList();
  const inv=list.find(i=>i.id===id);
  if(!inv){btn.disabled=false;btn.textContent='Send to Desktop →';return;}
  try{
    const r=await fetch(API+'/api/mobile/queue',{method:'POST',headers:{Authorization:'Bearer '+TOKEN,'Content-Type':'application/json'},body:JSON.stringify(inv)});
    const d=await r.json();
    if(!d.ok)throw new Error(d.error||'failed');
    inv.pending_sync=true;saveList(list);loadInvoices();
  }catch{btn.disabled=false;btn.textContent='Send to Desktop →';}
}
function openSheet(){renderChoiceStep();document.getElementById('overlay').classList.add('open');setTimeout(()=>document.getElementById('upload-sheet').classList.add('open'),10);}
function closeSheet(){document.getElementById('upload-sheet').classList.remove('open');document.getElementById('overlay').classList.remove('open');}
function pickCamera(){document.getElementById('camera-input').click();}
function pickFolder(){document.getElementById('folder-input').click();}
function renderChoiceStep(){
  document.getElementById('sheet-body').innerHTML=
    '<div class="sheet-title">Add Invoice</div>'+
    '<div class="sheet-sub">Choose how to capture your invoice.</div>'+
    '<div class="upload-options">'+
      '<button class="upload-opt" onclick="pickCamera()">'+
        '<div class="upload-opt-icon">&#x1F4F7;</div>'+
        '<div><div class="upload-opt-label">Camera</div><div class="upload-opt-sub">Photograph a paper receipt or invoice</div></div>'+
      '</button>'+
      '<button class="upload-opt" onclick="pickFolder()">'+
        '<div class="upload-opt-icon">&#x1F4C1;</div>'+
        '<div><div class="upload-opt-label">From Files</div><div class="upload-opt-sub">Pick a PDF or image from your device</div></div>'+
      '</button>'+
    '</div>'+
    '<button class="btn btn-secondary" onclick="closeSheet()">Cancel</button>';
}
function onFileChosen(e){
  const f=e.target.files[0];if(!f)return;e.target.value='';
  renderProcessing(f.name);doUpload(f);
}
function renderProcessing(name){
  document.getElementById('sheet-body').innerHTML=
    '<div class="sheet-title">Extracting…</div>'+
    '<div class="loading-row"><div class="spinner"></div>'+
    '<div>Reading <strong>'+esc(name)+'</strong></div>'+
    '<div class="loading-label">AI is extracting invoice data.<br>This may take a few seconds.</div></div>';
}
async function doUpload(file){
  const fd=new FormData();fd.append('file',file,file.name);
  try{
    const uploadHeaders={'Authorization':'Bearer '+TOKEN};
    if(GEMINI_KEY)uploadHeaders['x-gemini-key']=GEMINI_KEY;
    const r=await fetch(API+'/api/mobile/upload',{method:'POST',headers:uploadHeaders,body:fd});
    const d=await r.json();
    if(!d.ok)throw new Error(d.error||'Upload failed');
    const inv=d.invoice;
    const list=readList();list.unshift(inv);saveList(list);
    renderResult(inv,file);
  }catch(e){
    document.getElementById('sheet-body').innerHTML=
      '<div class="sheet-title">Error</div>'+
      '<div class="sheet-sub" style="color:var(--danger)">'+esc(e.message)+'</div>'+
      '<button class="btn btn-secondary" style="margin-top:8px" onclick="renderChoiceStep()">Try again</button>'+
      '<button class="btn btn-primary" style="margin-top:8px" onclick="closeSheet()">Close</button>';
  }
}
function renderResult(inv,file){
  const isImage=file&&file.type.startsWith('image/');
  const previewUrl=isImage?URL.createObjectURL(file):null;
  const items=(inv.items||[]).map(it=>'<tr><td>'+esc(it.name)+'</td><td style="text-align:right">'+fmt(it.amountInr)+'</td></tr>').join('');
  document.getElementById('sheet-body').innerHTML=
    '<div class="sheet-title">&#x2705; Extracted</div>'+
    '<div class="sheet-sub">Saved on your device. Send to desktop when ready.</div>'+
    (previewUrl?'<img id="cam-prev" style="width:100%;max-height:220px;object-fit:cover;border-radius:10px;margin-bottom:14px;border:1.5px solid var(--border)" src="'+previewUrl+'">':'')+
    '<div class="result-card">'+
      '<div class="result-name">'+esc(inv.shop_name||inv.filename||'Invoice')+'</div>'+
      '<div class="result-grid">'+
        '<div class="field"><label>Date</label><span>'+fmtDate(inv.date_of_purchase)+'</span></div>'+
        '<div class="field"><label>Total</label><span style="color:var(--accent);font-weight:700">'+fmt(inv.final_payment_inr)+'</span></div>'+
        '<div class="field"><label>GST No.</label><span>'+esc(inv.gst_number)+'</span></div>'+
        '<div class="field"><label>GST %</label><span>'+esc(inv.gst_percent)+'</span></div>'+
        '<div class="field"><label>Discount</label><span>'+fmt(inv.discount_inr)+'</span></div>'+
        '<div class="field"><label>GST Amt</label><span>'+fmt(inv.gst_amount_inr)+'</span></div>'+
      '</div>'+
      (items?'<table class="items-table" style="margin-top:10px"><thead><tr><th>Item</th><th style="text-align:right">Amt</th></tr></thead><tbody>'+items+'</tbody></table>':'')+
    '</div>'+
    '<button class="btn btn-primary" onclick="doSyncAndClose('+inv.id+')">Send to Desktop &#x2192;</button>'+
    '<button class="btn btn-secondary" onclick="closeSheet();loadInvoices()">Not now</button>';
  if(previewUrl){const img=document.getElementById('cam-prev');if(img){img.onload=()=>URL.revokeObjectURL(previewUrl);}}
}
async function doSyncAndClose(id){
  const list=readList();
  const inv=list.find(i=>i.id===id);
  if(inv){
    try{
      const r=await fetch(API+'/api/mobile/queue',{method:'POST',headers:{Authorization:'Bearer '+TOKEN,'Content-Type':'application/json'},body:JSON.stringify(inv)});
      const d=await r.json();
      if(d.ok){inv.pending_sync=true;saveList(list);}
    }catch{}
  }
  closeSheet();loadInvoices();
}

// ── Rewards screen ──────────────────────────────────────────────────────────
function loadRewardsScreen(){
  var P='jinvoice:rewards:';
  var pts=parseInt(localStorage.getItem(P+'pts')||'0',10);
  var cnt=parseInt(localStorage.getItem(P+'cnt')||'0',10);
  var hist=[];try{hist=JSON.parse(localStorage.getItem(P+'hist')||'[]');}catch{}
  var earn=[
    ['&#x2601;&#xFE0F;','Save invoice to cloud','+5 pts'],
    ['&#x1F525;','Every 5 invoices (streak bonus)','+25 pts'],
    ['&#x1F3C6;','Every 25 invoices (champion bonus)','+100 pts']
  ];
  var howHtml=earn.map(function(r){
    return '<div style="display:flex;align-items:center;gap:12px;padding:12px 14px;background:var(--surface);border:1.5px solid var(--border);border-radius:12px;margin-bottom:8px"><span style="font-size:22px">'+r[0]+'</span><span style="flex:1;font-size:13px;color:var(--text)">'+r[1]+'</span><span style="font-size:13px;font-weight:700;color:var(--accent)">'+r[2]+'</span></div>';
  }).join('');
  var histHtml=hist.length
    ?'<div style="font-size:12px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin:16px 0 10px">Recent Activity</div>'+
      hist.slice(0,10).map(function(ev){
        return '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border)"><div><div style="font-size:13px;color:var(--text)">'+esc(ev.reason)+'</div><div style="font-size:11px;color:var(--text3)">'+fmtDate(ev.at)+'</div></div><span style="font-size:13px;font-weight:700;color:#16a34a">+'+ev.points+'</span></div>';
      }).join('')
    :'<div style="padding:20px;text-align:center;color:var(--text3);font-size:13px">No activity yet. Upload an invoice to start earning!</div>';
  document.getElementById('rewards-body').innerHTML=
    '<div style="background:linear-gradient(135deg,#5c3ef0 0%,#7c3aed 100%);padding:28px 20px;color:#fff">'
    +'<div style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;opacity:.8;margin-bottom:4px">Your Rewards</div>'
    +'<div style="font-size:48px;font-weight:800;line-height:1">'+pts.toLocaleString('en-IN')+'</div>'
    +'<div style="font-size:14px;font-weight:600;opacity:.9;margin-top:4px">points &bull; '+cnt+' invoice'+(cnt!==1?'s':'')+'</div>'
    +'</div>'
    +'<div style="padding:16px"><div style="font-size:12px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">How to Earn</div>'
    +howHtml+histHtml+'</div>';
}

// ── Settings screen ─────────────────────────────────────────────────────────
function initSettingsScreen(){}

// ── FAQ screen ──────────────────────────────────────────────────────────────
function faqToggle(btn){
  var item=btn.closest('.faq-item');
  item.classList.toggle('open');
  btn.querySelector('.faq-chev').style.transform=item.classList.contains('open')?'rotate(180deg)':'rotate(0)';
}

// ── Feedback screen ─────────────────────────────────────────────────────────
var _fbRating=0;
function setFbRating(n){
  _fbRating=n;
  document.querySelectorAll('#star-row .star-btn').forEach(function(s,i){
    s.innerHTML=i<n?'&#x2B50;':'&#x2606;';
    s.classList.toggle('on',i<n);
  });
}
function submitFeedback(){
  var msg=(document.getElementById('fb-message').value||'').trim();
  var errEl=document.getElementById('fb-err');
  if(!msg){if(errEl)errEl.textContent='Please write your feedback.';return;}
  if(errEl)errEl.textContent='';
  var cat=(document.getElementById('fb-cat').value)||'General';
  var rating=_fbRating?(_fbRating+'/5 stars'):'Not rated';
  var body=encodeURIComponent('Rating: '+rating+'\\nCategory: '+cat+'\\n\\n'+msg);
  var sub=encodeURIComponent('jInvoice Mobile Feedback');
  window.open('mailto:feedback@jinvoice.app?subject='+sub+'&body='+body,'_blank');
  document.getElementById('fb-thanks').style.display='block';
  document.getElementById('fb-form').style.display='none';
}
function resetFeedback(){
  _fbRating=0;
  document.querySelectorAll('#star-row .star-btn').forEach(function(s){s.innerHTML='&#x2606;';s.classList.remove('on');});
  var msg=document.getElementById('fb-message');if(msg)msg.value='';
  var err=document.getElementById('fb-err');if(err)err.textContent='';
  document.getElementById('fb-thanks').style.display='none';
  document.getElementById('fb-form').style.display='block';
}
</script>
</body>
</html>`;
