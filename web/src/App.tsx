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
import { LoginScreen } from "./ui/auth/LoginScreen";
import { AdminScreen } from "./ui/admin/AdminScreen";
import { auth } from "./data/AuthStore";
import { prefs, getCachedTrialDays } from "./data/AutoImportPreferences";
import { schedulePolling } from "./service/AutoImportService";
import { checkAndNotify } from "./service/NotificationService";
import { startMobileSync } from "./service/MobileSyncService";
import { syncPlanFromServer } from "./service/UserPlanService";
import { refreshAllConfig } from "./service/ConfigService";
import { getActiveSentinels } from "./service/ExpirySentinel";
import { getActiveSecurityAlerts } from "./data/InvoiceDatabase";

function TrialExpiredBanner({ onSubscribe, onContinueFree }: { onSubscribe: () => void; onContinueFree: () => void }) {
  return (
    <div style={{
      background: "#fff7ed", borderBottom: "1px solid #fdba74",
      padding: "12px 20px", display: "flex", alignItems: "center",
      justifyContent: "space-between", gap: 12, flexWrap: "wrap",
      fontSize: 13, flexShrink: 0,
    }}>
      <span style={{ color: "#92400e", fontWeight: 600 }}>
        ⚠ Your {getCachedTrialDays()}-day Pro trial has ended. Subscribe to keep Pro features, or continue on the free plan.
      </span>
      <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
        <button
          onClick={onContinueFree}
          style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid #fdba74", background: "transparent", color: "#92400e", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
        >
          Continue with Free
        </button>
        <button
          onClick={onSubscribe}
          style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: "#7c3aed", color: "#fff", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}
        >
          Subscribe to Pro →
        </button>
      </div>
    </div>
  );
}

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
  const [loggedIn, setLoggedIn] = useState(auth.isLoggedIn);
  const [tab, setTab] = useState("import");
  const [adminRole, setAdminRole] = useState<"super_admin" | "admin" | null>(null);
  const isAdmin = adminRole !== null;
  const [alertCount, setAlertCount] = useState(0);
  const [showTrialBanner, setShowTrialBanner] = useState(false);

  // Handle hash set by executeJavaScript (same-page navigation — no reload).
  useEffect(() => {
    const onHash = () => {
      if (applyOAuthHash()) setLoggedIn(true);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Refresh admin-configurable settings (pricing, upload limits, profiles) on login
  useEffect(() => {
    if (!loggedIn) return;
    refreshAllConfig().catch(() => {});
  }, [loggedIn]);

  // Fetch the caller's admin role from the server so dynamic admins are recognized
  useEffect(() => {
    if (!loggedIn) { setAdminRole(null); return; }
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (auth.token) h["Authorization"] = `Bearer ${auth.token}`;
    fetch("/api/admin/role", { headers: h })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => setAdminRole(d?.role === "super_admin" ? "super_admin" : d?.role === "admin" ? "admin" : null))
      .catch(() => setAdminRole(null));
  }, [loggedIn]);

  // Sync subscription plan from Supabase on every login/startup
  useEffect(() => {
    if (!loggedIn) return;
    syncPlanFromServer().then((plan) => {
      if (!plan) return;
      const trialActive = plan.plan === "pro_trial" && !!plan.trial_ends_at
        && new Date(plan.trial_ends_at) > new Date() && plan.status === "active";
      const isPaid = plan.plan === "pro_paid" && plan.status === "active";
      const expired = plan.trial_used && !trialActive && !isPaid;
      setShowTrialBanner(expired && !localStorage.getItem("jinvoice:trial_ack"));
    }).catch(() => {});
  }, [loggedIn]);

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
    window.addEventListener("jinvoice:alerts-changed", refreshAlertCount);
    return () => {
      window.removeEventListener("jinvoice:sync-complete", onSync);
      window.removeEventListener("jinvoice:alerts-changed", refreshAlertCount);
    };
  }, [loggedIn]);

  if (!loggedIn) {
    return <LoginScreen onLogin={() => setLoggedIn(true)} />;
  }

  return (
    <MainLayout active={tab} onNav={setTab} alertCount={alertCount} isAdmin={isAdmin}>
      {showTrialBanner && (
        <TrialExpiredBanner
          onSubscribe={() => { setTab("pricing"); }}
          onContinueFree={() => {
            try { localStorage.setItem("jinvoice:trial_ack", "1"); } catch {}
            setShowTrialBanner(false);
          }}
        />
      )}
      {/* Keep AutoImportSettings mounted so in-progress uploads survive tab switches */}
      <div style={{ display: tab === "import" ? "contents" : "none" }}><AutoImportSettings /></div>
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
      {tab === "admin"    && isAdmin && <AdminScreen />}
    </MainLayout>
  );
}
