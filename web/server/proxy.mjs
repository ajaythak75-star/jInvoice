/**
 * jInvoice OAuth proxy — deploy this to Render (free tier).
 * Holds Google + Azure secrets server-side. After each OAuth dance,
 * redirects the user back to the local binary at http://localhost:7823.
 * No static files served here — the binary serves its own dist/.
 */
import express from "express";

const PORT = process.env.PORT ?? 3000;
const LOCAL_APP = "http://localhost:7823";

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET } = process.env;

const GMAIL_SCOPE        = "https://www.googleapis.com/auth/gmail.readonly email openid";
const GOOGLE_LOGIN_SCOPE = "openid email profile";
const OUTLOOK_SCOPE      = "openid email Mail.Read offline_access";

const app = express();

// CORS for the token refresh endpoint — the binary app calls this cross-origin
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", LOCAL_APP);
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

function base(req) {
  const proto = req.headers["x-forwarded-proto"] ?? req.protocol;
  const host  = req.headers["x-forwarded-host"]  ?? req.headers.host;
  return `${proto}://${host}`;
}

// ── Google login ──────────────────────────────────────────────────────────────

app.get("/auth/google/login/start", (req, res) => {
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
    client_id:     GOOGLE_CLIENT_ID,
    redirect_uri:  `${base(req)}/auth/google/login/callback`,
    response_type: "code",
    scope:         GOOGLE_LOGIN_SCOPE,
    access_type:   "online",
    state:         "google_login",
  })}`);
});

app.get("/auth/google/login/callback", async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect(`${LOCAL_APP}/#error=oauth_denied`);
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
    res.redirect(`${LOCAL_APP}/#${new URLSearchParams({ google_login_email: p.email ?? "", google_login_name: p.name ?? "" })}`);
  } catch { res.redirect(`${LOCAL_APP}/#error=oauth_failed`); }
});

// ── Gmail ─────────────────────────────────────────────────────────────────────

app.get("/auth/gmail/start", (req, res) => {
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
    client_id:     GOOGLE_CLIENT_ID,
    redirect_uri:  `${base(req)}/auth/gmail/callback`,
    response_type: "code",
    scope:         GMAIL_SCOPE,
    access_type:   "offline",
    prompt:        "consent",
    state:         "gmail",
  })}`);
});

app.get("/auth/gmail/callback", async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect(`${LOCAL_APP}/#error=oauth_denied`);
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
    res.redirect(`${LOCAL_APP}/#${new URLSearchParams(hp)}`);
  } catch { res.redirect(`${LOCAL_APP}/#error=oauth_failed`); }
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
  res.redirect(`https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${new URLSearchParams({
    client_id:     AZURE_CLIENT_ID,
    redirect_uri:  `${base(req)}/auth/outlook/callback`,
    response_type: "code",
    scope:         OUTLOOK_SCOPE,
    response_mode: "query",
    state:         "outlook",
  })}`);
});

app.get("/auth/outlook/callback", async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect(`${LOCAL_APP}/#error=oauth_denied`);
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
    res.redirect(`${LOCAL_APP}/#${new URLSearchParams({ outlook_access_token: t.access_token, outlook_email: prof.mail ?? prof.userPrincipalName ?? "" })}`);
  } catch { res.redirect(`${LOCAL_APP}/#error=oauth_failed`); }
});

// ── Health check ──────────────────────────────────────────────────────────────

app.get("/health", (_req, res) => res.send("ok"));

app.listen(PORT, () => console.log(`jInvoice OAuth proxy running on port ${PORT}`));
