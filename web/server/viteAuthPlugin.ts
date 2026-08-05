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
  // AUTH_BASE_URL overrides dynamic origin detection — required when accessing
  // from mobile/LAN since the host header differs from what's registered in
  // Google Cloud Console / Azure as an allowed redirect URI.
  const AUTH_BASE_URL        = env.AUTH_BASE_URL ?? "";

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
        if (url === "/auth/gmail/start") {
          const params = new URLSearchParams({
            client_id:     GOOGLE_CLIENT_ID,
            redirect_uri:  gmailRedirectUri(origin),
            response_type: "code",
            scope:         GMAIL_SCOPE,
            access_type:   "offline",
            prompt:        "consent",
            state:         "gmail",
          });
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
        if (url === "/auth/outlook/start") {
          const params = new URLSearchParams({
            client_id:     AZURE_CLIENT_ID,
            redirect_uri:  outlookRedirectUri(origin),
            response_type: "code",
            scope:         OUTLOOK_SCOPE,
            response_mode: "query",
            state:         "outlook",
          });
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

        next();
      });
    },
  };
}
