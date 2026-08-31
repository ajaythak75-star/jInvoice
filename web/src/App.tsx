import { useState, useEffect } from "react";
import { MainLayout } from "./ui/layout/MainLayout";
import { AutoImportSettings } from "./ui/autoimport/AutoImportSettings";
import { ViewScreen } from "./ui/view/ViewScreen";
import { AlertsScreen } from "./ui/sentinel/AlertsScreen";
import { ReportScreen } from "./ui/gst/ReportScreen";
import { BuyScreen } from "./ui/buy/BuyScreen";
import { RewardsScreen } from "./ui/rewards/RewardsScreen";
import { SettingsScreen } from "./ui/settings/SettingsScreen";
import { SecurityScreen } from "./ui/security/SecurityScreen";
import { PricingScreen } from "./ui/pricing/PricingScreen";
import { FAQScreen } from "./ui/help/FAQScreen";
import { AboutScreen } from "./ui/help/AboutScreen";
// import { LoginScreen } from "./ui/auth/LoginScreen"; // auth disabled
// import { auth } from "./data/AuthStore"; // auth disabled
import { prefs } from "./data/AutoImportPreferences";
import { schedulePolling } from "./service/AutoImportService";
import { checkAndNotify } from "./service/NotificationService";
import { startMobileSync } from "./service/MobileSyncService";
import { getActiveSentinels } from "./service/ExpirySentinel";
import { getActiveSecurityAlerts } from "./data/InvoiceDatabase";

// Process OAuth hash params — called at module init AND on hashchange.
// Returns true if the user is now signed in.
function applyOAuthHash(): boolean {
  const h = new URLSearchParams(window.location.hash.slice(1));
  if (!h.toString()) return false;

  const gmailToken     = h.get("gmail_access_token");
  const gmailRefresh   = h.get("gmail_refresh_token");
  const gmailEmail     = h.get("gmail_email");
  const outlookToken   = h.get("outlook_access_token");
  const outlookEmail   = h.get("outlook_email");

  if (gmailToken || outlookToken || h.get("error")) {
    window.history.replaceState({}, "", "/");
  }

  if (gmailToken) {
    // Upsert into gmailAccounts array (primary slot stays in prefs for backward compat)
    prefs.gmailAccessToken  = gmailToken;
    if (gmailRefresh) prefs.gmailRefreshToken = gmailRefresh;
    prefs.gmailEmail        = gmailEmail ?? "";
    prefs.gmailEnabled      = true;
    const gAccounts = prefs.gmailAccounts;
    const gIdx = gAccounts.findIndex((a) => a.email === (gmailEmail ?? ""));
    const gEntry = { email: gmailEmail ?? "", accessToken: gmailToken, refreshToken: gmailRefresh ?? null, enabled: true };
    if (gIdx >= 0) gAccounts[gIdx] = gEntry; else gAccounts.push(gEntry);
    prefs.gmailAccounts = gAccounts;
    schedulePolling();
  }
  if (outlookToken) {
    // Upsert into outlookAccounts array
    prefs.outlookAccessToken = outlookToken;
    prefs.outlookEmail       = outlookEmail ?? "";
    prefs.outlookEnabled     = true;
    const oAccounts = prefs.outlookAccounts;
    const oIdx = oAccounts.findIndex((a) => a.email === (outlookEmail ?? ""));
    const oEntry = { email: outlookEmail ?? "", accessToken: outlookToken, enabled: true };
    if (oIdx >= 0) oAccounts[oIdx] = oEntry; else oAccounts.push(oEntry);
    prefs.outlookAccounts = oAccounts;
    schedulePolling();
  }
  return false;
}

// Handle hash present on initial page load (e.g. after a full reload via loadURL).
applyOAuthHash();


export function App() {
  // const [loggedIn, setLoggedIn] = useState(true); // auth disabled
  const [tab, setTab] = useState("import");
  const [alertCount, setAlertCount] = useState(0);

  // Handle hash set by executeJavaScript (same-page navigation — no reload).
  useEffect(() => {
    const onHash = () => {
      if (applyOAuthHash()) setLoggedIn(true);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Push the stored jInvoice secret to the server on every startup so the
  // server's in-memory JINVOICE_SECRET stays in sync with localStorage even
  // after a Render dyno spin-up or Electron restart.
  useEffect(() => {
    if (!loggedIn) return;
    const secret = prefs.jInvoiceSecret;
    if (secret) {
      fetch("/api/set-secret", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret }),
      }).catch(() => {});
    }
  }, [loggedIn]);

  // Start the schedule-aware poller on mount; check expiry alerts now and after every sync
  useEffect(() => {
    if (!loggedIn) return;
    schedulePolling();
    checkAndNotify();
    startMobileSync();

    const refreshAlertCount = async () => {
      try {
        const [sentinels, security] = await Promise.all([getActiveSentinels(), getActiveSecurityAlerts()]);
        setAlertCount(sentinels.length + security.length);
      } catch {}
    };
    refreshAlertCount();

    const onSync = () => { checkAndNotify(); refreshAlertCount(); };
    window.addEventListener("jinvoice:sync-complete", onSync);
    return () => window.removeEventListener("jinvoice:sync-complete", onSync);
  }, [loggedIn]);

  // if (!loggedIn) {
  //   return <LoginScreen onLogin={() => setLoggedIn(true)} />;
  // }

  return (
    <MainLayout active={tab} onNav={setTab} alertCount={alertCount}>
      {tab === "import"   && <AutoImportSettings />}
      {tab === "view"     && <ViewScreen />}
      {tab === "buy"      && <BuyScreen />}
      {tab === "gst"      && <ReportScreen />}
      {tab === "alerts"   && <AlertsScreen />}
      {tab === "rewards"  && <RewardsScreen />}
      {tab === "security" && <SecurityScreen />}
      {tab === "pricing"  && <PricingScreen />}
      {tab === "settings" && <SettingsScreen onSignOut={() => setLoggedIn(false)} />}
      {tab === "faq"      && <FAQScreen />}
      {tab === "about"    && <AboutScreen />}
    </MainLayout>
  );
}
