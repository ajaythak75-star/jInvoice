import React, { useEffect, useState, useMemo } from "react";
import { GSTReportScreen } from "./GSTReportScreen";
import { db, type InvoiceMeta } from "../../data/InvoiceDatabase";

type ReportTab = "gst" | "period" | "vendor" | "tags" | "category";
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
  useEffect(() => {
    db.invoices.toArray().then(rows =>
      setRecords(rows.filter(r =>
        r.grandTotalPaise != null &&
        r.status !== "extraction_failed" &&
        r.status !== "import_blocked_encrypted"
      ))
    ).finally(() => setLoading(false));
  }, []);
  return { records, loading };
}

// ── shared UI ─────────────────────────────────────────────────────────────────

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
  const [customFrom, setCustomFrom] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 3); return d.toISOString().slice(0, 10);
  });
  const [customTo, setCustomTo] = useState(() => new Date().toISOString().slice(0, 10));

  const years = useMemo(() => availableYears(records), [records]);

  const base = useMemo(() =>
    view === "custom" ? records : filterByYear(records, year),
    [records, view, year]
  );

  const filtered = useMemo(() => {
    if (view !== "custom") return base;
    const from = new Date(customFrom + "T00:00:00");
    const to   = new Date(customTo + "T23:59:59");
    return records.filter(r => { const d = recDate(r); return d ? d >= from && d <= to : false; });
  }, [records, base, view, customFrom, customTo]);

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
        <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 3 }}>Invoice spend grouped by time period</p>
      </div>

      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 14 }}>
        {VIEW_TABS.map(v => <button key={v.id} style={chipStyle(view === v.id)} onClick={() => setView(v.id)}>{v.label}</button>)}
      </div>

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
                {[...buckets].reverse().map((b, i) => (
                  <tr key={b.label} style={{ borderBottom: i < buckets.length - 1 ? "1px solid var(--color-border)" : "none", background: i % 2 === 0 ? "transparent" : "var(--color-surface-2)" }}>
                    <td style={{ fontSize: 12.5, color: "var(--color-text)", padding: "10px 14px" }}>{b.label}</td>
                    <td style={{ fontSize: 12.5, color: "var(--color-text-secondary)", padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{b.count}</td>
                    <td style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-text)", padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtRupee(b.totalPaise)}</td>
                    <td style={{ fontSize: 12.5, color: "var(--color-text-secondary)", padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{b.taxPaise ? fmtRupee(b.taxPaise) : "—"}</td>
                  </tr>
                ))}
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
        <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 3 }}>Spending by supplier — track where your money goes</p>
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
                {list.map((v, i) => (
                  <tr key={v.name} style={{ borderBottom: i < list.length - 1 ? "1px solid var(--color-border)" : "none", background: i % 2 === 0 ? "transparent" : "var(--color-surface-2)" }}>
                    <td style={{ fontSize: 11, color: "var(--color-text-tertiary)", padding: "10px 14px", fontVariantNumeric: "tabular-nums" }}>{i + 1}</td>
                    <td style={{ fontSize: 12.5, color: "var(--color-text)", padding: "10px 14px", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.name}</td>
                    <td style={{ fontSize: 12.5, color: "var(--color-text-secondary)", padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{v.count}</td>
                    <td style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-text)", padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtRupee(v.totalPaise)}</td>
                    <td style={{ fontSize: 12, color: "var(--color-text-secondary)", padding: "10px 14px", textAlign: "right" }}>{pct(v.totalPaise, grandTotal)}</td>
                    <td style={{ fontSize: 11.5, color: "var(--color-text-secondary)", padding: "10px 14px", textAlign: "right" }}>
                      {v.lastDate ? new Date(v.lastDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" }) : "—"}
                    </td>
                  </tr>
                ))}
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
          Spending by client or project — for freelancers, advocates, and consultants
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
          <span style={{ opacity: 0.7 }}>Tag invoices in View screen to see them here.</span>
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
                {tagged.map((t, i) => (
                  <tr key={t.tag} style={{ borderBottom: "1px solid var(--color-border)", background: i % 2 === 0 ? "transparent" : "var(--color-surface-2)" }}>
                    <td style={{ fontSize: 12.5, color: "var(--color-text)", padding: "10px 14px" }}>
                      <span style={{ background: "color-mix(in srgb, var(--color-primary) 12%, transparent)", color: "var(--color-primary)", borderRadius: 4, padding: "2px 8px", fontSize: 12, fontWeight: 600 }}>{t.tag}</span>
                    </td>
                    <td style={{ fontSize: 12.5, color: "var(--color-text-secondary)", padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{t.count}</td>
                    <td style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-text)", padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtRupee(t.totalPaise)}</td>
                    <td style={{ fontSize: 12, color: "var(--color-text-secondary)", padding: "10px 14px", textAlign: "right" }}>{pct(t.totalPaise, grandTotal)}</td>
                  </tr>
                ))}
                {untaggedCount > 0 && (
                  <tr style={{ borderBottom: "none" }}>
                    <td style={{ fontSize: 12, color: "var(--color-text-tertiary)", padding: "10px 14px", fontStyle: "italic" }}>Untagged</td>
                    <td style={{ fontSize: 12.5, color: "var(--color-text-tertiary)", padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{untaggedCount}</td>
                    <td style={{ fontSize: 12.5, color: "var(--color-text-tertiary)", padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtRupee(untaggedPaise)}</td>
                    <td style={{ fontSize: 12, color: "var(--color-text-tertiary)", padding: "10px 14px", textAlign: "right" }}>{pct(untaggedPaise, grandTotal)}</td>
                  </tr>
                )}
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

function GroupSection({ title, rows, grandTotal, csvName }: {
  title: string;
  rows: { label: string; count: number; totalPaise: number }[];
  grandTotal: number;
  csvName: string;
}) {
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
            {rows.map((r, i) => (
              <tr key={r.label} style={{ borderBottom: i < rows.length - 1 ? "1px solid var(--color-border)" : "none", background: i % 2 === 0 ? "transparent" : "var(--color-surface-2)" }}>
                <td style={{ fontSize: 12.5, color: "var(--color-text)", padding: "9px 16px" }}>{r.label}</td>
                <td style={{ fontSize: 12.5, color: "var(--color-text-secondary)", padding: "9px 16px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.count}</td>
                <td style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-text)", padding: "9px 16px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtRupee(r.totalPaise)}</td>
                <td style={{ fontSize: 12, color: "var(--color-text-secondary)", padding: "9px 16px", textAlign: "right" }}>{pct(r.totalPaise, grandTotal)}</td>
              </tr>
            ))}
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
  const years = useMemo(() => availableYears(records), [records]);
  const filtered = useMemo(() => filterByYear(records, year), [records, year]);
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
        <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 3 }}>Breakdown by document type and payment method</p>
      </div>

      <YearRow years={years} year={year} setYear={setYear} />

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
          <GroupSection title="By Document Type" rows={docTypes}  grandTotal={grandTotal} csvName="category-by-type.csv" />
          <GroupSection title="By Payment Mode"  rows={payModes}  grandTotal={grandTotal} csvName="category-by-payment.csv" />
        </>
      )}
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

export function ReportScreen() {
  const { records, loading } = useInvoices();
  const [tab, setTab] = useState<ReportTab>("gst");

  const TABS: { id: ReportTab; label: string }[] = [
    { id: "gst",      label: "GST" },
    { id: "period",   label: "Period" },
    { id: "vendor",   label: "Vendor" },
    { id: "tags",     label: "Tags" },
    { id: "category", label: "Category" },
  ];

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
        {TABS.map(t => <button key={t.id} style={TAB_STYLE(tab === t.id)} onClick={() => setTab(t.id)}>{t.label}</button>)}
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {tab === "gst"      && <GSTReportScreen />}
        {tab === "period"   && <PeriodReportTab   records={records} />}
        {tab === "vendor"   && <VendorReportTab   records={records} />}
        {tab === "tags"     && <TagsReportTab     records={records} />}
        {tab === "category" && <CategoryReportTab records={records} />}
      </div>
    </div>
  );
}
