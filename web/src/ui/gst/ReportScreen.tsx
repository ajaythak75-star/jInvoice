import React, { useEffect, useState, useMemo } from "react";
import { GSTReportScreen } from "./GSTReportScreen";
import { db, type InvoiceMeta } from "../../data/InvoiceDatabase";

type InvoiceTab = "gst" | "invoice";
type InvoiceView = "daily" | "monthly" | "yearly" | "custom";

interface PeriodBucket {
  label: string;
  count: number;
  totalPaise: number;
}

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

function dateKey(d: Date, view: InvoiceView): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  if (view === "daily")   return `${y}-${m}-${day}`;
  if (view === "monthly") return `${y}-${m}`;
  return `${y}`;
}

function bucketLabel(key: string, view: InvoiceView): string {
  if (view === "daily") {
    const d = new Date(key + "T00:00:00");
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  }
  if (view === "monthly") {
    const [y, m] = key.split("-");
    const d = new Date(Number(y), Number(m) - 1, 1);
    return d.toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
  }
  return key;
}

function sortedKeys(keys: string[]): string[] {
  return [...keys].sort();
}

function InvoiceReportTab() {
  const [records, setRecords] = useState<InvoiceMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView]       = useState<InvoiceView>("monthly");
  const [customFrom, setCustomFrom] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 3);
    return d.toISOString().slice(0, 10);
  });
  const [customTo, setCustomTo] = useState(() => new Date().toISOString().slice(0, 10));

  useEffect(() => {
    db.invoices.toArray().then((rows) => {
      setRecords(rows.filter(
        (r) => r.grandTotalPaise != null && r.status !== "extraction_failed" && r.status !== "import_blocked_encrypted"
      ));
    }).finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    if (view !== "custom") return records;
    const from = new Date(customFrom + "T00:00:00");
    const to   = new Date(customTo   + "T23:59:59");
    return records.filter((r) => {
      const dateStr = r.invoiceDate ?? r.createdAt;
      if (!dateStr) return false;
      const d = new Date(dateStr);
      return d >= from && d <= to;
    });
  }, [records, view, customFrom, customTo]);

  const buckets = useMemo<PeriodBucket[]>(() => {
    const map = new Map<string, PeriodBucket>();
    const effectiveView = view === "custom" ? "daily" : view;

    for (const rec of filtered) {
      const dateStr = rec.invoiceDate ?? rec.createdAt;
      if (!dateStr) continue;
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) continue;

      let k: string;
      if (view === "daily") {
        // Last 60 days only
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 59);
        if (d < cutoff) continue;
        k = dateKey(d, "daily");
      } else if (view === "monthly") {
        // Last 24 months
        const cutoff = new Date();
        cutoff.setMonth(cutoff.getMonth() - 23);
        cutoff.setDate(1);
        if (d < cutoff) continue;
        k = dateKey(d, "monthly");
      } else if (view === "yearly") {
        k = dateKey(d, "yearly");
      } else {
        // custom → daily buckets within range
        k = dateKey(d, "daily");
      }

      if (!map.has(k)) {
        map.set(k, { label: bucketLabel(k, effectiveView), count: 0, totalPaise: 0 });
      }
      const b = map.get(k)!;
      b.count++;
      b.totalPaise += rec.grandTotalPaise!;
    }

    return sortedKeys([...map.keys()]).map((k) => map.get(k)!);
  }, [filtered, view]);

  const totals = useMemo(() => ({
    count: filtered.length,
    totalPaise: filtered.reduce((s, r) => s + (r.grandTotalPaise ?? 0), 0),
    avgPaise: buckets.length ? Math.round(filtered.reduce((s, r) => s + (r.grandTotalPaise ?? 0), 0) / buckets.length) : 0,
  }), [filtered, buckets]);

  const maxPaise = useMemo(() => Math.max(...buckets.map((b) => b.totalPaise), 1), [buckets]);

  const VIEW_TABS: { id: InvoiceView; label: string }[] = [
    { id: "daily",   label: "Daily" },
    { id: "monthly", label: "Monthly" },
    { id: "yearly",  label: "Yearly" },
    { id: "custom",  label: "Custom" },
  ];

  if (loading) return <div className="placeholder-screen"><p>Loading…</p></div>;

  return (
    <div style={{ padding: "20px", maxWidth: 900, margin: "0 auto" }}>

      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--color-text)", margin: 0 }}>Expense Summary</h2>
        <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 3 }}>
          Invoice spend aggregated by time period
        </p>
      </div>

      {/* View toggle */}
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 14 }}>
        {VIEW_TABS.map((v) => (
          <button key={v.id} onClick={() => setView(v.id)}
            style={{
              fontSize: 12.5, padding: "5px 14px", borderRadius: 20, border: "1.5px solid",
              borderColor: view === v.id ? "var(--color-primary)" : "var(--color-border)",
              background:  view === v.id ? "var(--accent-subtle)" : "transparent",
              color:       view === v.id ? "var(--color-primary)" : "var(--color-text-secondary)",
              cursor: "pointer", fontWeight: view === v.id ? 700 : 400,
            }}>
            {v.label}
          </button>
        ))}
      </div>

      {/* Custom date range */}
      {view === "custom" && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
          <label style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "flex", alignItems: "center", gap: 6 }}>
            From
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
              style={{ fontSize: 12.5, padding: "4px 8px", borderRadius: 6, border: "1px solid var(--color-border)", background: "var(--color-bg)", color: "var(--color-text)" }} />
          </label>
          <label style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "flex", alignItems: "center", gap: 6 }}>
            To
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
              style={{ fontSize: 12.5, padding: "4px 8px", borderRadius: 6, border: "1px solid var(--color-border)", background: "var(--color-bg)", color: "var(--color-text)" }} />
          </label>
        </div>
      )}

      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 20 }}>
        {[
          { label: "Invoices",    value: String(totals.count),         color: "var(--color-text)" },
          { label: "Total Spend", value: fmtShort(totals.totalPaise),  color: "var(--color-primary)" },
          { label: `Avg / ${view === "daily" ? "Day" : view === "monthly" ? "Month" : view === "yearly" ? "Year" : "Day"}`,
            value: fmtShort(totals.avgPaise), color: "var(--color-text)" },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10, padding: "12px 14px" }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5 }}>{label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color, fontVariantNumeric: "tabular-nums" }}>{value}</div>
          </div>
        ))}
      </div>

      {buckets.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 0", color: "var(--color-text-secondary)", fontSize: 13 }}>
          No invoice data for this period.
        </div>
      ) : (
        <>
          {/* Bar chart */}
          <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10, padding: "16px", marginBottom: 16, overflowX: "auto" }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>
              Spend by {view === "custom" ? "Day" : view.charAt(0).toUpperCase() + view.slice(1)}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: view === "daily" ? 480 : undefined }}>
              {buckets.map((b) => (
                <div key={b.label} style={{ display: "grid", gridTemplateColumns: "64px 1fr 90px", alignItems: "center", gap: 8 }}>
                  <div style={{ fontSize: 11, color: "var(--color-text-secondary)", textAlign: "right", whiteSpace: "nowrap" }}>{b.label}</div>
                  <div style={{ background: "var(--color-surface-2)", borderRadius: 4, height: 18, overflow: "hidden" }}>
                    <div style={{
                      height: "100%", borderRadius: 4,
                      width: `${Math.round((b.totalPaise / maxPaise) * 100)}%`,
                      background: "var(--color-primary)",
                      minWidth: b.totalPaise > 0 ? 4 : 0,
                      transition: "width 0.3s ease",
                    }} />
                  </div>
                  <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--color-text)", fontVariantNumeric: "tabular-nums", textAlign: "right" }}>
                    {fmtShort(b.totalPaise)}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Table */}
          <div style={{ overflowX: "auto", background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1.5px solid var(--color-border)" }}>
                  <th style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em", padding: "9px 14px", textAlign: "left" }}>
                    Period
                  </th>
                  <th style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em", padding: "9px 14px", textAlign: "right" }}>
                    Invoices
                  </th>
                  <th style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em", padding: "9px 14px", textAlign: "right" }}>
                    Total Spend
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...buckets].reverse().map((b, i) => (
                  <tr key={b.label}
                    style={{ borderBottom: i < buckets.length - 1 ? "1px solid var(--color-border)" : "none",
                      background: i % 2 === 0 ? "transparent" : "var(--color-surface-2)" }}>
                    <td style={{ fontSize: 12.5, color: "var(--color-text)", padding: "10px 14px" }}>{b.label}</td>
                    <td style={{ fontSize: 12.5, color: "var(--color-text-secondary)", padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{b.count}</td>
                    <td style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-text)", padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtRupee(b.totalPaise)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: "1.5px solid var(--color-border)", background: "var(--color-surface-2)" }}>
                  <td style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text-secondary)", padding: "10px 14px" }}>Total</td>
                  <td style={{ fontSize: 12.5, fontWeight: 700, padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{totals.count}</td>
                  <td style={{ fontSize: 12.5, fontWeight: 700, padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtRupee(totals.totalPaise)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export function ReportScreen() {
  const [tab, setTab] = useState<InvoiceTab>("gst");

  const TAB_STYLE = (active: boolean): React.CSSProperties => ({
    padding: "8px 20px",
    fontSize: 13,
    fontWeight: active ? 700 : 500,
    color: active ? "var(--color-primary)" : "var(--color-text-secondary)",
    background: "transparent",
    border: "none",
    borderBottom: `2.5px solid ${active ? "var(--color-primary)" : "transparent"}`,
    cursor: "pointer",
    transition: "color 0.15s, border-color 0.15s",
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Tab bar */}
      <div style={{
        display: "flex",
        borderBottom: "1.5px solid var(--color-border)",
        background: "var(--color-surface)",
        paddingLeft: 8,
        flexShrink: 0,
      }}>
        <button style={TAB_STYLE(tab === "gst")}     onClick={() => setTab("gst")}>GST</button>
        <button style={TAB_STYLE(tab === "invoice")} onClick={() => setTab("invoice")}>Invoice</button>
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {tab === "gst"     && <GSTReportScreen />}
        {tab === "invoice" && <InvoiceReportTab />}
      </div>
    </div>
  );
}
