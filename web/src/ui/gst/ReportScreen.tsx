import React, { useCallback, useEffect, useState, useMemo } from "react";
import { GSTReportScreen } from "./GSTReportScreen";
import { db, type InvoiceMeta, type LineItemRow } from "../../data/InvoiceDatabase";
import { prefs } from "../../data/AutoImportPreferences";

type ReportTab = "gst" | "period" | "vendor" | "tags" | "category"
               | "summary" | "personal_budget" | "personal_tax"
               | "society_ledger" | "society_audit" | "society_vendor" | "society_dues" | "society_sinking" | "society_quotes" | "society_meetings"
               | "bookkeeper_ledger"
               | "shop_purchase_register" | "shop_expense_head" | "shop_gst_summary"
               | "tc_client_summary" | "tc_tds_tracker" | "tc_fy_comparison" | "tc_gstr2a"
               | "ca_client_ledger" | "ca_tds_summary" | "ca_fy_comparison" | "ca_audit_trail"
               | "re_property_expense" | "re_rental_income" | "re_acquisition"
               | "adv_matter_billing" | "adv_client_ledger" | "adv_court_fees";
type PeriodView = "daily" | "monthly" | "quarterly" | "yearly" | "custom";

// ── quote line-item fuzzy alignment ───────────────────────────────────────────

const ITEM_STOP = new Set([
  "and","or","of","the","a","an","with","for","in","on","at","to","from","by","per",
  "coat","coats","plus","inc","excl","gst","ls","lumpsum","lump","sum","job",
  "sq","sqft","rft","no","nos",
]);

function tokenizeItem(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(t => t.length > 1 && !ITEM_STOP.has(t) && !/^\d+$/.test(t));
}

function jaccardSim(a: string[], b: string[]): number {
  const sa = new Set(a), sb = new Set(b);
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  const union = new Set([...sa, ...sb]).size;
  return union === 0 ? 0 : inter / union;
}

type AlignedRow = { label: string; cells: Map<number, number> };

function alignLineItems(
  vendorIds: number[],
  lineItemsMap: Map<number, LineItemRow[]>,
  threshold = 0.25,
): AlignedRow[] {
  type Slot = { vendorId: number; name: string; amount: number; tokens: string[]; used: boolean };
  const flat: Slot[] = vendorIds.flatMap(vid =>
    (lineItemsMap.get(vid) ?? []).map(li => ({
      vendorId: vid, name: li.name, amount: li.totalPricePaise,
      tokens: tokenizeItem(li.name), used: false,
    }))
  );

  const rows: AlignedRow[] = [];
  for (let i = 0; i < flat.length; i++) {
    if (flat[i].used) continue;
    flat[i].used = true;
    const row: AlignedRow = { label: flat[i].name, cells: new Map([[flat[i].vendorId, flat[i].amount]]) };

    for (const vid of vendorIds) {
      if (row.cells.has(vid)) continue;
      let bestIdx = -1, bestSim = threshold;
      for (let j = 0; j < flat.length; j++) {
        if (flat[j].used || flat[j].vendorId !== vid) continue;
        const sim = jaccardSim(flat[i].tokens, flat[j].tokens);
        if (sim > bestSim) { bestSim = sim; bestIdx = j; }
      }
      if (bestIdx >= 0) { flat[bestIdx].used = true; row.cells.set(vid, flat[bestIdx].amount); }
    }
    rows.push(row);
  }
  return rows;
}

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
  return records.filter(r => { const d = recDate(r); return !d || d.getFullYear() === year; });
}

