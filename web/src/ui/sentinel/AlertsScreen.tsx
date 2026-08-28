import { useEffect, useState } from "react";
import { getActiveSentinels, dismissSentinel, dismissAllSentinels, daysUntilExpiry } from "../../service/ExpirySentinel";
import { db } from "../../data/InvoiceDatabase";
import type { SentinelRecord, InvoiceMeta } from "../../data/InvoiceDatabase";

const TYPE_ICON: Record<string, string> = {
  warranty: "🛡️",
  insurance: "📋",
  prescription: "👓",
  service_interval: "🔧",
};

function urgencyClass(days: number): string {
  if (days < 0)   return "sentinel-badge sentinel-badge--expired";
  if (days <= 30) return "sentinel-badge sentinel-badge--urgent";
  if (days <= 90) return "sentinel-badge sentinel-badge--soon";
  return "sentinel-badge sentinel-badge--ok";
}

function urgencyLabel(days: number): string {
  if (days < 0)  return `Expired ${Math.abs(days)}d ago`;
  if (days === 0) return "Expires today";
  if (days === 1) return "Expires tomorrow";
  return `${days} days left`;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function AlertCard({ record, inv, onDismiss }: { record: SentinelRecord; inv?: InvoiceMeta; onDismiss: () => void }) {
  const days = daysUntilExpiry(record.expiresAt);
  const icon = TYPE_ICON[record.type] ?? "🔔";
  const title = inv?.subject ?? record.label;
  const metaStyle: React.CSSProperties = { fontSize: 11.5, color: "var(--color-text-secondary)" };
  const labelStyle: React.CSSProperties = { fontSize: 10.5, fontWeight: 600, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.04em", marginRight: 3 };

  return (
    <div className="sentinel-card" style={{ flexDirection: "column", gap: 4, alignItems: "stretch" }}>
      {/* Line 1: icon + subject/title + urgency badge + dismiss */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className="sentinel-icon" style={{ flexShrink: 0 }}>{icon}</span>
        <span className="sentinel-label" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
        <span className={urgencyClass(days)} style={{ flexShrink: 0 }}>{urgencyLabel(days)}</span>
        <button className="sentinel-dismiss" onClick={onDismiss} aria-label="Dismiss">✕</button>
      </div>
      {/* Line 2: File name + sender */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, paddingLeft: 30, ...metaStyle }}>
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          <span style={labelStyle}>File</span>
          {inv?.sourceFilename ?? record.label}
        </span>
        <span style={{ flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "45%" }}>
          <span style={labelStyle}>Sender</span>{inv?.senderEmail ?? "—"}
        </span>
      </div>
      {/* Line 3: Received + Expiry */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, paddingLeft: 30, ...metaStyle }}>
        <span style={{ flex: 1 }}>
          <span style={labelStyle}>Received</span>
          {inv ? formatDate(inv.receivedAt ?? inv.createdAt) : "—"}
        </span>
        <span style={{ flexShrink: 0 }}>
          <span style={labelStyle}>Expiry</span>
          {formatDate(record.expiresAt)}
        </span>
      </div>
    </div>
  );
}

export function AlertsScreen() {
  const [records, setRecords] = useState<SentinelRecord[]>([]);
  const [invoiceMap, setInvoiceMap] = useState<Map<number, InvoiceMeta>>(new Map());
  const [loaded, setLoaded]   = useState(false);
  const [query, setQuery]     = useState("");

  const load = async () => {
    const data = await getActiveSentinels();
    setRecords(data);
    const ids = [...new Set(data.map((r) => r.invoiceId))];
    const invs = await db.invoices.bulkGet(ids);
    const map = new Map<number, InvoiceMeta>();
    invs.forEach((inv) => { if (inv?.id != null) map.set(inv.id, inv); });
    setInvoiceMap(map);
    setLoaded(true);
  };

  useEffect(() => {
    load();
    window.addEventListener("jinvoice:sync-complete", load);
    return () => window.removeEventListener("jinvoice:sync-complete", load);
  }, []);

  const handleDismiss = async (id: number) => {
    await dismissSentinel(id);
    setRecords((prev) => prev.filter((r) => r.id !== id));
  };

  const handleClearAll = async () => {
    await dismissAllSentinels();
    setRecords([]);
  };

  if (!loaded) return null;

  if (records.length === 0) {
    return (
      <div className="placeholder-screen">
        <span>🛡️</span>
        <p>No active alerts</p>
        <p style={{ fontSize: 13 }}>Warranty and policy expiry reminders appear here.</p>
        <button className="btn-sm" style={{ marginTop: 12 }} onClick={load}>Refresh</button>
      </div>
    );
  }

  const matchesQuery = (r: SentinelRecord): boolean => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    const inv = invoiceMap.get(r.invoiceId);
    return (
      r.label?.toLowerCase().includes(q) ||
      inv?.subject?.toLowerCase().includes(q) ||
      inv?.sourceFilename?.toLowerCase().includes(q) ||
      inv?.senderEmail?.toLowerCase().includes(q) ||
      false
    );
  };

  const visible  = records.filter(matchesQuery);
  const expired  = visible.filter((r) => daysUntilExpiry(r.expiresAt) < 0);
  const active   = visible.filter((r) => daysUntilExpiry(r.expiresAt) >= 0);

  return (
    <div className="sentinel-screen">
      <div className="invoice-list-header">
        <h2>Expiry Alerts</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
            {visible.length}{query.trim() ? `/${records.length}` : ""} active
          </span>
          <button className="btn-sm" onClick={load}>Refresh</button>
          <button className="btn-sm btn-danger" onClick={handleClearAll}>Clear All</button>
        </div>
      </div>

      <input
        className="view-search"
        type="search"
        placeholder="Search subject, file, sender…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ marginBottom: 10 }}
      />

      {visible.length === 0 && query.trim() && (
        <p style={{ fontSize: 13, color: "var(--color-text-secondary)", textAlign: "center", marginTop: 24 }}>
          No results for "{query}"
        </p>
      )}

      {active.length > 0 && (
        <>
          {active.map((r) => (
            <AlertCard key={r.id} record={r} inv={invoiceMap.get(r.invoiceId)} onDismiss={() => handleDismiss(r.id!)} />
          ))}
        </>
      )}

      {expired.length > 0 && (
        <>
          <div className="sentinel-section-label">Expired</div>
          {expired.map((r) => (
            <AlertCard key={r.id} record={r} inv={invoiceMap.get(r.invoiceId)} onDismiss={() => handleDismiss(r.id!)} />
          ))}
        </>
      )}
    </div>
  );
}
