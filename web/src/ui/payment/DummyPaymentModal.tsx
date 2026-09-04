import { useState } from "react";
import { activateDummyPro } from "../../service/UserPlanService";
import type { ServerPlan } from "../../service/UserPlanService";

type ApiOption = "shared" | "own";
type Billing   = "monthly" | "yearly";

interface Props {
  apiOption: ApiOption;
  billing: Billing;
  totalPaise: number;
  onSuccess: (plan: ServerPlan) => void;
  onClose: () => void;
}

type PayTab = "upi" | "card";

const DUMMY_UPI = "success@razorpay";

export function DummyPaymentModal({ apiOption, billing, totalPaise, onSuccess, onClose }: Props) {
  const [tab, setTab]         = useState<PayTab>("upi");
  const [upiId, setUpiId]     = useState(DUMMY_UPI);
  const [paying, setPaying]   = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [done, setDone]       = useState(false);

  const planLabel = `Pro · ${apiOption === "shared" ? "Shared API" : "Own API Key"} · ${billing === "monthly" ? "Monthly" : "Yearly"}`;
  const amountStr = "₹" + (totalPaise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 });

  const handlePay = async () => {
    setError(null);
    if (tab === "upi" && !upiId.includes("@")) {
      setError("Enter a valid UPI ID (e.g. name@upi).");
      return;
    }
    setPaying(true);
    // Simulate network / bank round-trip
    await new Promise((r) => setTimeout(r, 1500));
    try {
      const plan = await activateDummyPro(apiOption, billing);
      setDone(true);
      setTimeout(() => onSuccess(plan), 1200);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Payment failed. Please try again.");
      setPaying(false);
    }
  };

  const overlay: React.CSSProperties = {
    position: "fixed", inset: 0,
    background: "rgba(0,0,0,0.55)", zIndex: 1000,
    display: "flex", alignItems: "center", justifyContent: "center",
    padding: 24,
  };
  const card: React.CSSProperties = {
    background: "var(--color-surface)", borderRadius: 16,
    border: "1px solid var(--color-border)",
    boxShadow: "0 12px 48px rgba(0,0,0,0.28)",
    width: "100%", maxWidth: 420,
    overflow: "hidden",
  };
  const tabBtn = (active: boolean): React.CSSProperties => ({
    flex: 1, padding: "10px 0", border: "none",
    background: active ? "var(--color-surface)" : "var(--color-surface-2)",
    color: active ? "var(--color-text)" : "var(--color-text-secondary)",
    fontWeight: active ? 700 : 500, fontSize: 13.5, cursor: "pointer",
    borderBottom: active ? "2px solid #7c3aed" : "2px solid transparent",
    transition: "all 0.15s",
  });
  const inp: React.CSSProperties = {
    width: "100%", padding: "10px 12px", borderRadius: 8,
    border: "1px solid var(--color-border)",
    background: "var(--color-surface-2)", color: "var(--color-text)",
    fontSize: 14, boxSizing: "border-box", outline: "none",
  };

  if (done) {
    return (
      <div style={overlay}>
        <div style={{ ...card, padding: "40px 32px", textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
          <div style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text)" }}>Payment successful!</div>
          <div style={{ fontSize: 13, color: "var(--color-text-secondary)", marginTop: 6 }}>
            Activating your Pro plan…
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={card}>

        {/* Demo banner */}
        <div style={{ background: "#fef3c7", borderBottom: "1px solid #fde68a", padding: "8px 20px", fontSize: 11.5, color: "#92400e", fontWeight: 600, textAlign: "center" }}>
          DEMO MODE — No real payment is processed
        </div>

        {/* Header */}
        <div style={{ padding: "20px 22px 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
                jInvoice
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text)" }}>{planLabel}</div>
            </div>
            <button
              onClick={onClose}
              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-secondary)", fontSize: 22, lineHeight: 1, padding: 0 }}
            >
              ×
            </button>
          </div>
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--color-border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>Amount due</span>
            <span style={{ fontSize: 20, fontWeight: 800, color: "#7c3aed" }}>{amountStr}</span>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid var(--color-border)", marginTop: 16 }}>
          <button style={tabBtn(tab === "upi")} onClick={() => setTab("upi")}>UPI</button>
          <button style={tabBtn(tab === "card")} onClick={() => setTab("card")}>Card</button>
        </div>

        {/* UPI form */}
        {tab === "upi" && (
          <div style={{ padding: "20px 22px" }}>
            <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: "var(--color-text-secondary)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>
              UPI ID
            </label>
            <input
              style={inp}
              placeholder="yourname@upi"
              value={upiId}
              onChange={(e) => setUpiId(e.target.value)}
              disabled={paying}
            />
            <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 5 }}>
              Use <strong>{DUMMY_UPI}</strong> to simulate a success.
            </div>
          </div>
        )}

        {/* Card form */}
        {tab === "card" && (
          <div style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: "var(--color-text-secondary)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                Card number
              </label>
              <input style={inp} placeholder="4111 1111 1111 1111" disabled={paying} defaultValue="4111 1111 1111 1111" />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: "var(--color-text-secondary)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  Expiry
                </label>
                <input style={inp} placeholder="MM / YY" disabled={paying} defaultValue="12 / 29" />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: "var(--color-text-secondary)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  CVV
                </label>
                <input style={inp} placeholder="•••" disabled={paying} defaultValue="123" type="password" />
              </div>
            </div>
            <div style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>
              Any values work in demo mode — no card is charged.
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{ margin: "0 22px", padding: "10px 14px", borderRadius: 8, background: "#fef2f2", border: "1px solid #fca5a5", color: "#b91c1c", fontSize: 12.5 }}>
            {error}
          </div>
        )}

        {/* Pay button */}
        <div style={{ padding: "16px 22px 22px" }}>
          <button
            onClick={handlePay}
            disabled={paying}
            style={{
              width: "100%", padding: "12px 0", borderRadius: 10, border: "none",
              background: paying ? "#a78bfa" : "#7c3aed", color: "#fff",
              fontSize: 15, fontWeight: 700, cursor: paying ? "wait" : "pointer",
              transition: "background 0.15s",
            }}
          >
            {paying
              ? "Processing…"
              : `Pay ${amountStr}`}
          </button>
          <div style={{ textAlign: "center", fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 10 }}>
            Secured by jInvoice · Demo environment
          </div>
        </div>
      </div>
    </div>
  );
}
