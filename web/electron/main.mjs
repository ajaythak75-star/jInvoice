import { createRequire } from "module";
const { app, BrowserWindow, shell, dialog } = createRequire(import.meta.url)("electron");
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { randomBytes, createHash } from "crypto";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { networkInterfaces } from "os";
import express from "express";
import { credentials } from "./credentials.mjs";
import { mobileRouter } from "../server/mobile.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DIST = app.isPackaged
  ? join(process.resourcesPath, "dist")
  : join(__dirname, "..", "dist");

const PORT = 7823;
const BASE = `http://127.0.0.1:${PORT}`;

// Read ANTHROPIC_API_KEY + JINVOICE_SECRET from .env for mobile extraction
(function loadEnv() {
  const envFile = join(__dirname, "..", ".env");
  if (!existsSync(envFile)) return;
  try {
    for (const line of readFileSync(envFile, "utf8").split("\n")) {
      const m = line.match(/^([A-Z_]+)\s*=\s*(.+)$/);
      if (!m) continue;
      const [, k, v] = m;
      if (!process.env[k]) process.env[k] = v.trim().replace(/^['"]|['"]$/g, "");
    }
    // also expose Vite-prefixed key under bare name
    if (!process.env.ANTHROPIC_API_KEY && process.env.VITE_ANTHROPIC_API_KEY)
      process.env.ANTHROPIC_API_KEY = process.env.VITE_ANTHROPIC_API_KEY;
  } catch {}
})();

// Load persisted jInvoice secret (set by user in Settings) — overrides env var
const SECRET_CONFIG_FILE = join(__dirname, "..", "jinvoice-secret.json");
(function loadPersistedSecret() {
  if (!existsSync(SECRET_CONFIG_FILE)) return;
  try {
    const { secret } = JSON.parse(readFileSync(SECRET_CONFIG_FILE, "utf8"));
    if (secret) process.env.JINVOICE_SECRET = secret;
  } catch {}
})();

function getLanIp() {
  for (const ifaces of Object.values(networkInterfaces())) {
    for (const iface of (ifaces ?? [])) {
      if (iface.family === "IPv4" && !iface.internal) return iface.address;
    }
  }
  return "127.0.0.1";
}

const DESKTOP_FOLDER_FILE = join(__dirname, "..", "desktop-folder.json");

function getDesktopFolderConfig() {
  if (!existsSync(DESKTOP_FOLDER_FILE)) return null;
  try { return JSON.parse(readFileSync(DESKTOP_FOLDER_FILE, "utf8")); } catch { return null; }
}

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET } = credentials;

const GMAIL_SCOPE        = "https://www.googleapis.com/auth/gmail.readonly email openid";
const GOOGLE_LOGIN_SCOPE = "openid email profile";
const OUTLOOK_SCOPE      = "openid email Mail.Read offline_access";

const httpApp = express();
httpApp.use(express.json({ limit: "20mb" }));
httpApp.use(mobileRouter);

// CORS for all LAN-accessible endpoints called cross-origin from the mobile browser
httpApp.use(["/api/receive-invoice", "/api/pick-desktop-folder", "/api/desktop-folder"], (req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-jinvoice-key, x-filename");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

// Renderer-callable folder picker — no secret required (desktop-app only).
// Called by DesktopFolderConnector running inside the Electron renderer.
httpApp.post("/api/pick-folder-local", async (req, res) => {
  if (!win) return res.status(503).json({ error: "no window" });
  const result = await dialog.showOpenDialog(win, {
    properties: ["openDirectory"],
    title: "Choose folder for invoice saves",
    buttonLabel: "Select Folder",
  });
  if (result.canceled || !result.filePaths.length) return res.json({ canceled: true });
  const folderPath = result.filePaths[0];
  const name = folderPath.split(/[\\/]/).pop() || folderPath;
  writeFileSync(DESKTOP_FOLDER_FILE, JSON.stringify({ path: folderPath, name }), "utf8");
  res.json({ ok: true, path: folderPath, name });
});

// Renderer-callable file save — no secret required (desktop-app only).
// Saves a PDF buffer to the desktop folder, creating subfolders as needed.
// x-filename header may include a subfolder prefix (e.g. "manual/file.pdf").
httpApp.post(
  "/api/save-to-folder-local",
  express.raw({ type: "application/pdf", limit: "20mb" }),
  (req, res) => {
    const cfg = getDesktopFolderConfig();
    if (!cfg?.path) return res.status(409).json({ error: "No desktop folder configured." });
    const raw = String(req.headers["x-filename"] || `invoice-${Date.now()}.pdf`);
    const segments = raw.split("/").filter(Boolean).map((s) => s.replace(/[\\:*?"<>|]/g, "_").slice(0, 200));
    const relPath = segments.join("/") || `invoice-${Date.now()}.pdf`;
    const outPath = join(cfg.path, relPath);
    try {
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, req.body);
      res.json({ ok: true, saved: relPath });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  }
);

// Open system folder-picker dialog → persist path to desktop-folder.json
httpApp.post("/api/pick-desktop-folder", async (req, res) => {
  const secret = process.env.JINVOICE_SECRET || "jinvoice-change-me";
  const key = req.headers["x-jinvoice-key"] ?? req.query.key;
  if (key !== secret) return res.status(401).json({ error: "unauthorized" });
  if (!win) return res.status(503).json({ error: "no window" });
  const result = await dialog.showOpenDialog(win, {
    properties: ["openDirectory"],
    title: "Choose folder for invoice saves",
    buttonLabel: "Select Folder",
  });
  if (result.canceled || !result.filePaths.length) return res.json({ canceled: true });
  const folderPath = result.filePaths[0];
  const name = folderPath.split(/[\\/]/).pop() || folderPath;
  writeFileSync(DESKTOP_FOLDER_FILE, JSON.stringify({ path: folderPath, name }), "utf8");
  res.json({ ok: true, path: folderPath, name });
});

// Return current desktop folder config
httpApp.get("/api/desktop-folder", (_req, res) => {
  const cfg = getDesktopFolderConfig();
  if (!cfg) return res.json({ configured: false });
  res.json({ configured: true, path: cfg.path, name: cfg.name });
});

// Receive an invoice PDF from mobile over LAN and save it to the desktop folder
httpApp.post(
  "/api/receive-invoice",
  express.raw({ type: "application/pdf", limit: "20mb" }),
  (req, res) => {
    const secret = process.env.JINVOICE_SECRET || "jinvoice-change-me";
    const key = req.headers["x-jinvoice-key"] ?? req.query.key;
    if (key !== secret) return res.status(401).json({ error: "unauthorized" });

    const cfg = getDesktopFolderConfig();
    if (!cfg?.path) {
      return res.status(409).json({ error: "No desktop folder configured. Open jInvoice desktop first." });
    }

    const raw = String(req.headers["x-filename"] || `invoice-${Date.now()}.pdf`);
    // Support subdirectory in filename (e.g. "ShopName/ShopName_Date.pdf")
    const segments = raw.split("/").filter(Boolean).map((s) => s.replace(/[\\:*?"<>|]/g, "_").slice(0, 200));
    const relPath = segments.join("/") || `invoice-${Date.now()}.pdf`;
    const outPath = join(cfg.path, relPath);
    try {
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, req.body);
      res.json({ ok: true, saved: relPath });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  }
);

httpApp.get("/api/local-info", (_req, res) => {
  const ip = getLanIp();
  const secret = process.env.JINVOICE_SECRET || "jinvoice-change-me";
  const renderUrl = process.env.RENDER_URL || "https://jinvoice-proxy.onrender.com";
  const folderCfg = getDesktopFolderConfig();
  res.json({
    url: `http://${ip}:${PORT}`,
    secret,
    mobileUrl: `http://${ip}:${PORT}/mobile?key=${encodeURIComponent(secret)}`,
    renderUrl,
    renderMobileUrl: `${renderUrl}/mobile?key=${encodeURIComponent(secret)}`,
    desktopFolder: folderCfg ? { configured: true, name: folderCfg.name } : { configured: false },
  });
});

// Update the jInvoice secret at runtime — called from the Settings UI
httpApp.post("/api/set-secret", (req, res) => {
  const { secret } = req.body ?? {};
  if (!secret || typeof secret !== "string" || secret.trim().length < 6) {
    return res.status(400).json({ error: "Secret must be at least 6 characters." });
  }
  const trimmed = secret.trim();
  process.env.JINVOICE_SECRET = trimmed;
  try {
    writeFileSync(SECRET_CONFIG_FILE, JSON.stringify({ secret: trimmed }), "utf8");
  } catch (e) {
    console.error("[set-secret] Failed to persist", e);
  }
  res.json({ ok: true });
});

// // Proxy Anthropic API calls — browser renderer can't call api.anthropic.com directly (CORS)
// httpApp.post("/api/claude", async (req, res) => {
//   const apiKey = process.env.VITE_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
//   console.log("[Claude proxy] hit, key present:", !!apiKey);
//   if (!apiKey) { console.log("[Claude proxy] ERROR: no API key"); return res.status(503).json({ error: "ANTHROPIC_API_KEY not configured" }); }
//   try {
//     const upstream = await fetch("https://api.anthropic.com/v1/messages", {
//       method: "POST",
//       headers: {
//         "Content-Type": "application/json",
//         "x-api-key": apiKey,
//         "anthropic-version": "2023-06-01",
//       },
//       body: JSON.stringify(req.body),
//     });
//     const data = await upstream.json();
//     console.log("[Claude proxy] response status:", upstream.status);
//     res.status(upstream.status).json(data);
//   } catch (e) {
//     console.log("[Claude proxy] fetch error:", String(e));
//     res.status(500).json({ error: String(e) });
//   }
// });

// Proxy Gemini API calls — browser renderer can't call generativelanguage.googleapis.com directly (CORS)
httpApp.post("/api/gemini", async (req, res) => {
  const apiKey = process.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
  console.log("[Gemini proxy] hit, key present:", !!apiKey);
  if (!apiKey) { console.log("[Gemini proxy] ERROR: no API key"); return res.status(503).json({ error: "GEMINI_API_KEY not configured" }); }
  const { model = "gemini-1.5-flash", ...body } = req.body;
  try {
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    );
    const data = await upstream.json();
    console.log("[Gemini proxy] response status:", upstream.status);
    res.status(upstream.status).json(data);
  } catch (e) {
    console.log("[Gemini proxy] fetch error:", String(e));
    res.status(500).json({ error: String(e) });
  }
});

// PKCE helpers
const pkceVerifiers = new Map();
function pkceStart(key) {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  pkceVerifiers.set(key, verifier);
  return { verifier, challenge };
}
function pkceConsume(key) {
  const v = pkceVerifiers.get(key) ?? "";
  pkceVerifiers.delete(key);
  return v;
}

// ── Google login ────────────────────────────────────────────────────────────

httpApp.get("/auth/google/login/start", (_req, res) => {
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID, redirect_uri: `${BASE}/auth/google/login/callback`,
    response_type: "code", scope: GOOGLE_LOGIN_SCOPE, access_type: "online", state: "google_login",
  })}`);
});

httpApp.get("/auth/google/login/callback", async (req, res) => {
  const { code } = req.query;
  if (!code) { deliverOAuthResult("#error=oauth_denied"); return res.send(CLOSE_TAB_HTML); }
  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, redirect_uri: `${BASE}/auth/google/login/callback`, grant_type: "authorization_code" }),
    });
    const t = await tokenRes.json();
    if (!t.access_token) {
      const errDetail = t.error_description ?? t.error ?? "no access_token";
      deliverOAuthResult("#error=oauth_failed");
      return res.send(`<html><body><h2>OAuth error</h2><p>${errDetail}</p><p>Status: ${tokenRes.status}</p><p>Response: ${JSON.stringify(t)}</p></body></html>`);
    }
    const p = await (await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: `Bearer ${t.access_token}` } })).json();
    deliverOAuthResult(`#${new URLSearchParams({ google_login_email: p.email ?? "", google_login_name: p.name ?? "" })}`);
    res.send(CLOSE_TAB_HTML);
  } catch(e) {
    deliverOAuthResult("#error=oauth_failed");
    res.send(`<html><body><h2>OAuth error</h2><p>${e.message}</p></body></html>`);
  }
});

// ── Gmail ────────────────────────────────────────────────────────────────────

httpApp.get("/auth/gmail/start", (_req, res) => {
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID, redirect_uri: `${BASE}/auth/gmail/callback`,
    response_type: "code", scope: GMAIL_SCOPE, access_type: "offline", prompt: "consent", state: "gmail",
  })}`);
});

httpApp.get("/auth/gmail/callback", async (req, res) => {
  const { code } = req.query;
  if (!code) { deliverOAuthResult("#error=oauth_denied"); return res.send(CLOSE_TAB_HTML); }
  try {
    const t = await (await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, redirect_uri: `${BASE}/auth/gmail/callback`, grant_type: "authorization_code" }),
    })).json();
    if (!t.access_token) throw new Error("no token");
    const prof = await (await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: `Bearer ${t.access_token}` } })).json();
    const hp = { gmail_access_token: t.access_token, gmail_email: prof.email ?? "" };
    if (t.refresh_token) hp.gmail_refresh_token = t.refresh_token;
    deliverOAuthResult(`#${new URLSearchParams(hp)}`);
    res.send(CLOSE_TAB_HTML);
  } catch { deliverOAuthResult("#error=oauth_failed"); res.send(CLOSE_TAB_HTML); }
});

