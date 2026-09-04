import React, { useState } from "react";
import { prefs, getCachedTrialDays } from "../../data/AutoImportPreferences";

type Billing = "monthly" | "yearly";
type ApiOption = "shared" | "own";

const PLANS: Record<ApiOption, { monthlyPrice: number; yearlyPrice: number; yearlyMonthly: number; savings: number }> = {
  shared: {
    monthlyPrice:  399,
    yearlyPrice:   3499,
    yearlyMonthly: 292,
    savings:       1289,
  },
  own: {
    monthlyPrice:  249,
    yearlyPrice:   1999,
    yearlyMonthly: 167,
    savings:        989,
  },
};

const SHARED_FEATURES = [
  "Unlimited invoices/day",
  "6+ months data history",
  "Up to 5 email accounts",
  "Mobile capture + cloud sync",
  "Advanced GST reports",
  "AI extraction via shared quota",
  "Priority support",
];

const OWN_API_FEATURES = [
  "Everything in Shared API plan",
  "Use your own Gemini API key",
  "No shared quota — your limits only",
  "Lower monthly cost",
];

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}

function Tag({ children, color = "#7c3aed", bg = "#ede9fe" }: { children: React.ReactNode; color?: string; bg?: string }) {
  return (
    <span style={{
      display: "inline-block", fontSize: 11, fontWeight: 700,
      letterSpacing: "0.05em", textTransform: "uppercase",
      padding: "2px 8px", borderRadius: 20,
      color, background: bg,
    }}>
      {children}
    </span>
  );
}

