import React, { useEffect, useState, useMemo } from "react";
import { db, type InvoiceMeta } from "../../data/InvoiceDatabase";
import { isSupabaseEnabled } from "../../data/supabase";
import { saveGstReport } from "../../service/SupabaseSync";

type Period = "this_month" | "last_month" | "q1" | "q2" | "q3" | "q4" | "this_fy" | "last_fy" | "all";

interface GSTRow {
  gstin: string;
  names: Set<string>;
  count: number;
  taxablePaise: number;
  gstPaise: number;
  totalPaise: number;
}

function fyStartYear(d: Date): number {
  return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
}

function getPeriodRange(period: Period): { from: Date | null; to: Date | null } {
  const now  = new Date();
  const y    = now.getFullYear();
  const m    = now.getMonth();
  const fy   = fyStartYear(now);

  switch (period) {
    case "this_month":  return { from: new Date(y, m, 1),       to: new Date(y, m + 1, 0, 23, 59, 59) };
    case "last_month":  return { from: new Date(y, m - 1, 1),   to: new Date(y, m, 0, 23, 59, 59) };
    case "q1":          return { from: new Date(fy, 3, 1),       to: new Date(fy, 6, 0, 23, 59, 59) };
    case "q2":          return { from: new Date(fy, 6, 1),       to: new Date(fy, 9, 0, 23, 59, 59) };
    case "q3":          return { from: new Date(fy, 9, 1),       to: new Date(fy, 12, 0, 23, 59, 59) };
    case "q4":          return { from: new Date(fy + 1, 0, 1),   to: new Date(fy + 1, 3, 0, 23, 59, 59) };
    case "this_fy":     return { from: new Date(fy, 3, 1),       to: new Date(fy + 1, 2, 31, 23, 59, 59) };
    case "last_fy":     return { from: new Date(fy - 1, 3, 1),   to: new Date(fy, 2, 31, 23, 59, 59) };
    case "all":         return { from: null, to: null };
  }
}

function inRange(dateStr: string | null | undefined, from: Date | null, to: Date | null): boolean {
  if (from === null) return true;
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return false;
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: "this_month", label: "This Month" },
  { value: "last_month", label: "Last Month" },
  { value: "q1",         label: "Q1 Apr–Jun" },
  { value: "q2",         label: "Q2 Jul–Sep" },
  { value: "q3",         label: "Q3 Oct–Dec" },
  { value: "q4",         label: "Q4 Jan–Mar" },
  { value: "this_fy",    label: "This FY" },
  { value: "last_fy",    label: "Last FY" },
  { value: "all",        label: "All Time" },
];

function fmtRupee(paise: number): string {
  return `₹${(paise / 100).toFixed(2)}`;
}

function fmtShort(paise: number): string {
  const inr = paise / 100;
  if (inr >= 100_000) return `₹${(inr / 100_000).toFixed(2)}L`;
  if (inr >= 1_000)   return `₹${(inr / 1_000).toFixed(1)}K`;
  return `₹${inr.toFixed(2)}`;
}

function formatTallyDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