httpApp.get("/auth/gmail/refresh", async (req, res) => {
  const { refresh_token } = req.query;
  if (!refresh_token) return res.status(400).end();
  try {
    const t = await (await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, refresh_token, grant_type: "refresh_token" }),
    })).json();
    if (!t.access_token) throw new Error("no token");
    res.json({ access_token: t.access_token });
  } catch { res.status(401).end(); }
});

// ── Outlook ──────────────────────────────────────────────────────────────────

httpApp.get("/auth/outlook/start", (_req, res) => {
  res.redirect(`https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${new URLSearchParams({
    client_id: AZURE_CLIENT_ID, redirect_uri: `${BASE}/auth/outlook/callback`,
    response_type: "code", scope: OUTLOOK_SCOPE, response_mode: "query", state: "outlook",
  })}`);
});

httpApp.get("/auth/outlook/callback", async (req, res) => {
  const { code } = req.query;
  if (!code) { deliverOAuthResult("#error=oauth_denied"); return res.send(CLOSE_TAB_HTML); }
  try {
    const t = await (await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: AZURE_CLIENT_ID, client_secret: AZURE_CLIENT_SECRET, redirect_uri: `${BASE}/auth/outlook/callback`, grant_type: "authorization_code", scope: OUTLOOK_SCOPE }),
    })).json();
    if (!t.access_token) throw new Error("no token");
    const prof = await (await fetch("https://graph.microsoft.com/v1.0/me", { headers: { Authorization: `Bearer ${t.access_token}` } })).json();
    deliverOAuthResult(`#${new URLSearchParams({ outlook_access_token: t.access_token, outlook_email: prof.mail ?? prof.userPrincipalName ?? "" })}`);
    res.send(CLOSE_TAB_HTML);
  } catch { deliverOAuthResult("#error=oauth_failed"); res.send(CLOSE_TAB_HTML); }
});

