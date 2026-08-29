import { useState } from "react";
import { prefs } from "../../data/AutoImportPreferences";
import { auth } from "../../data/AuthStore";
import { saveCustomerPlan, saveCustomerBusinessProfile } from "../../service/SupabaseSync";

const INDIAN_STATES = [
  "Andhra Pradesh","Arunachal Pradesh","Assam","Bihar","Chhattisgarh","Goa","Gujarat",
  "Haryana","Himachal Pradesh","Jharkhand","Karnataka","Kerala","Madhya Pradesh",
  "Maharashtra","Manipur","Meghalaya","Mizoram","Nagaland","Odisha","Punjab",
  "Rajasthan","Sikkim","Tamil Nadu","Telangana","Tripura","Uttar Pradesh",
  "Uttarakhand","West Bengal","Delhi","Jammu & Kashmir","Ladakh","Chandigarh",
  "Puducherry","Andaman & Nicobar Islands","Dadra & Nagar Haveli","Daman & Diu",
];

const BUSINESS_TYPES = [
  "Sole Proprietor","Partnership","LLP","Private Limited (Pvt. Ltd.)","Public Limited","Trust / NGO","Others",
];

interface BusinessProfile {
  businessType: string;
  address: string;
  pin: string;
  state: string;
  country: string;
  licenses: string;
}

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
    if (!trimmed.startsWith("AIza")) { setError('Gemini keys start with "AIza". Check your key.'); return; }
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
            placeholder="AIza…"
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