function xmlEsc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildTallyXml(filteredRecs: InvoiceMeta[], periodLabel: string): string {
  const vouchers = filteredRecs.map((rec, i) => {
    const date        = formatTallyDate(rec.invoiceDate ?? rec.createdAt);
    const total       = ((rec.grandTotalPaise ?? 0) / 100).toFixed(2);
    const gst         = ((rec.taxPaise ?? 0) / 100).toFixed(2);
    const taxable     = (((rec.grandTotalPaise ?? 0) - (rec.taxPaise ?? 0)) / 100).toFixed(2);
    const party       = xmlEsc(rec.merchantName ?? "Unknown Supplier");
    const narration   = xmlEsc(rec.sourceFilename ?? `Invoice ${i + 1}`);
    const hasGst      = (rec.taxPaise ?? 0) > 0;

    const gstEntry = hasGst ? `
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>GST Input Tax</LEDGERNAME>
            <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
            <AMOUNT>-${gst}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>` : "";

    return `
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <VOUCHER VCHTYPE="Purchase" ACTION="Create">
            <DATE>${date}</DATE>
            <VOUCHERTYPENAME>Purchase</VOUCHERTYPENAME>
            <NARRATION>${narration}</NARRATION>
            <PARTYLEDGERNAME>${party}</PARTYLEDGERNAME>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>Purchase Account</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <AMOUNT>-${taxable}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>${gstEntry}
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>${party}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
              <AMOUNT>${total}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>
          </VOUCHER>
        </TALLYMESSAGE>`;
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- jInvoice Tally Export · ${periodLabel} -->
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
    <TYPE>Data</TYPE>
    <ID>Vouchers</ID>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
      </REQUESTDESC>
      <REQUESTDATA>${vouchers}
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
}

function buildCsv(rows: GSTRow[], periodLabel: string): string {
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const header = `GST Report – ${periodLabel}\nGSTIN,Supplier Name,Invoice Count,Taxable Value (₹),GST Amount (₹),Total Amount (₹)`;
  const lines = rows.map((r) => [
    q(r.gstin === "—" ? "No GSTIN" : r.gstin),
    q([...r.names].join(" / ") || "—"),
    r.count,
    (r.taxablePaise / 100).toFixed(2),
    (r.gstPaise / 100).toFixed(2),
    (r.totalPaise / 100).toFixed(2),
  ].join(","));
  return [header, ...lines].join("\n");
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
                  {["Date", "Vendor", "Invoice #", "Amount", "Tax"].map((h, i) => (
                    <th key={h} style={{ fontSize: 10, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em", padding: "4px 10px", textAlign: i <= 2 ? "left" : "right", whiteSpace: "nowrap" }}>{h}</th>
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

export function GSTReportScreen() {
  const [records, setRecords]       = useState<InvoiceMeta[]>([]);
  const [loading, setLoading]       = useState(true);
  const [period, setPeriod]         = useState<Period>("this_fy");
  const [filterClient, setFilterClient] = useState<string | null>(null);
  const [drillGstin, setDrillGstin] = useState<string | null>(null);
  const [cloudSaving, setCloudSaving] = useState(false);
  const [cloudMsg, setCloudMsg]       = useState<string | null>(null);

  useEffect(() => {
    db.invoices.toArray().then(setRecords).finally(() => setLoading(false));
  }, []);

  const allClients = useMemo(
    () => [...new Set(records.flatMap((r) => r.clientTags ?? []))].sort(),
    [records],
  );

  const { from, to } = useMemo(() => getPeriodRange(period), [period]);

  const gstRows = useMemo<GSTRow[]>(() => {
    const map = new Map<string, GSTRow>();
    for (const rec of records) {
      if (rec.grandTotalPaise == null) continue;
      if (rec.status === "extraction_failed" || rec.status === "import_blocked_encrypted") continue;
      if (!inRange(rec.invoiceDate ?? rec.createdAt, from, to)) continue;
      if (filterClient && !(rec.clientTags ?? []).includes(filterClient)) continue;

      const key = rec.merchantGstin?.trim() || "—";
      if (!map.has(key)) {
        map.set(key, { gstin: key, names: new Set(), count: 0, taxablePaise: 0, gstPaise: 0, totalPaise: 0 });
      }
      const row = map.get(key)!;
      row.count++;
      row.totalPaise   += rec.grandTotalPaise;
      const gst         = rec.taxPaise ?? 0;
      row.gstPaise     += gst;
      row.taxablePaise += rec.grandTotalPaise - gst;
      if (rec.merchantName) row.names.add(rec.merchantName);
    }
    return [...map.values()].sort((a, b) => b.gstPaise - a.gstPaise);
  }, [records, from, to, filterClient]);

  const totals = useMemo(() => ({
    count:   gstRows.reduce((s, r) => s + r.count,        0),
    taxable: gstRows.reduce((s, r) => s + r.taxablePaise, 0),
    gst:     gstRows.reduce((s, r) => s + r.gstPaise,     0),
    total:   gstRows.reduce((s, r) => s + r.totalPaise,   0),
  }), [gstRows]);

  const filteredRecords = useMemo(() => records.filter((rec) => {
    if (rec.grandTotalPaise == null) return false;
    if (rec.status === "extraction_failed" || rec.status === "import_blocked_encrypted") return false;
    if (!inRange(rec.invoiceDate ?? rec.createdAt, from, to)) return false;
    if (filterClient && !(rec.clientTags ?? []).includes(filterClient)) return false;
    return true;
  }), [records, from, to, filterClient]);

  const downloadCsv = () => {
    const label = PERIOD_OPTIONS.find((p) => p.value === period)?.label ?? period;
    const blob  = new Blob([buildCsv(gstRows, label)], { type: "text/csv" });
    const url   = URL.createObjectURL(blob);
    const a     = document.createElement("a");
    a.href      = url;
    a.download  = `gst-report-${label.replace(/[^a-z0-9]/gi, "-").toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadTally = () => {
    const label = PERIOD_OPTIONS.find((p) => p.value === period)?.label ?? period;
    const xml   = buildTallyXml(filteredRecords, label);
    const blob  = new Blob([xml], { type: "application/xml" });
    const url   = URL.createObjectURL(blob);
    const a     = document.createElement("a");
    a.href      = url;
    a.download  = `tally-import-${label.replace(/[^a-z0-9]/gi, "-").toLowerCase()}.xml`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSaveToCloud = async () => {
    if (gstRows.length === 0) return;
    setCloudSaving(true);
    setCloudMsg(null);
    const label = PERIOD_OPTIONS.find((p) => p.value === period)?.label ?? period;
    const { from: f, to: t } = getPeriodRange(period);
    const ok = await saveGstReport({
      period,
      periodLabel: label,
      fromDate: f ? f.toISOString().slice(0, 10) : null,
      toDate:   t ? t.toISOString().slice(0, 10) : null,
      totals: {
        invoices:     totals.count,
        taxablePaise: totals.taxable,
        gstPaise:     totals.gst,
        totalPaise:   totals.total,
      },
      rows: gstRows.map((r) => ({
        gstin:         r.gstin,
        supplierNames: [...r.names],
        invoiceCount:  r.count,
        taxablePaise:  r.taxablePaise,
        gstPaise:      r.gstPaise,
        totalPaise:    r.totalPaise,
      })),
    });
    setCloudSaving(false);
    setCloudMsg(ok ? "Saved to cloud ✓" : "Save failed — check Supabase config");
    setTimeout(() => setCloudMsg(null), 4000);
  };

  if (loading) return <div className="placeholder-screen"><p>Loading…</p></div>;

  const thS: React.CSSProperties = {
    fontSize: 10.5, fontWeight: 700, color: "var(--color-text-tertiary)",
    textTransform: "uppercase", letterSpacing: "0.06em",
    padding: "9px 12px", textAlign: "left", whiteSpace: "nowrap",
  };
  const tdS: React.CSSProperties = { fontSize: 12.5, color: "var(--color-text)", padding: "10px 12px", verticalAlign: "middle" };
  const numS: React.CSSProperties = { ...tdS, textAlign: "right", fontVariantNumeric: "tabular-nums" };

  const periodLabel = PERIOD_OPTIONS.find((p) => p.value === period)?.label ?? "";

  return (
    <div style={{ padding: "20px", maxWidth: 900, margin: "0 auto" }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--color-text)", margin: 0 }}>GST Report</h2>
          <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 3 }}>
            Input tax credit summary · grouped by GSTIN
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button
            onClick={downloadCsv}
            disabled={gstRows.length === 0}
            style={{ fontSize: 12.5, padding: "7px 16px", borderRadius: 7, border: "1.5px solid var(--color-primary)", background: "var(--accent-subtle)", color: "var(--color-primary)", cursor: gstRows.length ? "pointer" : "not-allowed", fontWeight: 600, opacity: gstRows.length ? 1 : 0.5 }}
          >
            ↓ CSV
          </button>
          <button
            onClick={downloadTally}
            disabled={filteredRecords.length === 0}
            title="Download Tally Prime / ERP 9 compatible XML for purchase voucher import"
            style={{ fontSize: 12.5, padding: "7px 16px", borderRadius: 7, border: "1.5px solid #0891b2", background: filteredRecords.length ? "#ecfeff" : "transparent", color: "#0891b2", cursor: filteredRecords.length ? "pointer" : "not-allowed", fontWeight: 600, opacity: filteredRecords.length ? 1 : 0.5 }}
          >
            ↓ Tally XML
          </button>
          {isSupabaseEnabled() && (
            <button
              onClick={handleSaveToCloud}
              disabled={cloudSaving || gstRows.length === 0}
              title="Save this GST report snapshot to Supabase cloud"
              style={{
                fontSize: 12.5, padding: "7px 16px", borderRadius: 7,
                border: "1.5px solid #7c3aed",
                background: cloudSaving || gstRows.length === 0 ? "transparent" : "#f5f3ff",
                color: "#7c3aed",
                cursor: cloudSaving || gstRows.length === 0 ? "not-allowed" : "pointer",
                fontWeight: 600, opacity: gstRows.length === 0 ? 0.5 : 1,
              }}
            >
              {cloudSaving ? "Saving…" : "☁ Save to Cloud"}
            </button>
          )}
          {cloudMsg && (
            <span style={{
              fontSize: 12, fontWeight: 600,
              color: cloudMsg.startsWith("Saved") ? "#16a34a" : "#dc2626",
            }}>
              {cloudMsg}
            </span>
          )}
        </div>
      </div>

      {/* ── Period pills ── */}
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 10 }}>
        {PERIOD_OPTIONS.map((opt) => (
          <button key={opt.value} onClick={() => setPeriod(opt.value)}
            style={{ fontSize: 12, padding: "4px 11px", borderRadius: 20, border: "1.5px solid",
              borderColor: period === opt.value ? "var(--color-primary)" : "var(--color-border)",
              background:  period === opt.value ? "var(--accent-subtle)" : "transparent",
              color:       period === opt.value ? "var(--color-primary)" : "var(--color-text-secondary)",
              cursor: "pointer" }}>
            {opt.label}
          </button>
        ))}
      </div>

      {/* ── Client filter ── */}
      {allClients.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Client</span>
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
      )}

      {/* ── Summary cards ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 18 }}>
        {[
          { label: "Invoices",      value: String(totals.count),         color: "var(--color-text)" },
          { label: "Taxable Value", value: fmtShort(totals.taxable),     color: "var(--color-text)" },
          { label: "GST Paid",      value: fmtShort(totals.gst),         color: "#0891b2" },
          { label: "Total Spend",   value: fmtShort(totals.total),       color: "var(--color-primary)" },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10, padding: "12px 14px" }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5 }}>{label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color, fontVariantNumeric: "tabular-nums" }}>{value}</div>
          </div>
        ))}
      </div>

      {/* ── Table ── */}
      {gstRows.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 0", color: "var(--color-text-secondary)", fontSize: 13 }}>
          No invoices with extractable data for <strong>{periodLabel}</strong>.
        </div>
      ) : (
        <div style={{ overflowX: "auto", background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1.5px solid var(--color-border)" }}>
                <th style={thS}>GSTIN</th>
                <th style={thS}>Supplier</th>
                <th style={{ ...thS, textAlign: "right" }}>#</th>
                <th style={{ ...thS, textAlign: "right" }}>Taxable Value</th>
                <th style={{ ...thS, textAlign: "right" }}>GST Paid</th>
                <th style={{ ...thS, textAlign: "right" }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {gstRows.map((row, i) => {
                const isOpen = drillGstin === row.gstin;
                const drillRecs = filteredRecords.filter(r => (r.merchantGstin?.trim() || "—") === row.gstin);
                return (
                  <React.Fragment key={row.gstin}>
                    <tr
                      onClick={() => setDrillGstin(isOpen ? null : row.gstin)}
                      style={{ borderBottom: i < gstRows.length - 1 && !isOpen ? "1px solid var(--color-border)" : "none",
                        background: isOpen ? "color-mix(in srgb, var(--color-primary) 6%, transparent)" : i % 2 === 0 ? "transparent" : "var(--color-surface-2)",
                        cursor: "pointer" }}>
                      <td style={{ ...tdS, fontFamily: "monospace", fontSize: 11.5 }}>
                        <span style={{ fontSize: 10, color: "var(--color-primary)", opacity: 0.7, marginRight: 6 }}>{isOpen ? "▼" : "▶"}</span>
                        {row.gstin === "—"
                          ? <span style={{ color: "var(--color-text-tertiary)", fontFamily: "inherit" }}>No GSTIN</span>
                          : row.gstin}
                      </td>
                      <td style={tdS}>
                        <div style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                          title={[...row.names].join(", ")}>
                          {[...row.names].slice(0, 2).join(", ") || "—"}
                        </div>
                      </td>
                      <td style={{ ...numS, color: "var(--color-text-secondary)", fontSize: 12 }}>{row.count}</td>
                      <td style={numS}>{fmtRupee(row.taxablePaise)}</td>
                      <td style={{ ...numS, color: "#0891b2", fontWeight: 600 }}>{fmtRupee(row.gstPaise)}</td>
                      <td style={{ ...numS, fontWeight: 600 }}>{fmtRupee(row.totalPaise)}</td>
                    </tr>
                    {isOpen && <DrillDownPanel records={drillRecs} onClose={() => setDrillGstin(null)} />}
                  </React.Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: "1.5px solid var(--color-border)", background: "var(--color-surface-2)" }}>
                <td colSpan={2} style={{ ...tdS, fontWeight: 700, color: "var(--color-text-secondary)", fontSize: 12 }}>
                  Total — {gstRows.length} supplier{gstRows.length !== 1 ? "s" : ""}
                </td>
                <td style={{ ...numS, fontWeight: 700 }}>{totals.count}</td>
                <td style={{ ...numS, fontWeight: 700 }}>{fmtRupee(totals.taxable)}</td>
                <td style={{ ...numS, fontWeight: 700, color: "#0891b2" }}>{fmtRupee(totals.gst)}</td>
                <td style={{ ...numS, fontWeight: 700 }}>{fmtRupee(totals.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
