import { useEffect, useRef, useState } from "react";
import { getActiveSentinels, dismissSentinel, dismissAllSentinels, daysUntilExpiry, updateSentinelExpiry, addManualAlert } from "../../service/ExpirySentinel";
import { db } from "../../data/InvoiceDatabase";
import { auth } from "../../data/AuthStore";
import { prefs } from "../../data/AutoImportPreferences";
import type { SentinelRecord, InvoiceMeta, LineItemRow } from "../../data/InvoiceDatabase";
import { detectBillIssues } from "../../service/BillFraudDetector";

const TYPE_ICON: Record<string, string> = {
  warranty:          "🛡️",
  insurance:         "📋",
  prescription:      "👓",
  service_interval:  "🔧",
  amc_renewal:       "🔧",
  agreement_expiry:       "📄",
  rent_agreement_expiry:  "🏠",
  gst_due:                "🧾",
  itr_filing:        "📝",
  membership_renewal:"🎓",
  software_renewal:  "💻",
  retainer_renewal:  "⚖️",
  custom:            "🔔",
};

const TYPE_LABEL: Record<string, string> = {
  warranty:          "Warranty",
  insurance:         "Insurance",
  prescription:      "Prescription",
  service_interval:  "Service Interval",
  amc_renewal:       "AMC Renewal",
  agreement_expiry:       "Agreement Expiry",
  rent_agreement_expiry:  "Rent Agreement",
  gst_due:                "GST Return Due",
  itr_filing:        "ITR Filing",
  membership_renewal:"Membership Renewal",
  software_renewal:  "Software Renewal",
  retainer_renewal:  "Retainer Renewal",
  custom:            "Custom",
};

const ALL_TYPES = Object.keys(TYPE_LABEL) as SentinelRecord["type"][];

const REMINDER_OPTIONS: { label: string; days: number | null }[] = [
  { label: "None", days: null },
  { label: "3d",   days: 3   },
  { label: "7d",   days: 7   },
  { label: "14d",  days: 14  },
  { label: "30d",  days: 30  },
  { label: "60d",  days: 60  },
];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function reminderDueKey(id: number): string {
  return `jinvoice:reminder-sent:${id}:${todayIso()}`;
}

function isReminderDue(s: SentinelRecord): boolean {
  if (s.reminderDays == null) return false;
  const d = daysUntilExpiry(s.expiresAt);
  return d >= 0 && d <= s.reminderDays;
}

async function sendReminderEmail(email: string, s: SentinelRecord): Promise<void> {
  const days = daysUntilExpiry(s.expiresAt);
  const when = days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} day${days !== 1 ? "s" : ""}`;
  const subject = `jInvoice Reminder: "${s.label}" expires ${when}`;
  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:40px auto;padding:28px;border:1px solid #e5e7eb;border-radius:12px">
      <h2 style="margin:0 0 6px;color:#111">⏰ Expiry Reminder</h2>
      <p style="margin:0 0 20px;color:#555;font-size:15px"><strong>${s.label}</strong> expires <strong>${when}</strong>.</p>
      <p style="margin:0 0 6px;color:#888;font-size:13px">Type: ${TYPE_LABEL[s.type] ?? s.type}</p>
      <p style="margin:0;color:#888;font-size:13px">Expires on: ${new Date(s.expiresAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</p>
      <hr style="margin:20px 0;border:none;border-top:1px solid #e5e7eb"/>
      <p style="margin:0;color:#aaa;font-size:12px">This reminder was set ${s.reminderDays} day${s.reminderDays !== 1 ? "s" : ""} before expiry in jInvoice.</p>
    </div>`;
  await fetch("/api/send-reminder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, subject, html }),
  });
}

