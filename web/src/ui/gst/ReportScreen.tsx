import React, { useCallback, useEffect, useState, useMemo } from "react";
import { GSTReportScreen } from "./GSTReportScreen";
import { db, type InvoiceMeta } from "../../data/InvoiceDatabase";
import { prefs } from "../../data/AutoImportPreferences";

type ReportTab = "gst" | "period" | "vendor" | "tags" | "category"
               | "summary" | "personal_budget" | "personal_tax"
               | "society_ledger" | "society_audit";
type PeriodView = "daily" | "monthly" | "quarterly" | "yearly" | "custom";

// ── formatting ────────────────────────────────────────────────────────────────

function fmtRupee(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtShort(paise: number): string {
  const inr = paise / 100;
  if (inr >= 10_00_000) return `₹${(inr / 10_00_000).toFixed(2)}Cr`;
  if (inr >= 1_00_000)  return `₹${(inr / 1_00_000).toFixed(2)}L`;
  if (inr >= 1_000)     return `₹${(inr / 1_000).toFixed(1)}K`;
  return `₹${inr.toFixed(0)}`;
}
function pct(part: number, total: number): string {
  return total ? `${Math.round((part / total) * 100)}%` : "0%";
}

// ── utilities ─────────────────────────────────────────────────────────────────

function downloadCSV(filename: string, rows: (string | number)[][]): void {
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function recDate(r: InvoiceMeta): Date | null {
  const s = r.invoiceDate ?? r.createdAt;
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function availableYears(records: InvoiceMeta[]): number[] {
  const ys = new Set<number>();
  for (const r of records) { const d = recDate(r); if (d) ys.add(d.getFullYear()); }
  return [...ys].sort((a, b) => b - a);
}

function filterByYear(records: InvoiceMeta[], year: number | null): InvoiceMeta[] {
  if (year === null) return records;
  return records.filter(r => { const d = recDate(r); return d ? d.getFullYear() === year : false; });
}

function useInvoices() {
  const [records, setRecords] = useState<InvoiceMeta[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    db.invoices.toArray().then(rows =>
      setRecords(rows.filter(r =>
        r.grandTotalPaise != null &&
        r.status !== "extraction_failed" &&
        r.status !== "import_blocked_encrypted"
      ))
    ).catch(console.error)
     .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    window.addEventListener("jinvoice:sync-complete", load);
    window.addEventListener("jinvoice:tags-changed", load);
    return () => {
      window.removeEventListener("jinvoice:sync-complete", load);
      window.removeEventListener("jinvoice:tags-changed", load);
    };
  }, [load]);

  return { records, loading };
}

// ── drill-down panel ──────────────────────────────────────────────────────────

function TagCell({ rec }: { rec: InvoiceMeta }) {
  const [tags, setTags] = useState<string[]>(rec.clientTags ?? []);
  const [input, setInput] = useState("");
  const knownTags = prefs.clientTags;

  const addTag = async (tag: string) => {
    const t = tag.trim();
    if (!t || tags.includes(t)) return;
    const next = [...tags, t];
    setTags(next);
    setInput("");
    await db.invoices.update(rec.id!, { clientTags: next, updatedAt: new Date().toISOString() });
    if (!knownTags.includes(t)) prefs.clientTags = [...knownTags, t].sort();
    window.dispatchEvent(new CustomEvent("jinvoice:tags-changed"));
  };

  const removeTag = async (tag: string) => {
    const next = tags.filter((t) => t !== tag);
    setTags(next);
    await db.invoices.update(rec.id!, { clientTags: next, updatedAt: new Date().toISOString() });
    window.dispatchEvent(new CustomEvent("jinvoice:tags-changed"));
  };

  return (
    <td style={{ padding: "5px 10px", minWidth: 150 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
        {tags.map((t) => (
          <span key={t} style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, background: "color-mix(in srgb, var(--color-primary) 12%, transparent)", color: "var(--color-primary)", borderRadius: 4, padding: "1px 6px", fontWeight: 600 }}>
            {t}
            <button onClick={() => removeTag(t)} style={{ fontSize: 10, background: "none", border: "none", cursor: "pointer", color: "var(--color-primary)", padding: 0, lineHeight: 1 }}>×</button>
          </span>
        ))}
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(input); } }}
          onBlur={() => { if (input.trim()) addTag(input); }}
          placeholder="+ tag"
          style={{ fontSize: 11, width: 60, border: "none", background: "transparent", color: "var(--color-text-secondary)", outline: "none", cursor: "text" }}
        />
      </div>
    </td>
  );
}

function DrillDownPanel({ records, onClose }: { records: InvoiceMeta[]; onClose: () => void }) {
  if (records.length === 0) return null;
  return (
    <tr>
      <td colSpan={99} style={{ padding: 0, background: "var(--color-surface-2)" }}>
        <div style={{ padding: "10px 16px 14px", borderTop: "1px solid var(--color-primary)", borderBottom: "1px solid var(--color-border)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--color-primary)", textTransform: "uppercase", letterSpacing: "0.07em" }}>
              {records.length} Invoice{records.length > 1 ? "s" : ""}
            </span>
            <button onClick={onClose} style={{ fontSize: 12, color: "var(--color-text-tertiary)", background: "none", border: "none", cursor: "pointer", padding: "2px 6px" }}>✕ Close</button>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Date", "Vendor", "Invoice #", "Amount", "Tax", "Tags"].map((h, i) => (
                    <th key={h} style={{ fontSize: 10, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em", padding: "4px 10px", textAlign: i >= 3 && i <= 4 ? "right" : "left", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...records].sort((a, b) => (b.invoiceDate ?? b.createdAt ?? "").localeCompare(a.invoiceDate ?? a.createdAt ?? "")).map((r, i) => (
                  <tr key={r.id ?? i} style={{ borderTop: "1px solid var(--color-border)" }}>
                    <td style={{ fontSize: 11.5, color: "var(--color-text-secondary)", padding: "5px 10px", whiteSpace: "nowrap" }}>
                      {r.invoiceDate ? new Date(r.invoiceDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" }) : "—"}
                    </td>
                    <td style={{ fontSize: 11.5, color: "var(--color-text)", padding: "5px 10px", maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.merchantName ?? "Unknown"}</td>
                    <td style={{ fontSize: 11, color: "var(--color-text-secondary)", padding: "5px 10px", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.invoiceNumber ?? "—"}</td>
                    <td style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text)", padding: "5px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{fmtRupee(r.grandTotalPaise ?? 0)}</td>
                    <td style={{ fontSize: 11.5, color: "var(--color-text-secondary)", padding: "5px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{r.taxPaise ? fmtRupee(r.taxPaise) : "—"}</td>
                    <TagCell rec={r} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </td>
    </tr>
  );
}

// ── shared UI ─────────────────────────────────────────────────────────────────

function ClientFilterRow({ records, filterClient, setFilterClient }: {
  records: InvoiceMeta[];
  filterClient: string | null;
  setFilterClient: (c: string | null) => void;
}) {
  const allClients = useMemo(
    () => [...new Set(records.flatMap((r) => r.clientTags ?? []))].sort(),
    [records]
  );
  if (allClients.length === 0) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
      <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>Client</span>
      <button onClick={() => setFilterClient(null)}
        style={{ fontSize: 12, padding: "3px 10px", borderRadius: 20, border: "1.5px solid",
          borderColor: filterClient == null ? "var(--color-primary)" : "var(--color-border)",
          background:  filterClient == null ? "var(--accent-subtle)" : "transparent",
          color:       filterClient == null ? "var(--color-primary)" : "var(--color-text-secondary)", cursor: "pointer" }}>All</button>
      {allClients.map((c) => (
        <button key={c} onClick={() => setFilterClient(c === filterClient ? null : c)}
          style={{ fontSize: 12, padding: "3px 10px", borderRadius: 20, border: "1.5px solid",
            borderColor: filterClient === c ? "#0891b2" : "var(--color-border)",
            background:  filterClient === c ? "#ecfeff" : "transparent",
            color:       filterClient === c ? "#0891b2" : "var(--color-text-secondary)", cursor: "pointer" }}>
          {c}
        </button>
      ))}
    </div>
  );
}

function chipStyle(active: boolean): React.CSSProperties {
  return {
    fontSize: 12.5, padding: "5px 14px", borderRadius: 20, border: "1.5px solid",
    borderColor: active ? "var(--color-primary)" : "var(--color-border)",
    background:  active ? "var(--accent-subtle)" : "transparent",
    color:       active ? "var(--color-primary)" : "var(--color-text-secondary)",
    cursor: "pointer", fontWeight: active ? 700 : 400,
  };
}

function YearRow({ years, year, setYear }: { years: number[]; year: number | null; setYear: (y: number | null) => void }) {
  if (years.length <= 1) return null;
  return (
    <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 14 }}>
      <button style={chipStyle(year === null)} onClick={() => setYear(null)}>All Years</button>
      {years.map(y => <button key={y} style={chipStyle(year === y)} onClick={() => setYear(y)}>{y}</button>)}
    </div>
  );
}

function BarRow({ label, value, max }: { label: string; value: number; max: number }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "130px 1fr 90px", alignItems: "center", gap: 8 }}>
      <div style={{ fontSize: 11, color: "var(--color-text-secondary)", textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={label}>{label}</div>
      <div style={{ background: "var(--color-surface-2)", borderRadius: 4, height: 18, overflow: "hidden" }}>
        <div style={{ height: "100%", borderRadius: 4, width: `${Math.round((value / max) * 100)}%`, background: "var(--color-primary)", minWidth: value > 0 ? 4 : 0, transition: "width 0.3s ease" }} />
      </div>
      <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--color-text)", fontVariantNumeric: "tabular-nums", textAlign: "right" }}>{fmtShort(value)}</div>
    </div>
  );
}

function CsvButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ fontSize: 12, padding: "6px 14px", borderRadius: 8, border: "1.5px solid var(--color-border)", background: "transparent", color: "var(--color-text-secondary)", cursor: "pointer" }}>
      ↓ Download CSV
    </button>
  );
}

