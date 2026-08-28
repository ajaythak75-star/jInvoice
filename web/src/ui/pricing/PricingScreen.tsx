import { useState } from "react";
import { prefs } from "../../data/AutoImportPreferences";
import { auth } from "../../data/AuthStore";
import { saveCustomerPlan } from "../../service/SupabaseSync";

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
];

const SHARED_FEATURES = [
  "Unlimited invoices/day",
  "6+ months data history",
  "Up to 5 email accounts",
  "Advanced GST reports",
  "AI via shared Gemini quota",
  "Priority support",
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
  const [billing, setBilling]     = useState<Billing>("monthly");
  const [apiOption, setApiOption] = useState<ApiOption>(() => prefs.planApiOption);
  const [, forceUpdate]           = useState(0);

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
                onClick={handleStartTrial}
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
    </div>
  );
}
