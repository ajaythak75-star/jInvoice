import { useState } from "react";
import { MainLayout } from "./ui/layout/MainLayout";
import { AutoImportSettings } from "./ui/autoimport/AutoImportSettings";
import { ViewScreen } from "./ui/view/ViewScreen";
import { AlertsScreen } from "./ui/sentinel/AlertsScreen";
import { SettingsScreen } from "./ui/settings/SettingsScreen";
import { LoginScreen } from "./ui/auth/LoginScreen";
import { prefs } from "./data/AutoImportPreferences";
import { auth } from "./data/AuthStore";
import { schedulePolling } from "./service/AutoImportService";

// Server redirects back with tokens/identity in the hash fragment (#) after OAuth.
// Hash is never sent to any server, so everything stays in the browser only.
const _h                = new URLSearchParams(window.location.hash.slice(1));
const _gmailToken        = _h.get("gmail_access_token");
const _gmailRefreshToken = _h.get("gmail_refresh_token");
const _gmailEmail        = _h.get("gmail_email");
const _outlookToken     = _h.get("outlook_access_token");
const _outlookEmail     = _h.get("outlook_email");
const _googleLoginEmail = _h.get("google_login_email");
const _googleLoginName  = _h.get("google_login_name");

const _oauthError = _h.get("error");

if (_gmailToken || _outlookToken || _googleLoginEmail || _oauthError) {
  window.history.replaceState({}, "", "/");
}

if (_googleLoginEmail) {
  auth.signInWithGoogle(_googleLoginEmail, _googleLoginName ?? "");
}
if (_gmailToken) {
  prefs.gmailAccessToken  = _gmailToken;
  if (_gmailRefreshToken) prefs.gmailRefreshToken = _gmailRefreshToken;
  prefs.gmailEmail        = _gmailEmail ?? "";
  prefs.gmailEnabled      = true;
  schedulePolling();
}
if (_outlookToken) {
  prefs.outlookAccessToken = _outlookToken;
  prefs.outlookEmail       = _outlookEmail ?? "";
  prefs.outlookEnabled     = true;
  schedulePolling();
}

export function App() {
  const [loggedIn, setLoggedIn] = useState(import.meta.env.DEV || auth.isLoggedIn);
  const [tab, setTab] = useState("import");

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