// ── IMAP (Gmail App Password) ─────────────────────────────────────────────────

const IMAP_CREDS_FILE = join(__dirname, "..", "imap-creds.json");

function loadImapCreds() {
  if (!existsSync(IMAP_CREDS_FILE)) return null;
  try { return JSON.parse(readFileSync(IMAP_CREDS_FILE, "utf8")); } catch { return null; }
}

function findPdfParts(struct, partId = "") {
  if (!struct) return [];
  const parts = [];
  const type = (struct.type ?? "").toLowerCase();
  const subtype = (struct.subtype ?? "").toLowerCase();
  const filename = struct.disposition?.parameters?.filename ?? struct.parameters?.name ?? "";
  const isPdf = (type === "application" && subtype === "pdf") || filename.toLowerCase().endsWith(".pdf");
  if (isPdf && partId) {
    parts.push({ id: partId, name: filename || "invoice.pdf" });
    return parts;
  }
  (struct.childNodes ?? []).forEach((child, i) => {
    const cId = partId ? `${partId}.${i + 1}` : `${i + 1}`;
    parts.push(...findPdfParts(child, cId));
  });
  return parts;
}

httpApp.get("/api/imap/status", (_req, res) => {
  const creds = loadImapCreds();
  res.json({ configured: !!creds, email: creds?.email ?? null });
});

