import { useState, useEffect } from "react";
import { MainLayout } from "./ui/layout/MainLayout";
import { AutoImportSettings } from "./ui/autoimport/AutoImportSettings";
import { ViewScreen } from "./ui/view/ViewScreen";
import { AlertsScreen } from "./ui/sentinel/AlertsScreen";
import { SettingsScreen } from "./ui/settings/SettingsScreen";
import { LoginScreen } from "./ui/auth/LoginScreen";
import { prefs } from "./data/AutoImportPreferences";
import { auth } from "./data/AuthStore";
import { schedulePolling } from "./service/AutoImportService";

// Process OAuth hash params — called at module init AND on hashchange.
// Returns true if the user is now signed in.
function applyOAuthHash(): boolean {
  const h = new URLSearchParams(window.location.hash.slice(1));
  if (!h.toString()) return false;

  const googleEmail    = h.get("google_login_email");
  const gmailToken     = h.get("gmail_access_token");
  const gmailRefresh   = h.get("gmail_refresh_token");
  const gmailEmail     = h.get("gmail_email");
  const outlookToken   = h.get("outlook_access_token");
  const outlookEmail   = h.get("outlook_email");

  if (googleEmail || gmailToken || outlookToken || h.get("error")) {
    window.history.replaceState({}, "", "/");
  }

  if (googleEmail) {
    auth.signInWithGoogle(googleEmail, h.get("google_login_name") ?? "");
    return true;
  }
  if (gmailToken) {
    prefs.gmailAccessToken  = gmailToken;
    if (gmailRefresh) prefs.gmailRefreshToken = gmailRefresh;
    prefs.gmailEmail        = gmailEmail ?? "";
    prefs.gmailEnabled      = true;
    schedulePolling();
  }
  if (outlookToken) {
    prefs.outlookAccessToken = outlookToken;
    prefs.outlookEmail       = outlookEmail ?? "";
    prefs.outlookEnabled     = true;
    schedulePolling();
  }
  return false;
}

// Handle hash present on initial page load (e.g. after a full reload via loadURL).
applyOAuthHash();

export function App() {
  const [loggedIn, setLoggedIn] = useState(import.meta.env.DEV || auth.isLoggedIn);
  const [tab, setTab] = useState("import");

  // Handle hash set by executeJavaScript (same-page navigation — no reload).
  useEffect(() => {
    const onHash = () => {
      if (applyOAuthHash()) setLoggedIn(true);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  if (!loggedIn) {
    return <LoginScreen onLogin={() => setLoggedIn(true)} />;
  }

  return (
    <MainLayout active={tab} onNav={setTab}>
      {tab === "import"   && <AutoImportSettings />}
      {tab === "view"     && <ViewScreen />}
      {tab === "alerts"   && <AlertsScreen />}
      {tab === "settings" && <SettingsScreen onSignOut={() => setLoggedIn(false)} />}
    </MainLayout>
  );
}
