import { useState, useEffect } from "react";
import { rewards, type RewardEvent } from "../../data/RewardsStore";

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return iso; }
}

const HOW_TO_EARN = [
  { icon: "📄", action: "Upload an invoice manually",       pts: "+10 pts" },
  { icon: "✅", action: "Complete invoice (all fields filled)", pts: "+5 pts"  },
  { icon: "☁️", action: "Save invoice to cloud",             pts: "+5 pts"  },
  { icon: "🔥", action: "Every 5 invoices (streak bonus)",   pts: "+25 pts" },
  { icon: "🏆", action: "Every 25 invoices (champion bonus)", pts: "+100 pts"},
];

export function RewardsScreen() {
  const [pts,   setPts]   = useState(0);
  const [cnt,   setCnt]   = useState(0);
  const [hist,  setHist]  = useState<RewardEvent[]>([]);

  useEffect(() => {
    setPts(rewards.totalPoints);
    setCnt(rewards.uploadCount);
    setHist(rewards.history);
  }, []);

  const nextMilestone = cnt < 5 ? 5 : cnt < 25 ? 25 : Math.ceil((cnt + 1) / 25) * 25;
  const progressPct   = Math.min(100, ((cnt % (nextMilestone <= 25 ? 5 : 25)) / (nextMilestone <= 5 ? 5 : 25)) * 100);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--color-surface-2)", overflowY: "auto" }}>

      {/* Hero */}
      <div style={{
        background: "linear-gradient(135deg, var(--color-primary) 0%, #7c3aed 100%)",
        padding: "32px 28px 28px",
        color: "#fff",
      }}>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", opacity: 0.8, marginBottom: 6 }}>
          Your Rewards
        </div>
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
              height: "100%",
              borderRadius: 8,
              background: "#fff",
              width: `${progressPct}%`,
              transition: "width 0.6s ease",
            }} />
          </div>
        </div>
      </div>

      <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 20 }}>

        {/* How to earn */}
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

        {/* History */}
        <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 12, overflow: "hidden" }}>
          <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--color-border)", fontSize: 13, fontWeight: 700, color: "var(--color-text)" }}>
            Recent activity
          </div>
          {hist.length === 0 && (
            <div style={{ padding: "28px 16px", textAlign: "center", fontSize: 13, color: "var(--color-text-tertiary)" }}>
              No activity yet. Upload an invoice to start earning!
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
              <span style={{
                fontSize: 13, fontWeight: 700,
                color: ev.points > 0 ? "#16a34a" : "#dc2626",
                flexShrink: 0,
              }}>
                +{ev.points}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
