import express from "express";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// mobile.mjs is optional — present locally but not deployed to Render
let mobileRouter;
try { ({ mobileRouter } = await import("./mobile.mjs")); } catch {}

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, "..", "dist");

const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID     ?? "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "";
const AZURE_CLIENT_ID      = process.env.AZURE_CLIENT_ID      ?? "";
const AZURE_CLIENT_SECRET  = process.env.AZURE_CLIENT_SECRET  ?? "";
const PORT                 = Number(process.env.PORT ?? 3000);

const GMAIL_SCOPE        = "https://www.googleapis.com/auth/gmail.readonly email openid";
const GOOGLE_LOGIN_SCOPE = "openid email profile";
const OUTLOOK_SCOPE      = "openid email Mail.Read offline_access";

function appOrigin(req) {
  const proto = req.headers["x-forwarded-proto"] ?? req.protocol ?? "https";
  const host  = req.headers["x-forwarded-host"] ?? req.headers.host;
  return `${proto}://${host}`;
}

const app = express();

app.use(express.json());
if (mobileRouter) app.use(mobileRouter);

// ── Google login ───────────────────────────────────────────────────────────

app.get("/auth/google/login/start", (req, res) => {
  const params = new URLSearchParams({
    client_id:     GOOGLE_CLIENT_ID,
    redirect_uri:  `${appOrigin(req)}/auth/google/login/callback`,
    response_type: "code",
    scope:         GOOGLE_LOGIN_SCOPE,
    access_type:   "online",
    state:         "google_login",
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

app.get("/auth/google/login/callback", async (req, res) => {
  const code = req.query.code;
  if (!code) return res.redirect("/#error=oauth_denied");
  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id:     GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri:  `${appOrigin(req)}/auth/google/login/callback`,
        grant_type:    "authorization_code",
      }),
    });
    const tokens = await tokenRes.json();
    if (!tokens.access_token) throw new Error("no access_token");

    const profileRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = await profileRes.json();
    res.redirect(`/#${new URLSearchParams({ google_login_email: profile.email ?? "", google_login_name: profile.name ?? "" })}`);
  } catch {
    res.redirect("/#error=oauth_failed");
  }
});

// ── Gmail ──────────────────────────────────────────────────────────────────

app.get("/auth/gmail/start", (req, res) => {
  const params = new URLSearchParams({
    client_id:     GOOGLE_CLIENT_ID,
    redirect_uri:  `${appOrigin(req)}/auth/gmail/callback`,
    response_type: "code",
    scope:         GMAIL_SCOPE,
    access_type:   "offline",
    prompt:        "consent",
    state:         "gmail",
  });
  if (req.query.login_hint) params.set("login_hint", req.query.login_hint);
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

app.get("/auth/gmail/callback", async (req, res) => {
  const code = req.query.code;
  if (!code) return res.redirect("/#error=oauth_denied");
  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id:     GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri:  `${appOrigin(req)}/auth/gmail/callback`,
        grant_type:    "authorization_code",
      }),
    });
    const tokens = await tokenRes.json();
    if (!tokens.access_token) throw new Error("no access_token");

    const profileRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = await profileRes.json();
    const hashParams = { gmail_access_token: tokens.access_token, gmail_email: profile.email ?? "" };
    if (tokens.refresh_token) hashParams.gmail_refresh_token = tokens.refresh_token;
    res.redirect(`/#${new URLSearchParams(hashParams)}`);
  } catch {
    res.redirect("/#error=oauth_failed");
  }
});

app.get("/auth/gmail/refresh", async (req, res) => {
  const refreshToken = req.query.refresh_token;
  if (!refreshToken) return res.status(400).end();
  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id:     GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type:    "refresh_token",
      }),
    });
    const tokens = await tokenRes.json();
    if (!tokens.access_token) throw new Error("no access_token");
    res.json({ access_token: tokens.access_token });
  } catch {
    res.status(401).end();
  }
});

// ── Outlook ────────────────────────────────────────────────────────────────

app.get("/auth/outlook/start", (req, res) => {
  const params = new URLSearchParams({
    client_id:     AZURE_CLIENT_ID,
    redirect_uri:  `${appOrigin(req)}/auth/outlook/callback`,
    response_type: "code",
    scope:         OUTLOOK_SCOPE,
    response_mode: "query",
    state:         "outlook",
  });
  if (req.query.login_hint) params.set("login_hint", req.query.login_hint);
  res.redirect(`https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params}`);
});

app.get("/auth/outlook/callback", async (req, res) => {
  const code = req.query.code;
  if (!code) return res.redirect("/#error=oauth_denied");
  try {
    const tokenRes = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id:     AZURE_CLIENT_ID,
        client_secret: AZURE_CLIENT_SECRET,
        redirect_uri:  `${appOrigin(req)}/auth/outlook/callback`,
        grant_type:    "authorization_code",
        scope:         OUTLOOK_SCOPE,
      }),
    });
    const tokens = await tokenRes.json();
    if (!tokens.access_token) throw new Error("no access_token");

    const profileRes = await fetch("https://graph.microsoft.com/v1.0/me", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = await profileRes.json();
    res.redirect(`/#${new URLSearchParams({ outlook_access_token: tokens.access_token, outlook_email: profile.mail ?? profile.userPrincipalName ?? "" })}`);
  } catch {
    res.redirect("/#error=oauth_failed");
  }
});

// ── Local info (used by Settings → Mobile Sync) ───────────────────────────

app.get("/api/local-info", (req, res) => {
  const origin = appOrigin(req);
  const secret = process.env.JINVOICE_SECRET || "jinvoice-change-me";
  const renderUrl  = process.env.RENDER_URL ?? null;
  res.json({
    url:              origin,
    secret,
    mobileUrl:        `${origin}/mobile?key=${encodeURIComponent(secret)}`,
    renderUrl,
    renderMobileUrl:  renderUrl ? `${renderUrl}/mobile?key=${encodeURIComponent(secret)}` : undefined,
    desktopFolder:    { configured: false },
  });
});

// ── Secret update (mirrors Electron's /api/set-secret) ───────────────────
// Updates JINVOICE_SECRET in-memory for the running dyno session.
// Persists until the next Render redeploy; update the JINVOICE_SECRET env var
// in the Render dashboard for permanent changes.

app.post("/api/set-secret", (req, res) => {
  const { secret } = req.body ?? {};
  if (!secret || typeof secret !== "string" || secret.trim().length < 6) {
    return res.status(400).json({ error: "Secret must be at least 6 characters." });
  }
  process.env.JINVOICE_SECRET = secret.trim();
  res.json({ ok: true });
});

// ── Static files + SPA fallback ────────────────────────────────────────────

app.use(express.static(DIST));
app.get("/*path", (_req, res) => res.sendFile(join(DIST, "index.html")));

app.listen(PORT, () => console.log(`jInvoice running on http://localhost:${PORT}`));