httpApp.post("/api/imap/save", (req, res) => {
  const { email, appPassword } = req.body ?? {};
  if (!email || !appPassword) return res.status(400).json({ error: "email and appPassword required" });
  try {
    writeFileSync(IMAP_CREDS_FILE, JSON.stringify({ email, appPassword }), "utf8");
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

httpApp.post("/api/imap/disconnect", (_req, res) => {
  try {
    if (existsSync(IMAP_CREDS_FILE)) {
      createRequire(import.meta.url)("fs").unlinkSync(IMAP_CREDS_FILE);
    }
  } catch {}
  res.json({ ok: true });
});

httpApp.post("/api/imap/test", async (req, res) => {
  const { email, appPassword } = req.body ?? {};
  if (!email || !appPassword) return res.status(400).json({ error: "email and appPassword required" });
  try {
    const { ImapFlow } = createRequire(import.meta.url)("imapflow");
    const client = new ImapFlow({
      host: "imap.gmail.com", port: 993, secure: true,
      auth: { user: email, pass: appPassword },
      logger: false,
    });
    await client.connect();
    await client.logout();
    res.json({ ok: true });
  } catch (e) {
    res.status(401).json({ error: String(e) });
  }
});

httpApp.post("/api/imap/poll", async (req, res) => {
  const creds = loadImapCreds();
  if (!creds) return res.status(503).json({ error: "IMAP not configured" });
  const { months = 3 } = req.body ?? {};
  const since = new Date();
  since.setMonth(since.getMonth() - months);
  const { ImapFlow } = createRequire(import.meta.url)("imapflow");
  const client = new ImapFlow({
    host: "imap.gmail.com", port: 993, secure: true,
    auth: { user: creds.email, pass: creds.appPassword },
    logger: false,
  });
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    const results = [];
    try {
      const seqNos = await client.search({ since });
      const slice = seqNos.slice(-200); // newest 200 messages max
      if (slice.length) {
        for await (const msg of client.fetch(slice, { envelope: true, bodyStructure: true })) {
          const pdfParts = findPdfParts(msg.bodyStructure);
          if (!pdfParts.length) continue;
          const msgId = `imap:${msg.envelope.messageId ?? msg.seq}`;
          const attachments = [];
          for (const part of pdfParts) {
            try {
              const { content } = await client.download(`${msg.seq}`, part.id);
              const chunks = [];
              for await (const chunk of content) chunks.push(chunk);
              attachments.push({ filename: part.name, data: Buffer.concat(chunks).toString("base64") });
            } catch (e) {
              console.error("[IMAP] download part failed:", e.message);
            }
          }
          if (attachments.length) {
            results.push({
              messageId: msgId,
              subject: msg.envelope.subject ?? "",
              senderEmail: (msg.envelope.from ?? [])[0]?.address ?? "",
              receivedAt: msg.envelope.date?.toISOString() ?? new Date().toISOString(),
              attachments,
            });
          }
        }
      }
    } finally {
      lock.release();
    }
    await client.logout();
    res.json({ results });
  } catch (e) {
    try { await client.logout(); } catch {}
    res.status(500).json({ error: String(e) });
  }
});

// ── Static + SPA ──────────────────────────────────────────────────────────────

httpApp.use(express.static(DIST));
httpApp.get("/*path", (_req, res) => res.sendFile(join(DIST, "index.html")));

httpApp.listen(PORT, "0.0.0.0", () => {
  console.log(`[jInvoice] LAN mobile access: http://${getLanIp()}:${PORT}/mobile`);
  const geminiKey = process.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY || "";
  console.log(`[jInvoice] GEMINI key loaded: ${!!geminiKey} (length: ${geminiKey.length})`);
  console.log(`[jInvoice] DIST: ${DIST}`);

  // Quick Gemini connectivity test on startup
  if (geminiKey) {
    fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${geminiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: "Reply: ok" }] }], generationConfig: { maxOutputTokens: 50 } }),
    })
      .then((r) => r.json())
      .then((d) => {
        const parts = d?.candidates?.[0]?.content?.parts ?? [];
        const out = parts.find((p) => !p.thought) ?? parts[0];
        console.log("[jInvoice] Gemini ping:", out?.text ? "OK — " + out.text.trim().slice(0, 40) : "NO OUTPUT — " + JSON.stringify(d).slice(0, 120));
      })
      .catch((e) => console.error("[jInvoice] Gemini ping failed:", e.message));
  } else {
    console.warn("[jInvoice] Gemini key not found — extraction will fall back to text parser (50% confidence)");
  }
});

