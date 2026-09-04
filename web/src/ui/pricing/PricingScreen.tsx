import { useState, useEffect } from "react";
import { prefs } from "../../data/AutoImportPreferences";
import { auth } from "../../data/AuthStore";
import { saveCustomerPlan, saveCustomerBusinessProfile } from "../../service/SupabaseSync";
import {
  subscriptionService,
  type Subscription,
  isInTrial,
  isProActive as serverIsProActive,
  trialDaysLeft as serverTrialDaysLeft,
} from "../../service/SubscriptionService";
import { startTrial as startTrialServer, requestProAccess } from "../../service/UserPlanService";
import { BusinessProfileModal } from "../shared/BusinessProfileModal";
import { DummyPaymentModal } from "../payment/DummyPaymentModal";

const DUMMY_PAYMENT = import.meta.env.VITE_DUMMY_PAYMENT === "true";

const inpStyle: React.CSSProperties = {
  width: "100%", padding: "8px 10px", borderRadius: 6,
  border: "1px solid var(--color-border)", background: "var(--color-bg)",
  color: "var(--color-text)", fontSize: 13, boxSizing: "border-box", outline: "none",
};
const lblStyle: React.CSSProperties = {
  display: "block", fontSize: 11.5, fontWeight: 700, color: "var(--color-text-secondary)",
  marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.04em",
};
const errStyle: React.CSSProperties = { fontSize: 11.5, color: "#ef4444", marginTop: 3 };