function useInvoices() {
  const [records, setRecords] = useState<InvoiceMeta[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    db.invoices.toArray().then(rows =>
      setRecords(rows.filter(r =>
        (r.grandTotalPaise != null || r.category === "meeting_record") &&
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
  const [year, setYear] = useState<number | null>(currentFY());
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
  const [year, setYear] = useState<number | null>(currentFY());
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
  const [year, setYear] = useState<number | null>(currentFY());
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
  const [year, setYear] = useState<number | null>(currentFY());
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
  // Records with no parseable date are included in the selected FY (don't silently drop them)
  return records.filter(r => { const d = recDate(r); return !d || (d >= from && d <= to); });
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

const LEDGER_OPENING_KEY = "jinvoice_society_ledger_opening";

function SocietyLedgerTab({ records }: { records: InvoiceMeta[] }) {
  const allFYs = useMemo(() => availableFYs(records), [records]);
  const [fy, setFY] = useState<number | null>(currentFY);
  const [drillUnit, setDrillUnit] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"unit" | "total" | "count">("unit");
  const [ledgerOpeningPaise, setLedgerOpeningPaise] = useState<number>(() => {
    try { return Number(localStorage.getItem(LEDGER_OPENING_KEY) ?? "0"); } catch { return 0; }
  });
  const [ledgerOpeningInput, setLedgerOpeningInput] = useState("");

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

      {/* Opening balance for MCS Act CSV */}
      <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10, padding: "12px 14px", marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase" as const, letterSpacing: "0.05em", marginBottom: 8 }}>Opening Balance (₹) — for MCS Act CSV</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="number" placeholder={`Current: ${(ledgerOpeningPaise / 100).toFixed(0)}`} value={ledgerOpeningInput}
            onChange={e => setLedgerOpeningInput(e.target.value)}
            style={{ width: 130, padding: "5px 8px", borderRadius: 6, border: "1px solid var(--color-border)", background: "var(--color-bg)", color: "var(--color-text)", fontSize: 13 }} />
          <button onClick={() => {
            const v = Math.round(parseFloat(ledgerOpeningInput) * 100);
            if (!isNaN(v) && v >= 0) {
              setLedgerOpeningPaise(v);
              try { localStorage.setItem(LEDGER_OPENING_KEY, String(v)); } catch { /* ignore */ }
            }
            setLedgerOpeningInput("");
          }}
            style={{ padding: "5px 12px", borderRadius: 6, border: "none", background: "var(--color-primary)", color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>Set</button>
          <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>Arrears at period start — included in the Dr/Cr ledger export</span>
        </div>
      </div>

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
            <CsvButton onClick={() => {
              // MCS Act / Maharashtra Cooperative Housing Society ledger format
              const fyStr = fy !== null ? fyLabel(fy) : "All Time";
              const rows: (string | number)[][] = [
                [`Maintenance Collection Ledger — ${fyStr}`, "", "", "", "", ""],
                ["Unit / Flat", "Date", "Particulars", "Dr (Due)", "Cr (Paid)", "Balance (₹)"],
                ["Opening Balance", "", "", (ledgerOpeningPaise / 100).toFixed(2), "", (ledgerOpeningPaise / 100).toFixed(2)],
              ];
              let balance = ledgerOpeningPaise;
              const unitsSorted = [...units].sort((a, b) => a.unit.localeCompare(b.unit));
              for (const u of unitsSorted) {
                const invs = filtered
                  .filter(r => r.projectTag?.trim() === u.unit)
                  .sort((a, b) => (a.invoiceDate ?? "").localeCompare(b.invoiceDate ?? ""));
                for (const inv of invs) {
                  const amt = inv.grandTotalPaise ?? 0;
                  balance += amt;
                  rows.push([
                    u.unit,
                    (inv.invoiceDate ?? "").slice(0, 10),
                    inv.merchantName ?? "Maintenance",
                    "",
                    (amt / 100).toFixed(2),
                    (balance / 100).toFixed(2),
                  ]);
                }
              }
              rows.push(["Closing Balance", "", "", "", (unitsTotal / 100).toFixed(2), (balance / 100).toFixed(2)]);
              downloadCSV(`maintenance-ledger-mcs-${fy ?? "all"}.csv`, rows);
            }} />
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
  // Start with null; snap to the most recent FY once records load (avoids FY mismatch on first render)
  const [fy, setFY] = useState<number | null>(null);
  const [fyLocked, setFYLocked] = useState(false);
  useEffect(() => {
    if (!fyLocked && allFYs.length > 0) { setFY(allFYs[0]); setFYLocked(true); }
  }, [allFYs, fyLocked]);

  const filtered = useMemo(() => filterByFY(records, fy), [records, fy]);

  // Income = maintenance receipts tagged with a flat/unit (projectTag present)
  const incomeRecords  = useMemo(() => filtered.filter(r => !!r.projectTag?.trim()), [filtered]);
  const totalIncome    = useMemo(() => incomeRecords.reduce((s, r) => s + (r.grandTotalPaise ?? 0), 0), [incomeRecords]);

  // Expenditure = vendor/expense invoices (no projectTag), grouped by doc type
  const expenseRecords = useMemo(() => filtered.filter(r => !r.projectTag?.trim()), [filtered]);
  const expenditure = useMemo(() => {
    const map = new Map<string, { label: string; count: number; totalPaise: number }>();
    for (const r of expenseRecords) {
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
  }, [expenseRecords]);

  const totalExpenditure = expenditure.reduce((s, e) => s + e.totalPaise, 0);
  const surplus          = totalIncome - totalExpenditure;
  const maxExp           = Math.max(...expenditure.map(e => e.totalPaise), 1);
  const fyStr            = fy !== null ? fyLabel(fy) : "All Time";

  function downloadIECsv() {
    const rows: (string | number)[][] = [
      [`Income & Expenditure Statement — ${fyStr}`, "", "", ""],
      ["", "", "", ""],
      ["INCOME", "", "", ""],
      ["Particulars", "Units/Flats", "Amount (₹)", ""],
      ["Maintenance Receipts (from tagged flats)", incomeRecords.length, (totalIncome / 100).toFixed(2), ""],
      ["Total Income", "", (totalIncome / 100).toFixed(2), ""],
      ["", "", "", ""],
      ["EXPENDITURE", "", "", ""],
      ["Head", "Bills", "Amount (₹)", "% of Total"],
      ...expenditure.map(e => [e.label, e.count, (e.totalPaise / 100).toFixed(2), pct(e.totalPaise, totalExpenditure)]),
      ["Total Expenditure", expenseRecords.length, (totalExpenditure / 100).toFixed(2), "100%"],
      ["", "", "", ""],
      [surplus >= 0 ? "Surplus" : "Deficit", "", ((Math.abs(surplus)) / 100).toFixed(2), ""],
    ];
    downloadCSV(`society-ie-${fy ?? "all"}.csv`, rows);
  }

  return (
    <div style={{ padding: "20px", maxWidth: 900, margin: "0 auto" }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--color-text)", margin: 0 }}>Income & Expenditure</h2>
        <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 3 }}>Annual I&amp;E statement for committee audit — {fyStr}. Income = unit-tagged records (maintenance receipts); Expenditure = untagged vendor payments.</p>
      </div>

      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 14 }}>
        {allFYs.map(f => <button key={f} style={chipStyle(fy === f)} onClick={() => setFY(f)}>{fyLabel(f)}</button>)}
        <button style={chipStyle(fy === null)} onClick={() => setFY(null)}>All Time</button>
      </div>

      {/* I&E summary boxes */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 20 }}>
        <div style={{ padding: "14px 16px", background: "color-mix(in srgb, #16a34a 8%, var(--color-surface))", borderRadius: 10, border: "1px solid color-mix(in srgb, #16a34a 25%, transparent)" }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: "#16a34a", textTransform: "uppercase" as const, letterSpacing: "0.05em", marginBottom: 5 }}>Income (Receipts)</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#16a34a", fontVariantNumeric: "tabular-nums" }}>{fmtRupee(totalIncome)}</div>
          <div style={{ fontSize: 10.5, color: "#16a34a", opacity: 0.7, marginTop: 3 }}>{incomeRecords.length} tagged receipts</div>
        </div>
        <div style={{ padding: "14px 16px", background: "color-mix(in srgb, #dc2626 8%, var(--color-surface))", borderRadius: 10, border: "1px solid color-mix(in srgb, #dc2626 25%, transparent)" }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: "#dc2626", textTransform: "uppercase" as const, letterSpacing: "0.05em", marginBottom: 5 }}>Expenditure (Payments)</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#dc2626", fontVariantNumeric: "tabular-nums" }}>{fmtRupee(totalExpenditure)}</div>
          <div style={{ fontSize: 10.5, color: "#dc2626", opacity: 0.7, marginTop: 3 }}>{expenseRecords.length} vendor bills</div>
        </div>
        <div style={{
          padding: "14px 16px", borderRadius: 10,
          background: `color-mix(in srgb, ${surplus >= 0 ? "#16a34a" : "#dc2626"} 8%, var(--color-surface))`,
          border: `1px solid color-mix(in srgb, ${surplus >= 0 ? "#16a34a" : "#dc2626"} 25%, transparent)`,
        }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: surplus >= 0 ? "#16a34a" : "#dc2626", textTransform: "uppercase" as const, letterSpacing: "0.05em", marginBottom: 5 }}>
            {surplus >= 0 ? "Surplus" : "Deficit"}
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: surplus >= 0 ? "#16a34a" : "#dc2626", fontVariantNumeric: "tabular-nums" }}>{fmtRupee(Math.abs(surplus))}</div>
          <div style={{ fontSize: 10.5, color: surplus >= 0 ? "#16a34a" : "#dc2626", opacity: 0.7, marginTop: 3 }}>Income − Expenditure</div>
        </div>
      </div>

      <SummaryCards cards={[
        { label: "Income",         value: fmtShort(totalIncome),       color: "#16a34a" },
        { label: "Expenditure",    value: fmtShort(totalExpenditure),   color: "#dc2626" },
        { label: "Tax Paid (GST)", value: fmtShort(expenseRecords.reduce((s, r) => s + (r.taxPaise ?? 0), 0)) },
        { label: "Expense Heads",  value: String(expenditure.length) },
      ]} />

      {expenditure.length === 0 && incomeRecords.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 0", color: "var(--color-text-secondary)", fontSize: 13 }}>
          No records for this period.{" "}
          <span style={{ opacity: 0.7, fontSize: 12 }}>
            Upload maintenance receipts and tag them with a flat number (e.g. A-101) to see income here.
          </span>
        </div>
      ) : (
        <>
          {/* ── Income by Flat ─────────────────────────────────────────────── */}
          {incomeRecords.length > 0 && (() => {
            const byFlat = new Map<string, { count: number; totalPaise: number }>();
            for (const r of incomeRecords) {
              const tag = r.projectTag!.trim();
              if (!byFlat.has(tag)) byFlat.set(tag, { count: 0, totalPaise: 0 });
              const b = byFlat.get(tag)!;
              b.count++;
              b.totalPaise += r.grandTotalPaise ?? 0;
            }
            const rows = [...byFlat.entries()].sort((a, b) => a[0].localeCompare(b[0]));
            return (
              <div style={{ overflowX: "auto", background: "var(--color-surface)", border: "1px solid color-mix(in srgb, #16a34a 30%, transparent)", borderRadius: 10, marginBottom: 16 }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: "#16a34a", textTransform: "uppercase" as const, letterSpacing: "0.06em", padding: "12px 16px 0" }}>Income — by Flat / Unit</div>
                <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
                  <thead>
                    <tr style={{ borderBottom: "1.5px solid var(--color-border)" }}>
                      {["Flat / Tag", "Receipts", "Amount"].map((h, i) => (
                        <th key={h} style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase" as const, letterSpacing: "0.06em", padding: "8px 16px", textAlign: i === 0 ? "left" : "right" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(([tag, v], i) => (
                      <tr key={tag} style={{ borderBottom: i < rows.length - 1 ? "1px solid var(--color-border)" : "none", background: i % 2 === 0 ? "transparent" : "var(--color-surface-2)" }}>
                        <td style={{ fontSize: 12.5, fontWeight: 600, color: "#16a34a", padding: "9px 16px" }}>{tag}</td>
                        <td style={{ fontSize: 12.5, color: "var(--color-text-secondary)", padding: "9px 16px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{v.count}</td>
                        <td style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-text)", padding: "9px 16px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtRupee(v.totalPaise)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: "1.5px solid var(--color-border)", background: "color-mix(in srgb, #16a34a 6%, var(--color-surface-2))" }}>
                      <td style={{ fontSize: 12, fontWeight: 700, color: "#16a34a", padding: "10px 16px" }}>Total Income</td>
                      <td style={{ fontSize: 12.5, fontWeight: 700, padding: "10px 16px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{incomeRecords.length}</td>
                      <td style={{ fontSize: 12.5, fontWeight: 800, color: "#16a34a", padding: "10px 16px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtRupee(totalIncome)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            );
          })()}

          {incomeRecords.length === 0 && (
            <div style={{ padding: "14px 16px", background: "color-mix(in srgb, #16a34a 5%, var(--color-surface))", border: "1px dashed color-mix(in srgb, #16a34a 30%, transparent)", borderRadius: 10, marginBottom: 16, fontSize: 12, color: "var(--color-text-secondary)" }}>
              No income receipts tagged yet. Open a maintenance receipt in the View screen and set its <strong>Project Tag</strong> to a flat number (e.g. <strong>A-101</strong>) to include it as income.
            </div>
          )}

          {expenditure.length > 0 && (
            <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10, padding: "16px", marginBottom: 16 }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 12 }}>Expenditure by Head</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {expenditure.map(e => <BarRow key={e.label} label={e.label} value={e.totalPaise} max={maxExp} />)}
              </div>
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
            <CsvButton onClick={downloadIECsv} />
          </div>

          {expenditure.length > 0 && (
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
                    <td style={{ fontSize: 12.5, fontWeight: 700, padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{expenseRecords.length}</td>
                    <td style={{ fontSize: 12.5, fontWeight: 700, padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtRupee(totalExpenditure)}</td>
                    <td style={{ fontSize: 12, fontWeight: 700, padding: "10px 14px", textAlign: "right" }}>100%</td>
                  </tr>
                  {surplus !== 0 && (
                    <tr style={{ borderTop: "2px solid var(--color-border)", background: surplus >= 0 ? "color-mix(in srgb, #16a34a 6%, var(--color-surface-2))" : "color-mix(in srgb, #dc2626 6%, var(--color-surface-2))" }}>
                      <td style={{ fontSize: 12, fontWeight: 700, color: surplus >= 0 ? "#16a34a" : "#dc2626", padding: "10px 14px" }} colSpan={2}>
                        {surplus >= 0 ? "Surplus (Income − Expenditure)" : "Deficit (Expenditure − Income)"}
                      </td>
                      <td style={{ fontSize: 12.5, fontWeight: 800, color: surplus >= 0 ? "#16a34a" : "#dc2626", padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }} colSpan={2}>
                        {fmtRupee(Math.abs(surplus))}
                      </td>
                    </tr>
                  )}
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Society: Vendor Payments ──────────────────────────────────────────────────

function SocietyVendorTab({ records }: { records: InvoiceMeta[] }) {
  const allFYs = useMemo(() => availableFYs(records), [records]);
  const [fy, setFY] = useState<number | null>(currentFY);
  const [filterCat, setFilterCat] = useState<string | null>(null);
  const [expandedVendor, setExpandedVendor] = useState<string | null>(null);

  const filtered = useMemo(() => filterByFY(records, fy), [records, fy]);

  const categories = useMemo(() => {
    const s = new Set<string>();
    filtered.forEach(r => { if (r.docType) s.add(r.docType); });
    return [...s].sort();
  }, [filtered]);

  const byVendor = useMemo(() => {
    const map = new Map<string, { name: string; count: number; totalPaise: number; cat: string; recs: InvoiceMeta[] }>();
    const catFiltered = filterCat ? filtered.filter(r => r.docType === filterCat) : filtered;
    for (const r of catFiltered) {
      const name = r.merchantName?.trim() || "Unknown Vendor";
      if (!map.has(name)) map.set(name, { name, count: 0, totalPaise: 0, cat: r.docType ?? "other", recs: [] });
      const v = map.get(name)!;
      v.count++;
      v.totalPaise += r.grandTotalPaise ?? 0;
      v.recs.push(r);
    }
    return [...map.values()].sort((a, b) => b.totalPaise - a.totalPaise);
  }, [filtered, filterCat]);

  const grandTotal = byVendor.reduce((s, v) => s + v.totalPaise, 0);

  return (
    <div style={{ padding: "20px", maxWidth: 900, margin: "0 auto" }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--color-text)", margin: 0 }}>Vendor Payments</h2>
        <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 3 }}>All contractor and service bills grouped by vendor</p>
      </div>

      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 14 }}>
        {allFYs.map(f => <button key={f} style={chipStyle(fy === f)} onClick={() => setFY(f)}>{fyLabel(f)}</button>)}
        <button style={chipStyle(fy === null)} onClick={() => setFY(null)}>All Time</button>
      </div>

      {categories.length > 0 && (
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 14 }}>
          <button style={chipStyle(filterCat === null)} onClick={() => setFilterCat(null)}>All Categories</button>
          {categories.map(c => (
            <button key={c} style={chipStyle(filterCat === c)} onClick={() => setFilterCat(c)}>
              {ALL_DOC_TYPE_LABELS[c] ?? c}
            </button>
          ))}
        </div>
      )}

      <SummaryCards cards={[
        { label: "Vendors",       value: String(byVendor.length) },
        { label: "Total Paid",    value: fmtShort(grandTotal), color: "#dc2626" },
        { label: "Bills",         value: String(byVendor.reduce((s, v) => s + v.count, 0)) },
        { label: "Avg per Vendor",value: byVendor.length > 0 ? fmtShort(Math.round(grandTotal / byVendor.length)) : "—" },
      ]} />

      {byVendor.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 0", color: "var(--color-text-secondary)", fontSize: 13 }}>No vendor records for this period.</div>
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
            <CsvButton onClick={() => downloadCSV(`society-vendors-${fy ?? "all"}.csv`, [
              ["Vendor", "Category", "Bills", "Total Paid (₹)"],
              ...byVendor.map(v => [v.name, ALL_DOC_TYPE_LABELS[v.cat] ?? v.cat, v.count, (v.totalPaise / 100).toFixed(2)]),
              ["TOTAL", "", byVendor.reduce((s, v) => s + v.count, 0), (grandTotal / 100).toFixed(2)],
            ])} />
          </div>
          <div style={{ overflowX: "auto", background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1.5px solid var(--color-border)" }}>
                  {["Vendor", "Category", "Bills", "Total Paid"].map((h, i) => (
                    <th key={h} style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase" as const, letterSpacing: "0.06em", padding: "9px 14px", textAlign: i < 2 ? "left" : "right" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {byVendor.map((v, i) => {
                  const isOpen = expandedVendor === v.name;
                  return (
                    <React.Fragment key={v.name}>
                      <tr onClick={() => setExpandedVendor(isOpen ? null : v.name)}
                        style={{ borderBottom: i < byVendor.length - 1 && !isOpen ? "1px solid var(--color-border)" : "none", background: isOpen ? "color-mix(in srgb, var(--color-primary) 6%, transparent)" : i % 2 === 0 ? "transparent" : "var(--color-surface-2)", cursor: "pointer" }}>
                        <td style={{ fontSize: 12.5, color: "var(--color-text)", padding: "10px 14px" }}>
                          <span style={{ fontSize: 10, color: "var(--color-primary)", opacity: 0.7, marginRight: 6 }}>{isOpen ? "▼" : "▶"}</span>
                          {v.name}
                        </td>
                        <td style={{ fontSize: 11.5, color: "var(--color-text-secondary)", padding: "10px 14px" }}>
                          <span style={{ background: "var(--color-surface-2)", borderRadius: 4, padding: "2px 7px", fontSize: 11 }}>
                            {ALL_DOC_TYPE_LABELS[v.cat] ?? v.cat}
                          </span>
                        </td>
                        <td style={{ fontSize: 12.5, color: "var(--color-text-secondary)", padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{v.count}</td>
                        <td style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-text)", padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtRupee(v.totalPaise)}</td>
                      </tr>
                      {isOpen && <DrillDownPanel records={v.recs} onClose={() => setExpandedVendor(null)} />}
                    </React.Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: "1.5px solid var(--color-border)", background: "var(--color-surface-2)" }}>
                  <td style={{ fontSize: 12, fontWeight: 700, padding: "10px 14px" }} colSpan={2}>Total</td>
                  <td style={{ fontSize: 12.5, fontWeight: 700, padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{byVendor.reduce((s, v) => s + v.count, 0)}</td>
                  <td style={{ fontSize: 12.5, fontWeight: 700, padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtRupee(grandTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ── Society: Outstanding Dues ─────────────────────────────────────────────────

type DueFrequency = "monthly" | "yearly";
const DUES_KEY          = "jinvoice_society_expected_maintenance";
const DUES_KEY_YEARLY   = "jinvoice_society_expected_maintenance_yearly";
const DUES_FREQ_KEY     = "jinvoice_society_dues_frequency";

function loadDueFrequency(): DueFrequency {
  try { return (localStorage.getItem(DUES_FREQ_KEY) as DueFrequency) ?? "monthly"; } catch { return "monthly"; }
}
function saveDueFrequency(f: DueFrequency): void {
  try { localStorage.setItem(DUES_FREQ_KEY, f); } catch { /* ignore */ }
}
function loadExpectedForFreq(freq: DueFrequency): Record<string, number> {
  const key = freq === "yearly" ? DUES_KEY_YEARLY : DUES_KEY;
  try { return JSON.parse(localStorage.getItem(key) ?? "{}"); } catch { return {}; }
}
function saveExpectedForFreq(e: Record<string, number>, freq: DueFrequency): void {
  const key = freq === "yearly" ? DUES_KEY_YEARLY : DUES_KEY;
  try { localStorage.setItem(key, JSON.stringify(e)); } catch { /* ignore */ }
}

function SocietyDuesTab({ records }: { records: InvoiceMeta[] }) {
  const allFYs = useMemo(() => availableFYs(records), [records]);
  const [fy, setFY] = useState<number | null>(currentFY);
  const [frequency, setFrequency] = useState<DueFrequency>(loadDueFrequency);
  const [expected, setExpected] = useState<Record<string, number>>(() => loadExpectedForFreq(loadDueFrequency()));
  const [globalAmt, setGlobalAmt] = useState("");
  // incremented on every amount change so uncontrolled inputs remount with fresh defaultValue
  const [amtVersion, setAmtVersion] = useState(0);

  const filtered = useMemo(() => filterByFY(records, fy), [records, fy]);

  // Find all unique units from tagged records (across all time, so all flats are tracked)
  const allUnits = useMemo(() => {
    const s = new Set<string>();
    records.forEach(r => { if (r.projectTag?.trim()) s.add(r.projectTag.trim()); });
    return [...s].sort();
  }, [records]);

  // Oldest month that has any tagged record — used as floor for monthly "All Time"
  const oldestTaggedMonth = useMemo(() => {
    let oldest: Date | null = null;
    for (const r of records) {
      if (!r.projectTag?.trim()) continue;
      const d = r.invoiceDate ?? r.createdAt;
      if (!d) continue;
      const dt = new Date(d);
      if (!oldest || dt < oldest) oldest = dt;
    }
    return oldest ? new Date(oldest.getFullYear(), oldest.getMonth(), 1) : new Date();
  }, [records]);

  // Periods: months or FY-years depending on frequency
  const periods: { key: string; label: string }[] = useMemo(() => {
    if (frequency === "monthly") {
      const { from, to } = fy !== null ? fyBounds(fy) : { from: oldestTaggedMonth, to: new Date() };
      const result: { key: string; label: string }[] = [];
      const cur = new Date(from.getFullYear(), from.getMonth(), 1);
      while (cur <= to) {
        result.push({
          key: `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}`,
          label: cur.toLocaleDateString("en-IN", { month: "short", year: "2-digit" }),
        });
        cur.setMonth(cur.getMonth() + 1);
      }
      return result;
    } else {
      if (fy !== null) return [{ key: `fy-${fy}`, label: fyLabel(fy) }];
      return allFYs.map(f => ({ key: `fy-${f}`, label: fyLabel(f) }));
    }
  }, [frequency, fy, oldestTaggedMonth, allFYs]);

  // Map: unit → set of period keys that have at least one record
  const unitPeriods = useMemo(() => {
    const map = new Map<string, Set<string>>();
    // For yearly, scan all records so we know which FYs each unit has paid regardless of FY filter
    const src = frequency === "yearly" ? records : filtered;
    for (const r of src) {
      const tag = r.projectTag?.trim();
      if (!tag) continue;
      const d = r.invoiceDate ?? r.createdAt;
      if (!d) continue;
      const dt = new Date(d);
      let key: string;
      if (frequency === "monthly") {
        key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
      } else {
        const rFY = dt.getMonth() >= 3 ? dt.getFullYear() : dt.getFullYear() - 1;
        key = `fy-${rFY}`;
      }
      if (!map.has(tag)) map.set(tag, new Set());
      map.get(tag)!.add(key);
    }
    return map;
  }, [records, filtered, frequency]);

  function switchFrequency(f: DueFrequency) {
    setFrequency(f);
    saveDueFrequency(f);
    setExpected(loadExpectedForFreq(f));
    setAmtVersion(v => v + 1);
    setGlobalAmt("");
  }

  function applyGlobal() {
    const amt = parseFloat(globalAmt);
    if (isNaN(amt) || amt <= 0) return;
    const newExpected: Record<string, number> = { ...expected };
    allUnits.forEach(u => { newExpected[u] = Math.round(amt * 100); });
    setExpected(newExpected);
    saveExpectedForFreq(newExpected, frequency);
    setAmtVersion(v => v + 1);
    setGlobalAmt("");
  }

  // Build dues rows: units × periods, show only missing ones
  const dueRows = useMemo(() => {
    const rows: { unit: string; period: string; periodLabel: string; expectedPaise: number }[] = [];
    for (const unit of allUnits) {
      const paid = unitPeriods.get(unit) ?? new Set<string>();
      for (const p of periods) {
        if (!paid.has(p.key)) {
          rows.push({ unit, period: p.key, periodLabel: p.label, expectedPaise: expected[unit] ?? 0 });
        }
      }
    }
    return rows.sort((a, b) => a.unit.localeCompare(b.unit) || a.period.localeCompare(b.period));
  }, [allUnits, unitPeriods, periods, expected]);

  const totalDue = dueRows.reduce((s, r) => s + r.expectedPaise, 0);

  return (
    <div style={{ padding: "20px", maxWidth: 900, margin: "0 auto" }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--color-text)", margin: 0 }}>Outstanding Dues</h2>
        <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 3 }}>Units with missing maintenance payments — based on {frequency === "monthly" ? "months" : "years"} with no invoice tagged to that flat</p>
      </div>

      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8 }}>
        {allFYs.map(f => <button key={f} style={chipStyle(fy === f)} onClick={() => setFY(f)}>{fyLabel(f)}</button>)}
        <button style={chipStyle(fy === null)} onClick={() => setFY(null)}>All Time</button>
      </div>

      {/* Frequency toggle */}
      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        {(["monthly", "yearly"] as DueFrequency[]).map(f => (
          <button key={f} onClick={() => switchFrequency(f)}
            style={{ fontSize: 12, padding: "3px 14px", borderRadius: 20, border: "1.5px solid", cursor: "pointer",
              borderColor: frequency === f ? "var(--color-primary)" : "var(--color-border)",
              background: frequency === f ? "color-mix(in srgb, var(--color-primary) 12%, transparent)" : "transparent",
              color: frequency === f ? "var(--color-primary)" : "var(--color-text-secondary)", fontWeight: frequency === f ? 700 : 400 }}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Expected amount setter */}
      <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10, padding: "14px 16px", marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text)", marginBottom: 10 }}>
          {frequency === "monthly" ? "Monthly" : "Yearly"} Maintenance Amount
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>Set for all units:</span>
          <input
            type="number" placeholder={frequency === "monthly" ? "e.g. 2000" : "e.g. 24000"} value={globalAmt}
            onChange={e => setGlobalAmt(e.target.value)}
            style={{ width: 110, padding: "5px 8px", borderRadius: 6, border: "1px solid var(--color-border)", background: "var(--color-bg)", color: "var(--color-text)", fontSize: 13 }}
          />
          <button onClick={applyGlobal}
            style={{ padding: "5px 12px", borderRadius: 6, border: "none", background: "var(--color-primary)", color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
            Apply
          </button>
          <span style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>or set per-unit amounts below</span>
        </div>
      </div>

      {allUnits.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 24px", color: "var(--color-text-secondary)", fontSize: 13, background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>No unit-tagged invoices found</div>
          <div style={{ fontSize: 12, opacity: 0.8 }}>Tag invoices with flat numbers (Project Tag in View screen) to track dues.</div>
        </div>
      ) : (
        <>
          <SummaryCards cards={[
            { label: "Units Tracked",   value: String(allUnits.length) },
            { label: frequency === "monthly" ? "Missing Months" : "Missing Years", value: String(dueRows.length), color: "#dc2626" },
            { label: "Total Dues",      value: totalDue > 0 ? fmtShort(totalDue) : "—", color: "#dc2626" },
            { label: "Period",          value: fy !== null ? fyLabel(fy) : "All Time" },
          ]} />

          {dueRows.length === 0 ? (
            <div style={{ textAlign: "center", padding: "32px", color: "#16a34a", fontSize: 14, fontWeight: 600, background: "color-mix(in srgb, #16a34a 8%, var(--color-surface))", border: "1px solid color-mix(in srgb, #16a34a 25%, transparent)", borderRadius: 10 }}>
              All units have records for every {frequency === "monthly" ? "month" : "year"} in this period.
            </div>
          ) : (
            <>
              <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
                <CsvButton onClick={() => downloadCSV(`society-dues-${fy ?? "all"}.csv`, [
                  ["Unit / Flat", frequency === "monthly" ? "Month" : "Year", "Expected (₹)"],
                  ...dueRows.map(r => [r.unit, r.periodLabel, r.expectedPaise > 0 ? (r.expectedPaise / 100).toFixed(2) : "—"]),
                ])} />
              </div>
              <div style={{ overflowX: "auto", background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10 }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "1.5px solid var(--color-border)" }}>
                      {["Unit / Flat", frequency === "monthly" ? "Missing Month" : "Missing Year", "Expected (₹)", "Set Amount"].map((h, i) => (
                        <th key={h} style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase" as const, letterSpacing: "0.06em", padding: "9px 14px", textAlign: i < 2 ? "left" : "right" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {dueRows.map((r, i) => (
                      <tr key={`${r.unit}-${r.period}-${amtVersion}`}
                        style={{ borderBottom: i < dueRows.length - 1 ? "1px solid var(--color-border)" : "none", background: i % 2 === 0 ? "transparent" : "var(--color-surface-2)" }}>
                        <td style={{ padding: "9px 14px" }}>
                          <span style={{ background: "color-mix(in srgb, #dc2626 10%, transparent)", color: "#dc2626", borderRadius: 4, padding: "2px 8px", fontSize: 12, fontWeight: 600 }}>{r.unit}</span>
                        </td>
                        <td style={{ padding: "9px 14px", fontSize: 12.5, color: "var(--color-text-secondary)" }}>{r.periodLabel}</td>
                        <td style={{ padding: "9px 14px", textAlign: "right", fontSize: 12.5, fontWeight: 600, fontVariantNumeric: "tabular-nums", color: r.expectedPaise > 0 ? "#dc2626" : "var(--color-text-tertiary)" }}>
                          {r.expectedPaise > 0 ? fmtRupee(r.expectedPaise) : "—"}
                        </td>
                        <td style={{ padding: "9px 14px", textAlign: "right" }}>
                          <input
                            type="number" placeholder={frequency === "monthly" ? "₹/mo" : "₹/yr"}
                            defaultValue={expected[r.unit] ? (expected[r.unit] / 100).toString() : ""}
                            onBlur={e => {
                              const amt = parseFloat(e.target.value);
                              if (!isNaN(amt) && amt > 0) {
                                const newExpected = { ...expected, [r.unit]: Math.round(amt * 100) };
                                setExpected(newExpected);
                                saveExpectedForFreq(newExpected, frequency);
                                setAmtVersion(v => v + 1);
                              }
                            }}
                            style={{ width: 90, padding: "4px 7px", borderRadius: 5, border: "1px solid var(--color-border)", background: "var(--color-bg)", color: "var(--color-text)", fontSize: 12, textAlign: "right" }}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {totalDue > 0 && (
                    <tfoot>
                      <tr style={{ borderTop: "1.5px solid var(--color-border)", background: "var(--color-surface-2)" }}>
                        <td style={{ fontSize: 12, fontWeight: 700, padding: "10px 14px" }} colSpan={2}>Total Outstanding</td>
                        <td style={{ fontSize: 12.5, fontWeight: 700, color: "#dc2626", padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtRupee(totalDue)}</td>
                        <td />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ── Society: Sinking Fund Ledger ──────────────────────────────────────────────

const SINKING_CORPUS_KEY = "jinvoice_society_sinking_corpus";
const SINKING_OPENING_KEY = "jinvoice_society_sinking_opening";

function loadSinkingCorpus(): number {
  try { return Number(localStorage.getItem(SINKING_CORPUS_KEY) ?? "0"); } catch { return 0; }
}
function saveSinkingCorpus(v: number): void {
  try { localStorage.setItem(SINKING_CORPUS_KEY, String(v)); } catch { /* ignore */ }
}
function loadSinkingOpening(): number {
  try { return Number(localStorage.getItem(SINKING_OPENING_KEY) ?? "0"); } catch { return 0; }
}
function saveSinkingOpening(v: number): void {
  try { localStorage.setItem(SINKING_OPENING_KEY, String(v)); } catch { /* ignore */ }
}

interface SinkingEntry {
  invoiceId: number;
  date: string;
  vendor: string;
  amountPaise: number;
}

function SocietySinkingFundTab({ records }: { records: InvoiceMeta[] }) {
  const allFYs = useMemo(() => availableFYs(records), [records]);
  const [fy, setFY] = useState<number | null>(currentFY);
  const [entries, setEntries] = useState<SinkingEntry[]>([]);
  const [corpusInput, setCorpusInput] = useState("");
  const [openingInput, setOpeningInput] = useState("");
  const [corpusPaise, setCorpusPaise] = useState(loadSinkingCorpus);
  const [openingPaise, setOpeningPaise] = useState(loadSinkingOpening);

  const filtered = useMemo(() => filterByFY(records, fy), [records, fy]);

  useEffect(() => {
    if (filtered.length === 0) { setEntries([]); return; }
    const ids = filtered.map(r => r.id!).filter(Boolean);
    db.lineItems.where("invoiceId").anyOf(ids).toArray().then(items => {
      const result: SinkingEntry[] = [];
      for (const item of items) {
        if (!item.name.toLowerCase().includes("sinking")) continue;
        const inv = filtered.find(r => r.id === item.invoiceId);
        if (!inv) continue;
        result.push({
          invoiceId: item.invoiceId,
          date: inv.invoiceDate ?? inv.createdAt ?? "",
          vendor: inv.merchantName ?? "Unknown",
          amountPaise: item.totalPricePaise,
        });
      }
      result.sort((a, b) => a.date.localeCompare(b.date));
      setEntries(result);
    });
  }, [filtered]);

  const totalPaise = entries.reduce((s, e) => s + e.amountPaise, 0);
  const balancePaise = openingPaise + totalPaise;
  const pctFunded = corpusPaise > 0 ? Math.min(100, Math.round((balancePaise / corpusPaise) * 100)) : null;

  function applyCorpus() {
    const v = Math.round(parseFloat(corpusInput) * 100);
    if (!isNaN(v) && v >= 0) { setCorpusPaise(v); saveSinkingCorpus(v); }
    setCorpusInput("");
  }
  function applyOpening() {
    const v = Math.round(parseFloat(openingInput) * 100);
    if (!isNaN(v) && v >= 0) { setOpeningPaise(v); saveSinkingOpening(v); }
    setOpeningInput("");
  }

  // CSV: Dr/Cr running balance
  function downloadSinkingCSV() {
    const rows: (string | number)[][] = [
      ["Date", "Vendor / Particulars", "Dr (Withdrawal)", "Cr (Contribution)", "Balance (₹)"],
      ["Opening Balance", "", "", (openingPaise / 100).toFixed(2), (openingPaise / 100).toFixed(2)],
    ];
    let running = openingPaise;
    for (const e of entries) {
      running += e.amountPaise;
      rows.push([
        e.date.slice(0, 10),
        e.vendor,
        "",
        (e.amountPaise / 100).toFixed(2),
        (running / 100).toFixed(2),
      ]);
    }
    rows.push(["Closing Balance", "", "", (totalPaise / 100).toFixed(2), (balancePaise / 100).toFixed(2)]);
    downloadCSV(`sinking-fund-ledger-${fy ?? "all"}.csv`, rows);
  }

  return (
    <div style={{ padding: "20px", maxWidth: 900, margin: "0 auto" }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--color-text)", margin: 0 }}>Sinking Fund Ledger</h2>
        <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 3 }}>Running tally of sinking fund contributions from maintenance bills — invoices with a "Sinking Fund" line item</p>
      </div>

      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 14 }}>
        {allFYs.map(f => <button key={f} style={chipStyle(fy === f)} onClick={() => setFY(f)}>{fyLabel(f)}</button>)}
        <button style={chipStyle(fy === null)} onClick={() => setFY(null)}>All Time</button>
      </div>

      {/* Settings row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
        <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10, padding: "12px 14px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase" as const, letterSpacing: "0.05em", marginBottom: 8 }}>Opening Balance (₹)</div>
          <div style={{ display: "flex", gap: 6 }}>
            <input type="number" placeholder={`Current: ${(openingPaise / 100).toFixed(0)}`} value={openingInput}
              onChange={e => setOpeningInput(e.target.value)}
              style={{ flex: 1, padding: "5px 8px", borderRadius: 6, border: "1px solid var(--color-border)", background: "var(--color-bg)", color: "var(--color-text)", fontSize: 12 }} />
            <button onClick={applyOpening}
              style={{ padding: "5px 12px", borderRadius: 6, border: "none", background: "var(--color-primary)", color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>Set</button>
          </div>
        </div>
        <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10, padding: "12px 14px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase" as const, letterSpacing: "0.05em", marginBottom: 8 }}>Corpus Target (₹)</div>
          <div style={{ display: "flex", gap: 6 }}>
            <input type="number" placeholder={`Current: ${(corpusPaise / 100).toFixed(0)}`} value={corpusInput}
              onChange={e => setCorpusInput(e.target.value)}
              style={{ flex: 1, padding: "5px 8px", borderRadius: 6, border: "1px solid var(--color-border)", background: "var(--color-bg)", color: "var(--color-text)", fontSize: 12 }} />
            <button onClick={applyCorpus}
              style={{ padding: "5px 12px", borderRadius: 6, border: "none", background: "var(--color-primary)", color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>Set</button>
          </div>
        </div>
      </div>

      <SummaryCards cards={[
        { label: "Contributions",   value: String(entries.length) },
        { label: "Total Collected", value: fmtShort(totalPaise), color: "var(--color-primary)" },
        { label: "Fund Balance",    value: fmtShort(balancePaise), color: "#16a34a" },
        { label: pctFunded !== null ? "Corpus Funded" : "Corpus Target", value: pctFunded !== null ? `${pctFunded}%` : corpusPaise > 0 ? fmtShort(corpusPaise) : "—" },
      ]} />

      {pctFunded !== null && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginBottom: 4 }}>Corpus Progress</div>
          <div style={{ height: 8, borderRadius: 4, background: "var(--color-border)", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${pctFunded}%`, background: pctFunded >= 100 ? "#16a34a" : pctFunded >= 60 ? "#f59e0b" : "#dc2626", borderRadius: 4, transition: "width 0.3s" }} />
          </div>
          <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: 3 }}>
            {fmtRupee(balancePaise)} of {fmtRupee(corpusPaise)} target
          </div>
        </div>
      )}

      {entries.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 24px", color: "var(--color-text-secondary)", fontSize: 13, background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>No sinking fund line items found</div>
          <div style={{ fontSize: 12, opacity: 0.8 }}>The AI extractor captures "Sinking Fund" as a line item in maintenance bills. Upload a maintenance invoice that itemises sinking fund separately.</div>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
            <CsvButton onClick={downloadSinkingCSV} />
          </div>
          <div style={{ overflowX: "auto", background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1.5px solid var(--color-border)" }}>
                  {["Date", "Vendor / Particulars", "Cr (Contribution)", "Running Balance"].map((h, i) => (
                    <th key={h} style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase" as const, letterSpacing: "0.06em", padding: "9px 14px", textAlign: i < 2 ? "left" : "right" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(() => {
                  let running = openingPaise;
                  return entries.map((e, i) => {
                    running += e.amountPaise;
                    return (
                      <tr key={`${e.invoiceId}-${i}`} style={{ borderBottom: i < entries.length - 1 ? "1px solid var(--color-border)" : "none", background: i % 2 === 0 ? "transparent" : "var(--color-surface-2)" }}>
                        <td style={{ fontSize: 12, color: "var(--color-text-secondary)", padding: "9px 14px" }}>
                          {e.date ? new Date(e.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" }) : "—"}
                        </td>
                        <td style={{ fontSize: 12.5, color: "var(--color-text)", padding: "9px 14px" }}>{e.vendor}</td>
                        <td style={{ fontSize: 12.5, fontWeight: 600, color: "#16a34a", padding: "9px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtRupee(e.amountPaise)}</td>
                        <td style={{ fontSize: 12.5, fontWeight: 700, color: "var(--color-text)", padding: "9px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtRupee(running)}</td>
                      </tr>
                    );
                  });
                })()}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: "1.5px solid var(--color-border)", background: "var(--color-surface-2)" }}>
                  <td style={{ fontSize: 12, fontWeight: 700, padding: "10px 14px" }} colSpan={2}>Closing Balance</td>
                  <td style={{ fontSize: 12.5, fontWeight: 700, color: "#16a34a", padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtRupee(totalPaise)}</td>
                  <td style={{ fontSize: 12.5, fontWeight: 700, color: "var(--color-text)", padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtRupee(balancePaise)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ── Society Quotation Comparison ──────────────────────────────────────────────

const QUOTE_SETS_KEY = "jinvoice_society_quote_sets";

interface QuoteSet {
  id: string;
  name: string;
  invoiceIds: number[];
  awardedId: number | null;
  createdAt: string;
  lockedAt: string | null;
}

function loadQuoteSets(): QuoteSet[] {
  try { return JSON.parse(localStorage.getItem(QUOTE_SETS_KEY) ?? "[]"); }
  catch { return []; }
}
function saveQuoteSets(sets: QuoteSet[]): void {
  try { localStorage.setItem(QUOTE_SETS_KEY, JSON.stringify(sets)); } catch {}
}

function SocietyQuotesTab({ records }: { records: InvoiceMeta[] }) {
  const [quoteSets, setQuoteSets] = useState<QuoteSet[]>(() => loadQuoteSets());
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [lineItemsMap, setLineItemsMap] = useState<Map<number, LineItemRow[]>>(new Map());
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Load all non-failed invoices directly — no grandTotalPaise gate, so
  // quotations without a parsed total still appear in the picker.
  const [allInvoices, setAllInvoices] = useState<InvoiceMeta[]>([]);
  useEffect(() => {
    db.invoices.toArray().then(rows =>
      setAllInvoices(rows.filter(r =>
        r.status !== "extraction_failed" &&
        r.status !== "import_blocked_encrypted"
      ))
    );
  }, []);

  // Merge: prefer allInvoices for the picker (includes null-total docs),
  // fall back to the filtered records prop for comparison table lookups.
  const mergedRecords = useMemo(() => {
    const map = new Map<number, InvoiceMeta>();
    for (const r of records) if (r.id != null) map.set(r.id, r);
    for (const r of allInvoices) if (r.id != null && !map.has(r.id)) map.set(r.id, r);
    return [...map.values()];
  }, [records, allInvoices]);

  const quotationInvoices = useMemo(() =>
    mergedRecords
      .filter(r => {
        const cat = r.docTypes?.[0] ?? r.docType ?? r.category;
        if (cat === "quotation") return true;
        if (r.projectTag?.trim().toLowerCase() === "quotation") return true;
        return (r.clientTags ?? []).some(t => t.trim().toLowerCase() === "quotation");
      })
      .sort((a, b) => (b.invoiceDate ?? "").localeCompare(a.invoiceDate ?? "")),
    [mergedRecords]
  );

  useEffect(() => {
    if (!expandedId) return;
    const qs = quoteSets.find(s => s.id === expandedId);
    if (!qs || qs.invoiceIds.length === 0) { setLineItemsMap(new Map()); return; }
    db.lineItems.where("invoiceId").anyOf(qs.invoiceIds).toArray().then(items => {
      const map = new Map<number, LineItemRow[]>();
      for (const item of items) {
        if (!map.has(item.invoiceId)) map.set(item.invoiceId, []);
        map.get(item.invoiceId)!.push(item);
      }
      setLineItemsMap(map);
    });
  }, [expandedId, quoteSets]);

  function createSet() {
    if (!newName.trim() || selectedIds.size < 2) return;
    const qs: QuoteSet = {
      id: String(Date.now()),
      name: newName.trim(),
      invoiceIds: [...selectedIds],
      awardedId: null,
      createdAt: new Date().toISOString(),
      lockedAt: null,
    };
    const next = [qs, ...quoteSets];
    setQuoteSets(next);
    saveQuoteSets(next);
    setCreating(false);
    setNewName("");
    setSelectedIds(new Set());
    setExpandedId(qs.id);
  }

  async function awardVendor(setId: string, invoiceId: number) {
    const qs = quoteSets.find(s => s.id === setId);
    if (!qs || qs.lockedAt) return;
    const next = quoteSets.map(s =>
      s.id === setId ? { ...s, awardedId: invoiceId, lockedAt: new Date().toISOString() } : s
    );
    setQuoteSets(next);
    saveQuoteSets(next);
    for (const id of qs.invoiceIds) {
      const tag = id === invoiceId ? "Awarded" : "Rejected";
      await db.invoices.update(id, { projectTag: tag, updatedAt: new Date().toISOString() });
    }
  }

  function doDelete(setId: string) {
    const next = quoteSets.filter(s => s.id !== setId);
    setQuoteSets(next);
    saveQuoteSets(next);
    if (expandedId === setId) setExpandedId(null);
    setConfirmDelete(null);
  }

  function toggleSelect(id: number) {
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  return (
    <div style={{ padding: "20px", maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--color-text)", margin: 0 }}>Quotation Comparison</h2>
          <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 3 }}>Group vendor quotes for the same work, compare side-by-side, and mark the winner for the committee record</p>
        </div>
        {!creating && (
          <button onClick={() => setCreating(true)}
            style={{ padding: "8px 18px", borderRadius: 8, border: "none", background: "var(--color-primary)", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600, flexShrink: 0 }}>
            + New Quote Set
          </button>
        )}
      </div>

      {creating && (
        <div style={{ background: "var(--color-surface)", border: "1.5px solid var(--color-primary)", borderRadius: 12, padding: "16px 20px", marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text)", marginBottom: 12 }}>New Quote Set</div>
          <input type="text" placeholder="Project name — e.g. Exterior Painting 2026" value={newName} onChange={e => setNewName(e.target.value)}
            style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--color-border)", background: "var(--color-bg)", color: "var(--color-text)", fontSize: 13, marginBottom: 12, boxSizing: "border-box" as const }} />
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 8 }}>
            Select Quotes to Compare ({selectedIds.size} selected — min 2)
          </div>
          {quotationInvoices.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--color-text-secondary)", padding: "12px 0" }}>
              No invoices found yet. Upload vendor quotes and either set their category to "Quotation" or tag them as "Quotation" in the detail panel.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 240, overflowY: "auto", marginBottom: 12 }}>
              {quotationInvoices.map(r => {
                const id = r.id!;
                const checked = selectedIds.has(id);
                return (
                  <label key={id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 8, background: checked ? "color-mix(in srgb, var(--color-primary) 8%, transparent)" : "var(--color-surface-2)", border: "1px solid", borderColor: checked ? "var(--color-primary)" : "var(--color-border)", cursor: "pointer" }}>
                    <input type="checkbox" checked={checked} onChange={() => toggleSelect(id)} style={{ accentColor: "var(--color-primary)", width: 15, height: 15, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.merchantName ?? "Unknown Vendor"}</div>
                      <div style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>
                        {r.invoiceDate ? new Date(r.invoiceDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "No date"}
                        {r.invoiceNumber ? ` · ${r.invoiceNumber}` : ""}
                      </div>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text)", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{fmtRupee(r.grandTotalPaise ?? 0)}</div>
                  </label>
                );
              })}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button onClick={() => { setCreating(false); setNewName(""); setSelectedIds(new Set()); }}
              style={{ padding: "7px 16px", borderRadius: 8, border: "1px solid var(--color-border)", background: "transparent", color: "var(--color-text-secondary)", cursor: "pointer", fontSize: 13 }}>Cancel</button>
            <button onClick={createSet} disabled={!newName.trim() || selectedIds.size < 2}
              style={{ padding: "7px 16px", borderRadius: 8, border: "none", background: newName.trim() && selectedIds.size >= 2 ? "var(--color-primary)" : "var(--color-border)", color: newName.trim() && selectedIds.size >= 2 ? "#fff" : "var(--color-text-tertiary)", cursor: newName.trim() && selectedIds.size >= 2 ? "pointer" : "not-allowed", fontSize: 13, fontWeight: 600 }}>
              Create Quote Set
            </button>
          </div>
        </div>
      )}

      {quoteSets.length === 0 && !creating ? (
        <div style={{ textAlign: "center", padding: "48px 24px", color: "var(--color-text-secondary)", fontSize: 13, background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>No quote sets yet</div>
          <div style={{ fontSize: 12, opacity: 0.8 }}>Upload vendor quotations, then either set their category to "Quotation" or tag them as "Quotation" in the detail panel — both will appear here for comparison.</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {quoteSets.map(qs => {
            const isExpanded = expandedId === qs.id;
            const isLocked = !!qs.lockedAt;
            const qsInvoices = qs.invoiceIds.map(id => mergedRecords.find(r => r.id === id)).filter(Boolean) as InvoiceMeta[];
            const isConfirming = confirmDelete === qs.id;

            return (
              <div key={qs.id} style={{ background: "var(--color-surface)", border: "1.5px solid", borderColor: isLocked && qs.awardedId ? "#bbf7d0" : "var(--color-border)", borderRadius: 12, overflow: "hidden" }}>
                <div onClick={() => setExpandedId(isExpanded ? null : qs.id)}
                  style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", cursor: "pointer", background: isExpanded ? "color-mix(in srgb, var(--color-primary) 4%, transparent)" : "transparent" }}>
                  <span style={{ fontSize: 11, color: "var(--color-primary)", opacity: 0.7 }}>{isExpanded ? "▼" : "▶"}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "var(--color-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{qs.name}</div>
                    <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: 2 }}>
                      {qs.invoiceIds.length} vendor{qs.invoiceIds.length !== 1 ? "s" : ""} · {new Date(qs.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20, background: isLocked && qs.awardedId ? "#dcfce7" : isLocked ? "#f1f5f9" : "#fef9c3", color: isLocked && qs.awardedId ? "#15803d" : isLocked ? "#64748b" : "#a16207" }}>
                      {isLocked && qs.awardedId ? "Awarded" : isLocked ? "Closed" : "Open"}
                    </span>
                    {isConfirming ? (
                      <>
                        <span style={{ fontSize: 11, color: "#dc2626" }}>Delete?</span>
                        <button onClick={() => doDelete(qs.id)} style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6, border: "1px solid #dc2626", background: "#dc2626", color: "#fff", cursor: "pointer" }}>Yes</button>
                        <button onClick={() => setConfirmDelete(null)} style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6, border: "1px solid var(--color-border)", background: "transparent", color: "var(--color-text-secondary)", cursor: "pointer" }}>No</button>
                      </>
                    ) : (
                      <button onClick={() => setConfirmDelete(qs.id)} style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6, border: "1px solid var(--color-border)", background: "transparent", color: "var(--color-text-tertiary)", cursor: "pointer" }}>Delete</button>
                    )}
                  </div>
                </div>

                {isExpanded && (
                  <div style={{ borderTop: "1px solid var(--color-border)", padding: "16px", overflowX: "auto" }}>
                    {qsInvoices.length === 0 ? (
                      <div style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>No matching invoices found in the database.</div>
                    ) : (
                      <>
                        <table style={{ borderCollapse: "collapse", minWidth: Math.max(600, qsInvoices.length * 220) }}>
                          <colgroup>
                            <col style={{ width: 140 }} />
                            {qsInvoices.map(r => <col key={r.id} style={{ width: 210 }} />)}
                          </colgroup>
                          <thead>
                            <tr style={{ borderBottom: "1.5px solid var(--color-border)" }}>
                              <th style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase" as const, letterSpacing: "0.06em", padding: "8px 12px", textAlign: "left" }}></th>
                              {qsInvoices.map(r => {
                                const isAwarded = qs.awardedId === r.id;
                                const isRejected = isLocked && !isAwarded;
                                return (
                                  <th key={r.id} style={{ padding: "8px 12px", textAlign: "left", borderLeft: "1px solid var(--color-border)", background: isAwarded ? "#f0fdf4" : isRejected ? "color-mix(in srgb, #94a3b8 6%, transparent)" : "transparent" }}>
                                    <div style={{ fontSize: 13, fontWeight: 700, color: isAwarded ? "#15803d" : isRejected ? "var(--color-text-tertiary)" : "var(--color-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                      {isAwarded ? "✓ " : isRejected ? "✗ " : ""}{r.merchantName ?? "Unknown"}
                                    </div>
                                    {isAwarded && <div style={{ fontSize: 10, fontWeight: 700, color: "#16a34a", marginTop: 2, letterSpacing: "0.04em" }}>AWARDED</div>}
                                    {isRejected && <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", marginTop: 2, letterSpacing: "0.04em" }}>REJECTED</div>}
                                  </th>
                                );
                              })}
                            </tr>
                          </thead>
                          <tbody>
                            <tr style={{ borderBottom: "1px solid var(--color-border)", background: "var(--color-surface-2)" }}>
                              <td style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase" as const, letterSpacing: "0.05em", padding: "9px 12px" }}>Total Amount</td>
                              {qsInvoices.map(r => {
                                const isAwarded = qs.awardedId === r.id;
                                const lowestId = [...qsInvoices].sort((a, b) => (a.grandTotalPaise ?? 0) - (b.grandTotalPaise ?? 0))[0]?.id;
                                const isLowest = lowestId === r.id;
                                return (
                                  <td key={r.id} style={{ padding: "9px 12px", borderLeft: "1px solid var(--color-border)", background: isAwarded ? "#f0fdf4" : "transparent" }}>
                                    <span style={{ fontSize: 14, fontWeight: 700, color: isLowest ? "#16a34a" : "var(--color-text)", fontVariantNumeric: "tabular-nums" }}>{fmtRupee(r.grandTotalPaise ?? 0)}</span>
                                    {isLowest && !isLocked && <span style={{ fontSize: 9, fontWeight: 700, color: "#16a34a", marginLeft: 5, background: "#dcfce7", padding: "1px 5px", borderRadius: 4 }}>LOWEST</span>}
                                  </td>
                                );
                              })}
                            </tr>
                            <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                              <td style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase" as const, letterSpacing: "0.05em", padding: "9px 12px" }}>Quote Date</td>
                              {qsInvoices.map(r => (
                                <td key={r.id} style={{ padding: "9px 12px", fontSize: 12.5, color: "var(--color-text-secondary)", borderLeft: "1px solid var(--color-border)", background: qs.awardedId === r.id ? "#f0fdf4" : "transparent" }}>
                                  {r.invoiceDate ? new Date(r.invoiceDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—"}
                                </td>
                              ))}
                            </tr>
                            <tr style={{ borderBottom: "1px solid var(--color-border)", background: "var(--color-surface-2)" }}>
                              <td style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase" as const, letterSpacing: "0.05em", padding: "9px 12px" }}>Quote Ref</td>
                              {qsInvoices.map(r => (
                                <td key={r.id} style={{ padding: "9px 12px", fontSize: 12, color: "var(--color-text-secondary)", borderLeft: "1px solid var(--color-border)", background: qs.awardedId === r.id ? "#f0fdf4" : "transparent" }}>
                                  {r.invoiceNumber ?? "—"}
                                </td>
                              ))}
                            </tr>
                            {/* Line items section — fuzzy-aligned across vendors */}
                            {(() => {
                              const aligned = alignLineItems(qsInvoices.map(r => r.id!), lineItemsMap);
                              if (aligned.length === 0) return null;
                              return (
                                <>
                                  <tr style={{ borderBottom: "1px solid var(--color-border)", background: "color-mix(in srgb, var(--color-primary) 5%, transparent)" }}>
                                    <td colSpan={qsInvoices.length + 1} style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-primary)", textTransform: "uppercase" as const, letterSpacing: "0.06em", padding: "6px 12px" }}>Line Items</td>
                                  </tr>
                                  {aligned.map((row, ni) => (
                                    <tr key={ni} style={{ borderBottom: "1px solid var(--color-border)", background: ni % 2 === 0 ? "transparent" : "var(--color-surface-2)" }}>
                                      <td style={{ fontSize: 11.5, color: "var(--color-text)", padding: "7px 12px 7px 20px", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={row.label}>{row.label}</td>
                                      {qsInvoices.map(r => {
                                        const amount = row.cells.get(r.id!);
                                        return (
                                          <td key={r.id} style={{ padding: "7px 12px", fontSize: 12.5, color: amount != null ? "var(--color-text)" : "var(--color-text-tertiary)", textAlign: "right", fontVariantNumeric: "tabular-nums", borderLeft: "1px solid var(--color-border)", background: qs.awardedId === r.id ? "#f0fdf4" : "transparent" }}>
                                            {amount != null ? fmtRupee(amount) : "—"}
                                          </td>
                                        );
                                      })}
                                    </tr>
                                  ))}
                                </>
                              );
                            })()}
                          </tbody>
                        </table>

                        {!isLocked && (
                          <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap", alignItems: "center" }}>
                            <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>Award this contract to:</span>
                            {qsInvoices.map(r => (
                              <button key={r.id} onClick={() => awardVendor(qs.id, r.id!)}
                                style={{ padding: "7px 16px", borderRadius: 8, border: "1.5px solid #16a34a", background: "transparent", color: "#16a34a", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                                {r.merchantName ?? `Vendor ${r.id}`}
                              </button>
                            ))}
                          </div>
                        )}

                        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
                          <CsvButton onClick={() => {
                            const rows: (string | number)[][] = [
                              ["", ...qsInvoices.map(r => r.merchantName ?? "Unknown")],
                              ["Total Amount (₹)", ...qsInvoices.map(r => ((r.grandTotalPaise ?? 0) / 100).toFixed(2))],
                              ["Quote Date", ...qsInvoices.map(r => r.invoiceDate?.slice(0, 10) ?? "")],
                              ["Quote Ref", ...qsInvoices.map(r => r.invoiceNumber ?? "")],
                              ["Status", ...qsInvoices.map(r => qs.awardedId === r.id ? "Awarded" : qs.lockedAt ? "Rejected" : "Open")],
                            ];
                            const aligned = alignLineItems(qsInvoices.map(r => r.id!), lineItemsMap);
                            for (const row of aligned) {
                              rows.push([row.label, ...qsInvoices.map(r => {
                                const amount = row.cells.get(r.id!);
                                return amount != null ? (amount / 100).toFixed(2) : "";
                              })]);
                            }
                            downloadCSV(`quote-comparison-${qs.name.replace(/\s+/g, "-").toLowerCase()}.csv`, rows);
                          }} />
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Bookkeeper Ledger ─────────────────────────────────────────────────────────

const BOOKKEEPER_ACCOUNT_HEADS: { key: string; label: string }[] = [
  { key: "purchases",         label: "Purchases / Stock" },
  { key: "sales_income",      label: "Sales / Income" },
  { key: "payroll",           label: "Payroll / Salary" },
  { key: "bank_charges",      label: "Bank Charges & Fees" },
  { key: "tax_payments",      label: "Tax Payments (GST / TDS)" },
  { key: "professional_fees", label: "Professional Fees" },
  { key: "office_supplies",   label: "Office Supplies & Admin" },
  { key: "rent_utilities",    label: "Rent & Utilities" },
  { key: "transport",         label: "Transport & Logistics" },
  { key: "other",             label: "Other" },
];

function BookkeeperLedgerTab({ records }: { records: InvoiceMeta[] }) {
  const [fyStart, setFyStart] = useState<number | null>(() => currentFY());
  const [expandedHead, setExpandedHead] = useState<string | null>(null);
  const fys = availableFYs(records);
  const filtered = filterByFY(records, fyStart);

  // Group by account head: use category (profCategory) if set, else docType
  const byHead: Record<string, InvoiceMeta[]> = {};
  for (const r of filtered) {
    const head = r.category ?? r.docType ?? "other";
    (byHead[head] ??= []).push(r);
  }

  const rows = BOOKKEEPER_ACCOUNT_HEADS.map(({ key, label }) => {
    const recs = byHead[key] ?? [];
    const total = recs.reduce((s, r) => s + (r.grandTotalPaise ?? 0), 0);
    return { key, label, recs, total, count: recs.length };
  }).filter(r => r.count > 0);

  const grandTotal = rows.reduce((s, r) => s + r.total, 0);

  function exportCSV() {
    const lines = ["Account Head,Documents,Total (₹)"];
    rows.forEach(r => lines.push(`"${r.label}",${r.count},${(r.total / 100).toFixed(2)}`));
    lines.push(`"Grand Total",${rows.reduce((s, r) => s + r.count, 0)},${(grandTotal / 100).toFixed(2)}`);
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `bookkeeper-ledger-${fyStart ?? "all"}.csv`; a.click();
  }

  return (
    <div style={{ padding: "16px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <strong style={{ fontSize: 15 }}>Expense by Account Head</strong>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button onClick={() => setFyStart(null)}
            style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid var(--color-border)",
              background: fyStart === null ? "var(--color-primary)" : "var(--color-surface)",
              color: fyStart === null ? "#fff" : "var(--color-text)", cursor: "pointer", fontSize: 12 }}>
            All Time
          </button>
          {fys.map(fy => (
            <button key={fy} onClick={() => setFyStart(fy)}
              style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid var(--color-border)",
                background: fyStart === fy ? "var(--color-primary)" : "var(--color-surface)",
                color: fyStart === fy ? "#fff" : "var(--color-text)", cursor: "pointer", fontSize: 12 }}>
              {fyLabel(fy)}
            </button>
          ))}
        </div>
        <button onClick={exportCSV}
          style={{ marginLeft: "auto", padding: "6px 14px", borderRadius: 6, border: "1px solid var(--color-border)",
            background: "var(--color-surface)", color: "var(--color-text)", cursor: "pointer", fontSize: 12 }}>
          Export CSV
        </button>
      </div>

      {rows.length === 0 ? (
        <p style={{ color: "var(--color-text-secondary)", fontSize: 14 }}>
          No records for this period. As you add bills, they'll be grouped by account head automatically.
        </p>
      ) : (
        <>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: "2px solid var(--color-border)" }}>
                  <th style={{ textAlign: "left", padding: "8px 10px", fontWeight: 600 }}>Account Head</th>
                  <th style={{ textAlign: "right", padding: "8px 10px", fontWeight: 600 }}>Documents</th>
                  <th style={{ textAlign: "right", padding: "8px 10px", fontWeight: 600 }}>Total (₹)</th>
                  <th style={{ textAlign: "right", padding: "8px 10px", fontWeight: 600 }}>% of Spend</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <React.Fragment key={r.key}>
                    <tr style={{ borderBottom: "1px solid var(--color-border)", cursor: "pointer" }}
                      onClick={() => setExpandedHead(expandedHead === r.key ? null : r.key)}>
                      <td style={{ padding: "9px 10px" }}>
                        <span style={{ marginRight: 6, fontSize: 11, color: "var(--color-text-secondary)" }}>
                          {expandedHead === r.key ? "▼" : "▶"}
                        </span>
                        {r.label}
                      </td>
                      <td style={{ textAlign: "right", padding: "9px 10px", fontVariantNumeric: "tabular-nums" }}>{r.count}</td>
                      <td style={{ textAlign: "right", padding: "9px 10px", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                        ₹{(r.total / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>
                      <td style={{ textAlign: "right", padding: "9px 10px", fontVariantNumeric: "tabular-nums", color: "var(--color-text-secondary)" }}>
                        {grandTotal > 0 ? ((r.total / grandTotal) * 100).toFixed(1) : "0"}%
                      </td>
                    </tr>
                    {expandedHead === r.key && r.recs.slice(0, 10).map(inv => (
                      <tr key={inv.id} style={{ background: "var(--color-surface)", borderBottom: "1px solid var(--color-border)" }}>
                        <td style={{ padding: "7px 10px 7px 30px", color: "var(--color-text-secondary)", fontSize: 13 }} colSpan={2}>
                          {inv.merchantName || inv.sourceFilename || "—"}
                        </td>
                        <td style={{ textAlign: "right", padding: "7px 10px", fontVariantNumeric: "tabular-nums", fontSize: 13 }} colSpan={2}>
                          {inv.grandTotalPaise != null ? `₹${(inv.grandTotalPaise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}` : "—"}
                        </td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: "2px solid var(--color-border)", fontWeight: 700 }}>
                  <td style={{ padding: "10px" }}>Grand Total</td>
                  <td style={{ textAlign: "right", padding: "10px", fontVariantNumeric: "tabular-nums" }}>
                    {rows.reduce((s, r) => s + r.count, 0)}
                  </td>
                  <td style={{ textAlign: "right", padding: "10px", fontVariantNumeric: "tabular-nums" }}>
                    ₹{(grandTotal / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </td>
                  <td style={{ textAlign: "right", padding: "10px" }}>100%</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ── Shopkeeper: Purchase Register ─────────────────────────────────────────────

function ShopkeeperPurchaseRegisterTab({ records }: { records: InvoiceMeta[] }) {
  const allFYs = useMemo(() => availableFYs(records), [records]);
  const [fy, setFY] = useState<number | null>(currentFY);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const byFY = filterByFY(records, fy);
    if (!search.trim()) return byFY;
    const q = search.toLowerCase();
    return byFY.filter(r => (r.merchantName ?? "").toLowerCase().includes(q) || (r.invoiceNumber ?? "").toLowerCase().includes(q));
  }, [records, fy, search]);

  const sorted = useMemo(() => [...filtered].sort((a, b) => (b.invoiceDate ?? b.createdAt ?? "").localeCompare(a.invoiceDate ?? a.createdAt ?? "")), [filtered]);

  const totals = useMemo(() => ({
    count: sorted.length,
    taxable: sorted.reduce((s, r) => s + ((r.grandTotalPaise ?? 0) - (r.taxPaise ?? 0)), 0),
    tax: sorted.reduce((s, r) => s + (r.taxPaise ?? 0), 0),
    total: sorted.reduce((s, r) => s + (r.grandTotalPaise ?? 0), 0),
  }), [sorted]);

  return (
    <div style={{ padding: "20px", maxWidth: 1000, margin: "0 auto" }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--color-text)", margin: 0 }}>Purchase Register</h2>
        <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 3 }}>All purchase invoices by date — GSTR-2 style ledger for ITC reconciliation</p>
      </div>
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 14 }}>
        {allFYs.map(f => <button key={f} style={chipStyle(fy === f)} onClick={() => setFY(f)}>{fyLabel(f)}</button>)}
        <button style={chipStyle(fy === null)} onClick={() => setFY(null)}>All Time</button>
      </div>
      <div style={{ display: "flex", gap: 10, marginBottom: 14, alignItems: "center", flexWrap: "wrap" }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search supplier or invoice #..."
          style={{ flex: 1, maxWidth: 280, fontSize: 13, padding: "6px 10px", borderRadius: 8, border: "1px solid var(--color-border)", background: "var(--color-bg)", color: "var(--color-text)" }} />
        <CsvButton onClick={() => downloadCSV(`purchase-register-${fy ?? "all"}.csv`, [
          ["Date", "Supplier", "Invoice #", "Taxable (₹)", "GST (₹)", "Total (₹)"],
          ...sorted.map(r => [r.invoiceDate?.slice(0, 10) ?? "—", r.merchantName ?? "Unknown", r.invoiceNumber ?? "—",
            (((r.grandTotalPaise ?? 0) - (r.taxPaise ?? 0)) / 100).toFixed(2),
            ((r.taxPaise ?? 0) / 100).toFixed(2), ((r.grandTotalPaise ?? 0) / 100).toFixed(2)]),
        ])} />
      </div>
      <SummaryCards cards={[
        { label: "Invoices",      value: String(totals.count) },
        { label: "Taxable Value", value: fmtShort(totals.taxable) },
        { label: "GST (ITC)",     value: fmtShort(totals.tax), color: "#16a34a" },
        { label: "Total",         value: fmtShort(totals.total), color: "var(--color-primary)" },
      ]} />
      {sorted.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 0", color: "var(--color-text-secondary)", fontSize: 13 }}>No invoices for this period.</div>
      ) : (
        <div style={{ overflowX: "auto", background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1.5px solid var(--color-border)" }}>
                {["Date", "Supplier", "Invoice #", "Taxable", "GST", "Total"].map((h, i) => (
                  <th key={h} style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase" as const, letterSpacing: "0.06em", padding: "9px 12px", textAlign: i < 3 ? "left" : "right" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => {
                const taxable = (r.grandTotalPaise ?? 0) - (r.taxPaise ?? 0);
                return (
                  <tr key={r.id ?? i} style={{ borderBottom: i < sorted.length - 1 ? "1px solid var(--color-border)" : "none", background: i % 2 === 0 ? "transparent" : "var(--color-surface-2)" }}>
                    <td style={{ fontSize: 11.5, color: "var(--color-text-secondary)", padding: "9px 12px", whiteSpace: "nowrap" }}>
                      {r.invoiceDate ? new Date(r.invoiceDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" }) : "—"}
                    </td>
                    <td style={{ fontSize: 12.5, color: "var(--color-text)", padding: "9px 12px", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.merchantName ?? "Unknown"}</td>
                    <td style={{ fontSize: 11, color: "var(--color-text-secondary)", padding: "9px 12px" }}>{r.invoiceNumber ?? "—"}</td>
                    <td style={{ fontSize: 12.5, color: "var(--color-text)", padding: "9px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtRupee(taxable)}</td>
                    <td style={{ fontSize: 12.5, color: "#16a34a", padding: "9px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.taxPaise ? fmtRupee(r.taxPaise) : "—"}</td>
                    <td style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-text)", padding: "9px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtRupee(r.grandTotalPaise ?? 0)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: "1.5px solid var(--color-border)", background: "var(--color-surface-2)" }}>
                <td colSpan={3} style={{ fontSize: 12, fontWeight: 700, padding: "10px 12px" }}>Total ({totals.count} invoices)</td>
                <td style={{ fontSize: 12.5, fontWeight: 700, padding: "10px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtRupee(totals.taxable)}</td>
                <td style={{ fontSize: 12.5, fontWeight: 700, color: "#16a34a", padding: "10px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtRupee(totals.tax)}</td>
                <td style={{ fontSize: 12.5, fontWeight: 700, padding: "10px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtRupee(totals.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Shopkeeper: Expense by Head (P&L) ─────────────────────────────────────────

const SHOPKEEPER_PL_HEADS: { key: string; label: string; docTypes: string[] }[] = [
  { key: "purchases",  label: "Purchases / Stock",  docTypes: ["invoice"] },
  { key: "rent",       label: "Rent",               docTypes: ["rent"] },
  { key: "utility",    label: "Utilities",           docTypes: ["utility"] },
  { key: "payroll",    label: "Staff / Payroll",     docTypes: ["payroll"] },
  { key: "travel",     label: "Travel & Logistics",  docTypes: ["travel"] },
  { key: "tax",        label: "Tax / GST Payments",  docTypes: ["tax"] },
  { key: "insurance",  label: "Insurance",           docTypes: ["insurance"] },
  { key: "other",      label: "Other",               docTypes: ["other", "coupon", "shopping", "medical", "education"] },
];

function ShopkeeperExpenseHeadTab({ records }: { records: InvoiceMeta[] }) {
  const allFYs = useMemo(() => availableFYs(records), [records]);
  const [fy, setFY] = useState<number | null>(currentFY);
  const [drillHead, setDrillHead] = useState<string | null>(null);
  const filtered = useMemo(() => filterByFY(records, fy), [records, fy]);

  const headRows = useMemo(() => SHOPKEEPER_PL_HEADS.map(h => {
    const recs = filtered.filter(r => {
      const types = r.docTypes?.length ? r.docTypes : (r.docType ? [r.docType] : ["other"]);
      return types.some(t => h.docTypes.includes(t));
    });
    return { ...h, recs, count: recs.length, totalPaise: recs.reduce((s, r) => s + (r.grandTotalPaise ?? 0), 0) };
  }).filter(h => h.count > 0), [filtered]);

  const grandTotal = headRows.reduce((s, h) => s + h.totalPaise, 0);
  const maxPaise = Math.max(...headRows.map(h => h.totalPaise), 1);

  return (
    <div style={{ padding: "20px", maxWidth: 900, margin: "0 auto" }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--color-text)", margin: 0 }}>Expense by Head</h2>
        <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 3 }}>Rent, utilities, staff, purchases — P&L breakdown for the shop</p>
      </div>
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 14 }}>
        {allFYs.map(f => <button key={f} style={chipStyle(fy === f)} onClick={() => setFY(f)}>{fyLabel(f)}</button>)}
        <button style={chipStyle(fy === null)} onClick={() => setFY(null)}>All Time</button>
      </div>
      <SummaryCards cards={[
        { label: "Total Expenses", value: fmtShort(grandTotal), color: "var(--color-primary)" },
        { label: "Expense Heads",  value: String(headRows.length) },
        { label: "Invoices",       value: String(filtered.length) },
      ]} />
      {headRows.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 0", color: "var(--color-text-secondary)", fontSize: 13 }}>No data for this period.</div>
      ) : (
        <>
          <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10, padding: "16px", marginBottom: 16 }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 12 }}>P&L Breakdown</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {headRows.map(h => <BarRow key={h.key} label={h.label} value={h.totalPaise} max={maxPaise} />)}
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
            <CsvButton onClick={() => downloadCSV(`expense-by-head-${fy ?? "all"}.csv`, [
              ["Expense Head", "Invoices", "Total (₹)", "% of Spend"],
              ...headRows.map(h => [h.label, h.count, (h.totalPaise / 100).toFixed(2), pct(h.totalPaise, grandTotal)]),
            ])} />
          </div>
          <div style={{ overflowX: "auto", background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1.5px solid var(--color-border)" }}>
                  {["Expense Head", "Invoices", "Total", "% of Spend"].map((h, i) => (
                    <th key={h} style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase" as const, letterSpacing: "0.06em", padding: "9px 14px", textAlign: i === 0 ? "left" : "right" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {headRows.map((h, i) => {
                  const isOpen = drillHead === h.key;
                  return (
                    <React.Fragment key={h.key}>
                      <tr onClick={() => setDrillHead(isOpen ? null : h.key)}
                        style={{ borderBottom: !isOpen ? "1px solid var(--color-border)" : "none", background: isOpen ? "color-mix(in srgb, var(--color-primary) 6%, transparent)" : i % 2 === 0 ? "transparent" : "var(--color-surface-2)", cursor: "pointer" }}>
                        <td style={{ fontSize: 12.5, color: "var(--color-text)", padding: "10px 14px" }}>
                          <span style={{ fontSize: 10, color: "var(--color-primary)", opacity: 0.7, marginRight: 6 }}>{isOpen ? "▼" : "▶"}</span>{h.label}
                        </td>
                        <td style={{ fontSize: 12.5, color: "var(--color-text-secondary)", padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{h.count}</td>
                        <td style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-text)", padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtRupee(h.totalPaise)}</td>
                        <td style={{ fontSize: 12, color: "var(--color-text-secondary)", padding: "10px 14px", textAlign: "right" }}>{pct(h.totalPaise, grandTotal)}</td>
                      </tr>
                      {isOpen && <DrillDownPanel records={h.recs} onClose={() => setDrillHead(null)} />}
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

// ── Shopkeeper: GST Input Summary ─────────────────────────────────────────────

function ShopkeeperGSTSummaryTab({ records }: { records: InvoiceMeta[] }) {
  const allFYs = useMemo(() => availableFYs(records), [records]);
  const [fy, setFY] = useState<number | null>(currentFY);
  const [view, setView] = useState<"quarterly" | "monthly">("quarterly");

  const filtered = useMemo(() => filterByFY(records, fy).filter(r => (r.taxPaise ?? 0) > 0), [records, fy]);

  const GST_RATES = [5, 12, 18, 28];

  const byRate = useMemo(() => GST_RATES.map(rate => {
    const recs = filtered.filter(r => {
      const taxable = (r.grandTotalPaise ?? 0) - (r.taxPaise ?? 0);
      if (taxable <= 0) return false;
      const effectiveRate = Math.round(((r.taxPaise ?? 0) / taxable) * 100);
      return effectiveRate >= rate - 1 && effectiveRate <= rate + 1;
    });
    return { rate, count: recs.length, taxable: recs.reduce((s, r) => s + ((r.grandTotalPaise ?? 0) - (r.taxPaise ?? 0)), 0), itc: recs.reduce((s, r) => s + (r.taxPaise ?? 0), 0) };
  }).filter(r => r.count > 0), [filtered]);

  const totalITC = byRate.reduce((s, r) => s + r.itc, 0);
  const totalTaxable = byRate.reduce((s, r) => s + r.taxable, 0);

  const periods = useMemo(() => {
    const map = new Map<string, { label: string; itc: number }>();
    for (const r of filtered) {
      const d = recDate(r); if (!d) continue;
      const key = view === "quarterly" ? quarterKey(d) : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = view === "quarterly" ? key : d.toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
      if (!map.has(key)) map.set(key, { label, itc: 0 });
      map.get(key)!.itc += r.taxPaise ?? 0;
    }
    return [...map.entries()].sort().map(([, v]) => v);
  }, [filtered, view]);

  return (
    <div style={{ padding: "20px", maxWidth: 900, margin: "0 auto" }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--color-text)", margin: 0 }}>GST Input Summary</h2>
        <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 3 }}>Input Tax Credit (ITC) available — grouped by GST rate, for GSTR-3B filing</p>
      </div>
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 14 }}>
        {allFYs.map(f => <button key={f} style={chipStyle(fy === f)} onClick={() => setFY(f)}>{fyLabel(f)}</button>)}
        <button style={chipStyle(fy === null)} onClick={() => setFY(null)}>All Time</button>
      </div>
      <div style={{ display: "flex", gap: 5, marginBottom: 14 }}>
        <button style={chipStyle(view === "quarterly")} onClick={() => setView("quarterly")}>Quarterly</button>
        <button style={chipStyle(view === "monthly")}   onClick={() => setView("monthly")}>Monthly</button>
      </div>
      <SummaryCards cards={[
        { label: "GST Invoices",       value: String(filtered.length) },
        { label: "Total Taxable",       value: fmtShort(totalTaxable) },
        { label: "Total ITC Available", value: fmtShort(totalITC), color: "#16a34a" },
      ]} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: 20 }}>
        {byRate.map(r => (
          <div key={r.rate} style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10, padding: "12px 14px" }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 5 }}>{r.rate}% GST</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#16a34a", fontVariantNumeric: "tabular-nums" }}>{fmtShort(r.itc)}</div>
            <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 2 }}>{r.count} inv · taxable {fmtShort(r.taxable)}</div>
          </div>
        ))}
        {byRate.length === 0 && <div style={{ gridColumn: "1/-1", textAlign: "center", padding: "32px 0", color: "var(--color-text-secondary)", fontSize: 13 }}>No GST data for this period.</div>}
      </div>
      {periods.length > 0 && (
        <div style={{ overflowX: "auto", background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase" as const, letterSpacing: "0.06em", padding: "12px 14px 8px" }}>ITC by {view === "quarterly" ? "Quarter" : "Month"}</div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1.5px solid var(--color-border)" }}>
                {["Period", "ITC Available"].map((h, i) => (
                  <th key={h} style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase" as const, letterSpacing: "0.06em", padding: "9px 14px", textAlign: i === 0 ? "left" : "right" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {periods.map((p, i) => (
                <tr key={p.label} style={{ borderBottom: i < periods.length - 1 ? "1px solid var(--color-border)" : "none", background: i % 2 === 0 ? "transparent" : "var(--color-surface-2)" }}>
                  <td style={{ fontSize: 12.5, color: "var(--color-text)", padding: "9px 14px" }}>{p.label}</td>
                  <td style={{ fontSize: 12.5, fontWeight: 600, color: "#16a34a", padding: "9px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtRupee(p.itc)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
        <CsvButton onClick={() => downloadCSV(`gst-input-${fy ?? "all"}.csv`, [
          ["GST Rate", "Invoices", "Taxable (₹)", "ITC (₹)"],
          ...byRate.map(r => [`${r.rate}%`, r.count, (r.taxable / 100).toFixed(2), (r.itc / 100).toFixed(2)]),
          ["Total", filtered.length, (totalTaxable / 100).toFixed(2), (totalITC / 100).toFixed(2)],
        ])} />
      </div>
    </div>
  );
}

// ── Shared: Client Summary (used by TC, CA, Advocate) ─────────────────────────

function ClientSummaryTab({ records, title, subtitle }: { records: InvoiceMeta[]; title: string; subtitle: string }) {
  const allFYs = useMemo(() => availableFYs(records), [records]);
  const [fy, setFY] = useState<number | null>(currentFY);
  const [drillTag, setDrillTag] = useState<string | null>(null);
  const filtered = useMemo(() => filterByFY(records, fy), [records, fy]);

  const { clients, grandTotal } = useMemo(() => {
    const map = new Map<string, { tag: string; count: number; taxable: number; gst: number; total: number; recs: InvoiceMeta[] }>();
    let grandTotal = 0;
    for (const r of filtered) {
      const tags = r.clientTags?.length ? r.clientTags : ["(Untagged)"];
      for (const tag of tags) {
        if (!map.has(tag)) map.set(tag, { tag, count: 0, taxable: 0, gst: 0, total: 0, recs: [] });
        const c = map.get(tag)!;
        c.count++; c.gst += r.taxPaise ?? 0; c.total += r.grandTotalPaise ?? 0;
        c.taxable += (r.grandTotalPaise ?? 0) - (r.taxPaise ?? 0); c.recs.push(r);
      }
      grandTotal += r.grandTotalPaise ?? 0;
    }
    return { clients: [...map.values()].sort((a, b) => b.total - a.total), grandTotal };
  }, [filtered]);

  return (
    <div style={{ padding: "20px", maxWidth: 900, margin: "0 auto" }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--color-text)", margin: 0 }}>{title}</h2>
        <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 3 }}>{subtitle}</p>
      </div>
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 14 }}>
        {allFYs.map(f => <button key={f} style={chipStyle(fy === f)} onClick={() => setFY(f)}>{fyLabel(f)}</button>)}
        <button style={chipStyle(fy === null)} onClick={() => setFY(null)}>All Time</button>
      </div>
      <SummaryCards cards={[
        { label: "Clients",     value: String(clients.filter(c => c.tag !== "(Untagged)").length) },
        { label: "Total Spend", value: fmtShort(grandTotal), color: "var(--color-primary)" },
        { label: "Invoices",    value: String(filtered.length) },
      ]} />
      {clients.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 0", color: "var(--color-text-secondary)", fontSize: 13 }}>No client-tagged invoices. Tag invoices with client names in the View screen.</div>
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
            <CsvButton onClick={() => downloadCSV(`client-summary-${fy ?? "all"}.csv`, [
              ["Client", "Invoices", "Taxable (₹)", "GST (₹)", "Total (₹)"],
              ...clients.map(c => [c.tag, c.count, (c.taxable / 100).toFixed(2), (c.gst / 100).toFixed(2), (c.total / 100).toFixed(2)]),
            ])} />
          </div>
          <div style={{ overflowX: "auto", background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1.5px solid var(--color-border)" }}>
                  {["Client", "Invoices", "Taxable Value", "GST", "Total"].map((h, i) => (
                    <th key={h} style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase" as const, letterSpacing: "0.06em", padding: "9px 14px", textAlign: i === 0 ? "left" : "right" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {clients.map((c, i) => {
                  const isOpen = drillTag === c.tag;
                  return (
                    <React.Fragment key={c.tag}>
                      <tr onClick={() => setDrillTag(isOpen ? null : c.tag)}
                        style={{ borderBottom: !isOpen ? "1px solid var(--color-border)" : "none", background: isOpen ? "color-mix(in srgb, var(--color-primary) 6%, transparent)" : i % 2 === 0 ? "transparent" : "var(--color-surface-2)", cursor: "pointer" }}>
                        <td style={{ fontSize: 12.5, color: "var(--color-text)", padding: "10px 14px" }}>
                          <span style={{ fontSize: 10, color: "var(--color-primary)", opacity: 0.7, marginRight: 6 }}>{isOpen ? "▼" : "▶"}</span>
                          <span style={{ background: "color-mix(in srgb, var(--color-primary) 12%, transparent)", color: "var(--color-primary)", borderRadius: 4, padding: "2px 8px", fontSize: 12, fontWeight: 600 }}>{c.tag}</span>
                        </td>
                        <td style={{ fontSize: 12.5, color: "var(--color-text-secondary)", padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{c.count}</td>
                        <td style={{ fontSize: 12.5, color: "var(--color-text)", padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtRupee(c.taxable)}</td>
                        <td style={{ fontSize: 12.5, color: "#16a34a", padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{c.gst ? fmtRupee(c.gst) : "—"}</td>
                        <td style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-text)", padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtRupee(c.total)}</td>
                      </tr>
                      {isOpen && <DrillDownPanel records={c.recs} onClose={() => setDrillTag(null)} />}
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

// ── Shared: TDS Tracker ────────────────────────────────────────────────────────

const TDS_THRESHOLD_PAISE = 30_000 * 100;
const TDS_DOC_TYPES = ["legal", "payroll", "rent", "professional", "invoice"];

function TDSTrackerTab({ records, title, subtitle }: { records: InvoiceMeta[]; title: string; subtitle: string }) {
  const allFYs = useMemo(() => availableFYs(records), [records]);
  const [fy, setFY] = useState<number | null>(currentFY);
  const [drillVendor, setDrillVendor] = useState<string | null>(null);

  const filtered = useMemo(() => filterByFY(records, fy).filter(r => {
    if ((r.grandTotalPaise ?? 0) < TDS_THRESHOLD_PAISE) return false;
    const types = r.docTypes?.length ? r.docTypes : (r.docType ? [r.docType] : ["other"]);
    return types.some(t => TDS_DOC_TYPES.includes(t));
  }), [records, fy]);

  const byVendor = useMemo(() => {
    const map = new Map<string, { name: string; count: number; totalPaise: number; recs: InvoiceMeta[] }>();
    for (const r of filtered) {
      const name = r.merchantName?.trim() || "Unknown";
      if (!map.has(name)) map.set(name, { name, count: 0, totalPaise: 0, recs: [] });
      const v = map.get(name)!; v.count++; v.totalPaise += r.grandTotalPaise ?? 0; v.recs.push(r);
    }
    return [...map.values()].sort((a, b) => b.totalPaise - a.totalPaise);
  }, [filtered]);

  const tdsEstimate = byVendor.reduce((s, v) => s + Math.round(v.totalPaise * 0.1), 0);

  return (
    <div style={{ padding: "20px", maxWidth: 900, margin: "0 auto" }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--color-text)", margin: 0 }}>{title}</h2>
        <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 3 }}>{subtitle}</p>
      </div>
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 14 }}>
        {allFYs.map(f => <button key={f} style={chipStyle(fy === f)} onClick={() => setFY(f)}>{fyLabel(f)}</button>)}
        <button style={chipStyle(fy === null)} onClick={() => setFY(null)}>All Time</button>
      </div>
      <div style={{ background: "color-mix(in srgb, #d97706 10%, var(--color-surface))", border: "1px solid color-mix(in srgb, #d97706 30%, transparent)", borderRadius: 10, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: "#92400e" }}>
        ⚠ Invoices ≥ ₹30,000 for professional/legal/payroll/rent services. TDS deductible under Sec 194C/194J/194I.
      </div>
      <SummaryCards cards={[
        { label: "High-Value Bills",  value: String(filtered.length) },
        { label: "Total Value",       value: fmtShort(filtered.reduce((s, r) => s + (r.grandTotalPaise ?? 0), 0)), color: "var(--color-primary)" },
        { label: "Est. TDS (~10%)",   value: fmtShort(tdsEstimate), color: "#d97706" },
        { label: "Vendors Affected",  value: String(byVendor.length) },
      ]} />
      {byVendor.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 0", color: "var(--color-text-secondary)", fontSize: 13 }}>No invoices above ₹30,000 threshold for this period.</div>
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
            <CsvButton onClick={() => downloadCSV(`tds-tracker-${fy ?? "all"}.csv`, [
              ["Vendor", "Bills", "Total (₹)", "Est. TDS 10% (₹)"],
              ...byVendor.map(v => [v.name, v.count, (v.totalPaise / 100).toFixed(2), (v.totalPaise * 0.1 / 100).toFixed(2)]),
            ])} />
          </div>
          <div style={{ overflowX: "auto", background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1.5px solid var(--color-border)" }}>
                  {["Vendor / Payee", "Bills", "Total Paid", "Est. TDS (10%)"].map((h, i) => (
                    <th key={h} style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase" as const, letterSpacing: "0.06em", padding: "9px 14px", textAlign: i === 0 ? "left" : "right" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {byVendor.map((v, i) => {
                  const isOpen = drillVendor === v.name;
                  return (
                    <React.Fragment key={v.name}>
                      <tr onClick={() => setDrillVendor(isOpen ? null : v.name)}
                        style={{ borderBottom: !isOpen ? "1px solid var(--color-border)" : "none", background: isOpen ? "color-mix(in srgb, var(--color-primary) 6%, transparent)" : i % 2 === 0 ? "transparent" : "var(--color-surface-2)", cursor: "pointer" }}>
                        <td style={{ fontSize: 12.5, color: "var(--color-text)", padding: "10px 14px" }}>
                          <span style={{ fontSize: 10, color: "var(--color-primary)", opacity: 0.7, marginRight: 6 }}>{isOpen ? "▼" : "▶"}</span>{v.name}
                        </td>
                        <td style={{ fontSize: 12.5, color: "var(--color-text-secondary)", padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{v.count}</td>
                        <td style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-text)", padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtRupee(v.totalPaise)}</td>
                        <td style={{ fontSize: 12.5, fontWeight: 600, color: "#d97706", padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtRupee(Math.round(v.totalPaise * 0.1))}</td>
                      </tr>
                      {isOpen && <DrillDownPanel records={v.recs} onClose={() => setDrillVendor(null)} />}
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

// ── Shared: FY Comparison ──────────────────────────────────────────────────────

function FYComparisonTab({ records, title, subtitle }: { records: InvoiceMeta[]; title: string; subtitle: string }) {
  const allFYs = useMemo(() => availableFYs(records), [records]);
  const [fyA, setFyA] = useState<number | null>(() => currentFY());
  const [fyB, setFyB] = useState<number | null>(() => currentFY() - 1);

  const rA = useMemo(() => fyA !== null ? filterByFY(records, fyA) : records, [records, fyA]);
  const rB = useMemo(() => fyB !== null ? filterByFY(records, fyB) : records, [records, fyB]);
  const totA = useMemo(() => ({ count: rA.length, total: rA.reduce((s, r) => s + (r.grandTotalPaise ?? 0), 0), tax: rA.reduce((s, r) => s + (r.taxPaise ?? 0), 0) }), [rA]);
  const totB = useMemo(() => ({ count: rB.length, total: rB.reduce((s, r) => s + (r.grandTotalPaise ?? 0), 0), tax: rB.reduce((s, r) => s + (r.taxPaise ?? 0), 0) }), [rB]);

  function chgPct(a: number, b: number) { return b === 0 ? null : Math.round(((a - b) / b) * 100); }

  const rows = [
    { label: "Documents",   a: totA.count,  b: totB.count,  isAmount: false },
    { label: "Total Spend", a: totA.total,  b: totB.total,  isAmount: true  },
    { label: "GST Paid",    a: totA.tax,    b: totB.tax,    isAmount: true  },
    { label: "Avg Invoice", a: totA.count ? Math.round(totA.total / totA.count) : 0, b: totB.count ? Math.round(totB.total / totB.count) : 0, isAmount: true },
  ] as const;

  return (
    <div style={{ padding: "20px", maxWidth: 900, margin: "0 auto" }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--color-text)", margin: 0 }}>{title}</h2>
        <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 3 }}>{subtitle}</p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 12, alignItems: "center", marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-primary)", textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 6 }}>Period A</div>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            {allFYs.map(f => <button key={f} style={chipStyle(fyA === f)} onClick={() => setFyA(f)}>{fyLabel(f)}</button>)}
          </div>
        </div>
        <div style={{ fontSize: 20, color: "var(--color-text-tertiary)", fontWeight: 300 }}>vs</div>
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 6 }}>Period B</div>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            {allFYs.map(f => <button key={f} style={chipStyle(fyB === f)} onClick={() => setFyB(f)}>{fyLabel(f)}</button>)}
          </div>
        </div>
      </div>
      <div style={{ overflowX: "auto", background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10, marginBottom: 10 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1.5px solid var(--color-border)" }}>
              {["Metric", fyA !== null ? fyLabel(fyA) : "All Time", fyB !== null ? fyLabel(fyB) : "All Time", "Change"].map((h, i) => (
                <th key={i} style={{ fontSize: 10.5, fontWeight: 700, color: i === 1 ? "var(--color-primary)" : "var(--color-text-tertiary)", textTransform: "uppercase" as const, letterSpacing: "0.06em", padding: "9px 14px", textAlign: i === 0 ? "left" : "right" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const chg = chgPct(row.a, row.b);
              return (
                <tr key={row.label} style={{ borderBottom: i < rows.length - 1 ? "1px solid var(--color-border)" : "none", background: i % 2 === 0 ? "transparent" : "var(--color-surface-2)" }}>
                  <td style={{ fontSize: 12.5, color: "var(--color-text)", padding: "10px 14px" }}>{row.label}</td>
                  <td style={{ fontSize: 12.5, fontWeight: 700, color: "var(--color-primary)", padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{row.isAmount ? fmtRupee(row.a) : row.a}</td>
                  <td style={{ fontSize: 12.5, color: "var(--color-text-secondary)", padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{row.isAmount ? fmtRupee(row.b) : row.b}</td>
                  <td style={{ fontSize: 12, fontWeight: 600, padding: "10px 14px", textAlign: "right", color: chg === null ? "var(--color-text-tertiary)" : chg > 0 ? "#dc2626" : "#16a34a" }}>
                    {chg === null ? "—" : `${chg > 0 ? "+" : ""}${chg}%`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <CsvButton onClick={() => downloadCSV("fy-comparison.csv", [
          ["Metric", fyA !== null ? fyLabel(fyA) : "All Time", fyB !== null ? fyLabel(fyB) : "All Time", "Change"],
          ...rows.map(row => {
            const chg = chgPct(row.a, row.b);
            return [row.label, row.isAmount ? (row.a / 100).toFixed(2) : row.a, row.isAmount ? (row.b / 100).toFixed(2) : row.b, chg !== null ? `${chg > 0 ? "+" : ""}${chg}%` : "—"];
          }),
        ])} />
      </div>
    </div>
  );
}

// ── Tax Consultant: GSTR-2A Summary ───────────────────────────────────────────

function GSTR2ASummaryTab({ records }: { records: InvoiceMeta[] }) {
  const allFYs = useMemo(() => availableFYs(records), [records]);
  const [fy, setFY] = useState<number | null>(currentFY);
  const filtered = useMemo(() => filterByFY(records, fy).filter(r => (r.taxPaise ?? 0) > 0), [records, fy]);

  const byQuarter = useMemo(() => {
    const map = new Map<string, { label: string; count: number; taxable: number; cgst: number; sgst: number }>();
    for (const r of filtered) {
      const d = recDate(r); if (!d) continue;
      const q = Math.floor(d.getMonth() / 3) + 1;
      const key = `${d.getFullYear()}-Q${q}`;
      if (!map.has(key)) map.set(key, { label: `Q${q} ${d.getFullYear()}`, count: 0, taxable: 0, cgst: 0, sgst: 0 });
      const b = map.get(key)!;
      b.count++;
      const tax = r.taxPaise ?? 0;
      b.taxable += (r.grandTotalPaise ?? 0) - tax;
      b.cgst += Math.round(tax / 2); b.sgst += Math.round(tax / 2);
    }
    return [...map.entries()].sort().map(([, v]) => v);
  }, [filtered]);

  const totals = byQuarter.reduce((s, q) => ({ count: s.count + q.count, taxable: s.taxable + q.taxable, cgst: s.cgst + q.cgst, sgst: s.sgst + q.sgst }), { count: 0, taxable: 0, cgst: 0, sgst: 0 });

  return (
    <div style={{ padding: "20px", maxWidth: 900, margin: "0 auto" }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--color-text)", margin: 0 }}>GSTR-2A Summary</h2>
        <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 3 }}>Input tax credit by quarter — for reconciliation with GSTR-2A / GSTR-2B</p>
      </div>
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 14 }}>
        {allFYs.map(f => <button key={f} style={chipStyle(fy === f)} onClick={() => setFY(f)}>{fyLabel(f)}</button>)}
        <button style={chipStyle(fy === null)} onClick={() => setFY(null)}>All Time</button>
      </div>
      <div style={{ background: "color-mix(in srgb, #3b82f6 8%, var(--color-surface))", border: "1px solid color-mix(in srgb, #3b82f6 25%, transparent)", borderRadius: 10, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: "#1e40af" }}>
        ℹ CGST+SGST split shown as 50/50 estimate. Verify IGST (cross-state) amounts against portal GSTR-2A data.
      </div>
      <SummaryCards cards={[
        { label: "Invoices",     value: String(totals.count) },
        { label: "Taxable",      value: fmtShort(totals.taxable) },
        { label: "CGST",         value: fmtShort(totals.cgst), color: "#16a34a" },
        { label: "SGST",         value: fmtShort(totals.sgst), color: "#16a34a" },
      ]} />
      {byQuarter.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 0", color: "var(--color-text-secondary)", fontSize: 13 }}>No GST data for this period.</div>
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
            <CsvButton onClick={() => downloadCSV(`gstr2a-${fy ?? "all"}.csv`, [
              ["Quarter", "Invoices", "Taxable (₹)", "CGST (₹)", "SGST (₹)", "Total ITC (₹)"],
              ...byQuarter.map(q => [q.label, q.count, (q.taxable / 100).toFixed(2), (q.cgst / 100).toFixed(2), (q.sgst / 100).toFixed(2), ((q.cgst + q.sgst) / 100).toFixed(2)]),
              ["Total", totals.count, (totals.taxable / 100).toFixed(2), (totals.cgst / 100).toFixed(2), (totals.sgst / 100).toFixed(2), ((totals.cgst + totals.sgst) / 100).toFixed(2)],
            ])} />
          </div>
          <div style={{ overflowX: "auto", background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1.5px solid var(--color-border)" }}>
                  {["Quarter", "Invoices", "Taxable", "CGST", "SGST", "Total ITC"].map((h, i) => (
                    <th key={h} style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase" as const, letterSpacing: "0.06em", padding: "9px 14px", textAlign: i === 0 ? "left" : "right" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {byQuarter.map((q, i) => (
                  <tr key={q.label} style={{ borderBottom: i < byQuarter.length - 1 ? "1px solid var(--color-border)" : "none", background: i % 2 === 0 ? "transparent" : "var(--color-surface-2)" }}>
                    <td style={{ fontSize: 12.5, color: "var(--color-text)", padding: "9px 14px" }}>{q.label}</td>
                    <td style={{ fontSize: 12.5, color: "var(--color-text-secondary)", padding: "9px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{q.count}</td>
                    <td style={{ fontSize: 12.5, color: "var(--color-text)", padding: "9px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtRupee(q.taxable)}</td>
                    <td style={{ fontSize: 12.5, color: "#16a34a", padding: "9px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtRupee(q.cgst)}</td>
                    <td style={{ fontSize: 12.5, color: "#16a34a", padding: "9px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtRupee(q.sgst)}</td>
                    <td style={{ fontSize: 12.5, fontWeight: 600, color: "#16a34a", padding: "9px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtRupee(q.cgst + q.sgst)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: "1.5px solid var(--color-border)", background: "var(--color-surface-2)" }}>
                  <td colSpan={2} style={{ fontSize: 12, fontWeight: 700, padding: "10px 14px" }}>Total</td>
                  <td style={{ fontSize: 12.5, fontWeight: 700, padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtRupee(totals.taxable)}</td>
                  <td style={{ fontSize: 12.5, fontWeight: 700, color: "#16a34a", padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtRupee(totals.cgst)}</td>
                  <td style={{ fontSize: 12.5, fontWeight: 700, color: "#16a34a", padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtRupee(totals.sgst)}</td>
                  <td style={{ fontSize: 12.5, fontWeight: 700, color: "#16a34a", padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtRupee(totals.cgst + totals.sgst)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ── CA: Audit Trail ────────────────────────────────────────────────────────────

function AuditTrailTab({ records }: { records: InvoiceMeta[] }) {
  const allFYs = useMemo(() => availableFYs(records), [records]);
  const [fy, setFY] = useState<number | null>(currentFY);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const byFY = filterByFY(records, fy);
    if (!search.trim()) return byFY;
    const q = search.toLowerCase();
    return byFY.filter(r => (r.merchantName ?? "").toLowerCase().includes(q) || (r.docType ?? "").toLowerCase().includes(q) || (r.invoiceNumber ?? "").toLowerCase().includes(q));
  }, [records, fy, search]);

  const sorted = useMemo(() => [...filtered].sort((a, b) => (b.invoiceDate ?? b.createdAt ?? "").localeCompare(a.invoiceDate ?? a.createdAt ?? "")), [filtered]);

  return (
    <div style={{ padding: "20px", maxWidth: 1000, margin: "0 auto" }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--color-text)", margin: 0 }}>Audit Trail</h2>
        <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 3 }}>Complete date-ordered invoice list with doc type, source, and extraction status</p>
      </div>
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 14 }}>
        {allFYs.map(f => <button key={f} style={chipStyle(fy === f)} onClick={() => setFY(f)}>{fyLabel(f)}</button>)}
        <button style={chipStyle(fy === null)} onClick={() => setFY(null)}>All Time</button>
      </div>
      <div style={{ display: "flex", gap: 10, marginBottom: 14, alignItems: "center", flexWrap: "wrap" }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search vendor, type, invoice #..."
          style={{ flex: 1, maxWidth: 280, fontSize: 13, padding: "6px 10px", borderRadius: 8, border: "1px solid var(--color-border)", background: "var(--color-bg)", color: "var(--color-text)" }} />
        <CsvButton onClick={() => downloadCSV(`audit-trail-${fy ?? "all"}.csv`, [
          ["Date", "Vendor", "Invoice #", "Doc Type", "Amount (₹)", "GST (₹)", "Source", "Status"],
          ...sorted.map(r => [r.invoiceDate?.slice(0, 10) ?? "—", r.merchantName ?? "Unknown", r.invoiceNumber ?? "—",
            r.docType ?? "other", ((r.grandTotalPaise ?? 0) / 100).toFixed(2), ((r.taxPaise ?? 0) / 100).toFixed(2),
            r.sourceFilename ?? "email", r.status ?? "processed"]),
        ])} />
      </div>
      <SummaryCards cards={[
        { label: "Documents", value: String(sorted.length) },
        { label: "Total",     value: fmtShort(sorted.reduce((s, r) => s + (r.grandTotalPaise ?? 0), 0)), color: "var(--color-primary)" },
      ]} />
      {sorted.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 0", color: "var(--color-text-secondary)", fontSize: 13 }}>No records for this period.</div>
      ) : (
        <div style={{ overflowX: "auto", background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1.5px solid var(--color-border)" }}>
                {["Date", "Vendor", "Invoice #", "Type", "Amount", "GST", "Source", "Status"].map((h, i) => (
                  <th key={h} style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase" as const, letterSpacing: "0.06em", padding: "9px 12px", textAlign: i >= 4 && i <= 5 ? "right" : "left", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => (
                <tr key={r.id ?? i} style={{ borderBottom: i < sorted.length - 1 ? "1px solid var(--color-border)" : "none", background: i % 2 === 0 ? "transparent" : "var(--color-surface-2)" }}>
                  <td style={{ fontSize: 11.5, color: "var(--color-text-secondary)", padding: "8px 12px", whiteSpace: "nowrap" }}>
                    {r.invoiceDate ? new Date(r.invoiceDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" }) : "—"}
                  </td>
                  <td style={{ fontSize: 12.5, color: "var(--color-text)", padding: "8px 12px", maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.merchantName ?? "Unknown"}</td>
                  <td style={{ fontSize: 11, color: "var(--color-text-secondary)", padding: "8px 12px", maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.invoiceNumber ?? "—"}</td>
                  <td style={{ padding: "8px 12px" }}>
                    <span style={{ background: "var(--color-surface-2)", borderRadius: 4, padding: "2px 6px", fontSize: 11 }}>{r.docType ?? "other"}</span>
                  </td>
                  <td style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-text)", padding: "8px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtRupee(r.grandTotalPaise ?? 0)}</td>
                  <td style={{ fontSize: 12, color: "#16a34a", padding: "8px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.taxPaise ? fmtRupee(r.taxPaise) : "—"}</td>
                  <td style={{ fontSize: 11, color: "var(--color-text-tertiary)", padding: "8px 12px", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.sourceFilename ?? "email"}</td>
                  <td style={{ padding: "8px 12px" }}>
                    <span style={{ fontSize: 10.5, padding: "2px 7px", borderRadius: 4, fontWeight: 600,
                      background: r.status === "imported" || r.status === "downloaded" || r.status === "pending_review" ? "color-mix(in srgb, #16a34a 12%, transparent)" : "color-mix(in srgb, #dc2626 12%, transparent)",
                      color: r.status === "imported" || r.status === "downloaded" || r.status === "pending_review" ? "#16a34a" : "#dc2626" }}>
                      {r.status ?? "imported"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Real Estate: Property-wise Expense ────────────────────────────────────────

function REPropertyExpenseTab({ records }: { records: InvoiceMeta[] }) {
  const allFYs = useMemo(() => availableFYs(records), [records]);
  const [fy, setFY] = useState<number | null>(currentFY);
  const [drillProp, setDrillProp] = useState<string | null>(null);
  const filtered = useMemo(() => filterByFY(records, fy), [records, fy]);

  const { properties, grandTotal, untagged } = useMemo(() => {
    const map = new Map<string, { name: string; count: number; totalPaise: number; recs: InvoiceMeta[] }>();
    let untagged = 0;
    for (const r of filtered) {
      const tag = r.projectTag?.trim() || r.clientTags?.[0]?.trim();
      if (!tag) { untagged++; continue; }
      if (!map.has(tag)) map.set(tag, { name: tag, count: 0, totalPaise: 0, recs: [] });
      const p = map.get(tag)!; p.count++; p.totalPaise += r.grandTotalPaise ?? 0; p.recs.push(r);
    }
    const properties = [...map.values()].sort((a, b) => b.totalPaise - a.totalPaise);
    return { properties, grandTotal: properties.reduce((s, p) => s + p.totalPaise, 0), untagged };
  }, [filtered]);

  return (
    <div style={{ padding: "20px", maxWidth: 900, margin: "0 auto" }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--color-text)", margin: 0 }}>Property-wise Expense</h2>
        <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 3 }}>All expenses per property — stamp duty, legal, maintenance, repairs. Tag invoices with property name as Project Tag.</p>
      </div>
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 14 }}>
        {allFYs.map(f => <button key={f} style={chipStyle(fy === f)} onClick={() => setFY(f)}>{fyLabel(f)}</button>)}
        <button style={chipStyle(fy === null)} onClick={() => setFY(null)}>All Time</button>
      </div>
      <SummaryCards cards={[
        { label: "Properties",    value: String(properties.length) },
        { label: "Total Expenses",value: fmtShort(grandTotal), color: "var(--color-primary)" },
        { label: "Untagged",      value: `${untagged} inv.` },
      ]} />
      {properties.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 24px", color: "var(--color-text-secondary)", fontSize: 13, background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>No property-tagged invoices</div>
          <div style={{ fontSize: 12, opacity: 0.8 }}>Set Project Tag to property name (e.g. "Bandra Flat", "Plot-42") in the View screen.</div>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
            <CsvButton onClick={() => downloadCSV(`property-expenses-${fy ?? "all"}.csv`, [
              ["Property", "Invoices", "Total (₹)", "% of Total"],
              ...properties.map(p => [p.name, p.count, (p.totalPaise / 100).toFixed(2), pct(p.totalPaise, grandTotal)]),
            ])} />
          </div>
          <div style={{ overflowX: "auto", background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1.5px solid var(--color-border)" }}>
                  {["Property", "Invoices", "Total Expenses", "% of Total"].map((h, i) => (
                    <th key={h} style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase" as const, letterSpacing: "0.06em", padding: "9px 14px", textAlign: i === 0 ? "left" : "right" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {properties.map((p, i) => {
                  const isOpen = drillProp === p.name;
                  return (
                    <React.Fragment key={p.name}>
                      <tr onClick={() => setDrillProp(isOpen ? null : p.name)}
                        style={{ borderBottom: !isOpen ? "1px solid var(--color-border)" : "none", background: isOpen ? "color-mix(in srgb, var(--color-primary) 6%, transparent)" : i % 2 === 0 ? "transparent" : "var(--color-surface-2)", cursor: "pointer" }}>
                        <td style={{ fontSize: 12.5, color: "var(--color-text)", padding: "10px 14px" }}>
                          <span style={{ fontSize: 10, color: "var(--color-primary)", opacity: 0.7, marginRight: 6 }}>{isOpen ? "▼" : "▶"}</span>{p.name}
                        </td>
                        <td style={{ fontSize: 12.5, color: "var(--color-text-secondary)", padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{p.count}</td>
                        <td style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-text)", padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtRupee(p.totalPaise)}</td>
                        <td style={{ fontSize: 12, color: "var(--color-text-secondary)", padding: "10px 14px", textAlign: "right" }}>{pct(p.totalPaise, grandTotal)}</td>
                      </tr>
                      {isOpen && <DrillDownPanel records={p.recs} onClose={() => setDrillProp(null)} />}
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

// ── Real Estate: Rental Income Tracker ────────────────────────────────────────

function RERentalIncomeTab({ records }: { records: InvoiceMeta[] }) {
  const allFYs = useMemo(() => availableFYs(records), [records]);
  const [fy, setFY] = useState<number | null>(currentFY);
  const filtered = useMemo(() => filterByFY(records, fy).filter(r => {
    const types = r.docTypes?.length ? r.docTypes : (r.docType ? [r.docType] : []);
    return types.includes("rent");
  }), [records, fy]);
  const sorted = useMemo(() => [...filtered].sort((a, b) => (b.invoiceDate ?? b.createdAt ?? "").localeCompare(a.invoiceDate ?? a.createdAt ?? "")), [filtered]);
  const totalRent = sorted.reduce((s, r) => s + (r.grandTotalPaise ?? 0), 0);

  return (
    <div style={{ padding: "20px", maxWidth: 900, margin: "0 auto" }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--color-text)", margin: 0 }}>Rental Income Tracker</h2>
        <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 3 }}>Rent receipt invoices — tenant, property, amount, month. Invoices detected as doc type "rent" appear here.</p>
      </div>
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 14 }}>
        {allFYs.map(f => <button key={f} style={chipStyle(fy === f)} onClick={() => setFY(f)}>{fyLabel(f)}</button>)}
        <button style={chipStyle(fy === null)} onClick={() => setFY(null)}>All Time</button>
      </div>
      <SummaryCards cards={[
        { label: "Rent Receipts", value: String(sorted.length) },
        { label: "Total Rent",    value: fmtShort(totalRent), color: "#16a34a" },
        { label: "Avg / Receipt", value: sorted.length > 0 ? fmtShort(Math.round(totalRent / sorted.length)) : "—" },
      ]} />
      {sorted.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 0", color: "var(--color-text-secondary)", fontSize: 13 }}>No rent invoices for this period. Invoices with doc type "rent" will appear here.</div>
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
            <CsvButton onClick={() => downloadCSV(`rental-income-${fy ?? "all"}.csv`, [
              ["Date", "Tenant / Vendor", "Property (Project Tag)", "Month", "Amount (₹)"],
              ...sorted.map(r => [r.invoiceDate?.slice(0, 10) ?? "—", r.merchantName ?? r.clientTags?.[0] ?? "Unknown", r.projectTag ?? "—",
                r.invoiceDate ? new Date(r.invoiceDate).toLocaleDateString("en-IN", { month: "short", year: "2-digit" }) : "—",
                ((r.grandTotalPaise ?? 0) / 100).toFixed(2)]),
            ])} />
          </div>
          <div style={{ overflowX: "auto", background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1.5px solid var(--color-border)" }}>
                  {["Date", "Tenant / Vendor", "Property", "Month", "Amount"].map((h, i) => (
                    <th key={h} style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase" as const, letterSpacing: "0.06em", padding: "9px 12px", textAlign: i === 4 ? "right" : "left" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((r, i) => (
                  <tr key={r.id ?? i} style={{ borderBottom: i < sorted.length - 1 ? "1px solid var(--color-border)" : "none", background: i % 2 === 0 ? "transparent" : "var(--color-surface-2)" }}>
                    <td style={{ fontSize: 11.5, color: "var(--color-text-secondary)", padding: "9px 12px", whiteSpace: "nowrap" }}>
                      {r.invoiceDate ? new Date(r.invoiceDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" }) : "—"}
                    </td>
                    <td style={{ fontSize: 12.5, color: "var(--color-text)", padding: "9px 12px", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.merchantName ?? r.clientTags?.[0] ?? "Unknown"}</td>
                    <td style={{ fontSize: 12, color: "var(--color-text-secondary)", padding: "9px 12px", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.projectTag ?? "—"}</td>
                    <td style={{ fontSize: 12, color: "var(--color-text-secondary)", padding: "9px 12px", whiteSpace: "nowrap" }}>
                      {r.invoiceDate ? new Date(r.invoiceDate).toLocaleDateString("en-IN", { month: "short", year: "2-digit" }) : "—"}
                    </td>
                    <td style={{ fontSize: 12.5, fontWeight: 600, color: "#16a34a", padding: "9px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtRupee(r.grandTotalPaise ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: "1.5px solid var(--color-border)", background: "var(--color-surface-2)" }}>
                  <td colSpan={4} style={{ fontSize: 12, fontWeight: 700, padding: "10px 12px" }}>Total Rent Received</td>
                  <td style={{ fontSize: 12.5, fontWeight: 700, color: "#16a34a", padding: "10px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtRupee(totalRent)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ── Real Estate: Acquisition Cost Sheet ───────────────────────────────────────

function REAcquisitionCostTab({ records }: { records: InvoiceMeta[] }) {
  const allFYs = useMemo(() => availableFYs(records), [records]);
  const [fy, setFY] = useState<number | null>(currentFY);
  const ACQ_TYPES = ["legal", "financial", "tax", "other"];

  const filtered = useMemo(() => filterByFY(records, fy).filter(r => {
    const types = r.docTypes?.length ? r.docTypes : (r.docType ? [r.docType] : ["other"]);
    return types.some(t => ACQ_TYPES.includes(t));
  }), [records, fy]);

  const byProperty = useMemo(() => {
    const map = new Map<string, { name: string; count: number; totalPaise: number; byType: Record<string, number> }>();
    for (const r of filtered) {
      const tag = r.projectTag?.trim() || r.clientTags?.[0]?.trim() || "(Unassigned)";
      if (!map.has(tag)) map.set(tag, { name: tag, count: 0, totalPaise: 0, byType: {} });
      const p = map.get(tag)!; p.count++; p.totalPaise += r.grandTotalPaise ?? 0;
      const t = r.docType ?? "other";
      p.byType[t] = (p.byType[t] ?? 0) + (r.grandTotalPaise ?? 0);
    }
    return [...map.values()].sort((a, b) => b.totalPaise - a.totalPaise);
  }, [filtered]);

  const grandTotal = byProperty.reduce((s, p) => s + p.totalPaise, 0);

  return (
    <div style={{ padding: "20px", maxWidth: 900, margin: "0 auto" }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--color-text)", margin: 0 }}>Acquisition Cost Sheet</h2>
        <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 3 }}>One-time costs per property: registration, stamp duty, brokerage, legal fees</p>
      </div>
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 14 }}>
        {allFYs.map(f => <button key={f} style={chipStyle(fy === f)} onClick={() => setFY(f)}>{fyLabel(f)}</button>)}
        <button style={chipStyle(fy === null)} onClick={() => setFY(null)}>All Time</button>
      </div>
      <SummaryCards cards={[
        { label: "Properties",        value: String(byProperty.filter(p => p.name !== "(Unassigned)").length) },
        { label: "Total Acquisition", value: fmtShort(grandTotal), color: "var(--color-primary)" },
        { label: "Documents",         value: String(filtered.length) },
      ]} />
      {byProperty.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 0", color: "var(--color-text-secondary)", fontSize: 13 }}>No acquisition documents. Legal, financial, and tax invoices tagged to a property will appear here.</div>
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
            <CsvButton onClick={() => downloadCSV(`acquisition-costs-${fy ?? "all"}.csv`, [
              ["Property", "Documents", "Legal (₹)", "Financial (₹)", "Tax (₹)", "Other (₹)", "Total (₹)"],
              ...byProperty.map(p => [p.name, p.count, ((p.byType["legal"] ?? 0) / 100).toFixed(2), ((p.byType["financial"] ?? 0) / 100).toFixed(2), ((p.byType["tax"] ?? 0) / 100).toFixed(2), ((p.byType["other"] ?? 0) / 100).toFixed(2), (p.totalPaise / 100).toFixed(2)]),
            ])} />
          </div>
          <div style={{ overflowX: "auto", background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1.5px solid var(--color-border)" }}>
                  {["Property", "Legal", "Financial", "Tax", "Other", "Total"].map((h, i) => (
                    <th key={h} style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase" as const, letterSpacing: "0.06em", padding: "9px 14px", textAlign: i === 0 ? "left" : "right" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {byProperty.map((p, i) => (
                  <tr key={p.name} style={{ borderBottom: i < byProperty.length - 1 ? "1px solid var(--color-border)" : "none", background: i % 2 === 0 ? "transparent" : "var(--color-surface-2)" }}>
                    <td style={{ fontSize: 12.5, color: "var(--color-text)", padding: "10px 14px", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</td>
                    {["legal", "financial", "tax", "other"].map(t => (
                      <td key={t} style={{ fontSize: 12.5, color: "var(--color-text-secondary)", padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{p.byType[t] ? fmtRupee(p.byType[t]) : "—"}</td>
                    ))}
                    <td style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-text)", padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtRupee(p.totalPaise)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: "1.5px solid var(--color-border)", background: "var(--color-surface-2)" }}>
                  <td style={{ fontSize: 12, fontWeight: 700, padding: "10px 14px" }}>Total</td>
                  <td colSpan={4} />
                  <td style={{ fontSize: 12.5, fontWeight: 700, padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtRupee(grandTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ── Advocate: Court Fees Tracker ──────────────────────────────────────────────

function AdvCourtFeesTab({ records }: { records: InvoiceMeta[] }) {
  const allFYs = useMemo(() => availableFYs(records), [records]);
  const [fy, setFY] = useState<number | null>(currentFY);
  const [drillMatter, setDrillMatter] = useState<string | null>(null);

  const filtered = useMemo(() => filterByFY(records, fy).filter(r => {
    const types = r.docTypes?.length ? r.docTypes : (r.docType ? [r.docType] : []);
    return types.includes("legal") || types.includes("tax");
  }), [records, fy]);

  const byMatter = useMemo(() => {
    const map = new Map<string, { matter: string; count: number; totalPaise: number; recs: InvoiceMeta[] }>();
    for (const r of filtered) {
      const matter = r.clientTags?.[0]?.trim() || r.projectTag?.trim() || "(No Matter Tagged)";
      if (!map.has(matter)) map.set(matter, { matter, count: 0, totalPaise: 0, recs: [] });
      const m = map.get(matter)!; m.count++; m.totalPaise += r.grandTotalPaise ?? 0; m.recs.push(r);
    }
    return [...map.values()].sort((a, b) => b.totalPaise - a.totalPaise);
  }, [filtered]);

  const totalFees = byMatter.reduce((s, m) => s + m.totalPaise, 0);

  return (
    <div style={{ padding: "20px", maxWidth: 900, margin: "0 auto" }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--color-text)", margin: 0 }}>Court Fees Tracker</h2>
        <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 3 }}>Legal/tax invoices grouped by matter — set client tag or project tag to the matter name</p>
      </div>
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 14 }}>
        {allFYs.map(f => <button key={f} style={chipStyle(fy === f)} onClick={() => setFY(f)}>{fyLabel(f)}</button>)}
        <button style={chipStyle(fy === null)} onClick={() => setFY(null)}>All Time</button>
      </div>
      <SummaryCards cards={[
        { label: "Court Fee Bills", value: String(filtered.length) },
        { label: "Total Fees",      value: fmtShort(totalFees), color: "var(--color-primary)" },
        { label: "Matters",         value: String(byMatter.filter(m => m.matter !== "(No Matter Tagged)").length) },
      ]} />
      {byMatter.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 0", color: "var(--color-text-secondary)", fontSize: 13 }}>No legal/court fee invoices for this period.</div>
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
            <CsvButton onClick={() => downloadCSV(`court-fees-${fy ?? "all"}.csv`, [
              ["Matter", "Bills", "Total Fees (₹)"],
              ...byMatter.map(m => [m.matter, m.count, (m.totalPaise / 100).toFixed(2)]),
            ])} />
          </div>
          <div style={{ overflowX: "auto", background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1.5px solid var(--color-border)" }}>
                  {["Matter / Client", "Bills", "Total Fees"].map((h, i) => (
                    <th key={h} style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase" as const, letterSpacing: "0.06em", padding: "9px 14px", textAlign: i === 0 ? "left" : "right" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {byMatter.map((m, i) => {
                  const isOpen = drillMatter === m.matter;
                  return (
                    <React.Fragment key={m.matter}>
                      <tr onClick={() => setDrillMatter(isOpen ? null : m.matter)}
                        style={{ borderBottom: !isOpen ? "1px solid var(--color-border)" : "none", background: isOpen ? "color-mix(in srgb, var(--color-primary) 6%, transparent)" : i % 2 === 0 ? "transparent" : "var(--color-surface-2)", cursor: "pointer" }}>
                        <td style={{ fontSize: 12.5, color: "var(--color-text)", padding: "10px 14px" }}>
                          <span style={{ fontSize: 10, color: "var(--color-primary)", opacity: 0.7, marginRight: 6 }}>{isOpen ? "▼" : "▶"}</span>{m.matter}
                        </td>
                        <td style={{ fontSize: 12.5, color: "var(--color-text-secondary)", padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{m.count}</td>
                        <td style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-text)", padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtRupee(m.totalPaise)}</td>
                      </tr>
                      {isOpen && <DrillDownPanel records={m.recs} onClose={() => setDrillMatter(null)} />}
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

// ── Society: Meetings ─────────────────────────────────────────────────────────

const SOCIETY_MEETINGS_KEY = "jinvoice_society_meetings";

interface SocietyMeeting {
  id: string;
  type: "agm" | "sgm" | "committee" | "general";
  date: string;
  title: string;
  venue?: string;
  attendees?: number;
  totalMembers?: number;
  agenda?: string;
  resolutions?: string;
  notes?: string;
  createdAt: string;
}

const MTG_LABEL: Record<SocietyMeeting["type"], string> = {
  agm:       "AGM",
  sgm:       "Special GM",
  committee: "Committee Meeting",
  general:   "Society Meeting",
};
const MTG_ICON: Record<SocietyMeeting["type"], string> = {
  agm: "🏛️", sgm: "⚡", committee: "👥", general: "🤝",
};

function loadMeetings(): SocietyMeeting[] {
  try { return JSON.parse(localStorage.getItem(SOCIETY_MEETINGS_KEY) ?? "[]"); } catch { return []; }
}
function saveMeetings(meetings: SocietyMeeting[]): void {
  try { localStorage.setItem(SOCIETY_MEETINGS_KEY, JSON.stringify(meetings)); } catch {}
}
function genMtgId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
function mtgFY(date: string): number {
  const d = new Date(date + "T00:00:00");
  return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
}
function fyContainsMtg(date: string, fyStart: number): boolean {
  const d = new Date(date + "T00:00:00");
  return d >= new Date(fyStart, 3, 1) && d <= new Date(fyStart + 1, 2, 31, 23, 59, 59);
}

function AddMeetingModal({ onClose, onSave }: { onClose: () => void; onSave: (m: SocietyMeeting) => void }) {
  const [type, setType]           = useState<SocietyMeeting["type"]>("general");
  const [date, setDate]           = useState(new Date().toISOString().slice(0, 10));
  const [title, setTitle]         = useState("");
  const [venue, setVenue]         = useState("");
  const [attendees, setAttendees] = useState("");
  const [totalMem, setTotalMem]   = useState("");
  const [agenda, setAgenda]       = useState("");
  const [resolutions, setResolutions] = useState("");
  const [notes, setNotes]         = useState("");
  const [err, setErr]             = useState<string | null>(null);

  const iS: React.CSSProperties = { width: "100%", padding: "7px 10px", borderRadius: 6, fontSize: 13, border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--color-text)", boxSizing: "border-box" };
  const taS: React.CSSProperties = { ...iS, minHeight: 70, resize: "vertical" as const, fontFamily: "inherit" };
  const lS: React.CSSProperties  = { fontSize: 12, color: "var(--color-text-secondary)", display: "block", marginBottom: 4 };

  const handleSave = () => {
    if (!date) { setErr("Select a meeting date."); return; }
    const m: SocietyMeeting = {
      id: genMtgId(),
      type,
      date,
      title: title.trim() || `${MTG_LABEL[type]} — ${new Date(date + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`,
      venue: venue.trim() || undefined,
      attendees: attendees ? Number(attendees) : undefined,
      totalMembers: totalMem ? Number(totalMem) : undefined,
      agenda: agenda.trim() || undefined,
      resolutions: resolutions.trim() || undefined,
      notes: notes.trim() || undefined,
      createdAt: new Date().toISOString(),
    };
    onSave(m);
    onClose();
  };

  const TYPES: SocietyMeeting["type"][] = ["agm", "sgm", "committee", "general"];

  return (
    <div className="modal-overlay" onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480, width: "94%", padding: 24, borderRadius: 12, background: "var(--color-surface)", boxShadow: "0 8px 32px rgba(0,0,0,0.2)", maxHeight: "90vh", overflowY: "auto" }}>
        <h2 style={{ fontSize: 17, marginBottom: 18 }}>Add Meeting</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
          <div>
            <label style={lS}>Meeting type *</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {TYPES.map((t) => (
                <button key={t} type="button" onClick={() => setType(t)} style={{ padding: "5px 12px", borderRadius: 6, fontSize: 12.5, fontWeight: 600, cursor: "pointer", border: type === t ? "none" : "1px solid var(--color-border)", background: type === t ? "#7c3aed" : "var(--color-surface-2)", color: type === t ? "#fff" : "var(--color-text)" }}>
                  {MTG_ICON[t]} {MTG_LABEL[t]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label style={lS}>Date *</label>
            <input type="date" style={iS} value={date} onChange={(e) => { setDate(e.target.value); setErr(null); }} />
          </div>
          <div>
            <label style={lS}>Title / Subject <span style={{ fontWeight: 400 }}>(optional — auto-filled if blank)</span></label>
            <input style={iS} placeholder={`${MTG_LABEL[type]} — 01 Jan 2025`} value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <label style={lS}>Venue</label>
            <input style={iS} placeholder="e.g. Community Hall, Flat 101" value={venue} onChange={(e) => setVenue(e.target.value)} />
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={lS}>Attendees</label>
              <input type="number" min="0" style={iS} placeholder="0" value={attendees} onChange={(e) => setAttendees(e.target.value)} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={lS}>Total members</label>
              <input type="number" min="0" style={iS} placeholder="0" value={totalMem} onChange={(e) => setTotalMem(e.target.value)} />
            </div>
          </div>
          <div>
            <label style={lS}>Agenda <span style={{ fontWeight: 400 }}>(one item per line)</span></label>
            <textarea style={taS} placeholder="1. Approval of previous minutes&#10;2. Financial statement&#10;3. Maintenance revision" value={agenda} onChange={(e) => setAgenda(e.target.value)} />
          </div>
          <div>
            <label style={lS}>Resolutions passed <span style={{ fontWeight: 400 }}>(one per line)</span></label>
            <textarea style={taS} placeholder="Maintenance increased to ₹3500 from April&#10;Lift AMC renewed with ABC Services" value={resolutions} onChange={(e) => setResolutions(e.target.value)} />
          </div>
          <div>
            <label style={lS}>Notes / Remarks</label>
            <textarea style={{ ...taS, minHeight: 50 }} placeholder="Additional notes..." value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        {err && <p style={{ fontSize: 12, color: "#ef4444", marginTop: 8 }}>{err}</p>}
        <div style={{ display: "flex", gap: 10, marginTop: 18, justifyContent: "flex-end" }}>
          <button className="btn-ghost" onClick={onClose} style={{ fontSize: 13 }}>Cancel</button>
          <button onClick={handleSave} style={{ padding: "6px 18px", borderRadius: 6, fontSize: 13, fontWeight: 600, border: "none", background: "var(--color-primary)", color: "#fff", cursor: "pointer" }}>
            Save Meeting
          </button>
        </div>
      </div>
    </div>
  );
}

function agmMarkdownToHtml(md: string): string {
  function fmt(s: string): string {
    return s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\*(.+?)\*/g, "<em>$1</em>");
  }
  const lines = md.split("\n");
  const out: string[] = [];
  let inList = false;
  for (const raw of lines) {
    const esc = raw.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    if (/^####\s/.test(raw)) {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push(`<h4>${fmt(esc.replace(/^####\s/, ""))}</h4>`);
    } else if (/^###\s/.test(raw)) {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push(`<h3>${fmt(esc.replace(/^###\s/, ""))}</h3>`);
    } else if (/^##\s/.test(raw)) {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push(`<h2>${fmt(esc.replace(/^##\s/, ""))}</h2>`);
    } else if (/^#\s/.test(raw)) {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push(`<h1>${fmt(esc.replace(/^#\s/, ""))}</h1>`);
    } else if (/^---+$/.test(raw.trim())) {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push("<hr>");
    } else if (/^[*-] /.test(raw)) {
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push(`<li>${fmt(esc.replace(/^[*-] /, ""))}</li>`);
    } else if (raw.trim() === "") {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push("<div class='spacer'></div>");
    } else {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push(`<p>${fmt(esc)}</p>`);
    }
  }
  if (inList) out.push("</ul>");
  return out.join("\n");
}

const AGM_PRINT_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;600;700&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Noto Sans Devanagari', 'Mangal', Arial, sans-serif; font-size: 13pt; line-height: 1.8; color: #111; background: #fff; padding: 40px 60px; max-width: 800px; margin: 0 auto; }
  h1 { font-size: 18pt; font-weight: 700; text-align: center; margin: 16px 0 6px; }
  h2 { font-size: 15pt; font-weight: 700; margin: 20px 0 8px; }
  h3 { font-size: 13.5pt; font-weight: 700; margin: 18px 0 6px; }
  h4 { font-size: 12.5pt; font-weight: 600; margin: 14px 0 4px; }
  p  { margin: 6px 0; }
  ul { margin: 6px 0 6px 24px; }
  li { margin: 4px 0; }
  hr { border: none; border-top: 1.5px solid #888; margin: 16px 0; }
  .spacer { height: 8px; }
  strong { font-weight: 700; }
  @media print { body { padding: 20px 40px; } }
`;

function agmPrintWindow(title: string, bodyHtml: string) {
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title><style>${AGM_PRINT_CSS}</style></head><body>${bodyHtml}</body></html>`);
  w.document.close();
  w.print();
}

function AGMReportModal({ meetings, importedDocs, onClose, initialFY }: { meetings: SocietyMeeting[]; importedDocs: ImportedMeetingDoc[]; onClose: () => void; initialFY?: number }) {
  const curFY = currentFY();
  const allFYs = useMemo(() => {
    const fys = new Set<number>();
    for (const m of meetings) fys.add(mtgFY(m.date));
    for (const d of importedDocs) fys.add(d.fy);
    fys.add(curFY);
    return [...fys].sort((a, b) => b - a);
  }, [meetings, importedDocs, curFY]);

  const [selectedFY, setSelectedFY] = useState(initialFY ?? curFY);

  const agm = useMemo(
    () => meetings.filter(m => m.type === "agm" && fyContainsMtg(m.date, selectedFY)).sort((a, b) => b.date.localeCompare(a.date))[0] ?? null,
    [meetings, selectedFY],
  );
  const allInFY = useMemo(
    () => meetings.filter(m => fyContainsMtg(m.date, selectedFY)).sort((a, b) => a.date.localeCompare(b.date)),
    [meetings, selectedFY],
  );
  const importedInFY = useMemo(
    () => importedDocs.filter(d => fyContainsMtg(d.date, selectedFY)).sort((a, b) => a.date.localeCompare(b.date)),
    [importedDocs, selectedFY],
  );

  const prevFY = selectedFY - 1;
  const prevAGM = useMemo(
    () => meetings.filter(m => m.type === "agm" && fyContainsMtg(m.date, prevFY)).sort((a, b) => b.date.localeCompare(a.date))[0] ?? null,
    [meetings, prevFY],
  );

  const reportText = useMemo(() => {
    const fyLbl = fyLabel(selectedFY);
    const prevFyLbl = fyLabel(prevFY);
    const lines: string[] = [];
    const hr  = "═".repeat(50);
    const hr2 = "─".repeat(30);
    lines.push(`AGM REPORT — ${fyLbl}`);
    lines.push(hr);
    lines.push("");

    // ── Section 1: Previous year's AGM for continuity reference ──────────────
    lines.push(`PREVIOUS AGM REFERENCE (${prevFyLbl})`);
    lines.push(hr2);
    if (prevAGM) {
      lines.push(`Date    : ${new Date(prevAGM.date + "T00:00:00").toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}`);
      if (prevAGM.venue) lines.push(`Venue   : ${prevAGM.venue}`);
      if (prevAGM.attendees != null || prevAGM.totalMembers != null) {
        const att = prevAGM.attendees ?? "—";
        const tot = prevAGM.totalMembers ?? "—";
        const pct = prevAGM.attendees != null && prevAGM.totalMembers ? ` (${Math.round((prevAGM.attendees / prevAGM.totalMembers) * 100)}%)` : "";
        lines.push(`Attended: ${att} / ${tot} members${pct}`);
      }
      if (prevAGM.resolutions) {
        lines.push("");
        lines.push("Resolutions carried forward:");
        prevAGM.resolutions.split("\n").forEach(l => { if (l.trim()) lines.push(`  ✓ ${l.trim()}`); });
      }
      if (prevAGM.notes) { lines.push(""); lines.push(`Notes: ${prevAGM.notes}`); }
    } else {
      lines.push(`No AGM recorded for ${prevFyLbl}.`);
    }
    lines.push("");

    // ── Section 2: Current FY's AGM ───────────────────────────────────────────
    lines.push(`ANNUAL GENERAL MEETING — ${fyLbl}`);
    lines.push(hr2);
    if (agm) {
      lines.push(`Date    : ${new Date(agm.date + "T00:00:00").toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}`);
      if (agm.venue) lines.push(`Venue   : ${agm.venue}`);
      if (agm.attendees != null || agm.totalMembers != null) {
        const att = agm.attendees ?? "—";
        const tot = agm.totalMembers ?? "—";
        const pctStr = agm.attendees != null && agm.totalMembers ? ` (${Math.round((agm.attendees / agm.totalMembers) * 100)}%)` : "";
        lines.push(`Attended: ${att} / ${tot} members${pctStr}`);
      }
      if (agm.agenda) { lines.push(""); lines.push("Agenda:"); agm.agenda.split("\n").forEach(l => { if (l.trim()) lines.push(`  • ${l.trim()}`); }); }
      if (agm.resolutions) { lines.push(""); lines.push("Resolutions:"); agm.resolutions.split("\n").forEach(l => { if (l.trim()) lines.push(`  ✓ ${l.trim()}`); }); }
      if (agm.notes) { lines.push(""); lines.push(`Notes: ${agm.notes}`); }
      lines.push("");
    } else {
      lines.push(`No AGM recorded yet for ${fyLbl}.`);
      lines.push("");
    }

    // ── Section 3: All meetings in current FY (committee + SGM + general) ─────
    const nonAgmInFY = allInFY.filter(m => m.type !== "agm");
    if (nonAgmInFY.length > 0) {
      lines.push(`MEETINGS DURING ${fyLbl} (${nonAgmInFY.length})`);
      lines.push(hr2);
      for (const m of nonAgmInFY) {
        lines.push("");
        lines.push(`${MTG_ICON[m.type]}  ${MTG_LABEL[m.type].toUpperCase()}`);
        lines.push(`Date    : ${new Date(m.date + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })}`);
        lines.push(`Title   : ${m.title}`);
        if (m.venue) lines.push(`Venue   : ${m.venue}`);
        if (m.attendees != null || m.totalMembers != null) {
          const pctStr = m.attendees != null && m.totalMembers ? ` (${Math.round((m.attendees / m.totalMembers) * 100)}%)` : "";
          lines.push(`Attended: ${m.attendees ?? "—"} / ${m.totalMembers ?? "—"}${pctStr}`);
        }
        if (m.resolutions) { lines.push("Resolutions:"); m.resolutions.split("\n").forEach(l => { if (l.trim()) lines.push(`  ✓ ${l.trim()}`); }); }
      }
      lines.push("");
    }

    // ── Section 4: Imported meeting documents for FY ─────────────────────────
    if (importedInFY.length > 0) {
      lines.push(`MEETING DOCUMENTS — ${fyLbl} (${importedInFY.length})`);
      lines.push(hr2);
      for (const doc of importedInFY) {
        const docDate = new Date(doc.date + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
        const typeLabel = doc.meetingType ? `[${MTG_LABEL[doc.meetingType]}] ` : "";
        lines.push(`📄  ${typeLabel}${doc.title}`);
        lines.push(`    Date: ${docDate}`);
        lines.push("");
      }
    }

    // ── Section 5: Compiled resolutions for the FY ───────────────────────────
    const withRes = allInFY.filter(m => m.resolutions);
    if (withRes.length > 0) {
      lines.push(hr);
      lines.push(`COMPILED RESOLUTIONS — ${fyLbl}`);
      lines.push(hr2);
      for (const m of withRes) {
        lines.push(`\n[${MTG_LABEL[m.type]} — ${m.date}]`);
        m.resolutions!.split("\n").forEach(l => { if (l.trim()) lines.push(`  • ${l.trim()}`); });
      }
      lines.push("");
    }

    lines.push(hr2);
    lines.push(`Generated by jInvoice on ${new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" })}`);
    return lines.join("\n");
  }, [agm, prevAGM, allInFY, importedInFY, selectedFY, prevFY]);

  const handleCopy = () => { navigator.clipboard.writeText(reportText).catch(() => {}); };

  const handlePrint = () => {
    agmPrintWindow(`AGM Report ${fyLabel(selectedFY)}`, agmMarkdownToHtml(reportText));
  };

  return (
    <div className="modal-overlay" onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640, width: "94%", maxHeight: "90vh", borderRadius: 12, background: "var(--color-surface)", boxShadow: "0 8px 40px rgba(0,0,0,0.25)", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>AGM Report</div>
            <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 2 }}>Includes previous AGM reference + all meetings of the selected FY</div>
          </div>
          <button onClick={onClose} style={{ fontSize: 16, background: "none", border: "none", cursor: "pointer", color: "var(--color-text-secondary)", padding: "4px 8px" }}>✕</button>
        </div>

        <div style={{ padding: "12px 24px", borderBottom: "1px solid var(--color-border)", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>Financial Year:</span>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {allFYs.map(fy => (
                <button key={fy} style={chipStyle(selectedFY === fy)} onClick={() => setSelectedFY(fy)}>{fyLabel(fy)}</button>
              ))}
            </div>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--color-text-tertiary)", marginTop: 6 }}>
            {allInFY.length + importedInFY.length} item{allInFY.length + importedInFY.length !== 1 ? "s" : ""} in {fyLabel(selectedFY)}
            {importedInFY.length > 0 ? ` (${importedInFY.length} doc${importedInFY.length !== 1 ? "s" : ""})` : ""}
            {agm ? ` · AGM on ${new Date(agm.date + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}` : " · No AGM recorded"}
            {prevAGM ? ` · Prev AGM: ${new Date(prevAGM.date + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}` : ""}
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 24px" }}>
          <pre style={{ fontFamily: "'Noto Sans Devanagari', 'Mangal', sans-serif", fontSize: 12, lineHeight: 1.8, whiteSpace: "pre-wrap", color: "var(--color-text)", margin: 0, background: "var(--color-surface-2)", padding: 16, borderRadius: 8, border: "1px solid var(--color-border)" }}>
            {reportText}
          </pre>
        </div>

        <div style={{ padding: "14px 24px", borderTop: "1px solid var(--color-border)", display: "flex", gap: 10, justifyContent: "flex-end", flexShrink: 0 }}>
          <button onClick={handleCopy} style={{ fontSize: 13, padding: "7px 16px", borderRadius: 7, border: "1.5px solid var(--color-border)", background: "transparent", color: "var(--color-text-secondary)", cursor: "pointer" }}>
            📋 Copy
          </button>
          <button onClick={handlePrint} style={{ fontSize: 13, padding: "7px 16px", borderRadius: 7, border: "none", background: "var(--color-primary)", color: "#fff", cursor: "pointer", fontWeight: 600 }}>
            🖨️ Print / Save PDF
          </button>
        </div>
      </div>
    </div>
  );
}

interface ImportedMeetingDoc {
  id: string;
  date: string;
  fy: number;
  title: string;
  meetingType?: SocietyMeeting["type"];
  rec: InvoiceMeta;
}

function importedDocFromRecord(r: InvoiceMeta): ImportedMeetingDoc {
  const date = r.invoiceDate?.slice(0, 10) || r.createdAt.slice(0, 10);
  const title = r.merchantName
    || (r.sourceFilename ? r.sourceFilename.replace(/\.[^.]+$/, "") : null)
    || "Meeting Document";
  const meetingType = (r.docMetadata?.meetingType as SocietyMeeting["type"] | undefined) ?? undefined;
  return { id: String(r.id), date, fy: mtgFY(date), title, meetingType, rec: r };
}

function ImportedDocCard({ doc, onMeetingTypeChange, onDelete }: { doc: ImportedMeetingDoc; onMeetingTypeChange?: (type: SocietyMeeting["type"] | undefined) => void; onDelete?: () => void }) {
  const d = new Date(doc.date + "T00:00:00");
  const dateStr = d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  const MTG_TYPES: SocietyMeeting["type"][] = ["agm", "sgm", "committee", "general"];
  const typeBg  = doc.meetingType === "agm" ? "#7c3aed22" : doc.meetingType === "sgm" ? "#dc262622" : "var(--color-surface-2)";
  const typeCol = doc.meetingType === "agm" ? "#7c3aed"   : doc.meetingType === "sgm" ? "#dc2626"   : "var(--color-text-tertiary)";
  return (
    <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10, padding: "12px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 20, flexShrink: 0 }}>📄</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--color-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{doc.title}</div>
          <div style={{ fontSize: 11.5, color: "var(--color-text-secondary)", marginTop: 2, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <span>📅 {dateStr}</span>
            <span style={{ color: "#0369a1", fontWeight: 600 }}>{fyLabel(doc.fy)}</span>
          </div>
        </div>
        {doc.meetingType ? (
          <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 4, background: typeBg, color: typeCol, flexShrink: 0, whiteSpace: "nowrap" as const }}>
            {MTG_ICON[doc.meetingType]} {MTG_LABEL[doc.meetingType]}
          </span>
        ) : (
          <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 4, background: "#e0f2fe", color: "#0369a1", flexShrink: 0, whiteSpace: "nowrap" as const }}>
            Document
          </span>
        )}
        {onDelete && (
          <button
            onClick={(e) => { e.stopPropagation(); if (window.confirm("Delete this imported document?")) onDelete(); }}
            title="Delete"
            style={{ flexShrink: 0, fontSize: 14, lineHeight: 1, padding: "4px 7px", borderRadius: 6, border: "1.5px solid #ef444460", background: "transparent", color: "#ef4444", cursor: "pointer" }}
          >🗑</button>
        )}
      </div>
      {onMeetingTypeChange && (
        <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span style={{ fontSize: 10.5, color: "var(--color-text-tertiary)", fontWeight: 600 }}>Tag as:</span>
          {MTG_TYPES.map(t => (
            <button
              key={t}
              onClick={() => onMeetingTypeChange(doc.meetingType === t ? undefined : t)}
              style={{
                fontSize: 10.5, padding: "2px 8px", borderRadius: 4, cursor: "pointer", whiteSpace: "nowrap" as const, fontWeight: 600,
                border: doc.meetingType === t ? "none" : "1px solid var(--color-border)",
                background: doc.meetingType === t ? (t === "agm" ? "#7c3aed22" : t === "sgm" ? "#dc262622" : "var(--color-surface-2)") : "transparent",
                color: doc.meetingType === t ? (t === "agm" ? "#7c3aed" : t === "sgm" ? "#dc2626" : "var(--color-text-secondary)") : "var(--color-text-tertiary)",
              }}
            >
              {MTG_ICON[t]} {MTG_LABEL[t]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MeetingCard({ m, expandedId, setExpandedId, onDelete }: {
  m: SocietyMeeting;
  expandedId: string | null;
  setExpandedId: (id: string | null) => void;
  onDelete: (id: string) => void;
}) {
  const isOpen = expandedId === m.id;
  const d = new Date(m.date + "T00:00:00");
  const dateStr = d.toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
  const fy = mtgFY(m.date);
  const attStr = m.attendees != null && m.totalMembers != null
    ? `${m.attendees}/${m.totalMembers} (${Math.round((m.attendees / m.totalMembers) * 100)}%)`
    : m.attendees != null ? `${m.attendees} attended` : null;
  const typeBg  = m.type === "agm" ? "#7c3aed22" : m.type === "sgm" ? "#dc262622" : "var(--color-surface-2)";
  const typeCol = m.type === "agm" ? "#7c3aed"   : m.type === "sgm" ? "#dc2626"   : "var(--color-text-tertiary)";

  return (
    <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10, overflow: "hidden" }}>
      <div onClick={() => setExpandedId(isOpen ? null : m.id)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", cursor: "pointer" }}>
        <span style={{ fontSize: 20, flexShrink: 0 }}>{MTG_ICON[m.type]}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--color-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.title}</div>
          <div style={{ fontSize: 11.5, color: "var(--color-text-secondary)", marginTop: 2, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <span>📅 {dateStr}</span>
            <span style={{ color: "#0369a1", fontWeight: 600 }}>{fyLabel(fy)}</span>
            {m.venue && <span>📍 {m.venue}</span>}
            {attStr && <span>👥 {attStr}</span>}
            {m.resolutions && <span style={{ color: "#16a34a" }}>✓ Resolutions</span>}
          </div>
        </div>
        <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 4, background: typeBg, color: typeCol, flexShrink: 0, whiteSpace: "nowrap" as const }}>
          {MTG_LABEL[m.type]}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); if (window.confirm("Delete this meeting?")) onDelete(m.id); }}
          title="Delete"
          style={{ flexShrink: 0, fontSize: 14, lineHeight: 1, padding: "4px 7px", borderRadius: 6, border: "1.5px solid #ef444460", background: "transparent", color: "#ef4444", cursor: "pointer" }}
        >🗑</button>
        <span style={{ fontSize: 10, color: "var(--color-text-tertiary)", flexShrink: 0 }}>{isOpen ? "▲" : "▼"}</span>
      </div>

      {isOpen && (
        <div style={{ padding: "0 16px 16px", borderTop: "1px solid var(--color-border)" }}>
          {m.agenda && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase" as const, letterSpacing: "0.05em", marginBottom: 5 }}>Agenda</div>
              <div style={{ fontSize: 12.5, color: "var(--color-text)", whiteSpace: "pre-wrap", lineHeight: 1.65 }}>{m.agenda}</div>
            </div>
          )}
          {m.resolutions && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase" as const, letterSpacing: "0.05em", marginBottom: 5 }}>Resolutions Passed</div>
              <div style={{ fontSize: 12.5, color: "var(--color-text)", whiteSpace: "pre-wrap", lineHeight: 1.65, background: "#16a34a10", padding: "8px 12px", borderRadius: 6, borderLeft: "3px solid #16a34a" }}>{m.resolutions}</div>
            </div>
          )}
          {m.notes && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase" as const, letterSpacing: "0.05em", marginBottom: 5 }}>Notes</div>
              <div style={{ fontSize: 12.5, color: "var(--color-text-secondary)", whiteSpace: "pre-wrap", lineHeight: 1.65 }}>{m.notes}</div>
            </div>
          )}
          {!m.agenda && !m.resolutions && !m.notes && (
            <p style={{ fontSize: 12, color: "var(--color-text-tertiary)", marginTop: 12, fontStyle: "italic" }}>No agenda or resolutions recorded.</p>
          )}
        </div>
      )}
    </div>
  );
}

function GenerateAGMModal({ meetings, importedDocs, onClose }: {
  meetings: SocietyMeeting[];
  importedDocs: ImportedMeetingDoc[];
  onClose: () => void;
}) {
  const curFY  = currentFY();
  const prevFY = curFY - 1;

  const prevAGM = useMemo(() =>
    meetings.filter(m => m.type === "agm" && fyContainsMtg(m.date, prevFY))
      .sort((a, b) => b.date.localeCompare(a.date))[0] ?? null,
    [meetings, prevFY]);

  // Imported document from prev FY tagged as AGM — used as the format reference
  const prevAGMDoc = useMemo(() =>
    importedDocs.filter(d => d.meetingType === "agm" && fyContainsMtg(d.date, prevFY))
      .sort((a, b) => b.date.localeCompare(a.date))[0] ?? null,
    [importedDocs, prevFY]);

  const curManual = useMemo(() =>
    meetings.filter(m => fyContainsMtg(m.date, curFY)).sort((a, b) => a.date.localeCompare(b.date)),
    [meetings, curFY]);

  const curDocs = useMemo(() =>
    importedDocs.filter(d => fyContainsMtg(d.date, curFY)).sort((a, b) => a.date.localeCompare(b.date)),
    [importedDocs, curFY]);

  const [selected, setSelected] = useState<Set<string>>(() => {
    const s = new Set<string>();
    if (prevAGM) s.add(`prev_${prevAGM.id}`);
    if (prevAGMDoc) s.add(`prevdoc_${prevAGMDoc.id}`);
    curManual.forEach(m => s.add(`manual_${m.id}`));
    curDocs.forEach(d => s.add(`doc_${d.id}`));
    return s;
  });

  const [step, setStep]             = useState<"select" | "report">("select");
  const [reportText, setReportText]  = useState("");
  const [loading, setLoading]        = useState(false);
  const [genError, setGenError]      = useState<string | null>(null);

  const toggle = (key: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const buildFallbackText = (
    selManual: SocietyMeeting[],
    selDocs: ImportedMeetingDoc[],
    prevRef: SocietyMeeting | null,
  ): string => {
    const hr        = "═".repeat(50);
    const hr2       = "─".repeat(30);
    const fyLbl     = fyLabel(curFY);
    const prevFyLbl = fyLabel(prevFY);
    const lines: string[] = [];

    lines.push(`AGM REPORT — ${fyLbl}`);
    lines.push(hr);
    lines.push("");

    lines.push(`PREVIOUS AGM REFERENCE (${prevFyLbl})`);
    lines.push(hr2);
    if (prevRef) {
      lines.push(`Date    : ${new Date(prevRef.date + "T00:00:00").toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}`);
      if (prevRef.venue) lines.push(`Venue   : ${prevRef.venue}`);
      if (prevRef.attendees != null || prevRef.totalMembers != null) {
        const pct = prevRef.attendees != null && prevRef.totalMembers ? ` (${Math.round((prevRef.attendees / prevRef.totalMembers) * 100)}%)` : "";
        lines.push(`Attended: ${prevRef.attendees ?? "—"} / ${prevRef.totalMembers ?? "—"} members${pct}`);
      }
      if (prevRef.agenda) { lines.push(""); lines.push("Agenda:"); prevRef.agenda.split("\\n").forEach(l => { if (l.trim()) lines.push(`  • ${l.trim()}`); }); }
      if (prevRef.resolutions) { lines.push(""); lines.push("Resolutions carried forward:"); prevRef.resolutions.split("\\n").forEach(l => { if (l.trim()) lines.push(`  ✓ ${l.trim()}`); }); }
      if (prevRef.notes) { lines.push(""); lines.push(`Notes: ${prevRef.notes}`); }
    } else {
      lines.push(`No AGM reference selected for ${prevFyLbl}.`);
    }
    lines.push("");

    const thisAGM = selManual.find(m => m.type === "agm") ?? null;
    lines.push(`ANNUAL GENERAL MEETING — ${fyLbl}`);
    lines.push(hr2);
    if (thisAGM) {
      lines.push(`Date    : ${new Date(thisAGM.date + "T00:00:00").toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}`);
      if (thisAGM.venue) lines.push(`Venue   : ${thisAGM.venue}`);
      if (thisAGM.attendees != null || thisAGM.totalMembers != null) {
        const pct = thisAGM.attendees != null && thisAGM.totalMembers ? ` (${Math.round((thisAGM.attendees / thisAGM.totalMembers) * 100)}%)` : "";
        lines.push(`Attended: ${thisAGM.attendees ?? "—"} / ${thisAGM.totalMembers ?? "—"} members${pct}`);
      }
      if (thisAGM.agenda) { lines.push(""); lines.push("Agenda:"); thisAGM.agenda.split("\\n").forEach(l => { if (l.trim()) lines.push(`  • ${l.trim()}`); }); }
      if (thisAGM.resolutions) { lines.push(""); lines.push("Resolutions:"); thisAGM.resolutions.split("\\n").forEach(l => { if (l.trim()) lines.push(`  ✓ ${l.trim()}`); }); }
      if (thisAGM.notes) { lines.push(""); lines.push(`Notes: ${thisAGM.notes}`); }
      lines.push("");
    } else {
      lines.push(`No AGM recorded for ${fyLbl}.`);
      lines.push("");
    }

    const nonAgm = selManual.filter(m => m.type !== "agm");
    if (nonAgm.length > 0) {
      lines.push(`MEETINGS DURING ${fyLbl} (${nonAgm.length})`);
      lines.push(hr2);
      for (const m of nonAgm) {
        lines.push("");
        lines.push(`${MTG_ICON[m.type]}  ${MTG_LABEL[m.type].toUpperCase()}`);
        lines.push(`Date    : ${new Date(m.date + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })}`);
        lines.push(`Title   : ${m.title}`);
        if (m.venue) lines.push(`Venue   : ${m.venue}`);
        if (m.attendees != null || m.totalMembers != null) {
          const pct = m.attendees != null && m.totalMembers ? ` (${Math.round((m.attendees / m.totalMembers) * 100)}%)` : "";
          lines.push(`Attended: ${m.attendees ?? "—"} / ${m.totalMembers ?? "—"}${pct}`);
        }
        if (m.agenda) { lines.push("Agenda:"); m.agenda.split("\\n").forEach(l => { if (l.trim()) lines.push(`  • ${l.trim()}`); }); }
        if (m.resolutions) { lines.push("Resolutions:"); m.resolutions.split("\\n").forEach(l => { if (l.trim()) lines.push(`  ✓ ${l.trim()}`); }); }
        if (m.notes) lines.push(`Notes: ${m.notes}`);
      }
      lines.push("");
    }

    if (selDocs.length > 0) {
      lines.push(`MEETING DOCUMENTS — ${fyLbl} (${selDocs.length})`);
      lines.push(hr2);
      for (const doc of selDocs) {
        const docDate   = new Date(doc.date + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
        const typeLabel = doc.meetingType ? `[${MTG_LABEL[doc.meetingType]}] ` : "";
        lines.push(`📄  ${typeLabel}${doc.title}`);
        lines.push(`    Date: ${docDate}`);
        lines.push("");
      }
    }

    const withRes = selManual.filter(m => m.resolutions);
    if (withRes.length > 0) {
      lines.push(hr);
      lines.push(`COMPILED RESOLUTIONS — ${fyLbl}`);
      lines.push(hr2);
      for (const m of withRes) {
        lines.push(`\n[${MTG_LABEL[m.type]} — ${m.date}]`);
        m.resolutions!.split("\\n").forEach(l => { if (l.trim()) lines.push(`  • ${l.trim()}`); });
      }
      lines.push("");
    }

    lines.push(hr2);
    lines.push(`Generated by jInvoice on ${new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" })}`);
    return lines.join("\n");
  };

  const handleGenerate = async () => {
    const usePrevManual = prevAGM  && selected.has(`prev_${prevAGM.id}`);
    const usePrevDoc    = prevAGMDoc && selected.has(`prevdoc_${prevAGMDoc.id}`);
    const selManual     = curManual.filter(m => selected.has(`manual_${m.id}`));
    const selDocs       = curDocs.filter(d => selected.has(`doc_${d.id}`));
    const fyLbl         = fyLabel(curFY);
    const prevFyLbl     = fyLabel(prevFY);

    setLoading(true);
    setGenError(null);

    // Fetch prev AGM document raw text for format reference (Sarvam is text-only)
    let prevDocRawText: string | null = null;

    if (usePrevDoc && prevAGMDoc) {
      const numId = Number(prevAGMDoc.id);
      if (!isNaN(numId)) {
        const rawRec = await db.rawTexts.where("invoiceId").equals(numId).first().catch(() => null);
        prevDocRawText = rawRec?.rawText ?? null;
      }
    }

    // Build Sarvam AI (OpenAI-compatible) messages for Marathi AGM minutes
    const buildSarvamMessages = (): Array<{ role: string; content: string }> => {
      const system = [
        `You are a formal document writer for Indian housing cooperative societies (गृहनिर्माण सहकारी संस्था).`,
        `Generate the complete AGM minutes (वार्षिक सर्वसाधारण सभेचे इतिवृत्त) in MARATHI (Devanagari script).`,
        `Use formal Marathi throughout. Terms like "AGM", "FY", "resolution", "quorum" may stay in English where standard.`,
        `Structure the document with clear numbered Marathi headings (१., २., etc.) and sub-headings.`,
        `Output only the formatted minutes document — no preamble, no explanation, no markdown code fences.`,
      ].join("\n");

      let user = `वित्तीय वर्ष: ${fyLbl}\n\n`;

      if (prevDocRawText) {
        user += `मागील वर्षाचा AGM संदर्भ दस्तावेज (${prevFyLbl}) — याच स्वरूपाचे अनुसरण करा:\n\n${prevDocRawText.slice(0, 5000)}\n\n--- संदर्भ दस्तावेज समाप्त ---\n\n`;
      } else if (usePrevManual && prevAGM) {
        user += `मागील वर्षाचा AGM संदर्भ (${prevFyLbl}):\n`;
        user += `दिनांक: ${prevAGM.date}\n`;
        if (prevAGM.venue) user += `स्थळ: ${prevAGM.venue}\n`;
        if (prevAGM.attendees != null) user += `उपस्थिती: ${prevAGM.attendees}${prevAGM.totalMembers ? ` / ${prevAGM.totalMembers}` : ""} सदस्य\n`;
        if (prevAGM.agenda) user += `कार्यसूची:\n${prevAGM.agenda}\n`;
        if (prevAGM.resolutions) user += `ठराव:\n${prevAGM.resolutions}\n`;
        user += `\n`;
      }

      user += `${fyLbl} च्या नवीन अहवालात समाविष्ट करायच्या सभा:\n`;
      for (const m of selManual) {
        user += `\n[${MTG_LABEL[m.type]} — ${m.date}]\n`;
        user += `शीर्षक: ${m.title}\n`;
        if (m.venue) user += `स्थळ: ${m.venue}\n`;
        if (m.attendees != null) user += `उपस्थिती: ${m.attendees}${m.totalMembers ? ` पैकी ${m.totalMembers}` : ""} सदस्य\n`;
        if (m.agenda) user += `कार्यसूची:\n${m.agenda}\n`;
        if (m.resolutions) user += `ठराव:\n${m.resolutions}\n`;
        if (m.notes) user += `टीप: ${m.notes}\n`;
      }
      for (const d of selDocs) {
        user += `\n[आयात दस्तावेज — ${d.date}]\n`;
        user += `शीर्षक: ${d.title}\n`;
        if (d.meetingType) user += `सभेचा प्रकार: ${MTG_LABEL[d.meetingType]}\n`;
      }

      user += `\nसूचना:\n`;
      user += `१. ${fyLbl} साठी संपूर्ण, औपचारिक AGM इतिवृत्त मराठीत तयार करा\n`;
      user += `२. औपचारिक भाषा वापरा: "ठराव मंजूर की...", "अध्यक्षांनी सभेस आरंभ केला..."\n`;
      user += `३. सर्व कार्यसूची मुद्दे व ठराव क्रमांकित करा\n`;
      user += `४. वरील डेटातील उपस्थिती आकडेवारी समाविष्ट करा\n`;
      user += `५. सर्व सभांचे कार्यसूची मुद्दे व ठराव एकत्रित करा\n`;
      user += `६. शेवटी अध्यक्ष आणि सचिव/व्यवस्थापकाचे स्वाक्षरी खंड समाविष्ट करा\n`;
      user += `७. वरील डेटामध्ये दिलेली नावे, फ्लॅट क्रमांक किंवा आकडे नसतील तर शोध लावू नका\n`;

      return [
        { role: "system", content: system },
        { role: "user", content: user },
      ];
    };

    try {
      const res = await fetch("/api/sarvam", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "sarvam-105b",
          messages: buildSarvamMessages(),
          temperature: 0.3,
          max_tokens: 4096,
        }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        const errDetail = typeof errBody?.error === "object"
          ? JSON.stringify(errBody.error)
          : (errBody?.error ?? JSON.stringify(errBody));
        throw new Error(`Sarvam returned ${res.status}: ${errDetail}`);
      }
      const data = await res.json();
      const text = (data?.choices?.[0]?.message?.content ?? "").trim();
      if (!text) throw new Error(`Empty response from Sarvam — keys: ${Object.keys(data ?? {}).join(", ")}`);
      setReportText(text);
      setStep("report");
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      setGenError(`AI generation failed (${errMsg}). Showing structured summary instead.`);
      setReportText(buildFallbackText(selManual, selDocs, usePrevManual ? prevAGM : null));
      setStep("report");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => { navigator.clipboard.writeText(reportText).catch(() => {}); };
  const handlePrint = () => {
    agmPrintWindow(`AGM Report ${fyLabel(curFY)}`, agmMarkdownToHtml(reportText));
  };

  const fyLbl     = fyLabel(curFY);
  const prevFyLbl = fyLabel(prevFY);
  const totalSel  = selected.size;

  return (
    <div className="modal-overlay" onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 580, width: "94%", maxHeight: "90vh", borderRadius: 12, background: "var(--color-surface)", boxShadow: "0 8px 40px rgba(0,0,0,0.25)", display: "flex", flexDirection: "column" }}>

        {/* Header */}
        <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>🏛️ Generate AGM Report</div>
            <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 2 }}>
              {step === "select" ? `Select meetings to include — ${fyLbl}` : `AGM Report — ${fyLbl}`}
            </div>
          </div>
          <button onClick={onClose} style={{ fontSize: 16, background: "none", border: "none", cursor: "pointer", color: "var(--color-text-secondary)", padding: "4px 8px" }}>✕</button>
        </div>

        {step === "select" ? (
          <>
            <div style={{ flex: 1, overflowY: "auto", padding: "16px 24px" }}>

              {/* Previous year AGM reference */}
              <div style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase" as const, letterSpacing: "0.07em", marginBottom: 8 }}>
                  Last Year's AGM — {prevFyLbl} (Format Reference)
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {/* Imported AGM document — used as format template via raw text / PDF */}
                  {prevAGMDoc && (() => {
                    const key = `prevdoc_${prevAGMDoc.id}`;
                    const isChk = selected.has(key);
                    return (
                      <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", padding: "10px 12px", borderRadius: 8, background: isChk ? "#7c3aed11" : "var(--color-surface-2)", border: `1.5px solid ${isChk ? "#7c3aed44" : "var(--color-border)"}` }}>
                        <input type="checkbox" checked={isChk} onChange={() => toggle(key)} style={{ marginTop: 3, accentColor: "#7c3aed", flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text)" }}>📄 {prevAGMDoc.title}</div>
                          <div style={{ fontSize: 11.5, color: "var(--color-text-secondary)", marginTop: 2 }}>
                            <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 5px", borderRadius: 3, background: "#7c3aed22", color: "#7c3aed", marginRight: 6 }}>AGM Document</span>
                            📅 {new Date(prevAGMDoc.date + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                            {" · ✦ AI reads this PDF to copy its format"}
                          </div>
                        </div>
                      </label>
                    );
                  })()}
                  {/* Manually logged AGM entry */}
                  {prevAGM && (() => {
                    const key = `prev_${prevAGM.id}`;
                    const isChk = selected.has(key);
                    return (
                      <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", padding: "10px 12px", borderRadius: 8, background: isChk ? "#7c3aed11" : "var(--color-surface-2)", border: `1.5px solid ${isChk ? "#7c3aed44" : "var(--color-border)"}` }}>
                        <input type="checkbox" checked={isChk} onChange={() => toggle(key)} style={{ marginTop: 3, accentColor: "#7c3aed", flexShrink: 0 }} />
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text)" }}>🏛️ {prevAGM.title}</div>
                          <div style={{ fontSize: 11.5, color: "var(--color-text-secondary)", marginTop: 2 }}>
                            <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 5px", borderRadius: 3, background: "var(--color-surface)", border: "1px solid var(--color-border)", marginRight: 6 }}>Manual entry</span>
                            📅 {new Date(prevAGM.date + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                            {prevAGM.venue ? ` · 📍 ${prevAGM.venue}` : ""}
                            {prevAGM.resolutions ? " · ✓ Has resolutions" : ""}
                          </div>
                        </div>
                      </label>
                    );
                  })()}
                  {!prevAGM && !prevAGMDoc && (
                    <div style={{ fontSize: 12, color: "var(--color-text-tertiary)", fontStyle: "italic", padding: "8px 12px", background: "var(--color-surface-2)", borderRadius: 8 }}>
                      No AGM recorded for {prevFyLbl}. Tag an imported PDF as AGM in the Meetings tab to use it as a format reference.
                    </div>
                  )}
                </div>
              </div>

              {/* Current FY meetings */}
              <div>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase" as const, letterSpacing: "0.07em", marginBottom: 8 }}>
                  Current FY Meetings — {fyLbl}
                </div>
                {curManual.length === 0 && curDocs.length === 0 ? (
                  <div style={{ fontSize: 12, color: "var(--color-text-tertiary)", fontStyle: "italic", padding: "8px 12px", background: "var(--color-surface-2)", borderRadius: 8 }}>
                    No meetings recorded for {fyLbl} yet
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {curManual.map(m => {
                      const key   = `manual_${m.id}`;
                      const isChk = selected.has(key);
                      const bg    = isChk ? (m.type === "agm" ? "#7c3aed11" : m.type === "sgm" ? "#dc262611" : "var(--color-surface-2)") : "var(--color-surface-2)";
                      const bdr   = isChk ? (m.type === "agm" ? "#7c3aed44" : m.type === "sgm" ? "#dc262644" : "var(--color-border)") : "var(--color-border)";
                      return (
                        <label key={key} style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", padding: "10px 12px", borderRadius: 8, background: bg, border: `1.5px solid ${bdr}` }}>
                          <input type="checkbox" checked={isChk} onChange={() => toggle(key)} style={{ marginTop: 3, accentColor: "#7c3aed", flexShrink: 0 }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text)" }}>{MTG_ICON[m.type]} {m.title}</div>
                            <div style={{ fontSize: 11.5, color: "var(--color-text-secondary)", marginTop: 2 }}>
                              <span style={{ fontSize: 10.5, fontWeight: 700, padding: "1px 6px", borderRadius: 3, background: "var(--color-surface)", border: "1px solid var(--color-border)", marginRight: 6 }}>{MTG_LABEL[m.type]}</span>
                              📅 {new Date(m.date + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                              {m.venue ? ` · 📍 ${m.venue}` : ""}
                              {m.agenda ? " · Has agenda" : ""}
                              {m.resolutions ? " · ✓ Resolutions" : ""}
                            </div>
                          </div>
                        </label>
                      );
                    })}
                    {curDocs.map(d => {
                      const key   = `doc_${d.id}`;
                      const isChk = selected.has(key);
                      return (
                        <label key={key} style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", padding: "10px 12px", borderRadius: 8, background: isChk ? "#0369a111" : "var(--color-surface-2)", border: `1.5px solid ${isChk ? "#0369a144" : "var(--color-border)"}` }}>
                          <input type="checkbox" checked={isChk} onChange={() => toggle(key)} style={{ marginTop: 3, accentColor: "#0369a1", flexShrink: 0 }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text)" }}>📄 {d.title}</div>
                            <div style={{ fontSize: 11.5, color: "var(--color-text-secondary)", marginTop: 2 }}>
                              <span style={{ fontSize: 10.5, fontWeight: 700, padding: "1px 6px", borderRadius: 3, background: "#e0f2fe", color: "#0369a1", marginRight: 6 }}>
                                {d.meetingType ? MTG_LABEL[d.meetingType] : "Document"}
                              </span>
                              📅 {new Date(d.date + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div style={{ padding: "14px 24px", borderTop: "1px solid var(--color-border)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
              <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>{totalSel} item{totalSel !== 1 ? "s" : ""} selected</span>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={onClose} style={{ fontSize: 13, padding: "7px 14px", borderRadius: 7, border: "1.5px solid var(--color-border)", background: "transparent", color: "var(--color-text-secondary)", cursor: "pointer" }}>Cancel</button>
                <button onClick={handleGenerate} disabled={totalSel === 0 || loading} style={{ fontSize: 13, padding: "7px 16px", borderRadius: 7, border: "none", background: (totalSel === 0 || loading) ? "var(--color-surface-2)" : "#7c3aed", color: (totalSel === 0 || loading) ? "var(--color-text-tertiary)" : "#fff", cursor: (totalSel === 0 || loading) ? "not-allowed" : "pointer", fontWeight: 600 }}>
                  {loading ? "✦ Generating…" : "Generate Report →"}
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            {loading ? (
              <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 40, gap: 14 }}>
                <div style={{ fontSize: 28 }}>🏛️</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text)" }}>Generating AGM Report…</div>
                <div style={{ fontSize: 12, color: "var(--color-text-secondary)", textAlign: "center", maxWidth: 320 }}>
                  {(selected.has(`prevdoc_${prevAGMDoc?.id}`) && prevAGMDoc)
                    ? "Reading last year's AGM document and generating new minutes in the same format"
                    : "Using meeting data to generate formal AGM minutes"}
                </div>
              </div>
            ) : (
              <div style={{ flex: 1, overflowY: "auto", padding: "16px 24px" }}>
                {genError && (
                  <div style={{ fontSize: 11.5, color: "#92400e", background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 7, padding: "8px 12px", marginBottom: 12 }}>
                    ⚠️ {genError}
                  </div>
                )}
                <pre style={{ fontFamily: "'Noto Sans Devanagari', 'Mangal', sans-serif", fontSize: 12, lineHeight: 1.8, whiteSpace: "pre-wrap", color: "var(--color-text)", margin: 0, background: "var(--color-surface-2)", padding: 16, borderRadius: 8, border: "1px solid var(--color-border)" }}>
                  {reportText}
                </pre>
              </div>
            )}
            <div style={{ padding: "14px 24px", borderTop: "1px solid var(--color-border)", display: "flex", justifyContent: "space-between", flexShrink: 0 }}>
              <button onClick={() => { setStep("select"); setGenError(null); }} style={{ fontSize: 13, padding: "7px 14px", borderRadius: 7, border: "1.5px solid var(--color-border)", background: "transparent", color: "var(--color-text-secondary)", cursor: "pointer" }}>← Back</button>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={handleCopy} disabled={loading} style={{ fontSize: 13, padding: "7px 16px", borderRadius: 7, border: "1.5px solid var(--color-border)", background: "transparent", color: loading ? "var(--color-text-tertiary)" : "var(--color-text-secondary)", cursor: loading ? "not-allowed" : "pointer" }}>📋 Copy</button>
                <button onClick={handlePrint} disabled={loading} style={{ fontSize: 13, padding: "7px 16px", borderRadius: 7, border: "none", background: loading ? "var(--color-surface-2)" : "#7c3aed", color: loading ? "var(--color-text-tertiary)" : "#fff", cursor: loading ? "not-allowed" : "pointer", fontWeight: 600 }}>🖨️ Print / Save PDF</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SocietyMeetingsTab({ records }: { records: InvoiceMeta[] }) {
  const [meetings, setMeetings] = useState<SocietyMeeting[]>(() => loadMeetings());
  const [filterType, setFilterType] = useState<SocietyMeeting["type"] | "all" | "documents">("all");
  const [showAdd, setShowAdd]         = useState(false);
  const [showReport, setShowReport]   = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);
  const [reportInitialFY, setReportInitialFY] = useState<number | undefined>(undefined);
  const [expandedId, setExpandedId]   = useState<string | null>(null);
  const [importedDocTypes, setImportedDocTypes] = useState<Record<string, SocietyMeeting["type"] | undefined>>({});

  // Imported meeting_record documents from IndexedDB
  const importedDocs = useMemo<ImportedMeetingDoc[]>(() =>
    records
      .filter(r => r.category === "meeting_record" && r.status !== "extraction_failed" && r.status !== "import_blocked_encrypted")
      .map(r => {
        const base = importedDocFromRecord(r);
        // Local state override takes priority over stored docMetadata
        const override = importedDocTypes[base.id];
        return override !== undefined ? { ...base, meetingType: override === undefined ? undefined : override } : base;
      })
      .sort((a, b) => b.date.localeCompare(a.date)),
    [records, importedDocTypes]
  );

  const handleImportedDocTypeChange = async (docId: string, newType: SocietyMeeting["type"] | undefined) => {
    setImportedDocTypes(prev => ({ ...prev, [docId]: newType }));
    const numId = Number(docId);
    if (!isNaN(numId)) {
      const existing = records.find(r => r.id === numId);
      const existingMeta = existing?.docMetadata ?? {};
      const updatedMeta = newType != null
        ? { ...existingMeta, meetingType: newType }
        : Object.fromEntries(Object.entries(existingMeta).filter(([k]) => k !== "meetingType"));
      await db.invoices.update(numId, { docMetadata: updatedMeta });
      window.dispatchEvent(new Event("jinvoice:sync-complete"));
    }
  };

  // Unified display entries: manual meetings + imported docs filtered by type chip
  const { filteredMeetings, filteredDocs } = useMemo(() => {
    if (filterType === "documents") return { filteredMeetings: [], filteredDocs: importedDocs };
    if (filterType === "all") return {
      filteredMeetings: [...meetings].sort((a, b) => b.date.localeCompare(a.date)),
      filteredDocs: importedDocs,
    };
    return {
      filteredMeetings: meetings.filter(m => m.type === filterType).sort((a, b) => b.date.localeCompare(a.date)),
      // Also show imported docs tagged with the selected type
      filteredDocs: importedDocs.filter(d => d.meetingType === filterType),
    };
  }, [meetings, importedDocs, filterType]);

  // Merge both into a unified year→month grouped structure
  type UnifiedEntry = { kind: "manual"; m: SocietyMeeting } | { kind: "doc"; d: ImportedMeetingDoc };
  const byYearMonth = useMemo(() => {
    const all: Array<{ date: string; entry: UnifiedEntry }> = [
      ...filteredMeetings.map(m => ({ date: m.date, entry: { kind: "manual" as const, m } })),
      ...filteredDocs.map(d => ({ date: d.date, entry: { kind: "doc" as const, d } })),
    ].sort((a, b) => b.date.localeCompare(a.date));

    const yearMap = new Map<number, Map<number, UnifiedEntry[]>>();
    for (const { date, entry } of all) {
      const dt = new Date(date + "T00:00:00");
      const y = dt.getFullYear();
      const mo = dt.getMonth();
      if (!yearMap.has(y)) yearMap.set(y, new Map());
      const mMap = yearMap.get(y)!;
      if (!mMap.has(mo)) mMap.set(mo, []);
      mMap.get(mo)!.push(entry);
    }
    return [...yearMap.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([year, mMap]) => ({
        year,
        months: [...mMap.entries()]
          .sort((a, b) => b[0] - a[0])
          .map(([month, list]) => ({ month, list })),
      }));
  }, [filteredMeetings, filteredDocs]);

  const typeCounts = useMemo(() => {
    const c: Record<string, number> = { all: meetings.length + importedDocs.length, documents: importedDocs.length };
    for (const m of meetings) c[m.type] = (c[m.type] ?? 0) + 1;
    return c;
  }, [meetings, importedDocs]);

  const handleSave = (m: SocietyMeeting) => {
    const next = [m, ...meetings].sort((a, b) => b.date.localeCompare(a.date));
    setMeetings(next);
    saveMeetings(next);
  };

  const handleDelete = (id: string) => {
    const next = meetings.filter(m => m.id !== id);
    setMeetings(next);
    saveMeetings(next);
    if (expandedId === id) setExpandedId(null);
  };

  const handleDeleteImported = async (docId: string) => {
    const numId = Number(docId);
    if (!isNaN(numId)) {
      await db.invoices.delete(numId);
      await db.rawTexts.where("invoiceId").equals(numId).delete().catch(() => {});
      await db.pdfFiles.where("invoiceId").equals(numId).delete().catch(() => {});
      window.dispatchEvent(new Event("jinvoice:sync-complete"));
    }
  };

  const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const TYPES: (SocietyMeeting["type"] | "all" | "documents")[] = ["all", "agm", "sgm", "committee", "general", "documents"];
  const thisYear = new Date().getFullYear();
  const totalItems = filteredMeetings.length + filteredDocs.length;

  return (
    <div style={{ padding: "20px", maxWidth: 900, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--color-text)", margin: 0 }}>Meetings</h2>
          <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 3 }}>AGM, Special GM, Committee meetings + imported meeting documents — grouped by Financial Year and month</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={() => { setReportInitialFY(undefined); setShowReport(true); }} style={{ fontSize: 13, padding: "7px 14px", borderRadius: 8, border: "1.5px solid var(--color-border)", background: "transparent", color: "var(--color-text-secondary)", cursor: "pointer" }}>
            📄 AGM Report
          </button>
          <button
            onClick={() => setShowGenerate(true)}
            style={{ fontSize: 13, padding: "7px 14px", borderRadius: 8, border: "none", background: "#7c3aed", color: "#fff", cursor: "pointer", fontWeight: 600 }}
          >
            🏛️ Generate AGM Report
          </button>
          <button onClick={() => setShowAdd(true)} style={{ fontSize: 13, padding: "7px 14px", borderRadius: 8, border: "none", background: "var(--color-primary)", color: "#fff", cursor: "pointer", fontWeight: 600 }}>
            + Add Meeting
          </button>
        </div>
      </div>

      {/* Meeting type filter chips */}
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 14 }}>
        {TYPES.map(t => (
          <button key={t} style={chipStyle(filterType === t)} onClick={() => setFilterType(t)}>
            {t === "all"
              ? `All (${typeCounts.all ?? 0})`
              : t === "documents"
              ? `📄 Documents${importedDocs.length > 0 ? ` (${importedDocs.length})` : ""}`
              : `${MTG_ICON[t as SocietyMeeting["type"]]} ${MTG_LABEL[t as SocietyMeeting["type"]]}${(typeCounts[t] ?? 0) > 0 ? ` (${typeCounts[t]})` : ""}`}
          </button>
        ))}
      </div>

      <SummaryCards cards={[
        { label: "Total Meetings",    value: String(meetings.length) },
        { label: "AGMs",              value: String(meetings.filter(m => m.type === "agm").length) },
        { label: "This Year",         value: String(meetings.filter(m => new Date(m.date + "T00:00:00").getFullYear() === thisYear).length) },
        { label: "Documents",         value: String(importedDocs.length) },
      ]} />

      {totalItems === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 0", color: "var(--color-text-secondary)", fontSize: 13 }}>
          {meetings.length === 0 && importedDocs.length === 0
            ? <>No meetings recorded yet.<br /><span style={{ opacity: 0.7 }}>Add your first AGM or committee meeting to get started.</span></>
            : "No items match the current filter."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {byYearMonth.map(({ year, months }) => {
            const yearTotal = months.reduce((s, mo) => s + mo.list.length, 0);
            return (
              <div key={year}>
                {/* Year header with FY context */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                  <span style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text)" }}>{year}</span>
                  <span style={{ fontSize: 11, color: "var(--color-text-tertiary)", fontWeight: 600 }}>
                    {yearTotal} item{yearTotal !== 1 ? "s" : ""}
                  </span>
                  <div style={{ flex: 1, height: 1, background: "var(--color-border)" }} />
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  {months.map(({ month, list }) => (
                    <div key={month}>
                      {/* Month sub-header */}
                      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase" as const, letterSpacing: "0.07em", marginBottom: 8, paddingLeft: 4 }}>
                        {MONTH_NAMES[month]} · {list.length} item{list.length !== 1 ? "s" : ""}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {list.map((entry) =>
                          entry.kind === "manual"
                            ? <MeetingCard key={entry.m.id} m={entry.m} expandedId={expandedId} setExpandedId={setExpandedId} onDelete={handleDelete} />
                            : <ImportedDocCard key={entry.d.id} doc={entry.d} onMeetingTypeChange={(t) => handleImportedDocTypeChange(entry.d.id, t)} onDelete={() => handleDeleteImported(entry.d.id)} />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showAdd      && <AddMeetingModal    onClose={() => setShowAdd(false)} onSave={handleSave} />}
      {showReport   && <AGMReportModal     meetings={meetings} importedDocs={importedDocs} onClose={() => setShowReport(false)} initialFY={reportInitialFY} />}
      {showGenerate && <GenerateAGMModal   meetings={meetings} importedDocs={importedDocs} onClose={() => setShowGenerate(false)} />}
    </div>
  );
}

// ── Profile-based tab visibility ──────────────────────────────────────────────

type UserProfile = "personal" | "society" | "shopkeeper" | "tax_consultant" | "ca" | "real_estate" | "advocate" | "bookkeeper" | "freelancer" | "ngo";

const GST_PROFILES: UserProfile[] = ["society", "shopkeeper", "tax_consultant", "ca", "real_estate", "advocate", "bookkeeper", "freelancer", "ngo"];
const TAGS_PROFILES: UserProfile[] = ["tax_consultant", "ca", "real_estate", "advocate", "bookkeeper", "freelancer", "ngo"];

function visibleTabs(mode: string): ReportTab[] {
  const tabs: ReportTab[] = ["summary", "period", "vendor", "category"];
  if (GST_PROFILES.includes(mode as UserProfile)) tabs.unshift("gst");
  if (TAGS_PROFILES.includes(mode as UserProfile)) tabs.push("tags");
  if (mode === "personal")      tabs.push("personal_budget", "personal_tax");
  if (mode === "society")       { tabs.push("society_ledger"); tabs.push("society_audit"); tabs.push("society_dues"); tabs.push("society_sinking"); tabs.push("society_vendor"); tabs.push("society_quotes"); tabs.push("society_meetings"); }
  if (mode === "bookkeeper")    tabs.push("bookkeeper_ledger");
  if (mode === "shopkeeper")    tabs.push("shop_purchase_register", "shop_expense_head", "shop_gst_summary");
  if (mode === "tax_consultant") tabs.push("tc_client_summary", "tc_tds_tracker", "tc_fy_comparison", "tc_gstr2a");
  if (mode === "ca")            tabs.push("ca_client_ledger", "ca_tds_summary", "ca_fy_comparison", "ca_audit_trail");
  if (mode === "real_estate")   tabs.push("re_property_expense", "re_rental_income", "re_acquisition");
  if (mode === "advocate")      tabs.push("adv_matter_billing", "adv_client_ledger", "adv_court_fees");
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
    { id: "society_ledger",    label: "Ledger" },
    { id: "society_audit",     label: "Audit (I&E)" },
    { id: "society_dues",      label: "Dues" },
    { id: "society_sinking",   label: "Sinking Fund" },
    { id: "society_vendor",    label: "Vendors" },
    { id: "society_quotes",    label: "Quotes" },
    { id: "society_meetings",  label: "Meetings" },
    { id: "bookkeeper_ledger", label: "Account Book" },
    { id: "shop_purchase_register", label: "Purchase Register" },
    { id: "shop_expense_head",      label: "Expense Head" },
    { id: "shop_gst_summary",       label: "GST Input" },
    { id: "tc_client_summary",  label: "Client Summary" },
    { id: "tc_tds_tracker",     label: "TDS Tracker" },
    { id: "tc_fy_comparison",   label: "FY Comparison" },
    { id: "tc_gstr2a",          label: "GSTR-2A" },
    { id: "ca_client_ledger",   label: "Client Ledger" },
    { id: "ca_tds_summary",     label: "TDS Summary" },
    { id: "ca_fy_comparison",   label: "FY Comparison" },
    { id: "ca_audit_trail",     label: "Audit Trail" },
    { id: "re_property_expense", label: "By Property" },
    { id: "re_rental_income",    label: "Rental Income" },
    { id: "re_acquisition",      label: "Acquisition" },
    { id: "adv_matter_billing",  label: "Matter Billing" },
    { id: "adv_client_ledger",   label: "Client Ledger" },
    { id: "adv_court_fees",      label: "Court Fees" },
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
        {activeTab === "society_ledger"    && <SocietyLedgerTab      records={records} />}
        {activeTab === "society_vendor"    && <SocietyVendorTab      records={records} />}
        {activeTab === "society_dues"      && <SocietyDuesTab        records={records} />}
        {activeTab === "society_sinking"   && <SocietySinkingFundTab records={records} />}
        {activeTab === "society_quotes"    && <SocietyQuotesTab      records={records} />}
        {activeTab === "society_audit"     && <SocietyAuditTab       records={records} />}
        {activeTab === "society_meetings"  && <SocietyMeetingsTab records={records} />}
        {activeTab === "bookkeeper_ledger" && <BookkeeperLedgerTab   records={records} />}
        {activeTab === "shop_purchase_register" && <ShopkeeperPurchaseRegisterTab records={records} />}
        {activeTab === "shop_expense_head"      && <ShopkeeperExpenseHeadTab      records={records} />}
        {activeTab === "shop_gst_summary"       && <ShopkeeperGSTSummaryTab       records={records} />}
        {activeTab === "tc_client_summary"  && <ClientSummaryTab  records={records} title="Client-wise Summary" subtitle="Per client tag — total invoices, taxable value, GST, and total (for billing/retainer tracking)" />}
        {activeTab === "tc_tds_tracker"     && <TDSTrackerTab     records={records} title="TDS Tracker" subtitle="Invoices where professional/contractor fees cross the TDS threshold (>₹30K)" />}
        {activeTab === "tc_fy_comparison"   && <FYComparisonTab   records={records} title="FY Comparison" subtitle="Current FY vs last FY — total spend, GST paid, document count" />}
        {activeTab === "tc_gstr2a"          && <GSTR2ASummaryTab  records={records} />}
        {activeTab === "ca_client_ledger"   && <ClientSummaryTab  records={records} title="Client Ledger" subtitle="Per client tag — all invoices with dates, amounts, and GST (for audit trail)" />}
        {activeTab === "ca_tds_summary"     && <TDSTrackerTab     records={records} title="TDS Summary" subtitle="High-value invoices by type (legal, professional, rent) eligible for TDS deduction" />}
        {activeTab === "ca_fy_comparison"   && <FYComparisonTab   records={records} title="FY Comparison" subtitle="Cross-year spend and GST comparison for client reporting" />}
        {activeTab === "ca_audit_trail"     && <AuditTrailTab     records={records} />}
        {activeTab === "re_property_expense" && <REPropertyExpenseTab records={records} />}
        {activeTab === "re_rental_income"    && <RERentalIncomeTab   records={records} />}
        {activeTab === "re_acquisition"      && <REAcquisitionCostTab records={records} />}
        {activeTab === "adv_matter_billing"  && <ClientSummaryTab  records={records} title="Matter-wise Billing" subtitle="Per client tag — court fees, filing charges, professional fees per matter" />}
        {activeTab === "adv_client_ledger"   && <ClientSummaryTab  records={records} title="Client Ledger" subtitle="All invoices per client with running total — for billing statement" />}
        {activeTab === "adv_court_fees"      && <AdvCourtFeesTab   records={records} />}
      </div>
    </div>
  );
}
