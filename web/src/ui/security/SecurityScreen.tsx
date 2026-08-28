import { useEffect, useState } from "react";
import { getActiveSecurityAlerts, dismissSecurityAlert, type SecurityAlertRecord } from "../../data/InvoiceDatabase";

function formatDate(iso: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return iso; }
}

function riskColor(level: "medium" | "high"): string {
  return level === "high" ? "#dc2626" : "#d97706";
}

function riskBg(level: "medium" | "high"): string {
  return level === "high" ? "#fee2e2" : "#fef3c7";
}

function riskLabel(level: "medium" | "high"): string {
  return level === "high" ? "High Risk" : "Medium Risk";
}

function SecurityCard({ alert, onDismiss }: { alert: SecurityAlertRecord; onDismiss: () => void }) {
  const color = riskColor(alert.riskLevel);
  const bg = riskBg(alert.riskLevel);
  const metaStyle: React.CSSProperties = { fontSize: 11.5, color: "var(--color-text-secondary)" };
  const labelStyle: React.CSSProperties = { fontSize: 10.5, fontWeight: 600, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.04em", marginRight: 3 };

  return (
    <div className="sentinel-card" style={{ flexDirection: "column", gap: 4, alignItems: "stretch", borderLeft: `3px solid ${color}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 15, flexShrink: 0 }}>⚠️</span>
        <span className="sentinel-label" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {alert.subject || "(no subject)"}
        </span>
        <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: 4, background: bg, color }}>
          {riskLabel(alert.riskLevel)}
        </span>
        <button className="sentinel-dismiss" onClick={onDismiss} aria-label="Dismiss">✕</button>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, paddingLeft: 24, ...metaStyle }}>
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          <span style={labelStyle}>Sender</span>{alert.senderEmail || "—"}
        </span>
        <span style={{ flexShrink: 0 }}>
          <span style={labelStyle}>Source</span>{alert.importSource}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, paddingLeft: 24, ...metaStyle }}>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={labelStyle}>Reason</span>
          <span style={{ color, fontWeight: 500 }}>{alert.reason}</span>
        </span>
        <span style={{ flexShrink: 0 }}>
          <span style={labelStyle}>Flagged</span>{formatDate(alert.flaggedAt)}
        </span>
      </div>
      <div style={{ paddingLeft: 24, ...metaStyle }}>
        <span style={{ fontSize: 11, color: "var(--color-text-tertiary)", fontStyle: "italic" }}>
          Attachment not downloaded — file blocked for safety.
        </span>
      </div>
    </div>
  );
}

export function SecurityScreen() {
  const [alerts, setAlerts] = useState<SecurityAlertRecord[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = async () => {
    const data = await getActiveSecurityAlerts();
    setAlerts(data);
    setLoaded(true);
  };

  useEffect(() => {
    load();
    window.addEventListener("jinvoice:security-alert", load);
    window.addEventListener("jinvoice:sync-complete", load);
    return () => {
      window.removeEventListener("jinvoice:security-alert", load);
      window.removeEventListener("jinvoice:sync-complete", load);
    };
  }, []);

  const handleDismiss = async (id: number) => {
    await dismissSecurityAlert(id);
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  };

  const handleClearAll = async () => {
    for (const a of alerts) {
      if (a.id != null) await dismissSecurityAlert(a.id);
    }
    setAlerts([]);
  };

  if (!loaded) return null;

  if (alerts.length === 0) {
    return (
      <div className="placeholder-screen">
        <span>🔒</span>
        <p>No threats detected</p>
        <p style={{ fontSize: 13 }}>Suspicious emails flagged during sync appear here. Attachments from flagged emails are not downloaded.</p>
        <button className="btn-sm" style={{ marginTop: 12 }} onClick={load}>Refresh</button>
      </div>
    );
  }

  const high   = alerts.filter((a) => a.riskLevel === "high");
  const medium = alerts.filter((a) => a.riskLevel === "medium");

  return (
    <div className="sentinel-screen">
      <div className="invoice-list-header">
        <h2>Security Threats</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>{alerts.length} flagged</span>
          <button className="btn-sm" onClick={load}>Refresh</button>
          <button className="btn-sm btn-danger" onClick={handleClearAll}>Dismiss All</button>
        </div>
      </div>
      <p style={{ fontSize: 12.5, color: "var(--color-text-secondary)", margin: "0 0 12px", padding: "0 2px" }}>
        These emails were blocked by AI threat detection. No attachments were downloaded.
      </p>

      {high.length > 0 && (
        <>
          <div className="sentinel-section-label" style={{ color: "#dc2626" }}>High Risk</div>
          {high.map((a) => <SecurityCard key={a.id} alert={a} onDismiss={() => handleDismiss(a.id!)} />)}
        </>
      )}

      {medium.length > 0 && (
        <>
          <div className="sentinel-section-label" style={{ color: "#d97706" }}>Medium Risk</div>
          {medium.map((a) => <SecurityCard key={a.id} alert={a} onDismiss={() => handleDismiss(a.id!)} />)}
        </>
      )}
    </div>
  );
}
