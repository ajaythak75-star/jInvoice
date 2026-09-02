import type { Plugin } from "vite";

const GMAIL_SCOPE        = "https://www.googleapis.com/auth/gmail.readonly email openid";
const GOOGLE_LOGIN_SCOPE = "openid email profile";
const OUTLOOK_SCOPE      = "openid email Mail.Read offline_access";

function gmailRedirectUri(origin: string)       { return `${origin}/auth/gmail/callback`; }
function googleLoginRedirectUri(origin: string) { return `${origin}/auth/google/login/callback`; }
function outlookRedirectUri(origin: string)     { return `${origin}/auth/outlook/callback`; }

export function authPlugin(env: Record<string, string>): Plugin {
  const GOOGLE_CLIENT_ID     = env.GOOGLE_CLIENT_ID ?? "";
  const GOOGLE_CLIENT_SECRET = env.GOOGLE_CLIENT_SECRET ?? "";
  const AZURE_CLIENT_ID      = env.AZURE_CLIENT_ID ?? "";
  const AZURE_CLIENT_SECRET  = env.AZURE_CLIENT_SECRET ?? "";
  const AUTH_BASE_URL        = env.AUTH_BASE_URL ?? "";
  const SUPABASE_URL         = env.VITE_SUPABASE_URL ?? env.SUPABASE_URL ?? "";
  const SUPABASE_ANON_KEY    = env.VITE_SUPABASE_ANON_KEY ?? env.SUPABASE_ANON_KEY ?? "";
  const SUPABASE_SERVICE_KEY = env.SUPABASE_SERVICE_KEY ?? "";
  const RESEND_API_KEY       = env.RESEND_API_KEY ?? "";
  const RESEND_FROM_EMAIL    = env.RESEND_FROM_EMAIL ?? "onboarding@resend.dev";

  const _otpStore = new Map<string, { code: string; expiresAt: number }>();

  async function sendEmail(to: string, subject: string, html: string) {
    if (!RESEND_API_KEY) throw new Error("Email service not configured (RESEND_API_KEY missing).");
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: `jInvoice <${RESEND_FROM_EMAIL}>`, to: [to], subject, html }),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({})) as Record<string, string>;
      throw new Error(d.message ?? `Resend error ${r.status}`);
    }
  }

  return {
    name: "jinvoice-auth",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url    = req.url ?? "";
        const proto  = (req.headers["x-forwarded-proto"] as string) ?? ((req.socket as any)?.encrypted ? "https" : "http");
        const origin = AUTH_BASE_URL || `${proto}://${req.headers.host}`;

        // ── Google login start ─────────────────────────────────────────────
        if (url === "/auth/google/login/start") {
          const params = new URLSearchParams({
            client_id:     GOOGLE_CLIENT_ID,
            redirect_uri:  googleLoginRedirectUri(origin),
            response_type: "code",
            scope:         GOOGLE_LOGIN_SCOPE,
            access_type:   "online",
            state:         "google_login",
          });
          res.writeHead(302, {
            Location: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
          });
          res.end();
          return;
        }

        // ── Google login callback ──────────────────────────────────────────
        if (url.startsWith("/auth/google/login/callback")) {
          const qs   = new URLSearchParams(url.split("?")[1] ?? "");
          const code = qs.get("code");
          if (!code) {
            res.writeHead(302, { Location: "/#error=oauth_denied" });
            res.end();
            return;
          }
          try {
            const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
              method:  "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({
                code,
                client_id:     GOOGLE_CLIENT_ID,
                client_secret: GOOGLE_CLIENT_SECRET,
                redirect_uri:  googleLoginRedirectUri(origin),
                grant_type:    "authorization_code",
              }),
            });
            const tokens = await tokenRes.json() as Record<string, string>;
            if (!tokens.access_token) throw new Error("no access_token");

            const profileRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
              headers: { Authorization: `Bearer ${tokens.access_token}` },
            });
            const profile = await profileRes.json() as Record<string, string>;

            const hash = new URLSearchParams({
              google_login_email: profile.email ?? "",
              google_login_name:  profile.name  ?? "",
            });
            res.writeHead(302, { Location: `/#${hash}` });
          } catch {
            res.writeHead(302, { Location: "/#error=oauth_failed" });
          }
          res.end();
          return;
        }

        // ── Gmail refresh ──────────────────────────────────────────────────
        if (url.startsWith("/auth/gmail/refresh")) {
          const qs           = new URLSearchParams(url.split("?")[1] ?? "");
          const refreshToken = qs.get("refresh_token");
          if (!refreshToken) { res.writeHead(400); res.end(); return; }
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
            const tokens = await tokenRes.json() as Record<string, string>;
            if (!tokens.access_token) throw new Error("no access_token");
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ access_token: tokens.access_token }));
          } catch {
            res.writeHead(401);
            res.end();
          }
          return;
        }

        // ── Gmail start ────────────────────────────────────────────────────
        if (url.startsWith("/auth/gmail/start")) {
          const qs = new URLSearchParams(url.split("?")[1] ?? "");
          const params = new URLSearchParams({
            client_id:     GOOGLE_CLIENT_ID,
            redirect_uri:  gmailRedirectUri(origin),
            response_type: "code",
            scope:         GMAIL_SCOPE,
            access_type:   "offline",
            prompt:        "consent",
            state:         "gmail",
          });
          const hint = qs.get("login_hint");
          if (hint) params.set("login_hint", hint);
          res.writeHead(302, {
            Location: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
          });
          res.end();
          return;
        }

        // ── Gmail callback ─────────────────────────────────────────────────
        if (url.startsWith("/auth/gmail/callback")) {
          const qs   = new URLSearchParams(url.split("?")[1] ?? "");
          const code = qs.get("code");
          if (!code) {
            res.writeHead(302, { Location: "/#error=oauth_denied" });
            res.end();
            return;
          }
          try {
            const redirectUri = gmailRedirectUri(origin);
            const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
              method:  "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({
                code,
                client_id:     GOOGLE_CLIENT_ID,
                client_secret: GOOGLE_CLIENT_SECRET,
                redirect_uri:  redirectUri,
                grant_type:    "authorization_code",
              }),
            });
            const tokens = await tokenRes.json() as Record<string, string>;
            if (!tokens.access_token) throw new Error("no access_token");

            const profileRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
              headers: { Authorization: `Bearer ${tokens.access_token}` },
            });
            const profile = await profileRes.json() as Record<string, string>;

            const hashParams: Record<string, string> = {
              gmail_access_token: tokens.access_token,
              gmail_email:        profile.email ?? "",
            };
            if (tokens.refresh_token) hashParams.gmail_refresh_token = tokens.refresh_token;
            res.writeHead(302, { Location: `/#${new URLSearchParams(hashParams)}` });
          } catch {
            res.writeHead(302, { Location: "/#error=oauth_failed" });
          }
          res.end();
          return;
        }

        // ── Outlook start ──────────────────────────────────────────────────
        if (url.startsWith("/auth/outlook/start")) {
          const qs = new URLSearchParams(url.split("?")[1] ?? "");
          const params = new URLSearchParams({
            client_id:     AZURE_CLIENT_ID,
            redirect_uri:  outlookRedirectUri(origin),
            response_type: "code",
            scope:         OUTLOOK_SCOPE,
            response_mode: "query",
            state:         "outlook",
          });
          const hint = qs.get("login_hint");
          if (hint) params.set("login_hint", hint);
          res.writeHead(302, {
            Location: `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params}`,
          });
          res.end();
          return;
        }

        // ── Outlook callback ───────────────────────────────────────────────
        if (url.startsWith("/auth/outlook/callback")) {
          const qs   = new URLSearchParams(url.split("?")[1] ?? "");
          const code = qs.get("code");
          if (!code) {
            res.writeHead(302, { Location: "/#error=oauth_denied" });
            res.end();
            return;
          }
          try {
            const tokenRes = await fetch(
              "https://login.microsoftonline.com/common/oauth2/v2.0/token",
              {
                method:  "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                  code,
                  client_id:     AZURE_CLIENT_ID,
                  client_secret: AZURE_CLIENT_SECRET,
                  redirect_uri:  outlookRedirectUri(origin),
                  grant_type:    "authorization_code",
                  scope:         OUTLOOK_SCOPE,
                }),
              }
            );
            const tokens = await tokenRes.json() as Record<string, string>;
            if (!tokens.access_token) throw new Error("no access_token");

            const profileRes = await fetch("https://graph.microsoft.com/v1.0/me", {
              headers: { Authorization: `Bearer ${tokens.access_token}` },
            });
            const profile = await profileRes.json() as Record<string, string>;

            const hash = new URLSearchParams({
              outlook_access_token: tokens.access_token,
              outlook_email:        profile.mail ?? profile.userPrincipalName ?? "",
            });
            res.writeHead(302, { Location: `/#${hash}` });
          } catch {
            res.writeHead(302, { Location: "/#error=oauth_failed" });
          }
          res.end();
          return;
        }

        // ── /api/app-config ──────────────────────────────────────────────
        if (url === "/api/app-config") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ supabaseUrl: SUPABASE_URL, supabaseAnonKey: SUPABASE_ANON_KEY }));
          return;
        }

        // ── /api/auth/send-otp ───────────────────────────────────────────
        if (url === "/api/auth/send-otp" && req.method === "POST") {
          let body = "";
          req.on("data", (c: Buffer) => { body += c; });
          req.on("end", async () => {
            try {
              const { email } = JSON.parse(body) as { email?: string };
              if (!email || !email.includes("@")) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Valid email required" }));
                return;
              }
              const code = String(Math.floor(100000 + Math.random() * 900000));
              _otpStore.set(email.toLowerCase(), { code, expiresAt: Date.now() + 600_000 });
              await sendEmail(
                email,
                "Your jInvoice login code",
                `<div style="font-family:sans-serif;max-width:420px;margin:40px auto;padding:32px;border:1px solid #e5e7eb;border-radius:12px">
                  <h2 style="margin:0 0 8px;color:#111">jInvoice</h2>
                  <p style="margin:0 0 24px;color:#555">Your one-time login code:</p>
                  <p style="font-size:36px;font-weight:700;letter-spacing:10px;color:#4f46e5;margin:0 0 24px">${code}</p>
                  <p style="margin:0;color:#888;font-size:13px">Expires in 10 minutes. Do not share this code.</p>
                </div>`
              );
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ ok: true }));
            } catch (e) {
              res.writeHead(500, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: String(e) }));
            }
          });
          return;
        }

        // ── /api/auth/verify-otp ─────────────────────────────────────────
        if (url === "/api/auth/verify-otp" && req.method === "POST") {
          let body = "";
          req.on("data", (c: Buffer) => { body += c; });
          req.on("end", async () => {
            try {
              const { email, code } = JSON.parse(body) as { email?: string; code?: string };
              if (!email || !code) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "email and code required" }));
                return;
              }
              const stored = _otpStore.get(email.toLowerCase());
              if (!stored || stored.code !== String(code) || Date.now() > stored.expiresAt) {
                res.writeHead(401, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Invalid or expired code" }));
                return;
              }
              _otpStore.delete(email.toLowerCase());
              // TODO: magic link — re-enable when Resend domain is verified
              // if (!SUPABASE_SERVICE_KEY || !SUPABASE_URL) { ... }
              // await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, { ... });
              // const linkRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, { ... });
              // res.end(JSON.stringify({ token_hash: linkData.hashed_token }));
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ ok: true }));
            } catch (e) {
              res.writeHead(500, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: String(e) }));
            }
          });
          return;
        }

        next();
      });
    },
  };
}