function urgencyClass(days: number, reminderDue: boolean): string {
  if (reminderDue) return "sentinel-badge sentinel-badge--reminder";
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

function fileLabel(inv: InvoiceMeta | undefined): string | null {
  if (!inv?.sourceFilename) return null;
  return inv.sourceFilename.replace(/\.[^.]+$/, "");
}

interface AlertRow {
  record: SentinelRecord;
  inv?: InvoiceMeta;
  item: LineItemRow | null;
}

function AlertCard({ row, onDismiss, onExpiryChange }: {
  row: AlertRow;
  onDismiss: () => void;
  onExpiryChange: (newExpiry: string) => void;
}) {
  const { record, inv, item } = row;
  const [editing, setEditing] = useState(false);
  const [editDate, setEditDate] = useState(record.expiresAt);
  const [saving, setSaving] = useState(false);
  const days = daysUntilExpiry(record.expiresAt);
  const icon = TYPE_ICON[record.type] ?? "🔔";
  const isManual = record.invoiceId === 0;
  const reminderDue = isReminderDue(record);

  const label = fileLabel(inv);
  const productName = isManual
    ? record.label
    : (item?.name ?? label ?? inv?.subject ?? inv?.merchantName ?? record.label);

  const metaStyle: React.CSSProperties = { fontSize: 11.5, color: "var(--color-text-secondary)" };
  const labelStyle: React.CSSProperties = { fontSize: 10.5, fontWeight: 600, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.04em", marginRight: 3 };

  const cardStyle: React.CSSProperties = reminderDue
    ? { flexDirection: "column", gap: 4, alignItems: "stretch", borderLeft: "3px solid #ef4444", background: "rgba(239,68,68,0.06)" }
    : { flexDirection: "column", gap: 4, alignItems: "stretch" };

  const handleSave = async () => {
    if (!record.id || !editDate) return;
    setSaving(true);
    try {
      await updateSentinelExpiry(record.id, editDate);
      onExpiryChange(editDate);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="sentinel-card" style={cardStyle}>
      {/* Line 1: icon + name + urgency + edit + dismiss */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className="sentinel-icon" style={{ flexShrink: 0 }}>{icon}</span>
        <span className="sentinel-label" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={productName}>{productName}</span>
        <span className={urgencyClass(days, reminderDue)} style={{ flexShrink: 0, ...(reminderDue ? { background: "#ef4444", color: "#fff" } : {}) }}>{urgencyLabel(days)}</span>
        <button
          onClick={() => { setEditing(!editing); setEditDate(record.expiresAt); }}
          aria-label="Edit expiry"
          title="Edit expiry date"
          style={{ background: "none", border: "none", cursor: "pointer", padding: "2px 4px", fontSize: 13, color: "var(--color-text-secondary)", flexShrink: 0 }}
        >✏️</button>
        <button className="sentinel-dismiss" onClick={onDismiss} aria-label="Dismiss">✕</button>
      </div>
      {/* Line 2: Source + type */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, paddingLeft: 30, ...metaStyle }}>
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          <span style={labelStyle}>{isManual ? "Source" : "Merchant"}</span>
          {isManual ? "Manual entry" : (inv?.merchantName ?? "—")}
        </span>
        <span style={{ flexShrink: 0 }}>
          <span style={labelStyle}>Type</span>
          {record.type === "custom"
            ? (record.customType ?? "Custom")
            : (TYPE_LABEL[record.type] ?? record.type.replace(/_/g, " "))}
        </span>
      </div>
      {/* Line 3: Date info + Expiry */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, paddingLeft: 30, ...metaStyle }}>
        <span style={{ flex: 1 }}>
          <span style={labelStyle}>{isManual ? "Added" : "Purchased"}</span>
          {isManual ? formatDate(record.createdAt) : (inv ? formatDate(inv.invoiceDate ?? inv.createdAt) : "—")}
        </span>
        <span style={{ flexShrink: 0 }}>
          <span style={labelStyle}>Expiry</span>
          {formatDate(record.expiresAt)}
        </span>
      </div>
      {/* Line 4: Reminder info if set */}
      {record.reminderDays != null && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: 30, ...metaStyle }}>
          <span style={labelStyle}>Reminder</span>
          <span style={reminderDue ? { color: "#ef4444", fontWeight: 600 } : {}}>
            {record.reminderDays} day{record.reminderDays !== 1 ? "s" : ""} before expiry
            {reminderDue ? " 🔴 Due" : ""}
          </span>
        </div>
      )}
      {/* Inline edit row */}
      {editing && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: 30, paddingTop: 4 }}>
          <span style={{ ...labelStyle }}>New Expiry</span>
          <input
            type="date"
            value={editDate}
            onChange={(e) => setEditDate(e.target.value)}
            style={{
              fontSize: 12, padding: "3px 6px", borderRadius: 4,
              border: "1px solid var(--color-border)",
              background: "var(--color-surface)", color: "var(--color-text)",
            }}
          />
          <button
            onClick={handleSave}
            disabled={saving || !editDate}
            style={{
              fontSize: 12, padding: "3px 10px", borderRadius: 4, border: "none",
              background: "var(--color-primary)", color: "#fff", cursor: saving ? "wait" : "pointer",
              opacity: saving ? 0.7 : 1,
            }}
          >{saving ? "Saving…" : "Save"}</button>
          <button
            onClick={() => setEditing(false)}
            style={{
              fontSize: 12, padding: "3px 8px", borderRadius: 4,
              border: "1px solid var(--color-border)",
              background: "var(--color-surface)", color: "var(--color-text-secondary)", cursor: "pointer",
            }}
          >Cancel</button>
        </div>
      )}
    </div>
  );
}

