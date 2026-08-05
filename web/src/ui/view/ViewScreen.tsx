import { useEffect, useState } from "react";
import { db, type InvoiceMeta } from "../../data/InvoiceDatabase";

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function formatAmount(paise: number | null): string {
  if (paise == null) return "—";
  return `₹${(paise / 100).toFixed(2)}`;
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

function statusColor(status: string): string {
  switch (status) {
    case "imported":           return "#22c55e";
    case "pending_review":     return "#f59e0b";
    case "downloaded":         return "#3b82f6";
    case "import_blocked_encrypted":
    case "extraction_failed":  return "#ef4444";
    default:                   return "#6b7280";
  }
}

function statusText(status: string): string {
  switch (status) {
    case "imported":                  return "Imported";
    case "pending_review":            return "Needs Review";
    case "downloaded":                return "Downloaded";
    case "import_blocked_encrypted":  return "Encrypted";
    case "extraction_failed":         return "Failed";
    default:                          return status;
  }
}

type SortKey = "newest" | "oldest" | "amount_desc" | "amount_asc" | "name";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "newest",      label: "Newest first" },
  { value: "oldest",      label: "Oldest first" },
  { value: "amount_desc", label: "Amount: high to low" },
  { value: "amount_asc",  label: "Amount: low to high" },
  { value: "name",        label: "Name A–Z" },
];

function sortRecords(records: InvoiceMeta[], key: SortKey): InvoiceMeta[] {
  const copy = [...records];
  switch (key) {
    case "newest":
      return copy.sort((a, b) => {
        const da = a.createdAt ?? ""; const db = b.createdAt ?? "";
        return db > da ? 1 : db < da ? -1 : 0;
      });
    case "oldest":
      return copy.sort((a, b) => {
        const da = a.createdAt ?? ""; const db = b.createdAt ?? "";
        return da > db ? 1 : da < db ? -1 : 0;
      });
    case "amount_desc":
      return copy.sort((a, b) => (b.grandTotalPaise ?? -1) - (a.grandTotalPaise ?? -1));
    case "amount_asc":
      return copy.sort((a, b) => (a.grandTotalPaise ?? Infinity) - (b.grandTotalPaise ?? Infinity));
    case "name":
      return copy.sort((a, b) => {
        const na = (a.merchantName ?? a.sourceFilename ?? "").toLowerCase();
        const nb = (b.merchantName ?? b.sourceFilename ?? "").toLowerCase();
        return na < nb ? -1 : na > nb ? 1 : 0;
      });
  }
}

function matchesQuery(rec: InvoiceMeta, q: string): boolean {
  const lq = q.toLowerCase();
  return (
    rec.merchantName?.toLowerCase().includes(lq) ||
    rec.sourceFilename?.toLowerCase().includes(lq) ||
    rec.subject?.toLowerCase().includes(lq) ||
    rec.senderEmail?.toLowerCase().includes(lq) ||
    rec.category?.toLowerCase().includes(lq) ||
    rec.importSource.toLowerCase().includes(lq) ||
    false
  );
}

export function ViewScreen() {
  const [records, setRecords] = useState<InvoiceMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<SortKey>("newest");
  const [query, setQuery] = useState("");

  const load = () => {
    setLoading(true);
    db.invoices.orderBy("id").reverse().limit(200).toArray()
      .then(setRecords)
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    window.addEventListener("jinvoice:sync-complete", load);
    return () => window.removeEventListener("jinvoice:sync-complete", load);
  }, []);

  if (loading) return <div className="placeholder-screen"><p>Loading…</p></div>;

  if (records.length === 0) {
    return (
      <div className="placeholder-screen">
        <span>📋</span>
        <p>No files imported yet.</p>
      </div>
    );
  }

  const filtered = query.trim() ? records.filter((r) => matchesQuery(r, query.trim())) : records;
  const sorted   = sortRecords(filtered, sortBy);

  return (
    <div className="invoice-list">
      <div className="invoice-list-header">
        <h2>All Files</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
            {sorted.length}{query.trim() ? `/${records.length}` : ""} records
          </span>
          <button className="btn-sm" onClick={load} disabled={loading}>Refresh</button>
        </div>
      </div>
      <input
        className="view-search"
        type="search"
        placeholder="Search merchant, subject, sender…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="view-sort-row">
        <span className="view-sort-label">Sort</span>
        <select
          className="view-sort-select"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortKey)}
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
      {sorted.length === 0 && (
        <p style={{ fontSize: 13, color: "var(--color-text-secondary)", textAlign: "center", marginTop: 32 }}>
          No results for "{query}"
        </p>
      )}
      {sorted.map((rec) => (
        <div key={rec.id} className="view-card">
          <div className="view-card-top">
            <span className="view-card-title">
              {rec.merchantName ?? rec.sourceFilename ?? "Unknown"}
            </span>
            <span className="view-card-amount">{formatAmount(rec.grandTotalPaise)}</span>
          </div>
          <div className="view-card-chips">
            <span className="view-chip view-chip--source">{formatSource(rec.importSource)}</span>
            {(rec.docTypes ?? (rec.docType ? [rec.docType] : [])).map((dt) => (
              <span key={dt} className="view-chip view-chip--doctype">{dt}</span>
            ))}
            {rec.category && (
              <span className="view-chip view-chip--category">{rec.category.replace(/_/g, " ")}</span>
            )}
            <span className="view-chip" style={{ color: statusColor(rec.status), borderColor: statusColor(rec.status) }}>
              {statusText(rec.status)}
            </span>
          </div>
          {rec.subject && (
            <div className="view-card-row">
              <span className="view-card-label">Subject</span>
              <span className="view-card-value view-card-value--truncate">{rec.subject}</span>
            </div>
          )}
          {rec.senderEmail && (
            <div className="view-card-row">
              <span className="view-card-label">Sender</span>
              <span className="view-card-value view-card-value--truncate">{rec.senderEmail}</span>
            </div>
          )}
          <div className="view-card-row">
            <span className="view-card-label">Received</span>
            <span className="view-card-value">
              {rec.receivedAt ? formatDate(rec.receivedAt) : formatDate(rec.createdAt)}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
