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

function formatSource(src: string): string {
  switch (src) {
    case "gmail":          return "Gmail";
    case "outlook":        return "Outlook";
    case "manual_upload":  return "Manual";
    case "desktop_folder": return "Desktop";
    default:               return src;
  }
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function AlertCard({ record, inv, onDismiss }: { record: SentinelRecord; inv?: InvoiceMeta; onDismiss: () => void }) {
  const days = daysUntilExpiry(record.expiresAt);
  const icon = TYPE_ICON[record.type] ?? "🔔";

  return (
    <div className="sentinel-card">
      <div className="sentinel-card-left">
        <span className="sentinel-icon">{icon}</span>
        <div className="sentinel-info">
          <div className="sentinel-label">{record.label}</div>
          <div className="sentinel-date">
            {new Date(record.expiresAt).toLocaleDateString("en-IN", {
              day: "numeric", month: "short", year: "numeric",
            })}
          </div>
          {inv && (
            <div className="sentinel-meta">
              <span className="sentinel-meta-item">{formatSource(inv.importSource)}</span>
              {inv.senderEmail && <span className="sentinel-meta-item">{inv.senderEmail}</span>}
              {(inv.receivedAt || inv.createdAt) && (
                <span className="sentinel-meta-item">{formatDate(inv.receivedAt ?? inv.createdAt)}</span>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="sentinel-card-right">
        <span className={urgencyClass(days)}>{urgencyLabel(days)}</span>
        <button className="sentinel-dismiss" onClick={onDismiss} aria-label="Dismiss">
          ✕
        </button>
      </div>
    </div>
  );
}

export function AlertsScreen() {
  const [records, setRecords] = useState<SentinelRecord[]>([]);
  const [invoiceMap, setInvoiceMap] = useState<Map<number, InvoiceMeta>>(new Map());
  const [loaded, setLoaded]   = useState(false);

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
      </div>
    );
  }

  const expired = records.filter((r) => daysUntilExpiry(r.expiresAt) < 0);
  const active  = records.filter((r) => daysUntilExpiry(r.expiresAt) >= 0);

  return (
    <div className="sentinel-screen">
      <div className="invoice-list-header">
        <h2>Expiry Alerts</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>{records.length} active</span>
          <button className="btn-sm btn-danger" onClick={handleClearAll}>Clear All</button>
        </div>
      </div>

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
