import { createRequire } from "module";
const { app, BrowserWindow, shell } = createRequire(import.meta.url)("electron");
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { randomBytes, createHash } from "crypto";
import express from "express";
import { credentials } from "./credentials.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DIST = app.isPackaged
  ? join(process.resourcesPath, "dist")
  : join(__dirname, "..", "dist");

const PORT = 7823;
const BASE = `http://127.0.0.1:${PORT}`;

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET } = credentials;

const GMAIL_SCOPE        = "https://www.googleapis.com/auth/gmail.readonly email openid";
const GOOGLE_LOGIN_SCOPE = "openid email profile";
const OUTLOOK_SCOPE      = "openid email Mail.Read offline_access";

const httpApp = express();

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

// ── Static + SPA ──────────────────────────────────────────────────────────────

httpApp.use(express.static(DIST));
httpApp.get("/*path", (_req, res) => res.sendFile(join(DIST, "index.html")));

httpApp.listen(PORT, "127.0.0.1", () => {});

// ── Electron window ───────────────────────────────────────────────────────────

let win;

const OAUTH_HOSTS = ["accounts.google.com", "login.microsoftonline.com"];

function isOAuthUrl(url) {
  try { return OAUTH_HOSTS.includes(new URL(url).hostname); } catch { return false; }
}

function deliverOAuthResult(hash) {
  if (!win) return;
  // Set hash via JS → fires hashchange → App.tsx applyOAuthHash() picks it up.
  // Falls back to loadURL (full reload) if the page isn't ready yet.
  win.webContents.executeJavaScript(`window.location.hash = ${JSON.stringify(hash)}`)
    .catch(() => { win?.webContents.loadURL(`${BASE}/${hash}`); });
  app.dock?.bounce("informational");
  app.focus({ steal: true });
  win.show();
  win.focus();
}

const CLOSE_TAB_HTML = `<html><body><script>window.close()</script><p>Done — you can close this tab.</p></body></html>`;

function createWindow() {
  win = new BrowserWindow({
    width: 1200, height: 800, minWidth: 400, minHeight: 600,
    title: "jInvoice",
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  win.loadURL(BASE);

  // Open OAuth pages in the system browser, not the Electron window.
  win.webContents.on("will-navigate", (event, url) => {
    if (isOAuthUrl(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // Also intercept server-side 302 redirects (will-navigate does not fire for these).
  win.webContents.on("will-redirect", (event, url) => {
    console.log("[nav] will-redirect:", url.slice(0, 80));
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