export function PaymentScreen() {
  const [billing, setBilling]       = useState<Billing>("monthly");
  const [apiOption, setApiOption]   = useState<ApiOption>("shared");
  const [, forceUpdate]             = useState(0);

  const isSubscribed  = prefs.isSubscribed;
  const isInTrial     = prefs.isInTrial;
  const trialStarted  = !!prefs.trialStartedAt;
  const daysLeft      = prefs.trialDaysLeft;

  const plan = PLANS[apiOption];
  const displayPrice  = billing === "monthly" ? plan.monthlyPrice : plan.yearlyPrice;
  const billingLabel  = billing === "monthly" ? "/month" : "/year";

  const handleStartTrial = () => {
    prefs.startTrial();
    forceUpdate((n) => n + 1);
  };

  return (
    <div style={{ padding: "32px 28px", maxWidth: 700, margin: "0 auto" }}>

      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, color: "var(--color-text)", margin: 0 }}>
          Upgrade to Pro
        </h1>
        <p style={{ fontSize: 14, color: "var(--color-text-secondary)", marginTop: 6 }}>
          Choose the billing cycle and API option that suits you.
        </p>
      </div>

      {/* Status banners */}
      {isSubscribed && (
        <div style={{ marginBottom: 20, padding: "12px 16px", borderRadius: 10, background: "#f0fdf4", border: "1px solid #86efac", color: "#166534", fontSize: 13, fontWeight: 600 }}>
          ✓ You are already on the Pro plan.
        </div>
      )}
      {!isSubscribed && isInTrial && (
        <div style={{ marginBottom: 20, padding: "12px 16px", borderRadius: 10, background: "#eff6ff", border: "1px solid #93c5fd", color: "#1e40af", fontSize: 13, fontWeight: 600 }}>
          🎉 Pro trial active — {daysLeft} day{daysLeft !== 1 ? "s" : ""} left.
        </div>
      )}
      {!isSubscribed && trialStarted && !isInTrial && (
        <div style={{ marginBottom: 20, padding: "12px 16px", borderRadius: 10, background: "#fff7ed", border: "1px solid #fdba74", color: "#92400e", fontSize: 13, fontWeight: 600 }}>
          ⚠ Your {getCachedTrialDays()}-day trial has ended. Activate Pro to restore access.
        </div>
      )}

      {/* Billing toggle */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
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
          <Tag color="#166534" bg="#f0fdf4">Save up to ₹{PLANS[apiOption].savings.toLocaleString("en-IN")}</Tag>
        )}
      </div>

      {/* Plan cards */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 28 }}>

        {/* Shared API card */}
        <div
          onClick={() => setApiOption("shared")}
          style={{
            borderRadius: 14, padding: "22px 20px", cursor: "pointer",
            border: apiOption === "shared" ? "2px solid #7c3aed" : "1px solid var(--color-border)",
            background: "var(--color-surface)",
            position: "relative", display: "flex", flexDirection: "column",
            outline: "none", transition: "border-color 0.15s",
          }}
        >
          {apiOption === "shared" && (
            <div style={{ position: "absolute", top: 12, right: 12 }}>
              <Tag>Selected</Tag>
            </div>
          )}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
              Shared API
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 4 }}>
              <span style={{ fontSize: 30, fontWeight: 800, color: "var(--color-text)", lineHeight: 1 }}>
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
              AI extraction runs on our shared Gemini quota. No API key needed.
            </p>
          </div>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            {SHARED_FEATURES.map((f) => (
              <li key={f} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5, color: "var(--color-text)" }}>
                <span style={{ flexShrink: 0, marginTop: 1 }}><CheckIcon /></span>
                {f}
              </li>
            ))}
          </ul>
        </div>

        {/* Own API card */}
        <div
          onClick={() => setApiOption("own")}
          style={{
            borderRadius: 14, padding: "22px 20px", cursor: "pointer",
            border: apiOption === "own" ? "2px solid #7c3aed" : "1px solid var(--color-border)",
            background: "var(--color-surface)",
            position: "relative", display: "flex", flexDirection: "column",
            outline: "none", transition: "border-color 0.15s",
          }}
        >
          {apiOption === "own" && (
            <div style={{ position: "absolute", top: 12, right: 12 }}>
              <Tag>Selected</Tag>
            </div>
          )}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
              Own API Key
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 4 }}>
              <span style={{ fontSize: 30, fontWeight: 800, color: "var(--color-text)", lineHeight: 1 }}>
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
              Bring your own Gemini API key. Lower price, your own usage limits.
            </p>
          </div>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            {OWN_API_FEATURES.map((f) => (
              <li key={f} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5, color: "var(--color-text)" }}>
                <span style={{ flexShrink: 0, marginTop: 1 }}><CheckIcon /></span>
                {f}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Summary + CTA */}
      <div
        style={{
          border: "1px solid var(--color-border)", borderRadius: 12,
          background: "var(--color-surface)", padding: "20px 22px",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16,
          flexWrap: "wrap",
        }}
      >
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
              Payment coming soon
            </div>
          ) : !trialStarted ? (
            <>
              <button
                onClick={handleStartTrial}
                style={{
                  padding: "10px 24px", borderRadius: 8, border: "none",
                  background: "#7c3aed", color: "#fff", fontSize: 13.5,
                  fontWeight: 700, cursor: "pointer",
                }}
              >
                Start {getCachedTrialDays()}-day free trial
              </button>
              <span style={{ fontSize: 11.5, color: "var(--color-text-tertiary)" }}>
                No credit card required
              </span>
            </>
          ) : (
            <div style={{ fontSize: 13, color: "var(--color-text-secondary)", fontStyle: "italic" }}>
              Payment coming soon
            </div>
          )}
        </div>
      </div>

      {/* Comparison table */}
      <div style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--color-text)", marginBottom: 14, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Plan comparison
        </h2>
        <div style={{ border: "1px solid var(--color-border)", borderRadius: 10, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "var(--color-surface-2)" }}>
                <th style={{ textAlign: "left", padding: "10px 16px", color: "var(--color-text-secondary)", fontWeight: 600, borderBottom: "1px solid var(--color-border)" }}>Feature</th>
                <th style={{ textAlign: "center", padding: "10px 16px", color: "var(--color-text-secondary)", fontWeight: 600, borderBottom: "1px solid var(--color-border)" }}>Shared API</th>
                <th style={{ textAlign: "center", padding: "10px 16px", color: "#7c3aed", fontWeight: 700, borderBottom: "1px solid var(--color-border)" }}>Own API Key</th>
              </tr>
            </thead>
            <tbody>
              {([
                ["Monthly price",     "₹399/mo",  "₹249/mo"   ],
                ["Yearly price",      "₹3,499/yr", "₹1,999/yr" ],
                ["Daily invoices",    "Unlimited", "Unlimited" ],
                ["Data history",      "6+ months", "6+ months" ],
                ["Email accounts",    "Up to 5",   "Up to 5"   ],
                ["AI extraction",     "Shared",    "Your key"  ],
                ["Usage limits",      "Shared",    "Your own"  ],
                ["Mobile + sync",     "✓",         "✓"         ],
              ] as [string, string, string][]).map(([feature, shared, own], i) => (
                <tr
                  key={feature}
                  style={{ borderTop: i === 0 ? "none" : "1px solid var(--color-border)", background: i % 2 === 0 ? "var(--color-surface)" : "var(--color-surface-2)" }}
                >
                  <td style={{ padding: "9px 16px", color: "var(--color-text)", fontWeight: 500 }}>{feature}</td>
                  <td style={{ padding: "9px 16px", textAlign: "center", color: "var(--color-text)" }}>{shared}</td>
                  <td style={{ padding: "9px 16px", textAlign: "center", color: "#7c3aed", fontWeight: 600 }}>{own}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p style={{ marginTop: 18, fontSize: 11.5, color: "var(--color-text-tertiary)", lineHeight: 1.6 }}>
        Pro is for 1 user. Prices in INR inclusive of all taxes. Cancel anytime.
        Own API Key plan requires a valid Google Gemini API key set in Settings → API Keys.
      </p>
    </div>
  );
}