function GeminiApiKeyModal({ onConfirm, onClose }: { onConfirm: (key: string) => void; onClose: () => void }) {
  const [apiKey, setApiKey] = useState(() => prefs.geminiApiKey ?? "");
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);

  const handleSubmit = () => {
    const trimmed = apiKey.trim();
    if (!trimmed) { setError("API key is required for the Own API Key plan."); return; }
    prefs.geminiApiKey = trimmed;
    onConfirm(trimmed);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.52)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ background: "var(--color-surface)", borderRadius: 14, padding: "28px 24px", maxWidth: 440, width: "100%", border: "1px solid var(--color-border)", boxShadow: "0 8px 40px rgba(0,0,0,0.3)" }}>
        <h2 style={{ fontSize: 18, fontWeight: 800, color: "var(--color-text)", margin: "0 0 6px" }}>Add Your Gemini API Key</h2>
        <p style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 20, lineHeight: 1.55 }}>
          The Own API Key plan uses your personal Gemini key — your own quota, lower price.
          Get a free key at{" "}
          <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" style={{ color: "#7c3aed" }}>
            aistudio.google.com
          </a>.
        </p>

        <label style={lblStyle}>Gemini API Key <span style={{ color: "#ef4444" }}>*</span></label>
        <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
          <input
            type={visible ? "text" : "password"}
            value={apiKey}
            onChange={(e) => { setApiKey(e.target.value); setError(null); }}
            placeholder="Paste your Gemini API key"
            autoComplete="off"
            style={{ ...inpStyle, flex: 1, fontFamily: "monospace", fontSize: 12 }}
            autoFocus
          />
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid var(--color-border)", background: "var(--color-surface-2)", color: "var(--color-text-secondary)", fontSize: 12, cursor: "pointer", flexShrink: 0 }}
          >
            {visible ? "Hide" : "Show"}
          </button>
        </div>
        {error && <div style={errStyle}>{error}</div>}

        <p style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 8, lineHeight: 1.5 }}>
          Your key is stored only in your browser (localStorage). It never leaves your device.
        </p>

        <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
          <button onClick={onClose} style={{ flex: 1, padding: "10px", borderRadius: 8, border: "1px solid var(--color-border)", background: "var(--color-surface-2)", color: "var(--color-text-secondary)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            Cancel
          </button>
          <button onClick={handleSubmit} style={{ flex: 2, padding: "10px", borderRadius: 8, border: "none", background: "#7c3aed", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
            Save &amp; Start Trial →
          </button>
        </div>
      </div>
    </div>
  );
}

type Billing = "monthly" | "yearly";
type ApiOption = "shared" | "own";

const PLANS: Record<ApiOption, { monthlyPrice: number; yearlyPrice: number; yearlyMonthly: number; savings: number }> = {
  shared: { monthlyPrice: 999,  yearlyPrice: 9999, yearlyMonthly: 833, savings: 1989 },
  own:    { monthlyPrice: 499,  yearlyPrice: 4999, yearlyMonthly: 417, savings: 989  },
};

const FREE_FEATURES = [
  "5 manual uploads per day",
  "1 month of data history",
  "1 email account",
  "Mobile invoice capture",
  "Cloud sync",
  "Basic GST report",
  "Rewards points program",
  "7-day support response",
];

const SHARED_FEATURES = [
  "50 invoices/day",
  "3 months data history",
  "Up to 5 email accounts",
  "₹249/user for extra accounts; limit = 50 × users/day",
  "Advanced reports",
  "AI via shared OpenAI quota",
  "48-hour support response",
];

const OWN_API_FEATURES = [
  "Everything in Shared plan",
  "Your own OpenAI and/or Gemini API key",
  "No shared quota",
  "Lower monthly cost",
];

function CheckIcon({ color = "currentColor" }: { color?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}

export function PricingScreen() {
  const [billing, setBilling]         = useState<Billing>("monthly");
  const [apiOption, setApiOption]     = useState<ApiOption>(() => prefs.planApiOption);
  const [licences, setLicences]       = useState(1);
  const [sub, setSub]                 = useState<Subscription | null>(null);
  const [loading, setLoading]         = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showApiKeyModal,  setShowApiKeyModal]  = useState(false);
  const [postPayment,      setPostPayment]      = useState(false);
  const [approvalRequired, setApprovalRequired] = useState(false);
  const [requestSent,      setRequestSent]      = useState(false);
  const [requestingAccess, setRequestingAccess] = useState(false);
  const [trialError,       setTrialError]       = useState<string | null>(null);
  const [showDummyPayment, setShowDummyPayment] = useState(false);

  useEffect(() => {
    subscriptionService.get().then((s) => {
      setSub(s);
      setLoading(false);
      // If the user is already Pro but hasn't filled the business profile form, show it now
      if (s && serverIsProActive(s) && !prefs.businessProfileCompleted) {
        setShowProfileModal(true);
      }
    });
    // Handle Stripe success redirect
    const params = new URLSearchParams(window.location.search);
    if (params.get("payment") === "success") {
      window.history.replaceState({}, "", "/pricing");
      setPostPayment(true);
      setTimeout(() => subscriptionService.get().then((s) => {
        setSub(s);
        // Show profile form on first-time Pro upgrade if not yet completed
        if (s && serverIsProActive(s) && !prefs.businessProfileCompleted) {
          setShowProfileModal(true);
        }
      }), 2000);
    }
  }, []);

  // Derive state from server sub (fallback to local prefs while loading)
  const isSubscribed = sub ? sub.plan === "pro_paid" && sub.status === "active" : prefs.isSubscribed;
  const inTrial      = sub ? isInTrial(sub) : prefs.isInTrial;
  const trialStarted = sub ? !!sub.trial_started_at : !!prefs.trialStartedAt;
  const trialUsed    = sub ? sub.trial_used : trialStarted;
  const daysLeft     = sub ? serverTrialDaysLeft(sub) : prefs.trialDaysLeft;
  const proActive    = sub ? serverIsProActive(sub) : prefs.isProActive;
  const canCancel    = sub?.plan === "pro_paid" && sub.status === "active" && sub.paid_until
    ? new Date(sub.paid_until) < new Date() : false;
  const canRefund    = sub?.status === "cancelled" && !sub.refund_requested_at;

  const selectApiOption = (opt: ApiOption) => {
    setApiOption(opt);
    prefs.planApiOption = opt;
    if (proActive && auth.email) {
      saveCustomerPlan(auth.email, {
        plan: opt === "shared" ? "pro_shared" : "pro_own",
        plan_status: isSubscribed ? "active" : "trial",
        billing_cycle: billing,
      });
    }
  };

  const handleStartTrial = async () => {
    setTrialError(null);
    try {
      const updated = await startTrialServer();
      setSub(updated as unknown as Subscription);
      prefs.startTrial();
      if (auth.email) {
        saveCustomerPlan(auth.email, {
          plan: apiOption === "shared" ? "pro_shared" : "pro_own",
          plan_status: "trial",
          billing_cycle: billing,
          trial_started_at: updated.trial_started_at ?? new Date().toISOString(),
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "approval_required") {
        setApprovalRequired(true);
      } else {
        setTrialError(msg || "Failed to start trial.");
      }
    }
  };

  const handleRequestAccess = async () => {
    setRequestingAccess(true);
    try {
      await requestProAccess();
      setRequestSent(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setTrialError(msg || "Failed to send request. Please try again.");
    } finally {
      setRequestingAccess(false);
    }
  };

  const handleSubscribe = async () => {
    if (DUMMY_PAYMENT) {
      setShowDummyPayment(true);
      return;
    }
    setCheckoutLoading(true);
    setCheckoutError(null);
    const url = await subscriptionService.createCheckout(apiOption, billing);
    setCheckoutLoading(false);
    if (url) {
      window.location.href = url;
    } else {
      setCheckoutError("Could not open checkout. Payments may not be configured yet — please contact support or try again later.");
    }
  };

  const handleCancel = async () => {
    if (!window.confirm("Cancel your Pro subscription? You will stay on Free after your paid period.")) return;
    const updated = await subscriptionService.cancel();
    if (updated) setSub(updated);
  };

  const handleRefund = async () => {
    if (!window.confirm("Request a refund? Our team will process it within 5-7 business days.")) return;
    const updated = await subscriptionService.requestRefund();
    if (updated) setSub(updated);
  };

  const plan            = PLANS[apiOption];
  const billingLabel    = billing === "monthly" ? "/month" : "/year";
  const extraUserFee    = (licences - 1) * 249; // ₹249/user/month for extra users
  const displayTotal    = billing === "monthly"
    ? plan.monthlyPrice + extraUserFee
    : plan.yearlyPrice + extraUserFee * 12;

  return (
    <div style={{ padding: "32px 28px", maxWidth: 820, margin: "0 auto" }}>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, color: "var(--color-text)", margin: 0 }}>
          Plans &amp; Pricing
        </h1>
        <p style={{ fontSize: 14, color: "var(--color-text-secondary)", marginTop: 6 }}>
          Free forever for personal use. Upgrade to Pro for unlimited invoices, longer history, and your own API key.
        </p>
      </div>

      {/* Status banners */}
      {loading && (
        <div style={{ marginBottom: 20, padding: "12px 16px", borderRadius: 10, background: "var(--color-surface-2)", border: "1px solid var(--color-border)", color: "var(--color-text-secondary)", fontSize: 13 }}>
          Loading subscription status…
        </div>
      )}
      {!loading && isSubscribed && (
        <div style={{ marginBottom: 20, padding: "12px 16px", borderRadius: 10, background: "#f0fdf4", border: "1px solid #86efac", color: "#166534", fontSize: 13, fontWeight: 600 }}>
          ✓ You are on the Pro plan.
          {canCancel && (
            <button onClick={handleCancel} style={{ marginLeft: 16, fontSize: 12, color: "#ef4444", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>
              Cancel subscription
            </button>
          )}
        </div>
      )}
      {!loading && sub?.status === "cancelled" && (
        <div style={{ marginBottom: 20, padding: "12px 16px", borderRadius: 10, background: "#fef2f2", border: "1px solid #fca5a5", color: "#991b1b", fontSize: 13, fontWeight: 600 }}>
          ✗ Subscription cancelled.{" "}
          {canRefund && (
            <button onClick={handleRefund} style={{ fontSize: 12, color: "#7c3aed", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>
              Request refund
            </button>
          )}
          {sub.refund_requested_at && " Refund requested — being processed."}
        </div>
      )}
      {!loading && !isSubscribed && inTrial && (
        <div style={{ marginBottom: 20, padding: "12px 16px", borderRadius: 10, background: "#eff6ff", border: "1px solid #93c5fd", color: "#1e40af", fontSize: 13, fontWeight: 600 }}>
          🎉 Pro trial active — {daysLeft} day{daysLeft !== 1 ? "s" : ""} left.
        </div>
      )}
      {!loading && !isSubscribed && trialStarted && !inTrial && sub?.status !== "cancelled" && (
        <div style={{ marginBottom: 20, padding: "12px 16px", borderRadius: 10, background: "#fff7ed", border: "1px solid #fdba74", color: "#92400e", fontSize: 13, fontWeight: 600 }}>
          ⚠ Your 14-day trial has ended. Subscribe below to restore Pro features.
        </div>
      )}

      {/* Billing toggle */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-secondary)" }}>Billing:</span>
        <div style={{ display: "flex", background: "var(--color-surface-2)", borderRadius: 8, padding: 3, gap: 3 }}>
          {(["monthly", "yearly"] as Billing[]).map((b) => (
            <button
              key={b}
              onClick={() => setBilling(b)}
              style={{
                padding: "6px 16px", borderRadius: 6, border: "none",
                fontSize: 13, fontWeight: 600, cursor: "pointer",
                background: billing === b ? "#7c3aed" : "transparent",
                color: billing === b ? "#fff" : "var(--color-text-secondary)",
                transition: "background 0.15s",
              }}
            >
              {b.charAt(0).toUpperCase() + b.slice(1)}
            </button>
          ))}
        </div>
        {billing === "yearly" && (
          <span style={{
            display: "inline-block", fontSize: 11, fontWeight: 700,
            letterSpacing: "0.05em", textTransform: "uppercase",
            padding: "2px 8px", borderRadius: 20,
            color: "#166534", background: "#f0fdf4",
          }}>
            Save up to ₹{PLANS[apiOption].savings.toLocaleString("en-IN")}
          </span>
        )}
      </div>

      {/* Three plan cards */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 28 }}>

        {/* Free card */}
        <div style={{
          borderRadius: 14, border: "1px solid var(--color-border)",
          background: "var(--color-surface)", padding: "22px 20px",
          display: "flex", flexDirection: "column",
        }}>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
              Free
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 4 }}>
              <span style={{ fontSize: 28, fontWeight: 800, color: "var(--color-text)", lineHeight: 1 }}>₹0</span>
              <span style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 2 }}>/forever</span>
            </div>
            <p style={{ fontSize: 12.5, color: "var(--color-text-secondary)", marginTop: 10, lineHeight: 1.5 }}>
              For personal use with basic invoice tracking.
            </p>
          </div>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
            {FREE_FEATURES.map((f) => (
              <li key={f} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5, color: "var(--color-text)" }}>
                <span style={{ flexShrink: 0, marginTop: 1 }}><CheckIcon color="#16a34a" /></span>
                {f}
              </li>
            ))}
          </ul>
          <div style={{ marginTop: 18, fontSize: 13, color: "var(--color-text-secondary)", fontWeight: 600, textAlign: "center", padding: "8px 0" }}>
            {proActive ? "Downgrade anytime" : "Current plan"}
          </div>
        </div>

        {/* Shared API card */}
        <div
          onClick={() => selectApiOption("shared")}
          style={{
            borderRadius: 14, padding: "22px 20px", cursor: "pointer",
            border: apiOption === "shared" ? "2px solid #7c3aed" : "1px solid var(--color-border)",
            background: "var(--color-surface)",
            position: "relative", display: "flex", flexDirection: "column",
            transition: "border-color 0.15s",
          }}
        >
          {apiOption === "shared" && (
            <div style={{ position: "absolute", top: 12, right: 12, fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", padding: "2px 8px", borderRadius: 20, color: "#7c3aed", background: "#ede9fe" }}>
              Selected
            </div>
          )}
          <div style={{ position: "absolute", top: 12, left: 20, fontSize: 10.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", padding: "2px 8px", borderRadius: 20, background: "#7c3aed", color: "#fff" }}>
            PRO
          </div>
          <div style={{ marginBottom: 16, marginTop: 22 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#7c3aed", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
              Shared API
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 4 }}>
              <span style={{ fontSize: 28, fontWeight: 800, color: "var(--color-text)", lineHeight: 1 }}>
                ₹{billing === "monthly" ? PLANS.shared.monthlyPrice : PLANS.shared.yearlyPrice}
              </span>
              <span style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 2 }}>{billingLabel}</span>
            </div>
            {billing === "yearly" && (
              <div style={{ fontSize: 12, color: "var(--color-text-tertiary)", marginTop: 4 }}>
                ₹{PLANS.shared.yearlyMonthly}/month · save ₹{PLANS.shared.savings.toLocaleString("en-IN")}
              </div>
            )}
            <p style={{ fontSize: 12.5, color: "var(--color-text-secondary)", marginTop: 10, lineHeight: 1.5 }}>
              AI via our shared OpenAI quota. No API key needed.
            </p>
          </div>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
            {SHARED_FEATURES.map((f) => (
              <li key={f} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5, color: "var(--color-text)" }}>
                <span style={{ flexShrink: 0, marginTop: 1 }}><CheckIcon color="#7c3aed" /></span>
                {f}
              </li>
            ))}
          </ul>
        </div>

        {/* Own API card */}
        <div
          onClick={() => selectApiOption("own")}
          style={{
            borderRadius: 14, padding: "22px 20px", cursor: "pointer",
            border: apiOption === "own" ? "2px solid #7c3aed" : "1px solid var(--color-border)",
            background: "var(--color-surface)",
            position: "relative", display: "flex", flexDirection: "column",
            transition: "border-color 0.15s",
          }}
        >
          {apiOption === "own" && (
            <div style={{ position: "absolute", top: 12, right: 12, fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", padding: "2px 8px", borderRadius: 20, color: "#7c3aed", background: "#ede9fe" }}>
              Selected
            </div>
          )}
          <div style={{ position: "absolute", top: 12, left: 20, fontSize: 10.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", padding: "2px 8px", borderRadius: 20, background: "#7c3aed", color: "#fff" }}>
            PRO
          </div>
          <div style={{ marginBottom: 16, marginTop: 22 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#7c3aed", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
              Own API Key
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 4 }}>
              <span style={{ fontSize: 28, fontWeight: 800, color: "var(--color-text)", lineHeight: 1 }}>
                ₹{billing === "monthly" ? PLANS.own.monthlyPrice : PLANS.own.yearlyPrice}
              </span>
              <span style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 2 }}>{billingLabel}</span>
            </div>
            {billing === "yearly" && (
              <div style={{ fontSize: 12, color: "var(--color-text-tertiary)", marginTop: 4 }}>
                ₹{PLANS.own.yearlyMonthly}/month · save ₹{PLANS.own.savings.toLocaleString("en-IN")}
              </div>
            )}
            <p style={{ fontSize: 12.5, color: "var(--color-text-secondary)", marginTop: 10, lineHeight: 1.5 }}>
              Bring your own OpenAI and/or Gemini key. Lower price, your own limits.
            </p>
          </div>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
            {OWN_API_FEATURES.map((f) => (
              <li key={f} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5, color: "var(--color-text)" }}>
                <span style={{ flexShrink: 0, marginTop: 1 }}><CheckIcon color="#7c3aed" /></span>
                {f}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Summary + CTA (Pro cards only) */}
      <div style={{
        border: "1px solid var(--color-border)", borderRadius: 12,
        background: "var(--color-surface)", padding: "20px 22px",
        marginBottom: 32,
      }}>
        {/* Top row: plan label + CTA */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--color-text)" }}>
            Pro · {apiOption === "shared" ? "Shared API" : "Own API Key"} · {billing === "monthly" ? "Monthly" : "Yearly"}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
            {isSubscribed ? (
              <div style={{ fontSize: 13, color: "#7c3aed", fontWeight: 700 }}>✓ Pro active</div>
            ) : inTrial ? (
              <>
                <div style={{ fontSize: 13, color: "var(--color-text-secondary)", fontStyle: "italic" }}>
                  Trial active — {daysLeft} day{daysLeft !== 1 ? "s" : ""} left
                </div>
                <button
                  onClick={handleSubscribe}
                  disabled={checkoutLoading}
                  style={{ padding: "8px 18px", borderRadius: 8, border: "1px solid #7c3aed", background: "transparent", color: "#7c3aed", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
                >
                  {checkoutLoading ? "Redirecting…" : "Subscribe now →"}
                </button>
              </>
            ) : approvalRequired ? (
              requestSent ? (
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#059669" }}>✓ Request sent!</div>
                  <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 3 }}>
                    Admin will review and enable your Pro access.
                  </div>
                </div>
              ) : (
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 12.5, color: "#92400e", marginBottom: 8 }}>
                    Pro access requires admin approval for your account.
                  </div>
                  <button
                    onClick={handleRequestAccess}
                    disabled={requestingAccess}
                    style={{ padding: "10px 20px", borderRadius: 8, border: "none", background: "#f59e0b", color: "#fff", fontSize: 13, fontWeight: 700, cursor: requestingAccess ? "wait" : "pointer", opacity: requestingAccess ? 0.7 : 1 }}
                  >
                    {requestingAccess ? "Sending…" : "Request Pro Access →"}
                  </button>
                </div>
              )
            ) : !trialUsed ? (
              <>
                <button
                  onClick={() => setShowProfileModal(true)}
                  style={{ padding: "10px 24px", borderRadius: 8, border: "none", background: "#7c3aed", color: "#fff", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}
                >
                  Start 14-day free trial
                </button>
                <span style={{ fontSize: 11.5, color: "var(--color-text-tertiary)" }}>No credit card required</span>
              </>
            ) : (
              <button
                onClick={handleSubscribe}
                disabled={checkoutLoading}
                style={{ padding: "10px 24px", borderRadius: 8, border: "none", background: "#7c3aed", color: "#fff", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}
              >
                {checkoutLoading ? "Redirecting…" : "Continue with Pro →"}
              </button>
            )}
            {trialError && (
              <div style={{ marginTop: 4, padding: "10px 14px", borderRadius: 8, background: "#fef2f2", border: "1px solid #fca5a5", color: "#b91c1c", fontSize: 12.5, lineHeight: 1.5 }}>
                {trialError}
              </div>
            )}
            {checkoutError && (
              <div style={{ marginTop: 4, padding: "10px 14px", borderRadius: 8, background: "#fef2f2", border: "1px solid #fca5a5", color: "#b91c1c", fontSize: 12.5, lineHeight: 1.5 }}>
                {checkoutError}
              </div>
            )}
          </div>
        </div>

        {/* Licences picker */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 16 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-text-secondary)" }}>Licences:</span>
          <div style={{ display: "flex", gap: 5 }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => setLicences(n)}
                style={{
                  width: 32, height: 32, borderRadius: 7,
                  border: licences === n ? "none" : "1px solid var(--color-border)",
                  background: licences === n ? "#7c3aed" : "var(--color-surface-2)",
                  color: licences === n ? "#fff" : "var(--color-text)",
                  fontSize: 13, fontWeight: 700, cursor: "pointer",
                }}
              >
                {n}
              </button>
            ))}
          </div>
          <span style={{ fontSize: 11.5, color: "var(--color-text-tertiary)" }}>max 5</span>
        </div>

        {/* Price breakdown */}
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--color-border)" }}>
          <div style={{ fontSize: 12.5, color: "var(--color-text-secondary)", lineHeight: 1.8 }}>
            <span>₹{(billing === "monthly" ? plan.monthlyPrice : plan.yearlyPrice).toLocaleString("en-IN")}{billingLabel} base (1 user)</span>
            {licences > 1 && (
              <>
                <br />
                <span>
                  + ₹{((licences - 1) * 249 * (billing === "yearly" ? 12 : 1)).toLocaleString("en-IN")}{billingLabel}
                  {" "}({licences - 1} extra user{licences > 2 ? "s" : ""} × ₹249{billing === "yearly" ? " × 12" : ""})
                </span>
              </>
            )}
          </div>
          <div style={{ fontSize: 17, fontWeight: 800, color: "#7c3aed", marginTop: 6 }}>
            Total: ₹{displayTotal.toLocaleString("en-IN")}{billingLabel}
            {billing === "yearly" && (
              <span style={{ fontSize: 12.5, fontWeight: 400, color: "var(--color-text-tertiary)", marginLeft: 10 }}>
                (₹{Math.round(displayTotal / 12).toLocaleString("en-IN")}/month)
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Comparison table */}
      <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--color-text)", marginBottom: 14, textTransform: "uppercase", letterSpacing: "0.06em" }}>
        Plan comparison
      </h2>
      <div style={{ border: "1px solid var(--color-border)", borderRadius: 10, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "var(--color-surface-2)" }}>
              <th style={{ textAlign: "left", padding: "10px 16px", color: "var(--color-text-secondary)", fontWeight: 600, borderBottom: "1px solid var(--color-border)" }}>Feature</th>
              <th style={{ textAlign: "center", padding: "10px 16px", color: "var(--color-text-secondary)", fontWeight: 600, borderBottom: "1px solid var(--color-border)" }}>Free</th>
              <th style={{ textAlign: "center", padding: "10px 16px", color: "#7c3aed", fontWeight: 700, borderBottom: "1px solid var(--color-border)" }}>Shared API</th>
              <th style={{ textAlign: "center", padding: "10px 16px", color: "#7c3aed", fontWeight: 700, borderBottom: "1px solid var(--color-border)" }}>Own API Key</th>
            </tr>
          </thead>
          <tbody>
            {([
              ["Manual uploads",   "5 / day",       "50 / day", "Unlimited"            ],
              ["Email imports",    "10 / day",      "50 / day", "Unlimited"            ],
              ["Data history",     "1 month",   "3 months",    "3 months"             ],
              ["Email accounts",   "1",         "Up to 5",     "Up to 5"              ],
              ["Extra user",       "—",         "₹249/user",   "₹249/user"            ],
              ["Mobile capture",   "✓",         "✓",           "✓"                    ],
              ["Cloud sync",       "✓",         "✓",           "✓"                    ],
              ["Own API key",      "—",         "—",           "✓"                    ],
              ["Advanced reports", "—",         "✓",           "✓"                    ],
              ["Monthly price",    "Free",      "₹999/mo",     "₹499/mo"              ],
              ["Yearly price",     "Free",      "₹9,999/yr",   "₹4,999/yr"            ],
            ] as [string, string, string, string][]).map(([feature, free, shared, own], i) => (
              <tr
                key={feature}
                style={{ borderTop: i === 0 ? "none" : "1px solid var(--color-border)", background: i % 2 === 0 ? "var(--color-surface)" : "var(--color-surface-2)" }}
              >
                <td style={{ padding: "9px 16px", color: "var(--color-text)", fontWeight: 500 }}>{feature}</td>
                <td style={{ padding: "9px 16px", textAlign: "center", color: free === "—" ? "var(--color-text-tertiary)" : "var(--color-text)" }}>{free}</td>
                <td style={{ padding: "9px 16px", textAlign: "center", color: shared === "—" ? "var(--color-text-tertiary)" : "#7c3aed", fontWeight: shared !== "—" ? 600 : 400 }}>{shared}</td>
                <td style={{ padding: "9px 16px", textAlign: "center", color: own === "—" ? "var(--color-text-tertiary)" : "#7c3aed", fontWeight: own !== "—" ? 600 : 400 }}>{own}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p style={{ marginTop: 18, fontSize: 11.5, color: "var(--color-text-tertiary)", lineHeight: 1.6 }}>
        Base plan is for 1 user. Extra accounts ₹249/user/month; daily invoice limit scales with user count.
        Prices in INR inclusive of all taxes. Cancel anytime.
        Own API Key plan requires a valid OpenAI and/or Gemini API key set in Settings → API Keys.
        Click a Pro card to select a variant before starting your trial.
      </p>

      {showProfileModal && (
        <BusinessProfileModal
          ctaLabel={postPayment || proActive ? "Save & Continue →" : "Continue to Trial →"}
          onConfirm={() => {
            setShowProfileModal(false);
            prefs.businessProfileCompleted = true;
            if (auth.email) {
              try {
                const p = JSON.parse(localStorage.getItem("jinvoice:business_profile") ?? "null");
                if (p) {
                  saveCustomerBusinessProfile(auth.email, {
                    business_type:        p.businessType,
                    business_address:     p.address,
                    business_pin:         p.pin,
                    business_state:       p.state,
                    business_country:     p.country,
                    license_count:        p.licenses || null,
                    profile_completed_at: new Date().toISOString(),
                  });
                }
              } catch {}
            }
            // Post-payment or already-Pro: just close — no trial to start
            if (postPayment || proActive) return;
            if (apiOption === "own") {
              setShowApiKeyModal(true);
            } else {
              handleStartTrial();
            }
          }}
          onClose={() => setShowProfileModal(false)}
        />
      )}

      {showApiKeyModal && (
        <GeminiApiKeyModal
          onConfirm={() => { setShowApiKeyModal(false); handleStartTrial(); }}
          onClose={() => setShowApiKeyModal(false)}
        />
      )}

      {showDummyPayment && (
        <DummyPaymentModal
          apiOption={apiOption}
          billing={billing}
          totalPaise={displayTotal * 100}
          onSuccess={(plan) => {
            setShowDummyPayment(false);
            setSub(plan as unknown as Subscription);
            setPostPayment(true);
            if (!prefs.businessProfileCompleted) setShowProfileModal(true);
          }}
          onClose={() => setShowDummyPayment(false)}
        />
      )}
    </div>
  );
}