function SummaryCards({ cards }: { cards: { label: string; value: string; color?: string }[] }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 20 }}>
      {cards.map(({ label, value, color }) => (
        <div key={label} style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10, padding: "12px 14px" }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 5 }}>{label}</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: color ?? "var(--color-text)", fontVariantNumeric: "tabular-nums" }}>{value}</div>
        </div>
      ))}
    </div>
  );
}

// ── Period Report ─────────────────────────────────────────────────────────────

function quarterKey(d: Date): string {
  return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
}
function toDateKey(d: Date, view: PeriodView): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  if (view === "monthly")   return `${y}-${m}`;
  if (view === "quarterly") return quarterKey(d);
  if (view === "yearly")    return `${y}`;
  return `${y}-${m}-${day}`;
}
function periodLabel(k: string, view: PeriodView): string {
  if (view === "monthly") {
    const [y, m] = k.split("-");
    return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
  }
  if (view === "quarterly") {
    const [y, q] = k.split("-");
    return `${q} '${y.slice(2)}`;
  }
  if (view === "yearly") return k;
  return new Date(k + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

function PeriodReportTab({ records }: { records: InvoiceMeta[] }) {
  const [view, setView] = useState<PeriodView>("monthly");
  const [year, setYear] = useState<number | null>(null);
  const [drillKey, setDrillKey] = useState<string | null>(null);
  const [filterClient, setFilterClient] = useState<string | null>(null);
  const [customFrom, setCustomFrom] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 3); return d.toISOString().slice(0, 10);
  });
  const [customTo, setCustomTo] = useState(() => new Date().toISOString().slice(0, 10));

  const years = useMemo(() => availableYears(records), [records]);

  const base = useMemo(() => {
    const byYear = view === "custom" ? records : filterByYear(records, year);
    if (!filterClient) return byYear;
    return byYear.filter((r) => (r.clientTags ?? []).includes(filterClient));
  }, [records, view, year, filterClient]);

  const filtered = useMemo(() => {
    if (view !== "custom") return base;
    const from = new Date(customFrom + "T00:00:00");
    const to   = new Date(customTo + "T23:59:59");
    return records.filter(r => { const d = recDate(r); return d ? d >= from && d <= to : false; });
  }, [records, base, view, customFrom, customTo]);

  const drillRecords = useMemo(() => {
    const map = new Map<string, InvoiceMeta[]>();
    const effectiveView: PeriodView = view === "custom" ? "daily" : view;
    for (const rec of filtered) {
      const d = recDate(rec);
      if (!d) continue;
      const k = toDateKey(d, effectiveView);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(rec);
    }
    return map;
  }, [filtered, view]);

  const buckets = useMemo(() => {
    const map = new Map<string, { label: string; count: number; totalPaise: number; taxPaise: number }>();
    const effectiveView: PeriodView = view === "custom" ? "daily" : view;

    for (const rec of filtered) {
      const d = recDate(rec);
      if (!d) continue;

      let k: string;
      if (view === "daily") {
        const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 59);
        if (d < cutoff) continue;
        k = toDateKey(d, "daily");
      } else if (view === "monthly") {
        const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - 23); cutoff.setDate(1);
        if (d < cutoff) continue;
        k = toDateKey(d, "monthly");
      } else {
        k = toDateKey(d, view);
      }

      if (!map.has(k)) map.set(k, { label: periodLabel(k, effectiveView), count: 0, totalPaise: 0, taxPaise: 0 });
      const b = map.get(k)!;
      b.count++;
      b.totalPaise += rec.grandTotalPaise!;
      b.taxPaise   += rec.taxPaise ?? 0;
    }

    return [...map.keys()].sort().map(k => map.get(k)!);
  }, [filtered, view]);

  const totals = useMemo(() => {
    const totalPaise = filtered.reduce((s, r) => s + (r.grandTotalPaise ?? 0), 0);
    return {
      count: filtered.length,
      totalPaise,
      taxPaise: filtered.reduce((s, r) => s + (r.taxPaise ?? 0), 0),
      avgPaise: buckets.length ? Math.round(totalPaise / buckets.length) : 0,
    };
  }, [filtered, buckets]);

  const maxPaise = useMemo(() => Math.max(...buckets.map(b => b.totalPaise), 1), [buckets]);
  const periodWord = view === "quarterly" ? "Quarter" : view === "monthly" ? "Month" : view === "yearly" ? "Year" : "Day";

  const VIEW_TABS: { id: PeriodView; label: string }[] = [
    { id: "monthly",   label: "Monthly" },
    { id: "quarterly", label: "Quarterly" },
    { id: "yearly",    label: "Yearly" },
    { id: "custom",    label: "Custom" },
  ];

  return (
    <div style={{ padding: "20px", maxWidth: 900, margin: "0 auto" }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--color-text)", margin: 0 }}>Expense by Period</h2>
        <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 3 }}>Monthly, quarterly, or yearly spend — for bookkeepers, tax consultants, societies, and individuals</p>
      </div>

      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 14 }}>
        {VIEW_TABS.map(v => <button key={v.id} style={chipStyle(view === v.id)} onClick={() => setView(v.id)}>{v.label}</button>)}
      </div>

      <ClientFilterRow records={records} filterClient={filterClient} setFilterClient={setFilterClient} />

      {view !== "custom" && <YearRow years={years} year={year} setYear={setYear} />}

      {view === "custom" && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
          <label style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "flex", alignItems: "center", gap: 6 }}>
            From <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
              style={{ fontSize: 12.5, padding: "4px 8px", borderRadius: 6, border: "1px solid var(--color-border)", background: "var(--color-bg)", color: "var(--color-text)" }} />
          </label>
          <label style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "flex", alignItems: "center", gap: 6 }}>
            To <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
              style={{ fontSize: 12.5, padding: "4px 8px", borderRadius: 6, border: "1px solid var(--color-border)", background: "var(--color-bg)", color: "var(--color-text)" }} />
          </label>
        </div>
      )}

      <SummaryCards cards={[
        { label: "Invoices",      value: String(totals.count) },
        { label: "Total Spend",   value: fmtShort(totals.totalPaise),  color: "var(--color-primary)" },
        { label: "Tax (GST)",     value: fmtShort(totals.taxPaise) },
        { label: `Avg / ${periodWord}`, value: fmtShort(totals.avgPaise) },
      ]} />

      {buckets.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 0", color: "var(--color-text-secondary)", fontSize: 13 }}>No invoice data for this period.</div>
      ) : (
        <>
          <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10, padding: "16px", marginBottom: 16, overflowX: "auto" }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 12 }}>
              Spend by {periodWord}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {buckets.map(b => <BarRow key={b.label} label={b.label} value={b.totalPaise} max={maxPaise} />)}
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
            <CsvButton onClick={() => downloadCSV(`expense-by-${view}.csv`, [
              ["Period", "Invoices", "Total (₹)", "Tax (₹)"],
              ...[...buckets].reverse().map(b => [b.label, b.count, (b.totalPaise / 100).toFixed(2), (b.taxPaise / 100).toFixed(2)]),
            ])} />
          </div>

          <div style={{ overflowX: "auto", background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1.5px solid var(--color-border)" }}>
                  {["Period", "Invoices", "Total Spend", "Tax (GST)"].map((h, i) => (
                    <th key={h} style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase" as const, letterSpacing: "0.06em", padding: "9px 14px", textAlign: i === 0 ? "left" : "right" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...buckets].reverse().map((b, i) => {
                  const effectiveView: PeriodView = view === "custom" ? "daily" : view;
                  const bKey = [...drillRecords.keys()].find(k => periodLabel(k, effectiveView) === b.label) ?? b.label;
                  const isOpen = drillKey === bKey;
                  return (
                    <React.Fragment key={b.label}>
                      <tr
                        onClick={() => setDrillKey(isOpen ? null : bKey)}
                        style={{ borderBottom: i < buckets.length - 1 && !isOpen ? "1px solid var(--color-border)" : "none", background: isOpen ? "color-mix(in srgb, var(--color-primary) 6%, transparent)" : i % 2 === 0 ? "transparent" : "var(--color-surface-2)", cursor: "pointer" }}
                      >
                        <td style={{ fontSize: 12.5, color: "var(--color-text)", padding: "10px 14px", display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontSize: 10, color: "var(--color-primary)", opacity: 0.7 }}>{isOpen ? "▼" : "▶"}</span>
                          {b.label}
                        </td>
                        <td style={{ fontSize: 12.5, color: "var(--color-text-secondary)", padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{b.count}</td>
                        <td style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-text)", padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtRupee(b.totalPaise)}</td>
                        <td style={{ fontSize: 12.5, color: "var(--color-text-secondary)", padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{b.taxPaise ? fmtRupee(b.taxPaise) : "—"}</td>
                      </tr>
                      {isOpen && <DrillDownPanel records={drillRecords.get(bKey) ?? []} onClose={() => setDrillKey(null)} />}
                    </React.Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: "1.5px solid var(--color-border)", background: "var(--color-surface-2)" }}>
                  <td style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text-secondary)", padding: "10px 14px" }}>Total</td>
                  <td style={{ fontSize: 12.5, fontWeight: 700, padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{totals.count}</td>
                  <td style={{ fontSize: 12.5, fontWeight: 700, padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtRupee(totals.totalPaise)}</td>
                  <td style={{ fontSize: 12.5, fontWeight: 700, padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{totals.taxPaise ? fmtRupee(totals.taxPaise) : "—"}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ── Vendor Report ─────────────────────────────────────────────────────────────

function VendorReportTab({ records }: { records: InvoiceMeta[] }) {
  const [year, setYear] = useState<number | null>(null);
  const [sortBy, setSortBy] = useState<"total" | "count" | "name">("total");
  const [drillVendor, setDrillVendor] = useState<string | null>(null);

  const years = useMemo(() => availableYears(records), [records]);
  const filtered = useMemo(() => filterByYear(records, year), [records, year]);

  const { list, grandTotal } = useMemo(() => {
    const map = new Map<string, { name: string; count: number; totalPaise: number; lastDate: string }>();
    for (const r of filtered) {
      const name = r.merchantName?.trim() || "Unknown";
      if (!map.has(name)) map.set(name, { name, count: 0, totalPaise: 0, lastDate: "" });
      const v = map.get(name)!;
      v.count++;
      v.totalPaise += r.grandTotalPaise ?? 0;
      const d = r.invoiceDate ?? r.createdAt ?? "";
      if (d > v.lastDate) v.lastDate = d;
    }
    const list = [...map.values()];
    if (sortBy === "total") list.sort((a, b) => b.totalPaise - a.totalPaise);
    else if (sortBy === "count") list.sort((a, b) => b.count - a.count);
    else list.sort((a, b) => a.name.localeCompare(b.name));
    const grandTotal = list.reduce((s, v) => s + v.totalPaise, 0);
    return { list, grandTotal };
  }, [filtered, sortBy]);

  const maxPaise = useMemo(() => Math.max(...list.map(v => v.totalPaise), 1), [list]);

  return (
    <div style={{ padding: "20px", maxWidth: 900, margin: "0 auto" }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--color-text)", margin: 0 }}>By Vendor / Merchant</h2>
        <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 3 }}>Spending by supplier — for shopkeepers, bookkeepers, real estate agents, and societies</p>
      </div>

      <YearRow years={years} year={year} setYear={setYear} />

      <div style={{ display: "flex", gap: 5, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginRight: 2 }}>Sort:</span>
        {(["total", "count", "name"] as const).map(s => (
          <button key={s} style={chipStyle(sortBy === s)} onClick={() => setSortBy(s)}>
            {s === "total" ? "Amount" : s === "count" ? "Frequency" : "Name A–Z"}
          </button>
        ))}
      </div>

      <SummaryCards cards={[
        { label: "Vendors",     value: String(list.length) },
        { label: "Total Spend", value: fmtShort(grandTotal), color: "var(--color-primary)" },
        { label: "Invoices",    value: String(filtered.length) },
      ]} />

      {list.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 0", color: "var(--color-text-secondary)", fontSize: 13 }}>No vendor data available.</div>
      ) : (
        <>
          <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10, padding: "16px", marginBottom: 16 }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 12 }}>
              Top {Math.min(10, list.length)} by Spend
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {list.slice(0, 10).map(v => <BarRow key={v.name} label={v.name} value={v.totalPaise} max={maxPaise} />)}
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
            <CsvButton onClick={() => downloadCSV("vendor-report.csv", [
              ["Rank", "Vendor", "Invoices", "Total (₹)", "% of Spend", "Last Invoice"],
              ...list.map((v, i) => [i + 1, v.name, v.count, (v.totalPaise / 100).toFixed(2), pct(v.totalPaise, grandTotal), v.lastDate.slice(0, 10)]),
            ])} />
          </div>

          <div style={{ overflowX: "auto", background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1.5px solid var(--color-border)" }}>
                  {["#", "Vendor / Merchant", "Invoices", "Total Spend", "% of Spend", "Last Invoice"].map((h, i) => (
                    <th key={h} style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase" as const, letterSpacing: "0.06em", padding: "9px 14px", textAlign: i <= 1 ? "left" : "right" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {list.map((v, i) => {
                  const isOpen = drillVendor === v.name;
                  const drillRecs = filtered.filter(r => (r.merchantName?.trim() || "Unknown") === v.name);
                  return (
                    <React.Fragment key={v.name}>
                      <tr
                        onClick={() => setDrillVendor(isOpen ? null : v.name)}
                        style={{ borderBottom: i < list.length - 1 && !isOpen ? "1px solid var(--color-border)" : "none", background: isOpen ? "color-mix(in srgb, var(--color-primary) 6%, transparent)" : i % 2 === 0 ? "transparent" : "var(--color-surface-2)", cursor: "pointer" }}
                      >
                        <td style={{ fontSize: 11, color: "var(--color-text-tertiary)", padding: "10px 14px", fontVariantNumeric: "tabular-nums" }}>{i + 1}</td>
                        <td style={{ fontSize: 12.5, color: "var(--color-text)", padding: "10px 14px", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          <span style={{ marginRight: 5, fontSize: 10, color: "var(--color-primary)", opacity: 0.7 }}>{isOpen ? "▼" : "▶"}</span>
                          {v.name}
                        </td>
                        <td style={{ fontSize: 12.5, color: "var(--color-text-secondary)", padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{v.count}</td>
                        <td style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-text)", padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtRupee(v.totalPaise)}</td>
                        <td style={{ fontSize: 12, color: "var(--color-text-secondary)", padding: "10px 14px", textAlign: "right" }}>{pct(v.totalPaise, grandTotal)}</td>
                        <td style={{ fontSize: 11.5, color: "var(--color-text-secondary)", padding: "10px 14px", textAlign: "right" }}>
                          {v.lastDate ? new Date(v.lastDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" }) : "—"}
                        </td>
                      </tr>
                      {isOpen && <DrillDownPanel records={drillRecs} onClose={() => setDrillVendor(null)} />}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ── Tags Report ───────────────────────────────────────────────────────────────

function TagsReportTab({ records }: { records: InvoiceMeta[] }) {
  const [year, setYear] = useState<number | null>(null);
  const [mode, setMode] = useState<"client" | "project">("client");
  const [drillTag, setDrillTag] = useState<string | null>(null);

  const years = useMemo(() => availableYears(records), [records]);
  const filtered = useMemo(() => filterByYear(records, year), [records, year]);

  const { tagged, untaggedCount, untaggedPaise, grandTotal } = useMemo(() => {
    const map = new Map<string, { tag: string; count: number; totalPaise: number }>();
    let untaggedCount = 0, untaggedPaise = 0;
    const grandTotal = filtered.reduce((s, r) => s + (r.grandTotalPaise ?? 0), 0);

    for (const r of filtered) {
      const tags = mode === "client"
        ? (r.clientTags?.length ? r.clientTags : [])
        : (r.projectTag ? [r.projectTag] : []);

      if (tags.length === 0) {
        untaggedCount++;
        untaggedPaise += r.grandTotalPaise ?? 0;
        continue;
      }
      for (const tag of tags) {
        if (!map.has(tag)) map.set(tag, { tag, count: 0, totalPaise: 0 });
        const t = map.get(tag)!;
        t.count++;
        t.totalPaise += r.grandTotalPaise ?? 0;
      }
    }

    const tagged = [...map.values()].sort((a, b) => b.totalPaise - a.totalPaise);
    return { tagged, untaggedCount, untaggedPaise, grandTotal };
  }, [filtered, mode]);

  const maxPaise = useMemo(() => Math.max(...tagged.map(t => t.totalPaise), 1), [tagged]);
  const taggedTotal = tagged.reduce((s, t) => s + t.totalPaise, 0);

  return (
    <div style={{ padding: "20px", maxWidth: 900, margin: "0 auto" }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--color-text)", margin: 0 }}>By Tags</h2>
        <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 3 }}>
          Spending by client or project — for freelancers, advocates, real estate agents, and bookkeepers
        </p>
      </div>

      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 14 }}>
        <button style={chipStyle(mode === "client")}  onClick={() => setMode("client")}>Client Tags</button>
        <button style={chipStyle(mode === "project")} onClick={() => setMode("project")}>Projects</button>
      </div>

      <YearRow years={years} year={year} setYear={setYear} />

      <SummaryCards cards={[
        { label: mode === "client" ? "Clients" : "Projects", value: String(tagged.length) },
        { label: "Tagged Spend",   value: fmtShort(taggedTotal), color: "var(--color-primary)" },
        { label: "Untagged",       value: `${untaggedCount} inv.` },
      ]} />

      {tagged.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 0", color: "var(--color-text-secondary)", fontSize: 13 }}>
          No {mode === "client" ? "client tags" : "project tags"} found.{" "}
          <span style={{ opacity: 0.7 }}>
            {mode === "client"
              ? "Tag invoices with a client name (e.g. buyer, tenant, or company) in the View screen."
              : "Tag invoices with a project (e.g. property address, deal name, or account) in the View screen."}
          </span>
        </div>
      ) : (
        <>
          <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10, padding: "16px", marginBottom: 16 }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 12 }}>Spend by Tag</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {tagged.map(t => <BarRow key={t.tag} label={t.tag} value={t.totalPaise} max={maxPaise} />)}
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
            <CsvButton onClick={() => downloadCSV(`${mode}-tags-report.csv`, [
              [mode === "client" ? "Client" : "Project", "Invoices", "Total (₹)", "% of Spend"],
              ...tagged.map(t => [t.tag, t.count, (t.totalPaise / 100).toFixed(2), pct(t.totalPaise, grandTotal)]),
              ["(Untagged)", untaggedCount, (untaggedPaise / 100).toFixed(2), pct(untaggedPaise, grandTotal)],
            ])} />
          </div>

          <div style={{ overflowX: "auto", background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1.5px solid var(--color-border)" }}>
                  {[mode === "client" ? "Client Tag" : "Project", "Invoices", "Total Spend", "% of Spend"].map((h, i) => (
                    <th key={h} style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase" as const, letterSpacing: "0.06em", padding: "9px 14px", textAlign: i === 0 ? "left" : "right" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tagged.map((t, i) => {
                  const isOpen = drillTag === t.tag;
                  const drillRecs = filtered.filter(r =>
                    mode === "client"
                      ? (r.clientTags ?? []).includes(t.tag)
                      : r.projectTag === t.tag
                  );
                  return (
                    <React.Fragment key={t.tag}>
                      <tr
                        onClick={() => setDrillTag(isOpen ? null : t.tag)}
                        style={{ borderBottom: !isOpen ? "1px solid var(--color-border)" : "none", background: isOpen ? "color-mix(in srgb, var(--color-primary) 6%, transparent)" : i % 2 === 0 ? "transparent" : "var(--color-surface-2)", cursor: "pointer" }}
                      >
                        <td style={{ fontSize: 12.5, color: "var(--color-text)", padding: "10px 14px" }}>
                          <span style={{ fontSize: 10, color: "var(--color-primary)", opacity: 0.7, marginRight: 6 }}>{isOpen ? "▼" : "▶"}</span>
                          <span style={{ background: "color-mix(in srgb, var(--color-primary) 12%, transparent)", color: "var(--color-primary)", borderRadius: 4, padding: "2px 8px", fontSize: 12, fontWeight: 600 }}>{t.tag}</span>
                        </td>
                        <td style={{ fontSize: 12.5, color: "var(--color-text-secondary)", padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{t.count}</td>
                        <td style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-text)", padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtRupee(t.totalPaise)}</td>
                        <td style={{ fontSize: 12, color: "var(--color-text-secondary)", padding: "10px 14px", textAlign: "right" }}>{pct(t.totalPaise, grandTotal)}</td>
                      </tr>
                      {isOpen && <DrillDownPanel records={drillRecs} onClose={() => setDrillTag(null)} />}
                    </React.Fragment>
                  );
                })}
                {untaggedCount > 0 && (() => {
                  const isOpen = drillTag === "__untagged__";
                  const drillRecs = filtered.filter(r =>
                    mode === "client" ? !(r.clientTags?.length) : !r.projectTag
                  );
                  return (
                    <React.Fragment key="__untagged__">
                      <tr
                        onClick={() => setDrillTag(isOpen ? null : "__untagged__")}
                        style={{ borderBottom: "none", cursor: "pointer", background: isOpen ? "color-mix(in srgb, var(--color-primary) 6%, transparent)" : "transparent" }}
                      >
                        <td style={{ fontSize: 12, color: "var(--color-text-tertiary)", padding: "10px 14px", fontStyle: "italic" }}>
                          <span style={{ fontSize: 10, opacity: 0.7, marginRight: 6 }}>{isOpen ? "▼" : "▶"}</span>
                          Untagged
                        </td>
                        <td style={{ fontSize: 12.5, color: "var(--color-text-tertiary)", padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{untaggedCount}</td>
                        <td style={{ fontSize: 12.5, color: "var(--color-text-tertiary)", padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtRupee(untaggedPaise)}</td>
                        <td style={{ fontSize: 12, color: "var(--color-text-tertiary)", padding: "10px 14px", textAlign: "right" }}>{pct(untaggedPaise, grandTotal)}</td>
                      </tr>
                      {isOpen && <DrillDownPanel records={drillRecs} onClose={() => setDrillTag(null)} />}
                    </React.Fragment>
                  );
                })()}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ── Category Report ───────────────────────────────────────────────────────────

const DOC_TYPE_LABEL: Record<string, string> = {
  invoice: "Invoice", tax: "Tax / Receipt", travel: "Travel", coupon: "Coupon / Offer", other: "Other",
};
const PAYMENT_MODE_LABEL: Record<string, string> = {
  upi: "UPI", card: "Card", cash: "Cash", bnpl: "Buy Now Pay Later", credit: "Credit", unknown: "Not Captured",
};

function GroupSection({ title, rows, grandTotal, csvName, getDrillRecords }: {
  title: string;
  rows: { label: string; count: number; totalPaise: number }[];
  grandTotal: number;
  csvName: string;
  getDrillRecords: (label: string) => InvoiceMeta[];
}) {
  const [drillLabel, setDrillLabel] = useState<string | null>(null);
  const max = useMemo(() => Math.max(...rows.map(r => r.totalPaise), 1), [rows]);
  return (
    <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10, marginBottom: 16 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase" as const, letterSpacing: "0.06em", padding: "12px 16px 10px" }}>{title}</div>
      <div style={{ padding: "0 16px 4px", display: "flex", flexDirection: "column", gap: 6 }}>
        {rows.map(r => <BarRow key={r.label} label={r.label} value={r.totalPaise} max={max} />)}
      </div>
      <div style={{ overflowX: "auto", marginTop: 8 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderTop: "1px solid var(--color-border)", borderBottom: "1px solid var(--color-border)" }}>
              {["Type", "Invoices", "Total Spend", "%"].map((h, i) => (
                <th key={h} style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase" as const, letterSpacing: "0.06em", padding: "8px 16px", textAlign: i === 0 ? "left" : "right" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const isOpen = drillLabel === r.label;
              return (
                <React.Fragment key={r.label}>
                  <tr
                    onClick={() => setDrillLabel(isOpen ? null : r.label)}
                    style={{ borderBottom: i < rows.length - 1 && !isOpen ? "1px solid var(--color-border)" : "none", background: isOpen ? "color-mix(in srgb, var(--color-primary) 6%, transparent)" : i % 2 === 0 ? "transparent" : "var(--color-surface-2)", cursor: "pointer" }}
                  >
                    <td style={{ fontSize: 12.5, color: "var(--color-text)", padding: "9px 16px" }}>
                      <span style={{ fontSize: 10, color: "var(--color-primary)", opacity: 0.7, marginRight: 6 }}>{isOpen ? "▼" : "▶"}</span>
                      {r.label}
                    </td>
                    <td style={{ fontSize: 12.5, color: "var(--color-text-secondary)", padding: "9px 16px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.count}</td>
                    <td style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-text)", padding: "9px 16px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtRupee(r.totalPaise)}</td>
                    <td style={{ fontSize: 12, color: "var(--color-text-secondary)", padding: "9px 16px", textAlign: "right" }}>{pct(r.totalPaise, grandTotal)}</td>
                  </tr>
                  {isOpen && <DrillDownPanel records={getDrillRecords(r.label)} onClose={() => setDrillLabel(null)} />}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", padding: "10px 16px" }}>
        <CsvButton onClick={() => downloadCSV(csvName, [
          ["Type", "Invoices", "Total (₹)", "% of Spend"],
          ...rows.map(r => [r.label, r.count, (r.totalPaise / 100).toFixed(2), pct(r.totalPaise, grandTotal)]),
        ])} />
      </div>
    </div>
  );
}

function CategoryReportTab({ records }: { records: InvoiceMeta[] }) {
  const [year, setYear] = useState<number | null>(null);
  const [filterClient, setFilterClient] = useState<string | null>(null);
  const years = useMemo(() => availableYears(records), [records]);
  const filtered = useMemo(() => {
    const byYear = filterByYear(records, year);
    if (!filterClient) return byYear;
    return byYear.filter((r) => (r.clientTags ?? []).includes(filterClient));
  }, [records, year, filterClient]);
  const grandTotal = useMemo(() => filtered.reduce((s, r) => s + (r.grandTotalPaise ?? 0), 0), [filtered]);

  const docTypes = useMemo(() => {
    const map = new Map<string, { count: number; totalPaise: number }>();
    for (const r of filtered) {
      const types = r.docTypes?.length ? r.docTypes : (r.docType ? [r.docType] : ["other"]);
      for (const t of types) {
        if (!map.has(t)) map.set(t, { count: 0, totalPaise: 0 });
        const b = map.get(t)!;
        b.count++;
        b.totalPaise += r.grandTotalPaise ?? 0;
      }
    }
    return [...map.entries()].sort((a, b) => b[1].totalPaise - a[1].totalPaise)
      .map(([type, data]) => ({ label: DOC_TYPE_LABEL[type] ?? type, ...data }));
  }, [filtered]);

  const payModes = useMemo(() => {
    const map = new Map<string, { count: number; totalPaise: number }>();
    for (const r of filtered) {
      const mode = r.paymentMode ?? "unknown";
      if (!map.has(mode)) map.set(mode, { count: 0, totalPaise: 0 });
      const b = map.get(mode)!;
      b.count++;
      b.totalPaise += r.grandTotalPaise ?? 0;
    }
    return [...map.entries()].sort((a, b) => b[1].totalPaise - a[1].totalPaise)
      .map(([mode, data]) => ({ label: PAYMENT_MODE_LABEL[mode] ?? mode, ...data }));
  }, [filtered]);

  return (
    <div style={{ padding: "20px", maxWidth: 900, margin: "0 auto" }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--color-text)", margin: 0 }}>By Category</h2>
        <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 3 }}>Breakdown by document type and payment method — for bookkeepers, tax consultants, and normal users</p>
      </div>

      <YearRow years={years} year={year} setYear={setYear} />

      <ClientFilterRow records={records} filterClient={filterClient} setFilterClient={setFilterClient} />

      <SummaryCards cards={[
        { label: "Invoices",    value: String(filtered.length) },
        { label: "Total Spend", value: fmtShort(grandTotal), color: "var(--color-primary)" },
        { label: "Doc Types",   value: String(docTypes.length) },
        { label: "Pay Modes",   value: String(payModes.length) },
      ]} />

      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 0", color: "var(--color-text-secondary)", fontSize: 13 }}>No data available.</div>
      ) : (
        <>
          <GroupSection
            title="By Document Type" rows={docTypes} grandTotal={grandTotal} csvName="category-by-type.csv"
            getDrillRecords={(label) => filtered.filter(r => {
              const types = r.docTypes?.length ? r.docTypes : (r.docType ? [r.docType] : ["other"]);
              return types.some(t => (DOC_TYPE_LABEL[t] ?? t) === label);
            })}
          />
          <GroupSection
            title="By Payment Mode" rows={payModes} grandTotal={grandTotal} csvName="category-by-payment.csv"
            getDrillRecords={(label) => filtered.filter(r => (PAYMENT_MODE_LABEL[r.paymentMode ?? "unknown"] ?? r.paymentMode ?? "unknown") === label)}
          />
        </>
      )}
    </div>
  );
}

// ── FY helpers ────────────────────────────────────────────────────────────────

function currentFY(): number {
  const now = new Date();
  return now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
}

function fyBounds(fyStart: number): { from: Date; to: Date } {
  return { from: new Date(fyStart, 3, 1), to: new Date(fyStart + 1, 2, 31, 23, 59, 59) };
}

function filterByFY(records: InvoiceMeta[], fyStart: number | null): InvoiceMeta[] {
  if (fyStart === null) return records;
  const { from, to } = fyBounds(fyStart);
  return records.filter(r => { const d = recDate(r); return d ? d >= from && d <= to : false; });
}

function fyLabel(fyStart: number): string {
  return `FY ${fyStart}–${String(fyStart + 1).slice(2)}`;
}

function availableFYs(records: InvoiceMeta[]): number[] {
  const fys = new Set<number>();
  for (const r of records) {
    const d = recDate(r);
    if (!d) continue;
    fys.add(d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1);
  }
  return [...fys].sort((a, b) => b - a);
}

const ALL_DOC_TYPE_LABELS: Record<string, string> = {
  invoice: "Invoice / Bill", tax: "Tax / Receipt", financial: "Financial / Banking",
  payroll: "Payroll / Salary", legal: "Legal", society: "Society / HOA",
  utility: "Utility / Bill", medical: "Medical / Healthcare", insurance: "Insurance",
  travel: "Travel", education: "Education", rent: "Rent",
  shopping: "Shopping / Retail", coupon: "Coupon / Offer", warranty: "Warranty",
  other: "Other",
};

// ── Summary Report (common — all profiles) ────────────────────────────────────

function SummaryReportTab({ records }: { records: InvoiceMeta[] }) {
  const allFYs = useMemo(() => availableFYs(records), [records]);
  const [fy, setFY] = useState<number | null>(currentFY);
  const [drillType, setDrillType] = useState<string | null>(null);

  const filtered     = useMemo(() => filterByFY(records, fy), [records, fy]);
  const lastFiltered = useMemo(() => fy !== null ? filterByFY(records, fy - 1) : [], [records, fy]);

  const monthlyBuckets = useMemo(() => {
    const now = new Date();
    const buckets: { key: string; label: string; totalPaise: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      buckets.push({ key, label: d.toLocaleDateString("en-IN", { month: "short", year: "2-digit" }), totalPaise: 0 });
    }
    for (const r of records) {
      const d = recDate(r);
      if (!d) continue;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const b = buckets.find(x => x.key === key);
      if (b) b.totalPaise += r.grandTotalPaise ?? 0;
    }
    return buckets;
  }, [records]);

  const docTypes = useMemo(() => {
    const map = new Map<string, { count: number; totalPaise: number }>();
    for (const r of filtered) {
      const types = r.docTypes?.length ? r.docTypes : (r.docType ? [r.docType] : ["other"]);
      for (const t of types) {
        if (!map.has(t)) map.set(t, { count: 0, totalPaise: 0 });
        const b = map.get(t)!;
        b.count++;
        b.totalPaise += r.grandTotalPaise ?? 0;
      }
    }
    return [...map.entries()]
      .sort((a, b) => b[1].totalPaise - a[1].totalPaise)
      .map(([type, data]) => ({ type, label: ALL_DOC_TYPE_LABELS[type] ?? type, ...data }));
  }, [filtered]);

  const totals = useMemo(() => ({
    count:      filtered.length,
    totalPaise: filtered.reduce((s, r) => s + (r.grandTotalPaise ?? 0), 0),
    taxPaise:   filtered.reduce((s, r) => s + (r.taxPaise ?? 0), 0),
  }), [filtered]);

  const lastTotals = useMemo(() => ({
    count:      lastFiltered.length,
    totalPaise: lastFiltered.reduce((s, r) => s + (r.grandTotalPaise ?? 0), 0),
    taxPaise:   lastFiltered.reduce((s, r) => s + (r.taxPaise ?? 0), 0),
  }), [lastFiltered]);

  const grandTotal = totals.totalPaise;
  const maxMonth   = useMemo(() => Math.max(...monthlyBuckets.map(b => b.totalPaise), 1), [monthlyBuckets]);
  const maxDocType = useMemo(() => Math.max(...docTypes.map(d => d.totalPaise), 1), [docTypes]);

  const yoy = fy !== null && lastTotals.totalPaise > 0
    ? Math.round(((totals.totalPaise - lastTotals.totalPaise) / lastTotals.totalPaise) * 100)
    : null;

  return (
    <div style={{ padding: "20px", maxWidth: 900, margin: "0 auto" }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--color-text)", margin: 0 }}>Summary</h2>
        <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 3 }}>Overall spend, monthly trend, and document type breakdown</p>
      </div>

      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 14 }}>
        {allFYs.map(f => <button key={f} style={chipStyle(fy === f)} onClick={() => setFY(f)}>{fyLabel(f)}</button>)}
        <button style={chipStyle(fy === null)} onClick={() => setFY(null)}>All Time</button>
      </div>

      <SummaryCards cards={[
        { label: "Documents",   value: String(totals.count) },
        { label: "Total Spend", value: fmtShort(totals.totalPaise), color: "var(--color-primary)" },
        { label: "Tax Paid",    value: fmtShort(totals.taxPaise) },
        ...(yoy !== null ? [{ label: "vs Last FY", value: `${yoy > 0 ? "+" : ""}${yoy}%`, color: yoy > 0 ? "#dc2626" : "#16a34a" }] : []),
      ]} />

      {/* 12-month trend */}
      <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10, padding: "16px", marginBottom: 16 }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 12 }}>12-Month Trend</div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 88 }}>
          {monthlyBuckets.map(b => {
            const h = maxMonth > 0 ? Math.max(Math.round((b.totalPaise / maxMonth) * 72), b.totalPaise > 0 ? 4 : 0) : 0;
            return (
              <div key={b.key} title={`${b.label}: ${fmtShort(b.totalPaise)}`}
                style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flex: 1, minWidth: 0 }}>
                <div style={{ width: "100%", height: h, background: "var(--color-primary)", borderRadius: "3px 3px 0 0", opacity: 0.85, transition: "height 0.3s ease" }} />
                <span style={{ fontSize: 9, color: "var(--color-text-tertiary)", whiteSpace: "nowrap", overflow: "hidden", maxWidth: "100%", textOverflow: "ellipsis" }}>{b.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {docTypes.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 0", color: "var(--color-text-secondary)", fontSize: 13 }}>No data for this period.</div>
      ) : (
        <>
          <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10, padding: "16px", marginBottom: 16 }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 12 }}>By Document Type</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {docTypes.map(d => <BarRow key={d.type} label={d.label} value={d.totalPaise} max={maxDocType} />)}
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
            <CsvButton onClick={() => downloadCSV(`summary-${fy ?? "all"}.csv`, [
              ["Document Type", "Count", "Total (₹)", "% of Spend"],
              ...docTypes.map(d => [d.label, d.count, (d.totalPaise / 100).toFixed(2), pct(d.totalPaise, grandTotal)]),
            ])} />
          </div>

          <div style={{ overflowX: "auto", background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10, marginBottom: 16 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1.5px solid var(--color-border)" }}>
                  {["Document Type", "Documents", "Total Spend", "% of Spend"].map((h, i) => (
                    <th key={h} style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase" as const, letterSpacing: "0.06em", padding: "9px 14px", textAlign: i === 0 ? "left" : "right" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {docTypes.map((d, i) => {
                  const isOpen = drillType === d.type;
                  const drillRecs = filtered.filter(r => {
                    const types = r.docTypes?.length ? r.docTypes : (r.docType ? [r.docType] : ["other"]);
                    return types.includes(d.type);
                  });
                  return (
                    <React.Fragment key={d.type}>
                      <tr
                        onClick={() => setDrillType(isOpen ? null : d.type)}
                        style={{ borderBottom: i < docTypes.length - 1 && !isOpen ? "1px solid var(--color-border)" : "none", background: isOpen ? "color-mix(in srgb, var(--color-primary) 6%, transparent)" : i % 2 === 0 ? "transparent" : "var(--color-surface-2)", cursor: "pointer" }}
                      >
                        <td style={{ fontSize: 12.5, color: "var(--color-text)", padding: "10px 14px" }}>
                          <span style={{ fontSize: 10, color: "var(--color-primary)", opacity: 0.7, marginRight: 6 }}>{isOpen ? "▼" : "▶"}</span>
                          {d.label}
                        </td>
                        <td style={{ fontSize: 12.5, color: "var(--color-text-secondary)", padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{d.count}</td>
                        <td style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-text)", padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtRupee(d.totalPaise)}</td>
                        <td style={{ fontSize: 12, color: "var(--color-text-secondary)", padding: "10px 14px", textAlign: "right" }}>{pct(d.totalPaise, grandTotal)}</td>
                      </tr>
                      {isOpen && <DrillDownPanel records={drillRecs} onClose={() => setDrillType(null)} />}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* YoY comparison */}
          {fy !== null && lastTotals.count > 0 && (
            <div style={{ overflowX: "auto", background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10 }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase" as const, letterSpacing: "0.06em", padding: "12px 14px 8px" }}>Year-on-Year Comparison</div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1.5px solid var(--color-border)" }}>
                    {["", fyLabel(fy), fyLabel(fy - 1), "Change"].map((h, i) => (
                      <th key={i} style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase" as const, letterSpacing: "0.06em", padding: "9px 14px", textAlign: i === 0 ? "left" : "right" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {([
                    { label: "Documents",  cur: totals.count,      prev: lastTotals.count,      isAmount: false },
                    { label: "Total Spend",cur: totals.totalPaise,  prev: lastTotals.totalPaise,  isAmount: true  },
                    { label: "Tax Paid",   cur: totals.taxPaise,    prev: lastTotals.taxPaise,    isAmount: true  },
                  ] as const).map((row, i) => {
                    const chg = row.prev > 0 ? Math.round(((row.cur - row.prev) / row.prev) * 100) : null;
                    return (
                      <tr key={row.label} style={{ borderBottom: i < 2 ? "1px solid var(--color-border)" : "none", background: i % 2 === 0 ? "transparent" : "var(--color-surface-2)" }}>
                        <td style={{ fontSize: 12.5, color: "var(--color-text)", padding: "10px 14px" }}>{row.label}</td>
                        <td style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-text)", padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                          {row.isAmount ? fmtRupee(row.cur) : row.cur}
                        </td>
                        <td style={{ fontSize: 12.5, color: "var(--color-text-secondary)", padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                          {row.isAmount ? fmtRupee(row.prev) : row.prev}
                        </td>
                        <td style={{ fontSize: 12, padding: "10px 14px", textAlign: "right", fontWeight: 600, color: chg === null ? "var(--color-text-tertiary)" : chg > 0 ? "#dc2626" : "#16a34a" }}>
                          {chg === null ? "—" : `${chg > 0 ? "+" : ""}${chg}%`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Personal: Budget Tracker ───────────────────────────────────────────────────

const BUDGET_CATEGORIES: { key: string; label: string }[] = [
  { key: "shopping",  label: "Shopping / Retail" },
  { key: "utility",   label: "Utilities" },
  { key: "medical",   label: "Medical" },
  { key: "travel",    label: "Travel" },
  { key: "education", label: "Education" },
  { key: "insurance", label: "Insurance" },
  { key: "rent",      label: "Rent" },
  { key: "invoice",   label: "General Bills" },
  { key: "other",     label: "Other" },
];

function loadBudgets(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem("jinvoice_budgets") ?? "{}"); } catch { return {}; }
}
function saveBudgets(b: Record<string, number>): void {
  try { localStorage.setItem("jinvoice_budgets", JSON.stringify(b)); } catch { /* ignore */ }
}

function PersonalBudgetTab({ records }: { records: InvoiceMeta[] }) {
  const [budgets, setBudgets] = useState<Record<string, number>>(loadBudgets);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editVal, setEditVal] = useState("");

  const now = new Date();
  const monthRecords = useMemo(() => records.filter(r => {
    const d = recDate(r);
    return d && d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }), [records]);

  const actuals = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of monthRecords) {
      const types = r.docTypes?.length ? r.docTypes : (r.docType ? [r.docType] : ["other"]);
      for (const t of types) map[t] = (map[t] ?? 0) + (r.grandTotalPaise ?? 0);
    }
    return map;
  }, [monthRecords]);

  const totalBudgetPaise = BUDGET_CATEGORIES.reduce((s, c) => s + (budgets[c.key] ?? 0) * 100, 0);
  const totalActual      = BUDGET_CATEGORIES.reduce((s, c) => s + (actuals[c.key] ?? 0), 0);

  const commitEdit = (key: string) => {
    const val = parseFloat(editVal);
    if (!isNaN(val) && val >= 0) {
      const next = { ...budgets, [key]: val };
      setBudgets(next);
      saveBudgets(next);
    }
    setEditKey(null); setEditVal("");
  };

  const monthLabel = now.toLocaleDateString("en-IN", { month: "long", year: "numeric" });

  return (
    <div style={{ padding: "20px", maxWidth: 900, margin: "0 auto" }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--color-text)", margin: 0 }}>Monthly Budget</h2>
        <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 3 }}>Set a monthly budget per category and track actual spend — {monthLabel}</p>
      </div>

      <SummaryCards cards={[
        { label: "Budget Set",  value: totalBudgetPaise > 0 ? fmtShort(totalBudgetPaise) : "Not set" },
        { label: "Spent (MTD)", value: fmtShort(totalActual), color: "var(--color-primary)" },
        { label: "Remaining",   value: totalBudgetPaise > 0 ? fmtShort(Math.max(0, totalBudgetPaise - totalActual)) : "—", color: totalActual > totalBudgetPaise && totalBudgetPaise > 0 ? "#dc2626" : undefined },
      ]} />

      <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10, overflow: "hidden" }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase" as const, letterSpacing: "0.06em", padding: "12px 16px 10px" }}>
          Budget vs Actual — {monthLabel}
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1.5px solid var(--color-border)" }}>
              {["Category", "Budget / Month", "Spent MTD", "Status"].map((h, i) => (
                <th key={h} style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase" as const, letterSpacing: "0.06em", padding: "9px 16px", textAlign: i === 0 ? "left" : "right" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {BUDGET_CATEGORIES.map((cat, i) => {
              const actual = actuals[cat.key] ?? 0;
              const budget = (budgets[cat.key] ?? 0) * 100;
              const over = budget > 0 && actual > budget;
              const pctUsed = budget > 0 ? Math.min(Math.round((actual / budget) * 100), 999) : null;
              const isEdit = editKey === cat.key;
              return (
                <tr key={cat.key} style={{ borderBottom: i < BUDGET_CATEGORIES.length - 1 ? "1px solid var(--color-border)" : "none", background: over ? "color-mix(in srgb, #dc2626 5%, transparent)" : i % 2 === 0 ? "transparent" : "var(--color-surface-2)" }}>
                  <td style={{ fontSize: 12.5, color: "var(--color-text)", padding: "10px 16px" }}>{cat.label}</td>
                  <td style={{ padding: "10px 16px", textAlign: "right" }}>
                    {isEdit ? (
                      <input type="number" value={editVal} autoFocus
                        onChange={e => setEditVal(e.target.value)}
                        onBlur={() => commitEdit(cat.key)}
                        onKeyDown={e => { if (e.key === "Enter") commitEdit(cat.key); if (e.key === "Escape") { setEditKey(null); setEditVal(""); } }}
                        style={{ width: 90, fontSize: 12.5, padding: "3px 6px", borderRadius: 5, border: "1.5px solid var(--color-primary)", background: "var(--color-bg)", color: "var(--color-text)", textAlign: "right" }}
                      />
                    ) : (
                      <button onClick={() => { setEditKey(cat.key); setEditVal(budgets[cat.key]?.toString() ?? ""); }}
                        style={{ fontSize: 12.5, background: "none", border: "none", cursor: "pointer", color: budget > 0 ? "var(--color-text)" : "var(--color-text-tertiary)", textDecoration: "underline dotted", fontVariantNumeric: "tabular-nums" }}>
                        {budget > 0 ? fmtRupee(budget) : "Set budget"}
                      </button>
                    )}
                  </td>
                  <td style={{ fontSize: 12.5, fontWeight: actual > 0 ? 600 : 400, color: actual > 0 ? "var(--color-text)" : "var(--color-text-tertiary)", padding: "10px 16px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {actual > 0 ? fmtRupee(actual) : "—"}
                  </td>
                  <td style={{ fontSize: 12, padding: "10px 16px", textAlign: "right" }}>
                    {budget === 0 ? <span style={{ color: "var(--color-text-tertiary)" }}>—</span>
                    : over ? <span style={{ color: "#dc2626", fontWeight: 700 }}>Over {pctUsed}%</span>
                    : pctUsed !== null ? <span style={{ color: pctUsed > 80 ? "#d97706" : "#16a34a" }}>{pctUsed}% used</span>
                    : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 10, textAlign: "center" }}>
        Click any budget to edit. Values are saved locally on this device.
      </p>
    </div>
  );
}

// ── Personal: Tax Savings ──────────────────────────────────────────────────────

const TAX_SECTIONS: { section: string; label: string; docTypes: string[]; limit: string; note: string }[] = [
  { section: "80C",  label: "Section 80C",  docTypes: ["insurance", "education", "financial"], limit: "₹1.5L limit", note: "LIC premiums, ELSS/MF, tuition fees, PPF deposits" },
  { section: "80D",  label: "Section 80D",  docTypes: ["medical"],                              limit: "₹25K–₹1L limit", note: "Health insurance premiums and preventive health check-ups" },
  { section: "HRA",  label: "Rent (HRA)",   docTypes: ["rent"],                                 limit: "Actual rent",   note: "House Rent Allowance — keep receipts for each month" },
];

function PersonalTaxSavingsTab({ records }: { records: InvoiceMeta[] }) {
  const allFYs = useMemo(() => availableFYs(records), [records]);
  const [fy, setFY] = useState<number | null>(currentFY);

  const filtered = useMemo(() => filterByFY(records, fy), [records, fy]);

  const sectionData = useMemo(() =>
    TAX_SECTIONS.map(sec => {
      const recs = filtered.filter(r => {
        const types = r.docTypes?.length ? r.docTypes : (r.docType ? [r.docType] : ["other"]);
        return types.some(t => sec.docTypes.includes(t));
      });
      return { ...sec, recs, totalPaise: recs.reduce((s, r) => s + (r.grandTotalPaise ?? 0), 0) };
    }), [filtered]);

  const totalEligible = sectionData.reduce((s, sec) => s + sec.totalPaise, 0);

  return (
    <div style={{ padding: "20px", maxWidth: 900, margin: "0 auto" }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--color-text)", margin: 0 }}>Tax-Saving Expenses</h2>
        <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 3 }}>Invoices eligible for income tax deductions — useful for ITR filing</p>
      </div>

      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 14 }}>
        {allFYs.map(f => <button key={f} style={chipStyle(fy === f)} onClick={() => setFY(f)}>{fyLabel(f)}</button>)}
        <button style={chipStyle(fy === null)} onClick={() => setFY(null)}>All Time</button>
      </div>

      <SummaryCards cards={[
        { label: "Total Eligible", value: fmtShort(totalEligible), color: "#16a34a" },
        { label: "80C Eligible",   value: fmtShort(sectionData[0].totalPaise) },
        { label: "80D (Medical)",  value: fmtShort(sectionData[1].totalPaise) },
        { label: "Rent (HRA)",     value: fmtShort(sectionData[2].totalPaise) },
      ]} />

      {sectionData.map(sec => (
        <div key={sec.section} style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10, marginBottom: 16, overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--color-border)" }}>
            <div>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text)" }}>{sec.label}</span>
              <span style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginLeft: 8 }}>{sec.limit}</span>
              <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 2 }}>{sec.note}</div>
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#16a34a", fontVariantNumeric: "tabular-nums" }}>{fmtRupee(sec.totalPaise)}</div>
          </div>
          {sec.recs.length === 0 ? (
            <div style={{ padding: "16px", fontSize: 12, color: "var(--color-text-tertiary)", textAlign: "center" }}>
              No {sec.label}-eligible documents in this period.
            </div>
          ) : (
            <>
              <div style={{ display: "flex", justifyContent: "flex-end", padding: "8px 16px 0" }}>
                <CsvButton onClick={() => downloadCSV(`tax-${sec.section.toLowerCase()}-${fy ?? "all"}.csv`, [
                  ["Date", "Vendor", "Invoice #", "Amount (₹)", "Doc Type"],
                  ...sec.recs.map(r => [r.invoiceDate?.slice(0, 10) ?? "—", r.merchantName ?? "Unknown", r.invoiceNumber ?? "—", ((r.grandTotalPaise ?? 0) / 100).toFixed(2), r.docType ?? "other"]),
                ])} />
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                      {["Date", "Vendor", "Invoice #", "Amount"].map((h, i) => (
                        <th key={h} style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase" as const, letterSpacing: "0.06em", padding: "8px 16px", textAlign: i >= 3 ? "right" : "left" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...sec.recs].sort((a, b) => (b.invoiceDate ?? "").localeCompare(a.invoiceDate ?? "")).map((r, i) => (
                      <tr key={r.id ?? i} style={{ borderBottom: i < sec.recs.length - 1 ? "1px solid var(--color-border)" : "none", background: i % 2 === 0 ? "transparent" : "var(--color-surface-2)" }}>
                        <td style={{ fontSize: 11.5, color: "var(--color-text-secondary)", padding: "8px 16px", whiteSpace: "nowrap" }}>
                          {r.invoiceDate ? new Date(r.invoiceDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" }) : "—"}
                        </td>
                        <td style={{ fontSize: 12.5, color: "var(--color-text)", padding: "8px 16px", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.merchantName ?? "Unknown"}</td>
                        <td style={{ fontSize: 11, color: "var(--color-text-secondary)", padding: "8px 16px", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.invoiceNumber ?? "—"}</td>
                        <td style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-text)", padding: "8px 16px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtRupee(r.grandTotalPaise ?? 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      ))}

      <p style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 4, textAlign: "center" }}>
        Eligibility is based on document type detected by AI. Always verify with your CA before filing.
      </p>
    </div>
  );
}

// ── Society: Maintenance Ledger ───────────────────────────────────────────────

function SocietyLedgerTab({ records }: { records: InvoiceMeta[] }) {
  const allFYs = useMemo(() => availableFYs(records), [records]);
  const [fy, setFY] = useState<number | null>(currentFY);
  const [drillUnit, setDrillUnit] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"unit" | "total" | "count">("unit");

  const filtered = useMemo(() => filterByFY(records, fy), [records, fy]);

  const { units, unitsTotal, untaggedCount } = useMemo(() => {
    const map = new Map<string, { unit: string; count: number; totalPaise: number; lastDate: string }>();
    let untaggedCount = 0;
    for (const r of filtered) {
      const tag = r.projectTag?.trim();
      if (!tag) { untaggedCount++; continue; }
      if (!map.has(tag)) map.set(tag, { unit: tag, count: 0, totalPaise: 0, lastDate: "" });
      const u = map.get(tag)!;
      u.count++;
      u.totalPaise += r.grandTotalPaise ?? 0;
      const d = r.invoiceDate ?? r.createdAt ?? "";
      if (d > u.lastDate) u.lastDate = d;
    }
    const units = [...map.values()];
    if (sortBy === "unit")  units.sort((a, b) => a.unit.localeCompare(b.unit));
    if (sortBy === "total") units.sort((a, b) => b.totalPaise - a.totalPaise);
    if (sortBy === "count") units.sort((a, b) => b.count - a.count);
    return { units, unitsTotal: units.reduce((s, u) => s + u.totalPaise, 0), untaggedCount };
  }, [filtered, sortBy]);

  return (
    <div style={{ padding: "20px", maxWidth: 900, margin: "0 auto" }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--color-text)", margin: 0 }}>Maintenance Ledger</h2>
        <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 3 }}>Per-unit collection summary — tag invoices with flat/unit numbers via Project Tag in View screen</p>
      </div>

      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 14 }}>
        {allFYs.map(f => <button key={f} style={chipStyle(fy === f)} onClick={() => setFY(f)}>{fyLabel(f)}</button>)}
        <button style={chipStyle(fy === null)} onClick={() => setFY(null)}>All Time</button>
      </div>

      <SummaryCards cards={[
        { label: "Units Tracked",   value: String(units.length) },
        { label: "Total Collected", value: fmtShort(unitsTotal), color: "var(--color-primary)" },
        { label: "Avg per Unit",    value: units.length > 0 ? fmtShort(Math.round(unitsTotal / units.length)) : "—" },
        { label: "Untagged",        value: `${untaggedCount} inv.` },
      ]} />

      {units.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 24px", color: "var(--color-text-secondary)", fontSize: 13, background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>No unit-tagged invoices found</div>
          <div style={{ fontSize: 12, opacity: 0.8 }}>Open an invoice → View → set Project Tag to the flat/unit number (e.g. "A-101", "Wing-B-204") to track per-unit collections.</div>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 5, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>Sort:</span>
            {([["unit", "Unit #"], ["total", "Amount"], ["count", "Frequency"]] as const).map(([s, l]) => (
              <button key={s} style={chipStyle(sortBy === s)} onClick={() => setSortBy(s)}>{l}</button>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
            <CsvButton onClick={() => downloadCSV(`maintenance-ledger-${fy ?? "all"}.csv`, [
              ["Unit / Flat", "Invoices", "Total Collected (₹)", "Last Payment"],
              ...units.map(u => [u.unit, u.count, (u.totalPaise / 100).toFixed(2), u.lastDate.slice(0, 10)]),
            ])} />
          </div>
          <div style={{ overflowX: "auto", background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1.5px solid var(--color-border)" }}>
                  {["Unit / Flat", "Invoices", "Total Collected", "Last Payment"].map((h, i) => (
                    <th key={h} style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase" as const, letterSpacing: "0.06em", padding: "9px 14px", textAlign: i === 0 ? "left" : "right" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {units.map((u, i) => {
                  const isOpen = drillUnit === u.unit;
                  const drillRecs = filtered.filter(r => r.projectTag?.trim() === u.unit);
                  return (
                    <React.Fragment key={u.unit}>
                      <tr
                        onClick={() => setDrillUnit(isOpen ? null : u.unit)}
                        style={{ borderBottom: i < units.length - 1 && !isOpen ? "1px solid var(--color-border)" : "none", background: isOpen ? "color-mix(in srgb, var(--color-primary) 6%, transparent)" : i % 2 === 0 ? "transparent" : "var(--color-surface-2)", cursor: "pointer" }}
                      >
                        <td style={{ fontSize: 12.5, color: "var(--color-text)", padding: "10px 14px" }}>
                          <span style={{ fontSize: 10, color: "var(--color-primary)", opacity: 0.7, marginRight: 6 }}>{isOpen ? "▼" : "▶"}</span>
                          <span style={{ background: "color-mix(in srgb, var(--color-primary) 10%, transparent)", color: "var(--color-primary)", borderRadius: 4, padding: "2px 8px", fontSize: 12, fontWeight: 600 }}>{u.unit}</span>
                        </td>
                        <td style={{ fontSize: 12.5, color: "var(--color-text-secondary)", padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{u.count}</td>
                        <td style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-text)", padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtRupee(u.totalPaise)}</td>
                        <td style={{ fontSize: 11.5, color: "var(--color-text-secondary)", padding: "10px 14px", textAlign: "right" }}>
                          {u.lastDate ? new Date(u.lastDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" }) : "—"}
                        </td>
                      </tr>
                      {isOpen && <DrillDownPanel records={drillRecs} onClose={() => setDrillUnit(null)} />}
                    </React.Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: "1.5px solid var(--color-border)", background: "var(--color-surface-2)" }}>
                  <td style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text-secondary)", padding: "10px 14px" }}>Total</td>
                  <td style={{ fontSize: 12.5, fontWeight: 700, padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{units.reduce((s, u) => s + u.count, 0)}</td>
                  <td style={{ fontSize: 12.5, fontWeight: 700, padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtRupee(unitsTotal)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ── Society: Audit (I&E) ──────────────────────────────────────────────────────

function SocietyAuditTab({ records }: { records: InvoiceMeta[] }) {
  const allFYs = useMemo(() => availableFYs(records), [records]);
  const [fy, setFY] = useState<number | null>(currentFY);

  const filtered = useMemo(() => filterByFY(records, fy), [records, fy]);

  const expenditure = useMemo(() => {
    const map = new Map<string, { label: string; count: number; totalPaise: number }>();
    for (const r of filtered) {
      const types = r.docTypes?.length ? r.docTypes : (r.docType ? [r.docType] : ["other"]);
      for (const t of types) {
        const label = ALL_DOC_TYPE_LABELS[t] ?? t;
        if (!map.has(label)) map.set(label, { label, count: 0, totalPaise: 0 });
        const b = map.get(label)!;
        b.count++;
        b.totalPaise += r.grandTotalPaise ?? 0;
      }
    }
    return [...map.values()].sort((a, b) => b.totalPaise - a.totalPaise);
  }, [filtered]);

  const totalExpenditure = expenditure.reduce((s, e) => s + e.totalPaise, 0);
  const maxExp = Math.max(...expenditure.map(e => e.totalPaise), 1);
  const fyStr = fy !== null ? fyLabel(fy) : "All Time";

  return (
    <div style={{ padding: "20px", maxWidth: 900, margin: "0 auto" }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--color-text)", margin: 0 }}>Income & Expenditure</h2>
        <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 3 }}>Annual I&amp;E statement for committee audit — {fyStr}</p>
      </div>

      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 14 }}>
        {allFYs.map(f => <button key={f} style={chipStyle(fy === f)} onClick={() => setFY(f)}>{fyLabel(f)}</button>)}
        <button style={chipStyle(fy === null)} onClick={() => setFY(null)}>All Time</button>
      </div>

      {/* I&E summary boxes */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
        <div style={{ padding: "14px 16px", background: "color-mix(in srgb, #16a34a 8%, var(--color-surface))", borderRadius: 10, border: "1px solid color-mix(in srgb, #16a34a 25%, transparent)" }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: "#16a34a", textTransform: "uppercase" as const, letterSpacing: "0.05em", marginBottom: 5 }}>Income (Receipts)</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#16a34a", fontVariantNumeric: "tabular-nums" }}>—</div>
          <div style={{ fontSize: 10.5, color: "#16a34a", opacity: 0.7, marginTop: 3 }}>Receipt tracking coming soon</div>
        </div>
        <div style={{ padding: "14px 16px", background: "color-mix(in srgb, #dc2626 8%, var(--color-surface))", borderRadius: 10, border: "1px solid color-mix(in srgb, #dc2626 25%, transparent)" }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: "#dc2626", textTransform: "uppercase" as const, letterSpacing: "0.05em", marginBottom: 5 }}>Expenditure (Payments)</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#dc2626", fontVariantNumeric: "tabular-nums" }}>{fmtRupee(totalExpenditure)}</div>
          <div style={{ fontSize: 10.5, color: "#dc2626", opacity: 0.7, marginTop: 3 }}>{filtered.length} bills / invoices</div>
        </div>
      </div>

      <SummaryCards cards={[
        { label: "Total Bills",    value: String(filtered.length) },
        { label: "Expenditure",    value: fmtShort(totalExpenditure), color: "#dc2626" },
        { label: "Tax Paid (GST)", value: fmtShort(filtered.reduce((s, r) => s + (r.taxPaise ?? 0), 0)) },
        { label: "Expense Heads",  value: String(expenditure.length) },
      ]} />

      {expenditure.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 0", color: "var(--color-text-secondary)", fontSize: 13 }}>No expenditure data for this period.</div>
      ) : (
        <>
          <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10, padding: "16px", marginBottom: 16 }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 12 }}>Expenditure by Head</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {expenditure.map(e => <BarRow key={e.label} label={e.label} value={e.totalPaise} max={maxExp} />)}
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
            <CsvButton onClick={() => downloadCSV(`society-ie-${fy ?? "all"}.csv`, [
              ["Head", "Bills", "Amount (₹)", "% of Total"],
              ...expenditure.map(e => [e.label, e.count, (e.totalPaise / 100).toFixed(2), pct(e.totalPaise, totalExpenditure)]),
              ["TOTAL", filtered.length, (totalExpenditure / 100).toFixed(2), "100%"],
            ])} />
          </div>

          <div style={{ overflowX: "auto", background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1.5px solid var(--color-border)" }}>
                  {["Expense Head", "Bills", "Amount", "% of Total"].map((h, i) => (
                    <th key={h} style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase" as const, letterSpacing: "0.06em", padding: "9px 14px", textAlign: i === 0 ? "left" : "right" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {expenditure.map((e, i) => (
                  <tr key={e.label} style={{ borderBottom: i < expenditure.length - 1 ? "1px solid var(--color-border)" : "none", background: i % 2 === 0 ? "transparent" : "var(--color-surface-2)" }}>
                    <td style={{ fontSize: 12.5, color: "var(--color-text)", padding: "10px 14px" }}>{e.label}</td>
                    <td style={{ fontSize: 12.5, color: "var(--color-text-secondary)", padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{e.count}</td>
                    <td style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-text)", padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtRupee(e.totalPaise)}</td>
                    <td style={{ fontSize: 12, color: "var(--color-text-secondary)", padding: "10px 14px", textAlign: "right" }}>{pct(e.totalPaise, totalExpenditure)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: "1.5px solid var(--color-border)", background: "var(--color-surface-2)" }}>
                  <td style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text-secondary)", padding: "10px 14px" }}>Total Expenditure</td>
                  <td style={{ fontSize: 12.5, fontWeight: 700, padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{filtered.length}</td>
                  <td style={{ fontSize: 12.5, fontWeight: 700, padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtRupee(totalExpenditure)}</td>
                  <td style={{ fontSize: 12, fontWeight: 700, padding: "10px 14px", textAlign: "right" }}>100%</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ── Profile-based tab visibility ──────────────────────────────────────────────

type UserProfile = "personal" | "society" | "shopkeeper" | "tax_consultant" | "ca" | "real_estate" | "advocate";

const GST_PROFILES: UserProfile[] = ["society", "shopkeeper", "tax_consultant", "ca", "real_estate", "advocate"];
const TAGS_PROFILES: UserProfile[] = ["tax_consultant", "ca", "real_estate", "advocate"];

function visibleTabs(mode: string): ReportTab[] {
  const tabs: ReportTab[] = ["summary", "period", "vendor", "category"];
  if (GST_PROFILES.includes(mode as UserProfile)) tabs.unshift("gst");
  if (TAGS_PROFILES.includes(mode as UserProfile)) tabs.push("tags");
  if (mode === "personal") tabs.push("personal_budget", "personal_tax");
  if (mode === "society")  { tabs.push("society_ledger"); tabs.push("society_audit"); }
  return tabs;
}

// ── Root ──────────────────────────────────────────────────────────────────────

export function ReportScreen() {
  const { records, loading } = useInvoices();

  const mode = prefs.activeMode ?? "personal";
  const tabs = useMemo(() => visibleTabs(mode), [mode]);

  const ALL_TABS: { id: ReportTab; label: string }[] = [
    { id: "gst",             label: "GST" },
    { id: "summary",         label: "Summary" },
    { id: "period",          label: "Period" },
    { id: "vendor",          label: "Vendor" },
    { id: "tags",            label: "Tags" },
    { id: "category",        label: "Category" },
    { id: "personal_budget", label: "Budget" },
    { id: "personal_tax",    label: "Tax Savings" },
    { id: "society_ledger",  label: "Ledger" },
    { id: "society_audit",   label: "Audit (I&E)" },
  ];

  const TABS = ALL_TABS.filter(t => tabs.includes(t.id));

  const [tab, setTab] = useState<ReportTab>(() => tabs[0] ?? "period");

  // If active profile changes and current tab is no longer visible, reset to first visible tab.
  const activeTab = tabs.includes(tab) ? tab : tabs[0] ?? "period";

  const TAB_STYLE = (active: boolean): React.CSSProperties => ({
    padding: "8px 18px",
    fontSize: 13,
    fontWeight: active ? 700 : 500,
    color: active ? "var(--color-primary)" : "var(--color-text-secondary)",
    background: "transparent",
    border: "none",
    borderBottom: `2.5px solid ${active ? "var(--color-primary)" : "transparent"}`,
    cursor: "pointer",
    transition: "color 0.15s, border-color 0.15s",
    whiteSpace: "nowrap" as const,
  });

  if (loading) return <div className="placeholder-screen"><p>Loading…</p></div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ display: "flex", borderBottom: "1.5px solid var(--color-border)", background: "var(--color-surface)", paddingLeft: 8, flexShrink: 0, overflowX: "auto" }}>
        {TABS.map(t => <button key={t.id} style={TAB_STYLE(activeTab === t.id)} onClick={() => setTab(t.id)}>{t.label}</button>)}
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {activeTab === "gst"             && <GSTReportScreen />}
        {activeTab === "summary"         && <SummaryReportTab      records={records} />}
        {activeTab === "period"          && <PeriodReportTab       records={records} />}
        {activeTab === "vendor"          && <VendorReportTab       records={records} />}
        {activeTab === "tags"            && <TagsReportTab         records={records} />}
        {activeTab === "category"        && <CategoryReportTab     records={records} />}
        {activeTab === "personal_budget" && <PersonalBudgetTab     records={records} />}
        {activeTab === "personal_tax"    && <PersonalTaxSavingsTab records={records} />}
        {activeTab === "society_ledger"  && <SocietyLedgerTab      records={records} />}
        {activeTab === "society_audit"   && <SocietyAuditTab       records={records} />}
      </div>
    </div>
  );
}