const MONTH_OPTIONS = [1, 3, 6, 12, 18, 24, 36, 60];

function addMonths(dateStr: string, months: number): string {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

// Modal for manually adding an alert
function AddAlertModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [label, setLabel]             = useState("");
  const [type, setType]               = useState<SentinelRecord["type"]>("warranty");
  const [startDate, setStartDate]     = useState(todayIso());
  const [months, setMonths]           = useState<number | null>(null);
  const [reminderDays, setReminderDays] = useState<number | null>(null);
  const [saving, setSaving]           = useState(false);
  const [err, setErr]                 = useState<string | null>(null);
  const [fileOptions, setFileOptions] = useState<{ name: string; invoiceId: number }[]>([]);
  const [linkedInvoiceId, setLinkedInvoiceId] = useState(0);
  const [customType, setCustomType]   = useState("");
  const labelRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    labelRef.current?.focus();
    // Load unique file/invoice names from ViewScreen records, preserving invoice ID so renames propagate
    db.invoices.toArray().then((invs) => {
      const seen = new Map<string, number>();
      for (const inv of invs) {
        if (inv.status === "duplicate" || inv.id == null) continue;
        const name = inv.sourceFilename
          ? inv.sourceFilename.replace(/\.[^.]+$/, "")
          : inv.subject ?? inv.merchantName ?? null;
        if (name?.trim() && !seen.has(name.trim())) seen.set(name.trim(), inv.id);
      }
      setFileOptions(
        [...seen.entries()]
          .map(([name, invoiceId]) => ({ name, invoiceId }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
    });
  }, []);

  const expiryDate = startDate && months != null ? addMonths(startDate, months) : null;

  const handleLabelChange = (val: string) => {
    setLabel(val);
    setErr(null);
    // If the typed value exactly matches a datalist option, link the alert to that invoice
    const match = fileOptions.find((o) => o.name === val.trim());
    setLinkedInvoiceId(match ? match.invoiceId : 0);
  };

  const handleSubmit = async () => {
    if (!label.trim()) { setErr("Enter a description for this alert."); return; }
    if (!startDate)    { setErr("Select a start date."); return; }
    if (months == null){ setErr("Select a duration in months."); return; }
    if (type === "custom" && !customType.trim()) { setErr("Enter a name for your custom alert type."); return; }

    // Duplicate check
    const existing = await db.sentinelRecords.where("status").equals("active").toArray();
    const effectiveType = type === "custom" ? customType.trim().toLowerCase() : type;
    const isDuplicate = linkedInvoiceId > 0
      ? existing.some((s) => s.invoiceId === linkedInvoiceId && (s.type === type) && (type !== "custom" || s.customType?.toLowerCase() === effectiveType))
      : existing.some((s) => s.invoiceId === 0 && s.type === type && s.label.trim().toLowerCase() === label.trim().toLowerCase() && (type !== "custom" || s.customType?.toLowerCase() === effectiveType));
    if (isDuplicate) {
      const typeDisplay = type === "custom" ? customType.trim() : TYPE_LABEL[type];
      setErr(`An active "${typeDisplay}" alert already exists for this file. Dismiss the existing one first.`);
      return;
    }

    setSaving(true);
    try {
      await addManualAlert(label.trim(), type, expiryDate!, reminderDays ?? undefined, linkedInvoiceId, type === "custom" ? customType.trim() : undefined);
      onAdded();
      onClose();
    } catch {
      setErr("Failed to save alert. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "7px 10px", borderRadius: 6, fontSize: 13,
    border: "1px solid var(--color-border)",
    background: "var(--color-surface)", color: "var(--color-text)",
    boxSizing: "border-box",
  };
  const lblStyle: React.CSSProperties = {
    fontSize: 12, color: "var(--color-text-secondary)", display: "block", marginBottom: 5,
  };

  return (
    <div
      className="modal-overlay"
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
    >
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 420, width: "92%", padding: 24, borderRadius: 12, background: "var(--color-surface)", boxShadow: "0 8px 32px rgba(0,0,0,0.2)", maxHeight: "90vh", overflowY: "auto" }}
      >
        <h2 style={{ fontSize: 17, marginBottom: 18 }}>Add Alert</h2>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={lblStyle}>Description *</label>
            <input
              ref={labelRef}
              list="alert-files-datalist"
              style={inputStyle}
              placeholder="e.g. Samsung TV Warranty, Lift AMC, GST Q3"
              value={label}
              onChange={(e) => handleLabelChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
            />
            <datalist id="alert-files-datalist">
              {fileOptions.map((o) => <option key={o.invoiceId} value={o.name} />)}
            </datalist>
            {fileOptions.length > 0 && (
              <p style={{ fontSize: 11, color: "var(--color-text-tertiary)", margin: "4px 0 0" }}>
                {fileOptions.length} file{fileOptions.length !== 1 ? "s" : ""} from your records — type to search or pick one
                {linkedInvoiceId > 0 && " · linked ✓"}
              </p>
            )}
          </div>

          <div>
            <label style={lblStyle}>Alert type *</label>
            <select
              style={{ ...inputStyle, cursor: "pointer" }}
              value={type}
              onChange={(e) => { setType(e.target.value as SentinelRecord["type"]); setErr(null); }}
            >
              {ALL_TYPES.filter((t) => t !== "custom").map((t) => (
                <option key={t} value={t}>{TYPE_ICON[t]} {TYPE_LABEL[t]}</option>
              ))}
              <option value="custom">🔔 Custom…</option>
            </select>
            {type === "custom" && (
              <input
                style={{ ...inputStyle, marginTop: 8 }}
                placeholder="e.g. Car Insurance, Gym Membership, TV Licence"
                value={customType}
                onChange={(e) => { setCustomType(e.target.value); setErr(null); }}
                onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
              />
            )}
          </div>

          <div>
            <label style={lblStyle}>Start date (purchase / invoice date) *</label>
            <input
              type="date"
              style={inputStyle}
              value={startDate}
              onChange={(e) => { setStartDate(e.target.value); setErr(null); }}
            />
          </div>

          <div>
            <label style={lblStyle}>Duration *</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {MONTH_OPTIONS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => { setMonths(m); setErr(null); }}
                  style={{
                    padding: "5px 11px", borderRadius: 6, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                    border: months === m ? "none" : "1px solid var(--color-border)",
                    background: months === m ? "#7c3aed" : "var(--color-surface-2)",
                    color: months === m ? "#fff" : "var(--color-text)",
                  }}
                >
                  {m < 12 ? `${m}m` : `${m / 12}y`}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label style={lblStyle}>Remind me before expiry</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {REMINDER_OPTIONS.map((opt) => (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => setReminderDays(opt.days)}
                  style={{
                    padding: "5px 11px", borderRadius: 6, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                    border: reminderDays === opt.days ? "none" : "1px solid var(--color-border)",
                    background: reminderDays === opt.days ? (opt.days == null ? "#6b7280" : "#ef4444") : "var(--color-surface-2)",
                    color: reminderDays === opt.days ? "#fff" : "var(--color-text)",
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {reminderDays != null && (
              <p style={{ fontSize: 11, color: "var(--color-text-tertiary)", margin: "4px 0 0" }}>
                You'll get an email reminder {reminderDays} day{reminderDays !== 1 ? "s" : ""} before it expires.
              </p>
            )}
          </div>

          {expiryDate && (
            <div style={{ fontSize: 12.5, color: "var(--color-text-secondary)", background: "var(--color-surface-2)", padding: "7px 12px", borderRadius: 6 }}>
              Expires on: <strong style={{ color: "var(--color-text)" }}>
                {new Date(expiryDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
              </strong>
              {reminderDays != null && expiryDate && (
                <> · Reminder: <strong style={{ color: "var(--color-text)" }}>
                  {new Date(new Date(expiryDate).getTime() - reminderDays * 86400000).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                </strong></>
              )}
            </div>
          )}
        </div>

        {err && (
          <p style={{ fontSize: 12, color: "#ef4444", marginTop: 10 }}>{err}</p>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 20, justifyContent: "flex-end" }}>
          <button className="btn-ghost" onClick={onClose} style={{ fontSize: 13 }}>Cancel</button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            style={{
              padding: "6px 18px", borderRadius: 6, fontSize: 13, fontWeight: 600,
              border: "none", background: "var(--color-primary)", color: "#fff",
              cursor: saving ? "wait" : "pointer", opacity: saving ? 0.7 : 1,
            }}
          >{saving ? "Saving…" : "Add Alert"}</button>
        </div>
      </div>
    </div>
  );
}

export function AlertsScreen() {
  const [records, setRecords] = useState<SentinelRecord[]>([]);
  const [invoiceMap, setInvoiceMap] = useState<Map<number, InvoiceMeta>>(new Map());
  const [lineItemMap, setLineItemMap] = useState<Map<number, LineItemRow[]>>(new Map());
  const [loaded, setLoaded]       = useState(false);
  const [query, setQuery]         = useState("");
  const [showAddModal, setShowAddModal] = useState(false);

  const load = async () => {
    const data = await getActiveSentinels();
    const ids = [...new Set(data.map((r) => r.invoiceId).filter((id) => id > 0))];
    const invs = await db.invoices.bulkGet(ids);
    const map = new Map<number, InvoiceMeta>();
    invs.forEach((inv) => { if (inv?.id != null) map.set(inv.id, inv); });

    const liMap = new Map<number, LineItemRow[]>();
    await Promise.all(ids.map(async (id) => {
      const items = await db.lineItems.where("invoiceId").equals(id).toArray();
      if (items.length > 0) liMap.set(id, items);
    }));

    // Exclude alerts linked to duplicate invoices
    const duplicateIds = new Set<number>();
    for (const inv of map.values()) {
      const issues = await detectBillIssues(inv);
      if (issues.some((issue) => issue.type === "duplicate")) duplicateIds.add(inv.id!);
    }
    const active = data.filter((r) => r.invoiceId === 0 || !duplicateIds.has(r.invoiceId));
    setRecords(active);
    setInvoiceMap(map);
    setLineItemMap(liMap);
    setLoaded(true);

    // Check for due reminders and send email notification
    const email = auth.email ?? prefs.gmailEmail ?? null;
    if (email) {
      for (const s of active) {
        if (!isReminderDue(s) || !s.id) continue;
        const key = reminderDueKey(s.id);
        if (localStorage.getItem(key)) continue;
        try {
          await sendReminderEmail(email, s);
          localStorage.setItem(key, "1");
        } catch {
          // silent — don't block the load if email fails
        }
      }
    }
  };

  useEffect(() => {
    load();
    window.addEventListener("jinvoice:sync-complete", load);
    return () => window.removeEventListener("jinvoice:sync-complete", load);
  }, []);

  const handleDismiss = async (id: number) => {
    await dismissSentinel(id);
    setRecords((prev) => prev.filter((r) => r.id !== id));
    window.dispatchEvent(new Event("jinvoice:alerts-changed"));
  };

  const handleClearAll = async () => {
    await dismissAllSentinels();
    setRecords([]);
    window.dispatchEvent(new Event("jinvoice:alerts-changed"));
  };

  if (!loaded) return null;

  if (records.length === 0) {
    return (
      <>
        <div className="placeholder-screen">
          <span>🛡️</span>
          <p>No active alerts</p>
          <p style={{ fontSize: 13 }}>Warranty, AMC, agreement, GST, membership, and policy renewal reminders appear here.</p>
          <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "center" }}>
            <button className="btn-sm" onClick={load}>Refresh</button>
            <button className="btn-sm" onClick={() => setShowAddModal(true)}>+ Add Alert</button>
          </div>
        </div>
        {showAddModal && <AddAlertModal onClose={() => setShowAddModal(false)} onAdded={load} />}
      </>
    );
  }

  function expandRows(sentinels: SentinelRecord[]): AlertRow[] {
    const rows: AlertRow[] = [];
    for (const r of sentinels) {
      if (r.invoiceId === 0) {
        rows.push({ record: r, inv: undefined, item: null });
        continue;
      }
      const inv = invoiceMap.get(r.invoiceId);
      const items = lineItemMap.get(r.invoiceId) ?? [];
      const positiveItems = items.filter((i) => i.totalPricePaise > 0);
      const primaryItem = positiveItems.reduce<typeof items[number] | undefined>(
        (best, i) => (!best || i.totalPricePaise > best.totalPricePaise ? i : best),
        undefined,
      );
      rows.push({ record: r, inv, item: primaryItem ?? items[0] ?? null });
    }
    return rows;
  }

  const matchesQuery = (r: SentinelRecord): boolean => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    const inv = invoiceMap.get(r.invoiceId);
    const items = lineItemMap.get(r.invoiceId) ?? [];
    return (
      r.label?.toLowerCase().includes(q) ||
      inv?.subject?.toLowerCase().includes(q) ||
      inv?.sourceFilename?.toLowerCase().includes(q) ||
      inv?.merchantName?.toLowerCase().includes(q) ||
      items.some((li) => li.name.toLowerCase().includes(q)) ||
      false
    );
  };

  const visible = records.filter(matchesQuery);
  // Reminder-due alerts always sort to top
  const reminderDue = expandRows(visible.filter((r) => isReminderDue(r)));
  const expired = expandRows(visible.filter((r) => !isReminderDue(r) && daysUntilExpiry(r.expiresAt) < 0));
  const active  = expandRows(visible.filter((r) => !isReminderDue(r) && daysUntilExpiry(r.expiresAt) >= 0));

  return (
    <>
    <div className="sentinel-screen">
      <div className="invoice-list-header">
        <h2>Expiry Alerts</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
            {visible.length}{query.trim() ? `/${records.length}` : ""} active
          </span>
          <button className="btn-sm" onClick={() => setShowAddModal(true)}>+ Add</button>
          <button className="btn-sm" onClick={load}>Refresh</button>
          <button className="btn-sm btn-danger" onClick={handleClearAll}>Clear All</button>
        </div>
      </div>

      <input
        className="view-search"
        type="search"
        placeholder="Search item, merchant, file, sender…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ marginBottom: 10 }}
      />

      {visible.length === 0 && query.trim() && (
        <p style={{ fontSize: 13, color: "var(--color-text-secondary)", textAlign: "center", marginTop: 24 }}>
          No results for "{query}"
        </p>
      )}

      {reminderDue.length > 0 && (
        <>
          <div className="sentinel-section-label" style={{ color: "#ef4444" }}>🔴 Reminder Due</div>
          {reminderDue.map((row, i) => (
            <AlertCard
              key={`${row.record.id}-reminder-${i}`}
              row={row}
              onDismiss={() => handleDismiss(row.record.id!)}
              onExpiryChange={(newExpiry) => {
                setRecords((prev) => prev.map((r) =>
                  r.id === row.record.id ? { ...r, expiresAt: newExpiry } : r
                ));
              }}
            />
          ))}
        </>
      )}

      {active.length > 0 && (
        <>
          {active.map((row, i) => (
            <AlertCard
              key={`${row.record.id}-${i}`}
              row={row}
              onDismiss={() => handleDismiss(row.record.id!)}
              onExpiryChange={(newExpiry) => {
                setRecords((prev) => prev.map((r) =>
                  r.id === row.record.id ? { ...r, expiresAt: newExpiry } : r
                ));
              }}
            />
          ))}
        </>
      )}

      {expired.length > 0 && (
        <>
          <div className="sentinel-section-label">Expired</div>
          {expired.map((row, i) => (
            <AlertCard
              key={`${row.record.id}-${i}`}
              row={row}
              onDismiss={() => handleDismiss(row.record.id!)}
              onExpiryChange={(newExpiry) => {
                setRecords((prev) => prev.map((r) =>
                  r.id === row.record.id ? { ...r, expiresAt: newExpiry } : r
                ));
              }}
            />
          ))}
        </>
      )}
    </div>
    {showAddModal && <AddAlertModal onClose={() => setShowAddModal(false)} onAdded={load} />}
    </>
  );
}
