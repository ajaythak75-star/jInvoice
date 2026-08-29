/**
 * jInvoice OAuth proxy + mobile relay — deploy this to Render (free tier).
 * Holds Google + Azure secrets server-side. After each OAuth dance,
 * redirects the user back to the local binary at http://localhost:7823.
 * Also serves the mobile upload UI and relays invoices to the desktop.
 */
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

const GMAIL_SCOPE        = "https://www.googleapis.com/auth/gmail.readonly email openid";
const GOOGLE_LOGIN_SCOPE = "openid email profile";
const OUTLOOK_SCOPE      = "openid email Mail.Read offline_access";

const app = express();
app.use(express.json({ limit: "1mb" }));

// CORS for desktop app (http://localhost:7823) calling cross-origin Render endpoints
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", LOCAL_APP);
  res.header("Access-Control-Allow-Headers", "Content-Type, x-jinvoice-key");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ── Mobile relay — in-memory store ───────────────────────────────────────────
// Data is ephemeral (lost on Render restart), but that's fine:
// the flow is upload → send to desktop → ack, which completes in seconds.

let mobileDb = { invoices: [], nextId: 1 };

function getSecret() { return process.env.JINVOICE_SECRET || "jinvoice-change-me"; }

function mobileAuth(req, res, next) {
  const key = req.headers["x-jinvoice-key"] || req.query.key;
  if (key !== getSecret()) return res.status(401).json({ error: "invalid key" });
  next();
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

app.get("/mobile", (_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(MOBILE_HTML);
});

app.post("/api/mobile/auth", (req, res) => {
  const key = req.headers["x-jinvoice-key"] || req.body?.key;
  res.json({ ok: key === getSecret() });
});

app.post("/api/mobile/upload", mobileAuth, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "no file attached" });
  const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
  if (!apiKey) return res.status(503).json({ error: "GEMINI_API_KEY not configured on server" });
  try {
    const data = await extractWithGemini(req.file.buffer, req.file.mimetype, apiKey);
    const inv = {
      id: mobileDb.nextId++,
      filename: req.file.originalname || "upload",
      uploadedAt: new Date().toISOString(),
      pendingSync: false,
      syncedAt: null,
      ...data,
    };
    mobileDb.invoices.unshift(inv);
    res.json({ ok: true, invoice: inv });
  } catch (e) {
    console.error("[mobile upload]", e);
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/mobile/invoices", mobileAuth, (_req, res) => {
  res.json(mobileDb.invoices);
});

app.post("/api/mobile/invoices/:id/sync", mobileAuth, (req, res) => {
  const inv = mobileDb.invoices.find(i => i.id === +req.params.id);
  if (!inv) return res.status(404).json({ error: "not found" });
  inv.pendingSync = true;
  res.json({ ok: true });
});

app.get("/api/desktop/pending", mobileAuth, (_req, res) => {
  res.json(mobileDb.invoices.filter(i => i.pendingSync && !i.syncedAt));
});

app.post("/api/desktop/ack/:id", mobileAuth, (req, res) => {
  const inv = mobileDb.invoices.find(i => i.id === +req.params.id);
  if (!inv) return res.status(404).json({ error: "not found" });
  inv.pendingSync = false;
  inv.syncedAt = new Date().toISOString();
  res.json({ ok: true });
});

// ── Gemini extraction ─────────────────────────────────────────────────────────

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

// ── Google login ──────────────────────────────────────────────────────────────

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

// ── Gmail ─────────────────────────────────────────────────────────────────────

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

// ── Outlook ───────────────────────────────────────────────────────────────────

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

// ── Gemini proxy (keeps API key server-side, avoids CORS) ────────────────────

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

// ── Mobile HTML ───────────────────────────────────────────────────────────────
// (kept at bottom so it doesn't clutter the route definitions above)

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
</style>
</head>
<body>
<div class="screen active" id="screen-auth">
  <div class="auth-wrap">
    <div class="logo">j</div>
    <div class="auth-title">jInvoice Mobile</div>
    <div class="auth-sub">Enter your jInvoice secret key to connect.</div>
    <input id="key-input" class="inp" type="password" placeholder="Secret key" autocomplete="off">
    <div id="auth-err" class="err"></div>
    <button class="btn btn-primary" onclick="doAuth()">Connect &#x2192;</button>
  </div>
