// ╔══════════════════════════════════════════════════════════╗
// ║  proxy.mjs — deployed to Render (render.yaml)            ║
// ║                                                          ║
// ║  [DESKTOP]  OAuth proxy — Google login / Gmail / Outlook ║
// ║             Holds secrets; redirects back to localhost   ║
// ║                                                          ║
// ║  [MOBILE]   Relay + extraction + mobile web UI           ║
// ║             Supabase JWT auth, in-memory queue, 5-day TTL║
// ╚══════════════════════════════════════════════════════════╝
import express from "express";
import multer from "multer";

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
const SUPABASE_URL      = process.env.SUPABASE_URL      ?? "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? "";

const GMAIL_SCOPE        = "https://www.googleapis.com/auth/gmail.readonly email openid";
const GOOGLE_LOGIN_SCOPE = "openid email profile";
const OUTLOOK_SCOPE      = "openid email Mail.Read offline_access";

const app = express();
app.use(express.json({ limit: "1mb" }));

// CORS for desktop app (http://localhost:7823) calling cross-origin Render endpoints
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", LOCAL_APP);
  res.header("Access-Control-Allow-Headers", "Content-Type, x-jinvoice-key, Authorization");
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
  res.send(MOBILE_HTML);
});

// Upload: Gemini extraction → return data (not stored server-side; mobile saves to localStorage)
app.post("/api/mobile/upload", upload.single("file"), async (req, res) => {
  const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  const userId = await validateSupabaseJWT(token);
  if (!userId) return res.status(401).json({ error: "Unauthorized. Please sign in again." });

  if (!req.file) return res.status(400).json({ error: "no file attached" });
  const apiKey = req.headers["x-gemini-key"] || process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
  if (!apiKey) return res.status(503).json({ error: "No Gemini API key configured on server." });
  try {
    const data = await extractWithGemini(req.file.buffer, req.file.mimetype, apiKey);
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
      items:            data.items           ?? null,
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
const EXTRACTION_PROMPT = `You are an invoice data extractor for Indian businesses. Extract the following fields and respond ONLY with valid JSON, no explanation or markdown.

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
  "dateOfPurchase": <purchase date in YYYY-MM-DD format, assume 2025 if year missing, or null>,
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

async function extractWithGemini(fileBuf, mimeType, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [
        { inline_data: { mime_type: mimeType, data: fileBuf.toString("base64") } },
        { text: EXTRACTION_PROMPT },
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

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || "";

app.post("/api/gemini", async (req, res) => {
  if (!GEMINI_API_KEY) return res.status(503).json({ error: "GEMINI_API_KEY not configured on server" });
  const { model = "gemini-3.6-flash", ...body } = req.body ?? {};
  try {
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    );
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── Root: auto-detect mobile and redirect ─────────────────────────────────────

app.get("/", (req, res) => {
  const ua = req.headers["user-agent"] ?? "";
  const isMobile = /android|iphone|ipad|ipod|mobile/i.test(ua);
  if (isMobile) return res.redirect("/mobile");
  res.send(`<!DOCTYPE html><html><head><title>jInvoice</title>
<meta charset="utf-8"><style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f0eeff}
.box{text-align:center;padding:40px}.h1{font-size:28px;font-weight:800;color:#5c3ef0;margin-bottom:8px}
.sub{color:#4a4a6a;margin-bottom:32px}a.btn{display:inline-block;padding:14px 28px;background:#5c3ef0;color:#fff;border-radius:12px;text-decoration:none;font-weight:600;margin:8px}
</style></head><body><div class="box"><div class="h1">jInvoice</div>
<div class="sub">Run the desktop app with <code>npm start</code> in the web folder, or open on your phone.</div>
<a class="btn" href="/mobile">Open Mobile UI</a>
<a class="btn" href="/health" style="background:#e0daf8;color:#5c3ef0">Status</a>
</div></body></html>`);
});

// ── Health check ──────────────────────────────────────────────────────────────

app.get("/health", (_req, res) => res.send("ok"));

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
    <div style="margin-top:12px;text-align:center">
      <button type="button" onclick="previewNav()" style="background:none;border:1px dashed var(--border);color:var(--text3);font-size:11px;border-radius:8px;cursor:pointer;padding:6px 14px;width:100%">&#x1F9EA; Preview Nav (test — no login)</button>
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
      <div style="font-size:12px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px">AI Settings</div>
      <label style="display:block;font-size:12px;font-weight:600;color:var(--text2);margin-bottom:6px">Gemini API Key <span style="font-weight:400;color:var(--text3)">(optional)</span></label>
      <input type="password" id="settings-gemini" class="inp" placeholder="Leave blank to use server key" autocomplete="off">
      <div id="settings-msg" style="font-size:12px;margin-top:6px;min-height:18px"></div>
      <button class="btn btn-secondary" onclick="saveGeminiKey()" style="margin-top:10px">Save Key</button>
      <div style="font-size:11px;color:var(--text3);margin-top:8px;line-height:1.5">Used for invoice extraction. Leave blank to use the shared server key.</div>
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
  // version toast — visible for 3s so you can confirm Render deployed new code
  var vt=document.createElement('div');
  vt.textContent='jInvoice v2.2 • tap test';
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
function previewNav(){
  var nav=document.getElementById('bottom-nav');
  var banner=document.createElement('div');
  banner.textContent='TAPPED! nav='+(nav?'found':'MISSING');
  banner.style.cssText='position:fixed;top:0;left:0;right:0;background:#ef4444;color:#fff;text-align:center;padding:14px;font-size:16px;font-weight:700;z-index:9999';
  document.body.appendChild(banner);
  setTimeout(function(){banner.remove();},4000);
  showNav();
  setNavActive('home');
  var btn=document.querySelector('[onclick="previewNav()"]');
  if(btn){btn.style.background='#22c55e';btn.style.color='#fff';btn.textContent='✅ Nav visible below!';}
}
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
    '<div class="loading-label">Gemini AI is extracting invoice data.<br>This may take a few seconds.</div></div>';
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
function initSettingsScreen(){
  var gk=sessionStorage.getItem('jgk')||'';
  var el=document.getElementById('settings-gemini');
  if(el)el.value=gk;
  var msg=document.getElementById('settings-msg');
  if(msg)msg.textContent='';
}
function saveGeminiKey(){
  var k=(document.getElementById('settings-gemini').value||'').trim();
  GEMINI_KEY=k;
  if(k)sessionStorage.setItem('jgk',k);else sessionStorage.removeItem('jgk');
  var msg=document.getElementById('settings-msg');
  if(msg){msg.textContent='Saved!';msg.style.color='var(--success)';setTimeout(function(){if(msg)msg.textContent='';},2000);}
}

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
  var body=encodeURIComponent('Rating: '+rating+'\nCategory: '+cat+'\n\n'+msg);
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