// ── Electron window ───────────────────────────────────────────────────────────

let win;

const OAUTH_HOSTS = ["accounts.google.com", "login.microsoftonline.com"];

function isOAuthUrl(url) {
  try { return OAUTH_HOSTS.includes(new URL(url).hostname); } catch { return false; }
}

function deliverOAuthResult(hash) {
  if (!win) return;
  // Use /index.html (different path from /) so Chromium does a true cross-document
  // navigation regardless of the window's current URL — guarantees App.tsx re-runs
  // and applyOAuthHash() reads the hash at module init.
  win.webContents.loadURL(`${BASE}/index.html${hash}`);
  app.dock?.bounce("informational");
  app.focus({ steal: true });
  win.show();
  win.focus();
}

const CLOSE_TAB_HTML = `<!doctype html>
<html>
<head>
<meta charset="UTF-8"/>
<title>Signed in — jInvoice</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
    background:#f0eeff;display:flex;align-items:center;justify-content:center;
    min-height:100vh;padding:24px}
  .card{background:#fff;border-radius:16px;padding:40px 36px;text-align:center;
    max-width:340px;width:100%;box-shadow:0 4px 24px rgba(92,62,240,.12)}
  .mark{width:52px;height:52px;background:#5C3EF0;border-radius:14px;
    display:flex;align-items:center;justify-content:center;
    font-size:26px;font-weight:800;color:#fff;margin:0 auto 18px}
  h1{font-size:20px;font-weight:700;color:#0D0D1C;margin-bottom:8px}
  p{font-size:14px;color:#58587A;line-height:1.5}
  .hint{margin-top:20px;font-size:13px;color:#9898B8;background:#f7f5ff;
    border-radius:8px;padding:10px 14px}
</style>
</head>
<body>
<div class="card">
  <div class="mark">j</div>
  <h1>You're signed in!</h1>
  <p>jInvoice is ready. Closing this tab…</p>
  <div class="hint">⌘W if it doesn't close automatically</div>
</div>
<script>setTimeout(() => window.close(), 1500);</script>
</body>
</html>`;

function createWindow() {
  win = new BrowserWindow({
    width: 1200, height: 800, minWidth: 400, minHeight: 600,
    title: "jInvoice",
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  win.loadURL(BASE);

  // Auto-open DevTools in dev mode so errors are visible without right-click → Inspect
  if (!app.isPackaged) win.webContents.openDevTools({ mode: "detach" });

  // Open OAuth pages in the system browser (not Electron) — Google/Microsoft
  // block OAuth in embedded Chromium views.
  win.webContents.on("will-navigate", (event, url) => {
    if (isOAuthUrl(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  win.webContents.on("will-redirect", (event, url) => {
    if (isOAuthUrl(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  win.on("closed", () => { win = null; });
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