</div>
<div class="screen" id="screen-home">
  <header>
    <h1>j<span>Invoice</span></h1>
    <button class="icon-btn" onclick="signOut()" title="Sign out" aria-label="Sign out">&#x2935;</button>
  </header>
  <div class="list" id="invoice-list">
    <div class="empty"><div class="empty-icon">&#x1F9FE;</div><div>No invoices yet.<br>Tap + to upload or photograph an invoice.</div></div>
  </div>
  <button class="fab" onclick="openSheet()" aria-label="Add invoice">+</button>
</div>
<div class="overlay" id="overlay" onclick="closeSheet()"></div>
<div class="sheet" id="upload-sheet">
  <div class="sheet-handle"></div>
  <div class="sheet-body" id="sheet-body"></div>
</div>
<input type="file" id="camera-input" accept="image/*" capture="environment" style="display:none" onchange="onFileChosen(event)">
<input type="file" id="folder-input" accept="application/pdf,image/*" style="display:none" onchange="onFileChosen(event)">
<script>
const API=window.location.origin;
let KEY=sessionStorage.getItem('jik')||'';
async function doAuth(){
  const k=document.getElementById('key-input').value.trim();
  if(!k){document.getElementById('auth-err').textContent='Please enter your secret key.';return;}
  const btn=document.querySelector('#screen-auth .btn');
  document.getElementById('auth-err').textContent='';
  btn.textContent='Connecting…';btn.disabled=true;
  try{
    const r=await fetch(API+'/api/mobile/auth',{method:'POST',headers:{'Content-Type':'application/json','x-jinvoice-key':k},body:JSON.stringify({key:k}),signal:AbortSignal.timeout(8000)});
    const d=await r.json();
    if(d.ok){KEY=k;sessionStorage.setItem('jik',k);showHome();}
    else{document.getElementById('auth-err').textContent='Invalid key. Try again.';btn.textContent='Connect →';btn.disabled=false;}
  }catch(e){
    document.getElementById('auth-err').textContent='Cannot reach server: '+(e.message||'network error');
    btn.textContent='Connect →';btn.disabled=false;
  }
}
function signOut(){sessionStorage.removeItem('jik');KEY='';show('screen-auth');}
(function init(){
  const k=new URLSearchParams(location.search).get('key');
  if(k){document.getElementById('key-input').value=k;doAuth();}
  else if(KEY)showHome();
})();
document.getElementById('key-input').addEventListener('keydown',e=>{if(e.key==='Enter')doAuth();});
function show(id){document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));document.getElementById(id).classList.add('active');}
function showHome(){show('screen-home');loadInvoices();}
async function loadInvoices(){
  try{const r=await fetch(API+'/api/mobile/invoices',{headers:{'x-jinvoice-key':KEY}});renderList(await r.json());}catch{}
}
function fmt(v){return v!=null&&v!==''?'&#x20B9;'+Number(v).toFixed(2):'&#x2014;';}
function fmtDate(s){if(!s)return'&#x2014;';try{return new Date(s).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});}catch{return s;}}
function esc(s){return s?String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'):'&#x2014;';}
function renderList(list){
  const el=document.getElementById('invoice-list');
  if(!list.length){el.innerHTML='<div class="empty"><div class="empty-icon">&#x1F9FE;</div><div>No invoices yet.<br>Tap + to upload or photograph an invoice.</div></div>';return;}
  el.innerHTML=list.map((inv,i)=>{
    const items=(inv.items||[]).map(it=>'<tr><td>'+esc(it.name)+'</td><td>'+fmt(it.amountInr)+'</td></tr>').join('');
    const syncPart=inv.syncedAt
      ?'<div class="synced-badge" style="color:var(--success)">&#x2713; Synced to desktop '+fmtDate(inv.syncedAt)+'</div>'
      :inv.pendingSync
      ?'<div class="synced-badge" style="color:var(--warn)">&#x23F3; Waiting for desktop sync&hellip;</div>'
      :'<button class="sync-btn" onclick="markSync('+inv.id+',this)">Send to Desktop &#x2192;</button>';
    return '<div class="card '+(inv.pendingSync&&!inv.syncedAt?'pending-sync':'')+'" id="inv-'+i+'">'+
      '<div class="card-top" onclick="toggleCard('+i+')">'+
        '<div class="card-name">'+esc(inv.shopName||inv.filename||'Invoice')+'</div>'+
        '<div class="card-amount">'+fmt(inv.finalPaymentInr)+'</div>'+
      '</div>'+
      '<div class="card-meta">'+(inv.dateOfPurchase?'<span>'+fmtDate(inv.dateOfPurchase)+'</span>':'')+
        '<span>'+esc(inv.filename||'')+'</span></div>'+
      '<div class="card-detail">'+
        '<div class="detail-grid">'+
          (inv.address?'<div class="field" style="grid-column:1/-1"><label>Address</label><span>'+esc(inv.address)+'</span></div>':'')+
          '<div class="field"><label>Pincode</label><span>'+esc(inv.pincode)+'</span></div>'+
          '<div class="field"><label>GST No.</label><span>'+esc(inv.gstNumber)+'</span></div>'+
          '<div class="field"><label>GST %</label><span>'+esc(inv.gstPercent)+'</span></div>'+
          '<div class="field"><label>GST Amt</label><span>'+fmt(inv.gstAmountInr)+'</span></div>'+
          '<div class="field"><label>Discount</label><span>'+fmt(inv.discountInr)+'</span></div>'+
          '<div class="field"><label>Total</label><span style="color:var(--accent);font-weight:700">'+fmt(inv.finalPaymentInr)+'</span></div>'+
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
  try{await fetch(API+'/api/mobile/invoices/'+id+'/sync',{method:'POST',headers:{'x-jinvoice-key':KEY}});loadInvoices();}
  catch{btn.disabled=false;btn.textContent='Send to Desktop →';}
}
function openSheet(){renderChoiceStep();document.getElementById('overlay').classList.add('open');setTimeout(()=>document.getElementById('upload-sheet').classList.add('open'),10);}
function closeSheet(){document.getElementById('upload-sheet').classList.remove('open');document.getElementById('overlay').classList.remove('open');}
function renderChoiceStep(){
  document.getElementById('sheet-body').innerHTML=
    '<div class="sheet-title">Add Invoice</div>'+
    '<div class="sheet-sub">Choose how to capture your invoice.</div>'+
    '<div class="upload-options">'+
      '<button class="upload-opt" onclick="document.getElementById(\'camera-input\').click()">'+
        '<div class="upload-opt-icon">&#x1F4F7;</div>'+
        '<div><div class="upload-opt-label">Camera</div><div class="upload-opt-sub">Photograph a paper receipt or invoice</div></div>'+
      '</button>'+
      '<button class="upload-opt" onclick="document.getElementById(\'folder-input\').click()">'+
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
    const r=await fetch(API+'/api/mobile/upload',{method:'POST',headers:{'x-jinvoice-key':KEY},body:fd});
    const d=await r.json();
    if(!d.ok)throw new Error(d.error||'Upload failed');
    renderResult(d.invoice,file);
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
    '<div class="sheet-sub">Saved to cloud. Send to desktop when ready.</div>'+
    (previewUrl?'<img id="cam-prev" class="cam-preview" src="'+previewUrl+'">':'')+
    '<div class="result-card">'+
      '<div class="result-name">'+esc(inv.shopName||inv.filename||'Invoice')+'</div>'+
      '<div class="result-grid">'+
        '<div class="field"><label>Date</label><span>'+fmtDate(inv.dateOfPurchase)+'</span></div>'+
        '<div class="field"><label>Total</label><span style="color:var(--accent);font-weight:700">'+fmt(inv.finalPaymentInr)+'</span></div>'+
        '<div class="field"><label>GST No.</label><span>'+esc(inv.gstNumber)+'</span></div>'+
        '<div class="field"><label>GST %</label><span>'+esc(inv.gstPercent)+'</span></div>'+
        '<div class="field"><label>Discount</label><span>'+fmt(inv.discountInr)+'</span></div>'+
        '<div class="field"><label>GST Amt</label><span>'+fmt(inv.gstAmountInr)+'</span></div>'+
      '</div>'+
      (items?'<table class="items-table" style="margin-top:10px"><thead><tr><th>Item</th><th style="text-align:right">Amt</th></tr></thead><tbody>'+items+'</tbody></table>':'')+
    '</div>'+
    '<button class="btn btn-primary" onclick="doSyncAndClose('+inv.id+')">Send to Desktop &#x2192;</button>'+
    '<button class="btn btn-secondary" onclick="closeSheet();loadInvoices()">Not now</button>';
  if(previewUrl){const img=document.getElementById('cam-prev');if(img){img.style.display='block';img.onload=()=>URL.revokeObjectURL(previewUrl);}}
}
async function doSyncAndClose(id){
  try{await fetch(API+'/api/mobile/invoices/'+id+'/sync',{method:'POST',headers:{'x-jinvoice-key':KEY}});}catch{}
  closeSheet();loadInvoices();
}
</script>
</body>
</html>`;
