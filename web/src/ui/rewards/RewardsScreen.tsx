import { useState, useEffect } from "react";
import { rewards, type RewardEvent } from "../../data/RewardsStore";
import { prefs } from "../../data/AutoImportPreferences";
import { db } from "../../data/InvoiceDatabase";

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return iso; }
}

function formatDateShort(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  } catch { return iso; }
}

const HOW_TO_EARN = [
  { icon: "☁️", action: "Save invoice to cloud",              pts: "+5 pts"   },
  { icon: "🔥", action: "Every 5 invoices (streak bonus)",    pts: "+25 pts"  },
  { icon: "🏆", action: "Every 25 invoices (champion bonus)", pts: "+100 pts" },
];

function readStats() {
  return {
    pts:  rewards.totalPoints,
    cnt:  rewards.uploadCount,
    hist: rewards.history,
    lastUsed: rewards.lastUsedAt,
  };
}

export function RewardsScreen() {
  const isPro = prefs.isProActive;

  const [pts,      setPts]      = useState(() => rewards.totalPoints);
  const [cnt,      setCnt]      = useState(() => rewards.uploadCount);
  const [hist,     setHist]     = useState<RewardEvent[]>(() => rewards.history);
  const [lastUsed, setLastUsed] = useState<string | null>(() => rewards.lastUsedAt);
  const [autoCount, setAutoCount] = useState(0);

  function refresh() {
    const s = readStats();
    setPts(s.pts);
    setCnt(s.cnt);
    setHist(s.hist);
    setLastUsed(s.lastUsed);
  }

  useEffect(() => {
    refresh();
    // Count auto-downloaded documents
    db.invoices.where("importSource").anyOf(["gmail", "outlook", "desktop_folder", "mobile_sync"]).count()
      .then(setAutoCount).catch(() => {});

    window.addEventListener("jinvoice:rewards-updated", refresh);
    return () => window.removeEventListener("jinvoice:rewards-updated", refresh);
  }, []);

  const nextMilestone = cnt < 5 ? 5 : cnt < 25 ? 25 : Math.ceil((cnt + 1) / 25) * 25;
  const progressPct   = Math.min(100, ((cnt % (nextMilestone <= 25 ? 5 : 25)) / (nextMilestone <= 5 ? 5 : 25)) * 100);

  // Support SLA based on plan
  const supportSLA = isPro ? "48-hour response" : "7-day response";
  const supportSLAColor = isPro ? "#7c3aed" : "#6b7280";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--color-surface-2)", overflowY: "auto" }}>

      {/* Hero */}
      <div style={{
        background: isPro
          ? "linear-gradient(135deg, #374151 0%, #1f2937 100%)"
          : "linear-gradient(135deg, var(--color-primary) 0%, #7c3aed 100%)",
        padding: "32px 28px 28px",
        color: "#fff",
      }}>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", opacity: 0.8, marginBottom: 6 }}>
          {isPro ? "Pro Plan" : "Your Rewards"}
        </div>

        {isPro ? (
          <>
            <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1.2, marginBottom: 8 }}>
              Rewards not included
            </div>
            <div style={{ fontSize: 14, opacity: 0.85, lineHeight: 1.5 }}>
              Pro users have unlimited access without a points model.<br />
              Upgrade perks are baked into your plan.
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 54, fontWeight: 800, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
              {pts.toLocaleString("en-IN")}
            </div>
            <div style={{ fontSize: 15, fontWeight: 600, opacity: 0.9, marginTop: 4 }}>
              points · {cnt} invoice{cnt !== 1 ? "s" : ""} uploaded
            </div>
            {/* Milestone progress */}
            <div style={{ marginTop: 18 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, opacity: 0.85, marginBottom: 6 }}>
                <span>Next milestone: {nextMilestone} invoices</span>
                <span>{cnt} / {nextMilestone}</span>
              </div>
              <div style={{ background: "rgba(255,255,255,0.25)", borderRadius: 8, height: 8, overflow: "hidden" }}>
                <div style={{
                  height: "100%", borderRadius: 8, background: "#fff",
                  width: `${progressPct}%`, transition: "width 0.6s ease",
                }} />
              </div>
            </div>
          </>
        )}
      </div>

      <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 20 }}>

        {/* Support SLA card */}
        <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 12, padding: "14px 16px", display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 38, height: 38, borderRadius: 10, background: isPro ? "#f3e8ff" : "var(--color-surface-2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>
            🎧
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text)", marginBottom: 2 }}>
              Support response
            </div>
            <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
              {isPro ? "Pro plan — priority queue" : "Free plan"}
            </div>
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: supportSLAColor, flexShrink: 0 }}>
            {supportSLA}
          </div>
        </div>

        {/* Activity stats */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          {[
            { label: "Last activity", value: lastUsed ? formatDateShort(lastUsed) : "—" },
            { label: "Manual uploads", value: String(cnt) },
            { label: "Auto-imported", value: String(autoCount) },
          ].map(({ label, value }) => (
            <div key={label} style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10, padding: "12px 14px" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
                {label}
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--color-text)", fontVariantNumeric: "tabular-nums" }}>
                {value}
              </div>
            </div>
          ))}
        </div>

        {/* How to earn — only for free users */}
        {!isPro && (
          <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 12, overflow: "hidden" }}>
            <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--color-border)", fontSize: 13, fontWeight: 700, color: "var(--color-text)" }}>
              How to earn points
            </div>
            {HOW_TO_EARN.map(({ icon, action, pts: p }) => (
              <div key={action} style={{
                display: "flex", alignItems: "center", gap: 12,
                padding: "11px 16px", borderBottom: "1px solid var(--color-border)",
              }}>
                <span style={{ fontSize: 20, flexShrink: 0 }}>{icon}</span>
                <span style={{ flex: 1, fontSize: 13, color: "var(--color-text)" }}>{action}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: "var(--color-primary)", flexShrink: 0 }}>{p}</span>
              </div>
            ))}
          </div>
        )}

        {/* Recent activity — only for free users */}
        {!isPro && (
          <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 12, overflow: "hidden" }}>
            <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--color-border)", fontSize: 13, fontWeight: 700, color: "var(--color-text)" }}>
              Recent activity
            </div>
            {hist.length === 0 && (
              <div style={{ padding: "28px 16px", textAlign: "center", fontSize: 13, color: "var(--color-text-tertiary)" }}>
                No activity yet. Save an invoice to cloud to start earning!
              </div>
            )}
            {hist.map((ev, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
                padding: "10px 16px", borderBottom: i < hist.length - 1 ? "1px solid var(--color-border)" : undefined,
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: "var(--color-text)", marginBottom: 2 }}>{ev.reason}</div>
                  <div style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>{formatDate(ev.at)}</div>
                </div>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#16a34a", flexShrink: 0 }}>
                  +{ev.points}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