function BusinessProfileModal({ onConfirm, onClose }: { onConfirm: () => void; onClose: () => void }) {
  const [profile, setProfile] = useState<BusinessProfile>(() => {
    try { return JSON.parse(localStorage.getItem("jinvoice:business_profile") ?? "null") ?? { businessType: "", address: "", pin: "", state: "", country: "India", licenses: "" }; }
    catch { return { businessType: "", address: "", pin: "", state: "", country: "India", licenses: "" }; }
  });
  const [errors, setErrors] = useState<Partial<Record<keyof BusinessProfile, string>>>({});

  const set = (k: keyof BusinessProfile) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setProfile((p) => ({ ...p, [k]: e.target.value }));

  const handleSubmit = () => {
    const errs: Partial<Record<keyof BusinessProfile, string>> = {};
    if (!profile.businessType) errs.businessType = "Required";
    if (!profile.address.trim()) errs.address = "Required";
    if (!/^\d{6}$/.test(profile.pin.trim())) errs.pin = "Enter a valid 6-digit PIN";
    if (!profile.state) errs.state = "Required";
    if (!profile.country.trim()) errs.country = "Required";
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    try { localStorage.setItem("jinvoice:business_profile", JSON.stringify(profile)); } catch {}
    onConfirm();
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.52)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ background: "var(--color-surface)", borderRadius: 14, padding: "28px 24px", maxWidth: 460, width: "100%", maxHeight: "90vh", overflowY: "auto", border: "1px solid var(--color-border)", boxShadow: "0 8px 40px rgba(0,0,0,0.3)" }}>
        <h2 style={{ fontSize: 18, fontWeight: 800, color: "var(--color-text)", margin: "0 0 6px" }}>Business Details</h2>
        <p style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 22, lineHeight: 1.5 }}>
          A few details to set up your Pro account. Fields marked <span style={{ color: "#ef4444" }}>*</span> are required.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={lblStyle}>Business Type <span style={{ color: "#ef4444" }}>*</span></label>
            <select value={profile.businessType} onChange={set("businessType")} style={inpStyle}>
              <option value="">Select type…</option>
              {BUSINESS_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            {errors.businessType && <div style={errStyle}>{errors.businessType}</div>}
          </div>

          <div>
            <label style={lblStyle}>Business Address <span style={{ color: "#ef4444" }}>*</span></label>
            <textarea value={profile.address} onChange={set("address")} placeholder="Street, building, area…" rows={2}
              style={{ ...inpStyle, resize: "vertical", fontFamily: "inherit" }} />
            {errors.address && <div style={errStyle}>{errors.address}</div>}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={lblStyle}>PIN Code <span style={{ color: "#ef4444" }}>*</span></label>
              <input type="text" maxLength={6} inputMode="numeric" value={profile.pin} onChange={set("pin")} placeholder="6-digit PIN" style={inpStyle} />
              {errors.pin && <div style={errStyle}>{errors.pin}</div>}
            </div>
            <div>
              <label style={lblStyle}>State <span style={{ color: "#ef4444" }}>*</span></label>
              <select value={profile.state} onChange={set("state")} style={inpStyle}>
                <option value="">Select…</option>
                {INDIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              {errors.state && <div style={errStyle}>{errors.state}</div>}
            </div>
          </div>

          <div>
            <label style={lblStyle}>Country <span style={{ color: "#ef4444" }}>*</span></label>
            <input type="text" value={profile.country} onChange={set("country")} placeholder="India" style={inpStyle} />
            {errors.country && <div style={errStyle}>{errors.country}</div>}
          </div>

          <div>
            <label style={lblStyle}>Number of Licenses <span style={{ fontSize: 10.5, color: "var(--color-text-tertiary)", fontWeight: 400, textTransform: "none" }}>(optional)</span></label>
            <input type="number" min={1} value={profile.licenses} onChange={set("licenses")} placeholder="e.g. 1" style={inpStyle} />
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
          <button onClick={onClose} style={{ flex: 1, padding: "10px", borderRadius: 8, border: "1px solid var(--color-border)", background: "var(--color-surface-2)", color: "var(--color-text-secondary)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            Cancel
          </button>
          <button onClick={handleSubmit} style={{ flex: 2, padding: "10px", borderRadius: 8, border: "none", background: "#7c3aed", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
            Continue to Trial →
          </button>
        </div>
      </div>
    </div>
  );
}

type Billing = "monthly" | "yearly";
type ApiOption = "shared" | "own";

const PLANS: Record<ApiOption, { monthlyPrice: number; yearlyPrice: number; yearlyMonthly: number; savings: number }> = {
  shared: { monthlyPrice: 399,  yearlyPrice: 3499, yearlyMonthly: 292, savings: 1289 },
  own:    { monthlyPrice: 249,  yearlyPrice: 1999, yearlyMonthly: 167, savings: 989  },
};

const FREE_FEATURES = [
  "5 invoices per day",
  "3 months of data history",
  "1 email account",
  "Mobile invoice capture",
  "Cloud sync",
  "Basic GST report",
  "Rewards points program",
  "7-day support response",
];

const SHARED_FEATURES = [
  "Unlimited invoices/day",
  "6+ months data history",
  "Up to 5 email accounts",
  "Advanced GST reports",
  "AI via shared Gemini quota",
  "48-hour support response",
];

const OWN_API_FEATURES = [
  "Everything in Shared plan",
  "Your own Gemini API key",
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
  const [, forceUpdate]               = useState(0);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showApiKeyModal,  setShowApiKeyModal]  = useState(false);

  const isSubscribed = prefs.isSubscribed;
  const isInTrial    = prefs.isInTrial;
  const trialStarted = !!prefs.trialStartedAt;
  const daysLeft     = prefs.trialDaysLeft;
  const isProActive  = prefs.isProActive;

  const selectApiOption = (opt: ApiOption) => {
    setApiOption(opt);
    prefs.planApiOption = opt;
    if (isProActive && auth.email) {
      saveCustomerPlan(auth.email, {
        plan: opt === "shared" ? "pro_shared" : "pro_own",
        plan_status: isSubscribed ? "active" : "trial",
        billing_cycle: billing,
      });
    }
  };

  const handleStartTrial = () => {
    prefs.startTrial();
    forceUpdate((n) => n + 1);
    if (auth.email) {
      saveCustomerPlan(auth.email, {
        plan: apiOption === "shared" ? "pro_shared" : "pro_own",
        plan_status: "trial",
        billing_cycle: billing,
        trial_started_at: new Date().toISOString(),
      });
    }
  };

  const plan = PLANS[apiOption];
  const displayPrice  = billing === "monthly" ? plan.monthlyPrice : plan.yearlyPrice;
  const billingLabel  = billing === "monthly" ? "/month" : "/year";

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
      {isSubscribed && (
        <div style={{ marginBottom: 20, padding: "12px 16px", borderRadius: 10, background: "#f0fdf4", border: "1px solid #86efac", color: "#166534", fontSize: 13, fontWeight: 600 }}>
          ✓ You are on the Pro plan.
        </div>
      )}
      {!isSubscribed && isInTrial && (
        <div style={{ marginBottom: 20, padding: "12px 16px", borderRadius: 10, background: "#eff6ff", border: "1px solid #93c5fd", color: "#1e40af", fontSize: 13, fontWeight: 600 }}>
          🎉 Pro trial active — {daysLeft} day{daysLeft !== 1 ? "s" : ""} left.
        </div>
      )}
      {!isSubscribed && trialStarted && !isInTrial && (
        <div style={{ marginBottom: 20, padding: "12px 16px", borderRadius: 10, background: "#fff7ed", border: "1px solid #fdba74", color: "#92400e", fontSize: 13, fontWeight: 600 }}>
          ⚠ Your 14-day trial has ended. Subscribe to restore Pro features.
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
            {isProActive ? "Downgrade anytime" : "Current plan"}
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
              AI via our shared Gemini quota. No API key needed.
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
              Bring your own Gemini key. Lower price, your own limits.
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
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16,
        flexWrap: "wrap", marginBottom: 32,
      }}>
        <div>
          <div style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 4 }}>
            Selected plan
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--color-text)" }}>
            Pro · {apiOption === "shared" ? "Shared API" : "Own API Key"} · {billing === "monthly" ? "Monthly" : "Yearly"}
          </div>
          <div style={{ fontSize: 13, color: "#7c3aed", fontWeight: 600, marginTop: 3 }}>
            ₹{displayPrice.toLocaleString("en-IN")}{billingLabel}
            {billing === "yearly" && (
              <span style={{ color: "var(--color-text-tertiary)", fontWeight: 400, marginLeft: 8 }}>
                (₹{PLANS[apiOption].yearlyMonthly}/month)
              </span>
            )}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
          {isSubscribed ? (
            <div style={{ fontSize: 13, color: "#7c3aed", fontWeight: 700 }}>✓ Pro active</div>
          ) : isInTrial ? (
            <div style={{ fontSize: 13, color: "var(--color-text-secondary)", fontStyle: "italic" }}>
              Trial active — {daysLeft} day{daysLeft !== 1 ? "s" : ""} left
            </div>
          ) : !trialStarted ? (
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
            <div style={{ fontSize: 13, color: "var(--color-text-secondary)", fontStyle: "italic" }}>
              Payment coming soon
            </div>
          )}
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
              ["Daily invoices",   "5 / day",   "Unlimited",  "Unlimited"  ],
              ["Data history",     "3 months",  "6+ months",  "6+ months"  ],
              ["Email accounts",   "1",         "Up to 5",    "Up to 5"    ],
              ["Mobile capture",   "✓",         "✓",          "✓"          ],
              ["Cloud sync",       "✓",         "✓",          "✓"          ],
              ["Own API key",      "—",         "—",          "✓"          ],
              ["Advanced GST",     "—",         "✓",          "✓"          ],
              ["Project tags",     "—",         "✓",          "✓"          ],
              ["Monthly price",    "Free",      "₹399/mo",    "₹249/mo"    ],
              ["Yearly price",     "Free",      "₹3,499/yr",  "₹1,999/yr"  ],
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
        Pro is for 1 user. Prices in INR inclusive of all taxes. Cancel anytime.
        Own API Key plan requires a valid Google Gemini API key set in Settings → API Keys.
        Click a Pro card to select a variant before starting your trial.
      </p>

      {showProfileModal && (
        <BusinessProfileModal
          onConfirm={() => {
            setShowProfileModal(false);
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
    </div>
  );
}
