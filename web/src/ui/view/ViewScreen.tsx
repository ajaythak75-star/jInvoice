import React, { useEffect, useRef, useState, useCallback } from "react";
import { db, type InvoiceMeta, type LineItemRow, insertInvoiceWithItems } from "../../data/InvoiceDatabase";
import { syncNewInvoice } from "../../service/SupabaseSync";
import { runBillChecksForAll, type BillIssue } from "../../service/BillFraudDetector";
import { rewards } from "../../data/RewardsStore";
import { isSupabaseEnabled } from "../../data/supabase";
import type { ClaudeInvoiceData } from "../../extraction/ClaudeExtractor";
import { desktopConnector } from "../../service/AutoImportService";
import { prefs } from "../../data/AutoImportPreferences";
import { ImapConnector } from "../../autoimport/ImapConnector";
import { extractFilePreview, extractInvoiceWithAI } from "../../extraction/ExtractionPipeline";
import { getBulkExtractionState, runBulkExtraction, type BulkState } from "../../service/BulkExtractionService";
import type { ExtractedInvoice } from "../../core/extraction/models";
import { detectCategory } from "../../core/extraction/CategoryDetector";
import { detectDocType, DOC_TYPE_LABELS } from "../../extraction/DocTypeDetector";
import { getWarrantySentinel, computeSentinelForInvoice } from "../../service/ExpirySentinel";
import { WarrantyPromptModal, type WarrantyPromptItem } from "../sentinel/WarrantyPromptModal";
import { SOCIETY_CATEGORY_LABEL, type SocietyExpenseCategory } from "../../core/extraction/SocietyExpenseDetector";
import { getProfessionalCategoryLabel, type ProfessionalProfile } from "../../core/extraction/ProfessionalCategoryDetector";

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
    case "imap":           return "IMAP";
    case "manual_upload":  return "Manual";
    case "manual":         return "Manual";
    case "desktop_folder": return "Desktop";
    case "mobile_upload":  return "Mobile";
    default:               return src;
  }
}

function formatSourceWithEmail(importSource: string, accountEmail?: string | null): string {
  if (accountEmail) return accountEmail;
  if (importSource === "gmail") return prefs.gmailEmail ?? formatSource(importSource);
  if (importSource === "outlook") return prefs.outlookEmail ?? formatSource(importSource);
  if (importSource === "imap") {
    const accounts = ImapConnector.getAccounts();
    return accounts[0]?.email ?? prefs.imapEmail ?? formatSource(importSource);
  }
  return formatSource(importSource);
}


function statusColor(status: string): string {
  switch (status) {
    case "imported":              return "#22c55e";
    case "pending_review":        return "#f59e0b";
    case "pending_extraction":    return "#8b5cf6";
    case "downloaded":            return "#3b82f6";
    case "duplicate":             return "#f97316";
    case "import_blocked_encrypted":
    case "extraction_failed":     return "#ef4444";
    default:                      return "#6b7280";
  }
}

function statusText(status: string): string {
  switch (status) {
    case "imported":                  return "Imported";
    case "pending_review":            return "Needs Review";
    case "pending_extraction":        return "Pending AI";
    case "downloaded":                return "Downloaded";
    case "import_blocked_encrypted":  return "Encrypted";
    case "extraction_failed":         return "Failed";
    case "duplicate":                 return "Duplicate";
    default:                          return status;
  }
}

function extractPincode(address: string | null | undefined): string | null {
  if (!address) return null;
  const m = address.match(/\b\d{6}\b/);
  return m ? m[0] : null;
}

function discountPercent(discountPaise: number, grandTotalPaise: number | null): string | null {
  if (!discountPaise || !grandTotalPaise) return null;
  const base = grandTotalPaise + discountPaise;
  if (!base) return null;
  return ((discountPaise / base) * 100).toFixed(1) + "%";
}

type AccBadge = "CORRECT" | "NOT_SHOWN" | "FORMAT";
function accBadge(
  value: string | number | null | undefined,
  type?: "date" | "gstin" | "phone" | "pincode"
): { badge: AccBadge; note?: string } {
  if (value == null || value === "") return { badge: "NOT_SHOWN" };
  const s = String(value);
  if (type === "date") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return { badge: "CORRECT" };
    return { badge: "FORMAT", note: "Expected YYYY-MM-DD · year may be missing" };
  }
  if (type === "gstin") {
    if (/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/.test(s)) return { badge: "CORRECT" };
    return { badge: "FORMAT", note: "Format mismatch" };
  }
  if (type === "pincode") {
    if (/^\d{6}$/.test(s)) return { badge: "CORRECT" };
    return { badge: "FORMAT", note: "Expected 6 digits" };
  }
  if (type === "phone") {
    if (/^\d{10}$/.test(s.replace(/[\s\-+()​]/g, ""))) return { badge: "CORRECT" };
    return { badge: "FORMAT", note: "Expected 10 digits" };
  }
  return { badge: "CORRECT" };
}
function badgeChip(b: AccBadge, note?: string): React.ReactElement {
  const styles: React.CSSProperties =
    b === "CORRECT"   ? { color: "#16a34a", background: "#dcfce7", border: "1px solid #86efac" } :
    b === "FORMAT"    ? { color: "#dc2626", background: "#fee2e2", border: "1px solid #fca5a5" } :
                        { color: "#6b7280", background: "var(--color-surface-2)", border: "1px solid var(--color-border)" };
  const label = b === "CORRECT" ? "✓ Correct" : b === "FORMAT" ? "✕ Format" : "✓ Not Shown";
  return (
    <span title={note} style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", borderRadius: 4, padding: "2px 6px", ...styles }}>
      {label}
    </span>
  );
}
function extractionMethod(pdfSourceType: string): string {
  if (pdfSourceType === "SCANNED_PDF" || pdfSourceType === "MIXED_PDF") return "Gemini Vision";
  return "PDF Text";
}

function detectSensitiveData(r: InvoiceMeta): { sensitive: boolean; reasons: string[] } {
  const reasons: string[] = [];

  // Phone number on the invoice
  if (r.merchantPhone?.trim()) {
    reasons.push("Phone number present");
  }

  // Residential address patterns (flat, house no, apartment, etc.)
  const addr = (r.merchantAddress ?? "").toLowerCase();
  if (/\b(flat|apt\.?|apartment|house\s*(no\.?|num\.?|#)?|h\.?\s*no\.?|room\s*(no\.?)?|floor|plot\s*(no\.?|#)?|society|villa|bungalow|wing)\b/.test(addr)) {
    reasons.push("Residential address detected");
  }

  // Aadhaar-like pattern (12 digits, optionally space/hyphen-separated as xxxx xxxx xxxx)
  const allText = `${r.merchantName ?? ""} ${r.merchantAddress ?? ""} ${r.invoiceNumber ?? ""}`;
  if (/\b\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b/.test(allText)) {
    reasons.push("Possible Aadhaar number detected");
  }

  // PAN number pattern (AAAAA9999A) that is NOT part of a 15-char GSTIN
  const panPattern = /\b[A-Z]{5}\d{4}[A-Z]\b/;
  const notInGstin = !r.merchantGstin; // if GSTIN present, PAN is embedded there
  if (notInGstin && panPattern.test(allText.toUpperCase())) {
    reasons.push("Possible PAN number detected");
  }

  return { sensitive: reasons.length > 0, reasons };
}

type SortKey = "newest" | "oldest" | "amount_desc" | "amount_asc" | "name" | "name_desc" | "folder" | "folder_desc";

function folderGroupKey(rec: InvoiceMeta): string {
  const cat = rec.docTypes?.[0] ?? rec.docType ?? rec.category ?? "";
  return `${rec.importSource ?? ""}::${cat}`;
}

function formatFolderGroup(rec: InvoiceMeta): string {
  const src = formatSource(rec.importSource);
  const cat = rec.docTypes?.[0] ?? rec.docType ?? rec.category;
  return cat ? `${src} – ${cat.replace(/_/g, " ")}` : src;
}

function sortByFolder(records: InvoiceMeta[], reverse: boolean): InvoiceMeta[] {
  const groups = new Map<string, InvoiceMeta[]>();
  for (const r of records) {
    const key = folderGroupKey(r);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  for (const g of groups.values()) {
    g.sort((a, b) => {
      const dateA = a.createdAt ?? "";
      const dateB = b.createdAt ?? "";
      return dateB > dateA ? 1 : dateB < dateA ? -1 : 0;
    });
  }
  const keys = Array.from(groups.keys()).sort();
  if (reverse) keys.reverse();
  return keys.flatMap((k) => groups.get(k)!);
}

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
      return copy.sort((a, b) =>
        cardHeading(a).localeCompare(cardHeading(b), undefined, { sensitivity: "base", numeric: true })
      );
    case "name_desc":
      return copy.sort((a, b) =>
        cardHeading(b).localeCompare(cardHeading(a), undefined, { sensitivity: "base", numeric: true })
      );
    case "folder":      return sortByFolder(copy, false);
    case "folder_desc": return sortByFolder(copy, true);
  }
}

function cardHeading(rec: InvoiceMeta): string {
  const f = rec.sourceFilename;
  if (f && f.toLowerCase().endsWith(".pdf")) return f;
  if (rec.subject && rec.subject.length <= 120) return rec.subject;
  return rec.merchantName ?? "Unknown";
}

function matchesQuery(rec: InvoiceMeta, q: string): boolean {
  const lq = q.toLowerCase();
  return (
    rec.merchantName?.toLowerCase().includes(lq) ||
    rec.sourceFilename?.toLowerCase().includes(lq) ||
    rec.subject?.toLowerCase().includes(lq) ||
    rec.senderEmail?.toLowerCase().includes(lq) ||
    rec.category?.toLowerCase().includes(lq) ||
    rec.clientTags?.some((t) => t.toLowerCase().includes(lq)) ||
    rec.projectTag?.toLowerCase().includes(lq) ||
    rec.importSource.toLowerCase().includes(lq) ||
    rec.status.toLowerCase().includes(lq) ||
    statusText(rec.status).toLowerCase().includes(lq) ||
    false
  );
}

interface UploadEntry {
  rec: InvoiceMeta;
  items: LineItemRow[];
  pincode: string | null;
  discountPct: string | null;
  claude: ClaudeInvoiceData | null;
}

function gstPercent(rec: InvoiceMeta): string | null {
  if (!rec.taxPaise || !rec.grandTotalPaise) return null;
  const subtotal = rec.grandTotalPaise + rec.discountPaise - rec.taxPaise;
  if (subtotal <= 0) return null;
  return ((rec.taxPaise / subtotal) * 100).toFixed(1) + "%";
}

function resolveEntry(entry: UploadEntry) {
  const { rec, items, pincode, claude } = entry;
  if (claude) {
    return {
      shopName:       claude.shopName,
      address:        claude.address,
      pincode:        claude.pincode,
      invoiceNumber:  claude.invoiceNumber,
      gstNumber:      claude.gstNumber,
      gstPercent:     claude.gstPercent,
      gstAmountInr:   claude.gstAmountInr,
      dateOfPurchase: claude.dateOfPurchase,
      discountInr:    claude.discountInr,
      finalPaymentInr: claude.finalPaymentInr,
      items:          claude.items,
      source:         "claude" as const,
    };
  }
  return {
    shopName:       rec.merchantName,
    address:        rec.merchantAddress,
    pincode:        rec.merchantPincode ?? pincode,
    phone:          rec.merchantPhone ?? null,
    invoiceNumber:  rec.invoiceNumber ?? null,
    gstNumber:      rec.merchantGstin,
    gstPercent:     gstPercent(rec),
    gstAmountInr:   rec.taxPaise != null ? rec.taxPaise / 100 : null,
    dateOfPurchase: rec.invoiceDate,
    discountInr:    rec.discountPaise ? rec.discountPaise / 100 : null,
    finalPaymentInr: rec.grandTotalPaise != null ? rec.grandTotalPaise / 100 : null,
    items:          items.map((it) => ({ name: it.name, quantity: it.quantity, unitPriceInr: it.unitPricePaise / 100, discountInr: it.discountPaise ? it.discountPaise / 100 : null, amountInr: it.totalPricePaise / 100 })),
    source:         "db" as const,
  };
}

function buildJson(entries: UploadEntry[]): string {
  const payload = entries.map((entry) => {
    const d = resolveEntry(entry);
    return {
      invoiceNumber:  d.invoiceNumber,
      shopName:       d.shopName,
      address:        d.address,
      pincode:        d.pincode,
      phone:          d.phone,
      gstNumber:      d.gstNumber,
      gstPercent:     d.gstPercent,
      gstAmount:      d.gstAmountInr,
      dateOfPurchase: d.dateOfPurchase,
      discount:       d.discountInr,
      finalPayment:   d.finalPaymentInr,
      items:          d.items,
    };
  });
  return JSON.stringify(payload, null, 2);
}

function buildCsv(entries: UploadEntry[]): string {
  const header = "Invoice No,Shop Name,Date of Purchase,Item Name,Address,Pincode,Phone,Amount (INR),Discount (INR),Final Payment (INR),GST Number,GST %,GST Amount (INR)";
  const rows: string[] = [header];
  entries.forEach((entry) => {
    const d = resolveEntry(entry);
    const q = (s: string | null | undefined) => `"${(s ?? "").replace(/"/g, '""')}"`;
    const n = (v: number | null | undefined) => v != null ? v.toFixed(2) : "";

    const invoiceBase = [d.invoiceNumber ?? "", q(d.shopName), d.dateOfPurchase ?? ""];
    const tail = [
      q(d.address),
      d.pincode ?? "",
      d.phone ?? "",
      "",   // Amount — per item
      n(d.discountInr),
      n(d.finalPaymentInr),
      d.gstNumber ?? "",
      d.gstPercent ?? "",
      n(d.gstAmountInr),
    ];

    if (d.items.length === 0) {
      rows.push([...invoiceBase, "", ...tail].join(","));
    } else {
      d.items.forEach((it, i) => {
        const rowTail = [...tail];
        rowTail[6] = n("amountInr" in it ? it.amountInr : (it as any).totalPricePaise / 100);
        if (i > 0) {
          rows.push(["", "", "", q(it.name), "", "", "", rowTail[6], "", "", "", "", ""].join(","));
        } else {
          rows.push([...invoiceBase, q(it.name), ...rowTail].join(","));
        }
      });
    }
  });
  return rows.join("\n");
}

function downloadFile(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function buildMobileHtml(entries: UploadEntry[]): string {
  const payload = entries.map((entry) => {
    const d = resolveEntry(entry);
    return {
      invoiceNumber:  d.invoiceNumber,
      shopName:       d.shopName,
      address:        d.address,
      pincode:        d.pincode,
      phone:          d.phone,
      gstNumber:      d.gstNumber,
      gstPercent:     d.gstPercent,
      gstAmountInr:   d.gstAmountInr,
      dateOfPurchase: d.dateOfPurchase,
      discountInr:    d.discountInr,
      finalPaymentInr:d.finalPaymentInr,
      items:          d.items,
      source:         d.source,
      filename:       entry.rec.sourceFilename ?? null,
      subject:        entry.rec.subject ?? null,
    };
  });

  // Flatten all items across all invoices for Buy tab
  const buyItems: { name: string; merchant: string; pincode: string; amountInr: number; date: string }[] = [];
  for (const entry of entries) {
    const d = resolveEntry(entry);
    for (const it of d.items) {
      const amt = "amountInr" in it ? (it as any).amountInr : (it as any).totalPricePaise / 100;
      if (it.name?.trim() && amt > 0) {
        buyItems.push({
          name: it.name.trim(),
          merchant: d.shopName ?? "",
          pincode: d.pincode ?? "",
          amountInr: amt,
          date: d.dateOfPurchase ?? "",
        });
      }
    }
  }
  // Sort by price ascending
  buyItems.sort((a, b) => a.amountInr - b.amountInr);

  // Build lowest price map
  const lowestMap = new Map<string, number>();
  for (const it of buyItems) {
    const key = it.name.toLowerCase();
    const cur = lowestMap.get(key);
    if (cur === undefined || it.amountInr < cur) lowestMap.set(key, it.amountInr);
  }
  const buyItemsWithBest = buyItems.map((it) => ({
    ...it,
    isBest: it.amountInr === lowestMap.get(it.name.toLowerCase()),
  }));

  const dataJson    = JSON.stringify(payload);
  const buyJson     = JSON.stringify(buyItemsWithBest);
  const ts = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>jInvoice · ${ts}</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#f5f5f7;--surface:#fff;--border:#e2e2e5;
  --text:#1a1a1a;--text2:#555;--text3:#888;
  --accent:#6366f1;--accent-light:#ede9fe;
  --green:#16a34a;--radius:12px;--shadow:0 1px 4px rgba(0,0,0,.08);
}
@media(prefers-color-scheme:dark){
  :root{--bg:#0f0f13;--surface:#1c1c22;--border:#2e2e38;--text:#f0f0f4;--text2:#a0a0b0;--text3:#606070;--accent-light:#312e6a;}
}
html{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:15px;-webkit-text-size-adjust:100%}
body{min-height:100dvh;padding-bottom:env(safe-area-inset-bottom)}
header{position:sticky;top:0;z-index:10;background:var(--bg);padding:16px 16px 0;border-bottom:1px solid var(--border)}
header h1{font-size:18px;font-weight:700;letter-spacing:-.3px;margin-bottom:10px}
header h1 span{color:var(--accent)}
.tabs{display:flex;gap:4px;margin-bottom:10px}
.tab{flex:1;padding:8px 0;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;background:transparent;color:var(--text3);transition:all .15s}
.tab.active{background:var(--accent);color:#fff}
.search-row{display:flex;gap:8px;padding-bottom:12px}
#search,#buy-search,#buy-pin{padding:10px 14px;border:1.5px solid var(--border);border-radius:10px;background:var(--surface);color:var(--text);font-size:15px;outline:none;-webkit-appearance:none}
#search{width:100%}
#buy-search{flex:1}
#buy-pin{width:110px;font-variant-numeric:tabular-nums}
#search:focus,#buy-search:focus,#buy-pin:focus{border-color:var(--accent)}
#count{font-size:12px;color:var(--text3);margin-bottom:8px;padding:0 2px}
.panel{display:none;padding:12px 16px;flex-direction:column;gap:10px}
.panel.active{display:flex}
.card{background:var(--surface);border:1.5px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden;transition:border-color .15s}
.card.ai{border-color:var(--accent)}
.card.best{border-color:var(--green)}
.card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;padding:14px 14px 10px}
.card-title{font-size:14px;font-weight:700;line-height:1.3;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.card-amount{font-size:15px;font-weight:700;color:var(--accent);white-space:nowrap;font-variant-numeric:tabular-nums}
.card-amount.best-price{color:var(--green)}
.badge{display:inline-flex;align-items:center;font-size:9px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;background:var(--accent);color:#fff;border-radius:4px;padding:1px 5px;margin-left:6px;vertical-align:middle}
.badge.best{background:var(--green)}
.card-date{font-size:12px;color:var(--text3);padding:0 14px 10px;margin-top:-6px}
.card-meta{font-size:12px;color:var(--text2);padding:0 14px 10px;margin-top:-4px;display:flex;gap:10px;flex-wrap:wrap}
.card-body{padding:0 14px 10px;display:none;flex-direction:column;gap:8px}
.card.open .card-body{display:flex}
.row{display:flex;gap:16px}
.field{flex:1;min-width:0}
.field label{display:block;font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px}
.field span{font-size:13px;color:var(--text);word-break:break-word}
.items-table{width:100%;border-collapse:collapse;font-size:12px;margin-top:4px}
.items-table th{text-align:left;padding:4px 0;color:var(--text3);font-size:10px;text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid var(--border)}
.items-table td{padding:5px 0;color:var(--text);border-bottom:1px solid var(--border)}
.items-table td:last-child{text-align:right;font-variant-numeric:tabular-nums;font-weight:500}
.toggle{display:block;width:100%;padding:9px 14px;background:none;border:none;border-top:1px solid var(--border);color:var(--accent);font-size:12px;font-weight:600;text-align:center;cursor:pointer;letter-spacing:.02em}
.empty{text-align:center;color:var(--text3);font-size:14px;padding:48px 0}
</style>
</head>
<body>
<header>
  <h1>j<span>Invoice</span> · ${ts}</h1>
  <div class="tabs">
    <button class="tab active" onclick="switchTab('invoices',this)">📋 Invoices</button>
    <button class="tab" onclick="switchTab('buy',this)">🛒 Buy</button>
  </div>
</header>

<!-- Invoices panel -->
<div id="panel-invoices" class="panel active">
  <div style="padding:0 0 4px">
    <input id="search" type="search" placeholder="Search shop, address, item…" autocomplete="off">
    <div id="count" style="margin-top:6px"></div>
  </div>
  <div id="list" style="display:flex;flex-direction:column;gap:10px"></div>
</div>

<!-- Buy panel -->
<div id="panel-buy" class="panel">
  <div class="search-row" style="padding:0 0 4px">
    <input id="buy-search" type="search" placeholder="Search items…" autocomplete="off">
    <input id="buy-pin" type="tel" placeholder="Pincode" maxlength="6" autocomplete="off">
  </div>
  <div id="buy-count" style="font-size:12px;color:var(--text3);margin-bottom:4px"></div>
  <div id="buy-list" style="display:flex;flex-direction:column;gap:8px"></div>
</div>

<script>
const DATA=${dataJson};
const BUY_DATA=${buyJson};

function fmt(v){if(v==null||v===''||v===undefined)return'—';return'₹'+Number(v).toFixed(2);}
function fmtDate(s){if(!s)return'—';try{const d=new Date(s);return d.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});}catch{return s;}}
function esc(s){if(!s)return'—';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function invTitle(d){return d.shopName||d.filename||d.subject||'Unknown';}

// ── Invoice tab ──
function renderInvoices(list){
  const el=document.getElementById('list');
  document.getElementById('count').textContent=list.length+' invoice'+(list.length!==1?'s':'');
  if(list.length===0){el.innerHTML='<div class="empty">No results</div>';return;}
  el.innerHTML=list.map((d,i)=>{
    const isAI=d.source==='claude';
    const items=d.items||[];
    const itemRows=items.map(it=>'<tr><td>'+esc(it.name)+'</td><td>'+fmt(it.amountInr)+'</td></tr>').join('');
    return \`<div class="card\${isAI?' ai':''}" id="c\${i}">
<div class="card-head" onclick="toggle(\${i})">
  <div class="card-title">\${esc(invTitle(d))}\${isAI?'<span class=\\"badge\\">AI</span>':''}</div>
  <div class="card-amount">\${fmt(d.finalPaymentInr)}</div>
</div>
\${d.dateOfPurchase?'<div class="card-date">'+fmtDate(d.dateOfPurchase)+'</div>':''}
<div class="card-body">
  \${d.invoiceNumber?'<div class="field" style="margin-bottom:6px"><label>Invoice No</label><span>'+esc(d.invoiceNumber)+'</span></div>':''}
  \${d.address?'<div class="field" style="margin-bottom:4px"><label>Address</label><span>'+esc(d.address)+'</span></div>':''}
  <div class="row">
    <div class="field"><label>Pincode</label><span>\${esc(d.pincode)}</span></div>
    <div class="field"><label>Phone</label><span>\${esc(d.phone)}</span></div>
  </div>
  <div class="row">
    <div class="field"><label>GST No.</label><span>\${esc(d.gstNumber)}</span></div>
  </div>
  <div class="row">
    <div class="field"><label>GST %</label><span>\${esc(d.gstPercent)}</span></div>
    <div class="field"><label>GST Amt</label><span>\${fmt(d.gstAmountInr)}</span></div>
  </div>
  <div class="row">
    <div class="field"><label>Discount</label><span>\${fmt(d.discountInr)}</span></div>
    <div class="field"><label>Final</label><span style="color:var(--accent);font-weight:700">\${fmt(d.finalPaymentInr)}</span></div>
  </div>
  \${items.length?'<div><table class="items-table"><thead><tr><th>Item</th><th style=\\"text-align:right\\">Amt</th></tr></thead><tbody>'+itemRows+'</tbody></table></div>':''}
</div>
<button class="toggle" onclick="toggle(\${i})">Show details ▾</button>
</div>\`;
  }).join('');
}

function toggle(i){
  const c=document.getElementById('c'+i);
  const open=c.classList.toggle('open');
  c.querySelector('.toggle').textContent=open?'Hide details ▴':'Show details ▾';
}

let filteredInv=DATA;
renderInvoices(DATA);

document.getElementById('search').addEventListener('input',function(){
  const q=this.value.toLowerCase().trim();
  filteredInv=q?DATA.filter(d=>
    (d.shopName||'').toLowerCase().includes(q)||
    (d.address||'').toLowerCase().includes(q)||
    (d.gstNumber||'').toLowerCase().includes(q)||
    (d.invoiceNumber||'').toLowerCase().includes(q)||
    (d.phone||'').toLowerCase().includes(q)||
    (d.filename||'').toLowerCase().includes(q)||
    (d.subject||'').toLowerCase().includes(q)||
    (d.items||[]).some(it=>(it.name||'').toLowerCase().includes(q))
  ):DATA;
  renderInvoices(filteredInv);
});

// ── Buy tab ──
function pinDist(a,b){
  const na=parseInt(a,10),nb=parseInt(b,10);
  if(isNaN(na)||isNaN(nb))return Infinity;
  return Math.abs(na-nb);
}
function distLabel(d){
  if(d===0)return{t:'Same area',c:'#16a34a'};
  if(d<=1000)return{t:'Very near',c:'#22c55e'};
  if(d<=5000)return{t:'Nearby',c:'#84cc16'};
  if(d<=20000)return{t:'Same region',c:'#eab308'};
  return{t:'Far',c:'#94a3b8'};
}

function renderBuy(list,pin){
  const el=document.getElementById('buy-list');
  document.getElementById('buy-count').textContent=list.length+' item'+(list.length!==1?'s':'')+(pin.length===6?' · sorted by distance + price':' · sorted by price');
  if(list.length===0){el.innerHTML='<div class="empty">No items found</div>';return;}
  const pinValid=pin.length===6;
  const sorted=[...list].sort((a,b)=>{
    if(pinValid){
      const da=pinDist(pin,a.pincode||''),db2=pinDist(pin,b.pincode||'');
      if(da!==db2)return da-db2;
    }
    return a.amountInr-b.amountInr;
  });
  el.innerHTML=sorted.map(it=>{
    const dist=pinValid&&it.pincode?distLabel(pinDist(pin,it.pincode)):null;
    const bestBadge=it.isBest?'<span class=\\"badge best\\">BEST PRICE</span>':'';
    const distBadge=dist?'<span style=\\"font-size:11px;font-weight:600;color:'+dist.c+';background:'+dist.c+'18;border-radius:6px;padding:3px 8px;white-space:nowrap\\">'+dist.t+'</span>':'';
    return \`<div class="card\${it.isBest?' best':''}">
<div class="card-head" style="align-items:center">
  <div class="card-title">\${esc(it.name)}\${bestBadge}</div>
  <div class="card-amount\${it.isBest?' best-price':''}">\${fmt(it.amountInr)}</div>
</div>
<div class="card-meta">
  \${it.merchant?'<span>'+esc(it.merchant)+'</span>':''}
  \${it.pincode?'<span>📍 '+esc(it.pincode)+'</span>':''}
  \${it.date?'<span>'+fmtDate(it.date)+'</span>':''}
  \${distBadge}
</div>
</div>\`;
  }).join('');
}

let buyPin='';
renderBuy(BUY_DATA,buyPin);

document.getElementById('buy-search').addEventListener('input',function(){
  const q=this.value.toLowerCase().trim();
  const list=q?BUY_DATA.filter(it=>(it.name||'').toLowerCase().includes(q)||(it.merchant||'').toLowerCase().includes(q)):BUY_DATA;
  renderBuy(list,buyPin);
});
document.getElementById('buy-pin').addEventListener('input',function(){
  buyPin=this.value.replace(/\\D/g,'').slice(0,6);
  const q=document.getElementById('buy-search').value.toLowerCase().trim();
  const list=q?BUY_DATA.filter(it=>(it.name||'').toLowerCase().includes(q)||(it.merchant||'').toLowerCase().includes(q)):BUY_DATA;
  renderBuy(list,buyPin);
});

// ── Tab switch ──
function switchTab(name,btn){
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
  document.getElementById('panel-'+name).classList.add('active');
}
</script>
</body>
</html>`;
}

// ── Upload Modal ──────────────────────────────────────────────────────────────
function UploadModal({ entries, onClose }: { entries: UploadEntry[]; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  const handleCopyJson = async () => {
    await navigator.clipboard.writeText(buildJson(entries));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadJson = () => {
    const ts = new Date().toISOString().slice(0, 10);
    downloadFile(buildJson(entries), `jinvoice-export-${ts}.json`, "application/json");
  };

  const handleDownloadCsv = () => {
    const ts = new Date().toISOString().slice(0, 10);
    downloadFile(buildCsv(entries), `jinvoice-export-${ts}.csv`, "text/csv");
  };

  const handleDownloadHtml = () => {
    const ts = new Date().toISOString().slice(0, 10);
    downloadFile(buildMobileHtml(entries), `jinvoice-mobile-${ts}.html`, "text/html");
  };

  const valStyle: React.CSSProperties = { fontSize: 13, color: "var(--color-text)", fontWeight: 500 };
  const labelStyle: React.CSSProperties = { fontSize: 10.5, fontWeight: 600, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 2 };
  const thStyle: React.CSSProperties = { fontSize: 12, color: "var(--color-text-secondary)", textAlign: "left", padding: "3px 6px 5px 0", fontWeight: 600 };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--split">
        <div className="modal-body">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <h2>Upload to jInvoice</h2>
          <button className="btn-sm" onClick={onClose} style={{ padding: "4px 10px" }}>✕</button>
        </div>
        <p className="modal-subtitle">{entries.length} invoice{entries.length !== 1 ? "s" : ""} selected</p>

        {entries.map((entry, idx) => {
          const d = resolveEntry(entry);
          const rec = entry.rec;
          const fmtInr = (v: number | null | undefined) => v != null ? `₹${v.toFixed(2)}` : "—";
          // Guard: merchantName may contain a large text blob if extraction failed
          const shopName = (d.shopName && d.shopName.length <= 120) ? d.shopName : null;
          const address  = (d.address  && d.address.length  <= 300) ? d.address  : null;
          return (
            <div key={rec.id ?? idx} style={{
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-sm)",
              padding: "14px 16px",
              marginBottom: 12,
              background: "var(--color-surface-2)",
            }}>
              {/* Filename heading + date */}
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: "var(--color-text)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {cardHeading(rec)}
                </div>
                <div style={{ fontSize: 12, color: "var(--color-text-secondary)", flexShrink: 0 }}>
                  {d.dateOfPurchase ? formatDate(d.dateOfPurchase) : "—"}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 20px", marginBottom: entry.items.length ? 12 : 0 }}>
                {shopName && (
                  <div style={{ gridColumn: "1 / -1" }}>
                    <div style={labelStyle}>Shop Name</div>
                    <div style={valStyle}>{shopName}</div>
                  </div>
                )}
                {d.invoiceNumber && (
                  <div>
                    <div style={labelStyle}>Invoice No</div>
                    <div style={valStyle}>{d.invoiceNumber}</div>
                  </div>
                )}
                {d.phone && (
                  <div>
                    <div style={labelStyle}>Phone</div>
                    <div style={valStyle}>{d.phone}</div>
                  </div>
                )}
                <div style={{ gridColumn: "1 / -1" }}>
                  <div style={labelStyle}>Address</div>
                  <div style={valStyle}>{address ?? "—"}</div>
                </div>
                <div>
                  <div style={labelStyle}>Pincode</div>
                  <div style={valStyle}>{d.pincode ?? "—"}</div>
                </div>
                <div>
                  <div style={labelStyle}>GST Number</div>
                  <div style={valStyle}>{d.gstNumber ?? "—"}</div>
                </div>
                <div>
                  <div style={labelStyle}>GST %</div>
                  <div style={valStyle}>{d.gstPercent ?? "—"}</div>
                </div>
                <div>
                  <div style={labelStyle}>GST Amount</div>
                  <div style={valStyle}>{fmtInr(d.gstAmountInr)}</div>
                </div>
                <div>
                  <div style={labelStyle}>Discount</div>
                  <div style={valStyle}>{fmtInr(d.discountInr)}</div>
                </div>
                <div>
                  <div style={labelStyle}>Final Payment</div>
                  <div style={{ ...valStyle, color: "var(--color-primary)", fontSize: 15 }}>{fmtInr(d.finalPaymentInr)}</div>
                </div>
              </div>

              {entry.items.length > 0 && (
                <div style={{ overflowX: "auto" }}>
                  <div style={{ ...labelStyle, marginBottom: 6 }}>Items ({entry.items.length})</div>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                        <th style={thStyle}>Item Name</th>
                        <th style={{ ...thStyle, textAlign: "right" }}>Qty</th>
                        <th style={{ ...thStyle, textAlign: "right" }}>Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entry.items.map((it, i) => {
                        const nameIsGarbled = it.name.length > 150;
                        const displayName = nameIsGarbled ? it.name.slice(0, 120) + "…" : it.name;
                        return (
                          <tr key={i} style={{ borderBottom: "1px solid var(--color-border)" }}>
                            <td style={{ padding: "5px 6px 5px 0", color: nameIsGarbled ? "var(--color-text-secondary)" : "var(--color-text)", fontStyle: nameIsGarbled ? "italic" : "normal" }}>
                              {displayName}
                              {nameIsGarbled && <span style={{ marginLeft: 6, fontSize: 10, color: "#f59e0b", fontWeight: 700, fontStyle: "normal" }}>⚠ garbled</span>}
                            </td>
                            <td style={{ padding: "5px 0", color: "var(--color-text-secondary)", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{it.quantity}</td>
                            <td style={{ padding: "5px 0 5px 6px", color: "var(--color-text)", textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 500 }}>
                              {fmtInr(it.totalPricePaise / 100)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
        </div>{/* /modal-body */}

        <div className="modal-footer-bar">
          <button className="btn-sync-primary" onClick={handleDownloadJson}>Download JSON</button>
          <button className="btn-sync-primary" onClick={handleDownloadCsv}>Download CSV</button>
          <button className="btn-sync" onClick={handleCopyJson}>{copied ? "Copied!" : "Copy JSON"}</button>
          <button className="btn-sync" onClick={handleDownloadHtml}>📱 Mobile HTML</button>
        </div>
      </div>
    </div>
  );
}


// ── ViewScreen ────────────────────────────────────────────────────────────────
export function ViewScreen() {
  const [records, setRecords] = useState<InvoiceMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<SortKey>("newest");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [preparing, setPreparing] = useState(false);
  const [cloudSyncing, setCloudSyncing] = useState(false);
  const [cloudSyncMsg, setCloudSyncMsg] = useState<string | null>(null);
  const [uploadEntries, setUploadEntries] = useState<UploadEntry[] | null>(null);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [filterClient, setFilterClient] = useState<string | null>(null);
  const [taggingId, setTaggingId] = useState<number | null>(null);
  const [taggingPos, setTaggingPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [clientTags, setClientTags] = useState<string[]>(() => prefs.clientTags);
  const [newClientName, setNewClientName] = useState("");
  const [bulkTaggingOpen, setBulkTaggingOpen] = useState(false);
  const [bulkTagPos, setBulkTagPos] = useState<{ bottom: number; left: number }>({ bottom: 0, left: 0 });
  const [bulkNewClientName, setBulkNewClientName] = useState("");
  const [filterProject, setFilterProject] = useState<string | null>(null);
  const [projectTags, setProjectTags] = useState<string[]>(() => prefs.projects);
  const [projectTaggingId, setProjectTaggingId] = useState<number | null>(null);
  const projectTaggingPos = { top: 0, left: 0 };
  const [newProjectName, setNewProjectName] = useState("");
  const [detailRec, setDetailRec] = useState<InvoiceMeta | null>(null);
  const [detailItems, setDetailItems] = useState<LineItemRow[]>([]);
  const [detailCategory, setDetailCategory] = useState<string>("");
  const [isPreviewMode, setIsPreviewMode] = useState(false);
  const [previewExtracted, setPreviewExtracted] = useState<ExtractedInvoice | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewSubmitting, setPreviewSubmitting] = useState(false);
  const [previewCloudSaving, setPreviewCloudSaving] = useState(false);
  const [aiExtracting, setAiExtracting] = useState(false);
  const [bulkState, setBulkState] = useState<BulkState>(() => getBulkExtractionState());
  const [warrantyItems, setWarrantyItems] = useState<WarrantyPromptItem[]>([]);
  const pendingBulkIds = useRef<number[]>([]);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [billIssues, setBillIssues] = useState<Map<number, BillIssue[]>>(new Map());
  const [syncingId, setSyncingId] = useState<number | null>(null);
  const hasLoadedRef = useRef(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => {
    // Only show the full-page loading screen on the very first load.
    // Subsequent refreshes keep the existing list visible.
    if (!hasLoadedRef.current) setLoading(true);
    db.invoices.orderBy("id").reverse().toArray()
      .then((recs) => {
        hasLoadedRef.current = true;
        setRecords(recs);
        runBillChecksForAll(recs).then(setBillIssues).catch(console.error);
      })
      .catch(console.error)
      .finally(() => { setLoading(false); setRefreshing(false); });
  }, []);

  // After extraction, collect warranty sentinels for the given invoice IDs and show the prompt.
  const checkWarrantyPrompt = async (invoiceIds: number[]) => {
    const items: WarrantyPromptItem[] = [];
    for (const id of invoiceIds) {
      const inv = await db.invoices.get(id);
      if (!inv || inv.status === "duplicate" || inv.status === "extraction_failed") continue;
      const sentinel = await getWarrantySentinel(id);
      if (!sentinel) continue;
      const dbItems = await db.lineItems.where("invoiceId").equals(id).toArray();
      const productName = dbItems[0]?.name ?? inv.merchantName ?? "Unknown product";
      items.push({
        sentinelId: sentinel.id ?? null,
        invoiceId: id,
        productName,
        merchantName: inv.merchantName,
        expiresAt: sentinel.expiresAt,
      });
    }
    if (items.length > 0) setWarrantyItems(items);
  };

  useEffect(() => {
    load();
    desktopConnector.preloadHandle();
    const onSyncComplete = () => {
      load();
      // Bulk extraction warranty check — triggered when bulk run finishes
      const ids = pendingBulkIds.current;
      if (ids.length > 0) {
        pendingBulkIds.current = [];
        checkWarrantyPrompt(ids);
      }
    };
    window.addEventListener("jinvoice:sync-complete", onSyncComplete);
    window.addEventListener("jinvoice:sync-progress", load);
    const onBulkProgress = (e: Event) => {
      setBulkState((e as CustomEvent<BulkState>).detail);
    };
    window.addEventListener("jinvoice:bulk-extract-progress", onBulkProgress);
    return () => {
      window.removeEventListener("jinvoice:sync-complete", onSyncComplete);
      window.removeEventListener("jinvoice:sync-progress", load);
      window.removeEventListener("jinvoice:bulk-extract-progress", onBulkProgress);
    };
  }, []);

  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const [confirmDelete, setConfirmDelete] = useState(false);

  const buildSuggestedFilename = (rec: InvoiceMeta): string => {
    const sanitize = (s: string) => (s || "").replace(/[/\\:*?"<>|]/g, "_").replace(/\s+/g, "_").trim();
    const parts: string[] = [];
    if (rec.merchantName)  parts.push(sanitize(rec.merchantName).slice(0, 40));
    if (rec.invoiceDate)   parts.push(sanitize(rec.invoiceDate));
    if (rec.invoiceNumber) parts.push(sanitize(rec.invoiceNumber).slice(0, 20));
    if (!parts.length) {
      const raw = rec.sourceFilename ?? "";
      return raw.replace(/\.pdf$/i, "");
    }
    return parts.join("_");
  };

  const startRename = (e: React.MouseEvent, rec: InvoiceMeta) => {
    e.preventDefault();
    e.stopPropagation();
    setRenamingId(rec.id!);
    setRenameValue(buildSuggestedFilename(rec));
  };

  const saveRename = async () => {
    if (renamingId == null) return;
    let name = renameValue.trim();
    if (!name) { setRenamingId(null); setRenameValue(""); return; }

    // Preserve .pdf extension
    const rec = records.find((r) => r.id === renamingId);
    const oldName = rec?.sourceFilename ?? "";
    if (oldName.toLowerCase().endsWith(".pdf") && !name.toLowerCase().endsWith(".pdf")) {
      name = name + ".pdf";
    }

    await db.invoices.update(renamingId, { sourceFilename: name, isRenamed: true, updatedAt: new Date().toISOString() });

    // Also rename the file on disk if it was saved to the desktop folder
    if (oldName && oldName !== name) {
      await desktopConnector.renameFileInFolder(oldName, name);
    }

    load();
    // Notify AlertsScreen (and other screens) to reload with the new filename
    window.dispatchEvent(new Event("jinvoice:sync-complete"));
    setRenamingId(null);
    setRenameValue("");
  };

  const openTagging = (e: React.MouseEvent<HTMLButtonElement>, rec: InvoiceMeta) => {
    e.preventDefault();
    e.stopPropagation();
    const r = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
    setTaggingPos({ top: r.bottom + 4, left: r.left });
    setTaggingId(rec.id!);
    setNewClientName("");
  };

  const toggleClientTag = async (invoiceId: number, tag: string | null) => {
    const rec = records.find((r) => r.id === invoiceId);
    let newTags: string[];
    if (tag === null) {
      newTags = [];
    } else {
      const current = rec?.clientTags ?? [];
      newTags = current.includes(tag)
        ? current.filter((t) => t !== tag)
        : [...current, tag].sort();
    }
    await db.invoices.update(invoiceId, { clientTags: newTags, updatedAt: new Date().toISOString() });
    if (tag && !clientTags.includes(tag)) {
      const next = [...clientTags, tag].sort();
      prefs.clientTags = next;
      setClientTags(next);
    }
    load();
    setNewClientName("");
  };

  const assignProjectTag = async (invoiceId: number, project: string | null) => {
    const rec = records.find((r) => r.id === invoiceId);
    const newTag = rec?.projectTag === project ? null : project;
    await db.invoices.update(invoiceId, { projectTag: newTag, updatedAt: new Date().toISOString() });
    if (project && !projectTags.includes(project)) {
      const next = [...projectTags, project].sort();
      prefs.projects = next;
      setProjectTags(next);
    }
    load();
    setNewProjectName("");
  };

  const openDetail = async (e: React.MouseEvent, rec: InvoiceMeta) => {
    e.preventDefault();
    e.stopPropagation();
    const items = await db.lineItems.where("invoiceId").equals(rec.id!).toArray();
    setDetailItems(items);
    setDetailRec(rec);
    setDetailCategory(rec.category ?? "");
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setPreviewLoading(true);
    try {
      const result = await extractFilePreview(file);
      if (result.kind === "success" || result.kind === "lowConfidence") {
        const inv = result.invoice;
        const fakeMeta = {
          merchantName: inv.merchantName,
          merchantAddress: inv.merchantAddress,
          merchantGstin: inv.merchantGstin,
          merchantPhone: inv.merchantPhone ?? null,
          merchantPincode: inv.merchantPincode ?? null,
          platform: inv.platform ?? null,
          invoiceNumber: inv.invoiceNumber,
          invoiceDate: inv.invoiceDate,
          subtotalPaise: inv.subtotalPaise,
          taxPaise: inv.taxPaise,
          discountPaise: inv.discountPaise ?? 0,
          grandTotalPaise: inv.grandTotalPaise,
          pdfSourceType: inv.sourceType,
          importSource: "manual_upload",
          status: "pending_review",
          sourceFilename: file.name,
          paymentMode: inv.paymentMode,
          importRecordId: null,
          docType: "invoice",
          docTypes: ["invoice"],
          category: undefined,
          clientTags: [],
          subject: "Unknown",
          senderEmail: "Manual",
          receivedAt: undefined,
          isRenamed: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        } as InvoiceMeta;
        const fakeItems: LineItemRow[] = inv.lineItems.map((li, i) => ({
          id: i,
          invoiceId: 0,
          name: li.name,
          quantity: li.quantity,
          unitPricePaise: li.unitPricePaise,
          totalPricePaise: li.totalPricePaise,
          discountPaise: li.discountPaise ?? 0,
        }));
        setPreviewExtracted(inv);
        setDetailItems(fakeItems);
        setDetailRec(fakeMeta);
        setIsPreviewMode(true);
      }
    } catch (err) {
      console.error("[Preview upload]", err);
    } finally {
      setPreviewLoading(false);
    }
  };

  const closeDetailPanel = () => {
    setDetailRec(null);
    setIsPreviewMode(false);
    setPreviewExtracted(null);
  };

  const openBulkTagging = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    setBulkTagPos({ bottom: window.innerHeight - r.top + 4, left: r.left });
    setBulkTaggingOpen(true);
    setBulkNewClientName("");
  };

  const bulkToggleClientTag = async (tag: string | null) => {
    const selectedIds = [...selected];
    const allHaveTag = tag !== null && selectedIds.every((id) => {
      const rec = records.find((r) => r.id === id);
      return rec?.clientTags?.includes(tag) ?? false;
    });
    for (const id of selectedIds) {
      const rec = records.find((r) => r.id === id);
      let newTags: string[];
      if (tag === null) {
        newTags = [];
      } else {
        const current = rec?.clientTags ?? [];
        newTags = allHaveTag
          ? current.filter((t) => t !== tag)
          : current.includes(tag) ? current : [...current, tag].sort();
      }
      await db.invoices.update(id, { clientTags: newTags, updatedAt: new Date().toISOString() });
    }
    if (tag && !clientTags.includes(tag)) {
      const next = [...clientTags, tag].sort();
      prefs.clientTags = next;
      setClientTags(next);
    }
    load();
    setBulkNewClientName("");
  };

  const handleDelete = async () => {
    const toDelete = records.filter((r) => r.id != null && selected.has(r.id));
    await db.transaction("rw", db.invoices, db.lineItems, db.rawTexts, async () => {
      for (const rec of toDelete) {
        await db.lineItems.where("invoiceId").equals(rec.id!).delete();
        await db.rawTexts.where("invoiceId").equals(rec.id!).delete();
        await db.invoices.delete(rec.id!);
      }
    });
    for (const rec of toDelete) {
      if (rec.sourceFilename) {
        await desktopConnector.deleteFileFromFolder(rec.sourceFilename).catch(() => {});
      }
    }
    setSelected(new Set());
    setConfirmDelete(false);
    load();
  };

  const handleUpload = async () => {
    setPreparing(true);
    const selectedRecords = records.filter((r) => r.id != null && selected.has(r.id));
    const entries: UploadEntry[] = [];
    for (const rec of selectedRecords) {
      const items = await db.lineItems.where("invoiceId").equals(rec.id!).toArray();
      entries.push({
        rec,
        items,
        pincode: extractPincode(rec.merchantAddress),
        discountPct: discountPercent(rec.discountPaise, rec.grandTotalPaise),
        claude: null,
      });
    }
    setUploadEntries(entries);
    setPreparing(false);
  };

  const handleSaveToCloud = async () => {
    if (!isSupabaseEnabled()) return;
    setCloudSyncing(true);
    setCloudSyncMsg(null);
    let ok = 0, fail = 0;
    for (const id of selected) {
      try { await syncNewInvoice(id); ok++; }
      catch { fail++; }
    }
    setCloudSyncing(false);
    setCloudSyncMsg(fail === 0 ? `${ok} invoice${ok !== 1 ? "s" : ""} saved to cloud.` : `${ok} saved, ${fail} failed.`);
    setTimeout(() => setCloudSyncMsg(null), 3000);
  };

  const handleBulkExtract = () => {
    // Only extract selected records that still need extraction; skip already-imported ones
    const ids = records
      .filter((r) => r.id != null && selected.has(r.id) && r.status === "pending_extraction")
      .map((r) => r.id!);
    if (ids.length === 0) return;
    pendingBulkIds.current = ids;   // saved so warranty prompt can check them when bulk completes
    runBulkExtraction(ids);
  };

  if (loading) return <div className="placeholder-screen"><p>Loading…</p></div>;

  if (records.length === 0) {
    return (
      <div className="placeholder-screen">
        <span>📋</span>
        <p>No files imported yet.</p>
      </div>
    );
  }

  const allClients  = [...new Set(records.flatMap((r) => r.clientTags ?? []))].sort();
  const allProjects = [...new Set(records.filter((r) => r.projectTag).map((r) => r.projectTag!))].sort();
  const filtered = records
    .filter((r) => filterClient == null || (r.clientTags ?? []).includes(filterClient))
    .filter((r) => filterProject == null || r.projectTag === filterProject)
    .filter((r) => !query.trim() || matchesQuery(r, query.trim()));
  const sorted   = sortRecords(filtered, sortBy);
  const allSelected = sorted.length > 0 && sorted.every((r) => r.id != null && selected.has(r.id));

  const toggleAll = () => {
    if (allSelected) {
      setSelected((prev) => {
        const next = new Set(prev);
        sorted.forEach((r) => r.id != null && next.delete(r.id));
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        sorted.forEach((r) => r.id != null && next.add(r.id));
        return next;
      });
    }
  };

  return (
    <>
      {warrantyItems.length > 0 && (
        <WarrantyPromptModal
          items={warrantyItems}
          onDone={() => setWarrantyItems([])}
        />
      )}
      <div className="invoice-list" style={{ paddingBottom: selected.size > 0 ? 72 : 20 }}>
        <div className="invoice-list-header">
          <h2>All Files</h2>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
              {sorted.length}{query.trim() ? `/${records.length}` : ""} records
            </span>
            <button className="btn-sm" onClick={toggleAll}>
              {allSelected ? "Deselect all" : "Select all"}
            </button>
            <input
                ref={uploadInputRef}
                type="file"
                accept=".pdf"
                style={{ display: "none" }}
                onChange={handleFileChange}
              />
              <button className="btn-sm" onClick={() => uploadInputRef.current?.click()} disabled={previewLoading}>
                {previewLoading ? "Extracting…" : "+ Upload PDF"}
              </button>
            {(() => {
              const selectedPending = records.filter(
                (r) => r.id != null && selected.has(r.id) && r.status === "pending_extraction"
              );
              const hasWork = bulkState.running || selectedPending.length > 0;
              return (
                <button
                  className="btn-sm"
                  disabled={bulkState.running || selectedPending.length === 0}
                  style={{ background: "#8b5cf6", color: "#fff", border: "none", fontWeight: 700, opacity: hasWork ? 1 : 0.5 }}
                  onClick={handleBulkExtract}
                >
                  {bulkState.running
                    ? `Extracting ${bulkState.done}/${bulkState.total}…`
                    : selectedPending.length > 0 ? `Extract AI (${selectedPending.length})` : "Extract AI"}
                </button>
              );
            })()}
            <button className="btn-sm" onClick={() => { setRefreshing(true); load(); }} disabled={refreshing}>
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>
        <input
          className="view-search"
          type="search"
          placeholder="Search merchant, subject, sender…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {allClients.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, overflowX: "auto", marginBottom: 6, paddingBottom: 2 }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em", flexShrink: 0 }}>Client</span>
            <button
              onClick={() => setFilterClient(null)}
              style={{ fontSize: 12, padding: "3px 10px", borderRadius: 20, border: "1.5px solid", borderColor: filterClient == null ? "var(--color-primary)" : "var(--color-border)", background: filterClient == null ? "var(--accent-subtle)" : "transparent", color: filterClient == null ? "var(--color-primary)" : "var(--color-text-secondary)", cursor: "pointer", flexShrink: 0 }}
            >All</button>
            {allClients.map((c) => (
              <button key={c}
                onClick={() => setFilterClient(c === filterClient ? null : c)}
                style={{ fontSize: 12, padding: "3px 10px", borderRadius: 20, border: "1.5px solid", borderColor: filterClient === c ? "#0891b2" : "var(--color-border)", background: filterClient === c ? "#ecfeff" : "transparent", color: filterClient === c ? "#0891b2" : "var(--color-text-secondary)", cursor: "pointer", flexShrink: 0 }}
              >{c}</button>
            ))}
          </div>
        )}
        {prefs.isProActive && allProjects.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, overflowX: "auto", marginBottom: 6, paddingBottom: 2 }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em", flexShrink: 0 }}>Project</span>
            <button
              onClick={() => setFilterProject(null)}
              style={{ fontSize: 12, padding: "3px 10px", borderRadius: 20, border: "1.5px solid", borderColor: filterProject == null ? "#059669" : "var(--color-border)", background: filterProject == null ? "#ecfdf5" : "transparent", color: filterProject == null ? "#059669" : "var(--color-text-secondary)", cursor: "pointer", flexShrink: 0 }}
            >All</button>
            {allProjects.map((p) => (
              <button key={p}
                onClick={() => setFilterProject(p === filterProject ? null : p)}
                style={{ fontSize: 12, padding: "3px 10px", borderRadius: 20, border: "1.5px solid", borderColor: filterProject === p ? "#059669" : "var(--color-border)", background: filterProject === p ? "#ecfdf5" : "transparent", color: filterProject === p ? "#059669" : "var(--color-text-secondary)", cursor: "pointer", flexShrink: 0 }}
              >📁 {p}</button>
            ))}
          </div>
        )}
        <div className="view-sort-row" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {([
            {
              label: "Date",
              active: sortBy === "newest" || sortBy === "oldest",
              arrow: sortBy === "oldest" ? " ↑" : sortBy === "newest" ? " ↓" : "",
              onClick: () => setSortBy(sortBy === "newest" ? "oldest" : "newest"),
            },
            {
              label: "Name",
              active: sortBy === "name" || sortBy === "name_desc",
              arrow: sortBy === "name_desc" ? " ↑" : sortBy === "name" ? " ↓" : "",
              onClick: () => setSortBy(sortBy === "name" ? "name_desc" : "name"),
            },
            {
              label: "Amount",
              active: sortBy === "amount_desc" || sortBy === "amount_asc",
              arrow: sortBy === "amount_asc" ? " ↑" : sortBy === "amount_desc" ? " ↓" : "",
              onClick: () => setSortBy(sortBy === "amount_desc" ? "amount_asc" : "amount_desc"),
            },
            {
              label: "Folder",
              active: sortBy === "folder" || sortBy === "folder_desc",
              arrow: sortBy === "folder_desc" ? " ↑" : sortBy === "folder" ? " ↓" : "",
              onClick: () => setSortBy(sortBy === "folder" ? "folder_desc" : "folder"),
            },
          ] as { label: string; active: boolean; arrow: string; onClick: () => void }[]).map(({ label, active, arrow, onClick }) => (
            <button
              key={label}
              onClick={onClick}
              style={{
                fontSize: 12,
                fontWeight: active ? 600 : 400,
                padding: "4px 10px",
                borderRadius: 20,
                border: "1.5px solid",
                borderColor: active ? "var(--color-primary)" : "var(--color-border)",
                background: active ? "var(--accent-subtle)" : "transparent",
                color: active ? "var(--color-primary)" : "var(--color-text-secondary)",
                cursor: "pointer",
                transition: "all .15s",
              }}
            >
              {label}{arrow}
            </button>
          ))}
        </div>
        {sorted.length === 0 && (
          <p style={{ fontSize: 13, color: "var(--color-text-secondary)", textAlign: "center", marginTop: 32 }}>
            No results for "{query}"
          </p>
        )}
        {(() => {
          let lastFolder: string | null = null;
          return sorted.map((rec) => {
          const isSelected = rec.id != null && selected.has(rec.id);
          const metaStyle: React.CSSProperties = { fontSize: 11.5, color: "var(--color-text-secondary)" };
          const labelStyle: React.CSSProperties = { fontSize: 10.5, fontWeight: 600, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.04em", marginRight: 3 };
          const isFolderSort = sortBy === "folder" || sortBy === "folder_desc";
          const currentFolderKey = folderGroupKey(rec);
          const showFolderHeader = isFolderSort && currentFolderKey !== lastFolder;
          const isFirstFolder = showFolderHeader && lastFolder === null;
          if (isFolderSort) lastFolder = currentFolderKey;
          return (
            <React.Fragment key={rec.id}>
            {showFolderHeader && (
              <div
                className="sentinel-section-label"
                style={isFirstFolder ? undefined : { borderTop: "1px solid var(--color-border)", paddingTop: 12, marginTop: 8 }}
              >
                {formatFolderGroup(rec)}
              </div>
            )}
            <label
              key={rec.id}
              className="view-card"
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                cursor: "pointer",
                ...(isSelected ? { borderColor: "var(--color-primary)", background: "var(--accent-subtle)" } : {}),
              }}
            >
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => rec.id != null && toggleSelect(rec.id)}
                style={{ marginTop: 3, accentColor: "var(--color-primary)", width: 15, height: 15, flexShrink: 0, cursor: "pointer" }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                {/* Line 1: title + renamed badge + rename button */}
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                  <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "baseline", gap: 5 }}>
                    <span className="view-card-title" style={{ minWidth: 0 }}>{cardHeading(rec)}</span>
                    {rec.isRenamed && (
                      <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", color: "#7c3aed", background: "#f3eeff", border: "1px solid #c4b5fd", borderRadius: 4, padding: "1px 5px", lineHeight: 1.4 }}>
                        Renamed
                      </span>
                    )}
                  </div>
                  <button
                    title="Rename file"
                    onClick={(e) => startRename(e, rec)}
                    style={{ flexShrink: 0, background: "none", border: "none", cursor: "pointer", color: "var(--color-text-tertiary)", padding: "2px 4px", fontSize: 13, lineHeight: 1 }}
                  >✎</button>
                  <button
                    title="Assign client"
                    onClick={(e) => openTagging(e, rec)}
                    style={{ flexShrink: 0, background: "none", border: "none", cursor: "pointer", color: rec.clientTags?.length ? "#0891b2" : "var(--color-text-tertiary)", padding: "2px 4px", fontSize: 13, lineHeight: 1 }}
                  >🏷</button>
                  <button
                    title="View extraction details"
                    onClick={(e) => openDetail(e, rec)}
                    style={{ flexShrink: 0, background: "none", border: "none", cursor: "pointer", color: "var(--color-text-tertiary)", padding: "2px 4px", fontSize: 13, lineHeight: 1 }}
                  >👁</button>
                </div>
                {/* Line 2: source (with account email) + doctype + status chips + amount */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 5 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
                    <span className="view-chip view-chip--source" style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={formatSourceWithEmail(rec.importSource, rec.accountEmail)}>
                      {formatSourceWithEmail(rec.importSource, rec.accountEmail)}
                    </span>
                    {rec.docType && rec.status !== "pending_extraction" && (
                      <span className="view-chip" style={{ color: "#6d28d9", borderColor: "#c4b5fd", background: "#f3eeff", fontWeight: 700, flexShrink: 0 }}>
                        {DOC_TYPE_LABELS[rec.docType as keyof typeof DOC_TYPE_LABELS] ?? rec.docType}
                      </span>
                    )}
                    {(rec.clientTags ?? []).map((tag) => (
                      <span key={tag} className="view-chip" style={{ color: "#0891b2", borderColor: "#0891b2", background: "#ecfeff", display: "inline-flex", alignItems: "center", gap: 2 }}>
                        {tag}
                        <button
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); rec.id != null && toggleClientTag(rec.id, tag); }}
                          style={{ background: "none", border: "none", cursor: "pointer", padding: "0 1px", fontSize: 11, color: "#0891b2", lineHeight: 1, flexShrink: 0 }}
                          title="Remove tag"
                        >×</button>
                      </span>
                    ))}
                    {rec.projectTag && (
                      <span className="view-chip" style={{ color: "#059669", borderColor: "#059669", background: "#ecfdf5" }}>{rec.projectTag}</span>
                    )}
                    <span className="view-chip" style={{ color: statusColor(rec.status), borderColor: statusColor(rec.status) }}>
                      {statusText(rec.status)}
                    </span>
                    {rec.id != null && (billIssues.get(rec.id) ?? []).map((issue, i) => {
                      const dupRec = issue.type === "duplicate" && issue.duplicateId != null
                        ? records.find((r) => r.id === issue.duplicateId) : null;
                      const dupName = dupRec ? cardHeading(dupRec) : null;
                      return (
                        <span key={i} className="view-chip" style={{
                          color: issue.severity === "error" ? "#dc2626" : "#d97706",
                          borderColor: issue.severity === "error" ? "#dc2626" : "#d97706",
                          background: issue.severity === "error" ? "#fee2e2" : "#fef3c7",
                          maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }} title={issue.message}>
                          {issue.type === "duplicate"
                            ? `⚠ Dup: ${dupName ? dupName.slice(0, 24) + (dupName.length > 24 ? "…" : "") : "#" + issue.duplicateId}`
                            : "⚠ Fraud Risk"}
                        </span>
                      );
                    })}
                  </div>
                  <span className="view-card-amount">{formatAmount(rec.grandTotalPaise)}</span>
                </div>
                {/* Extraction note (blurry image, local-only, etc.) */}
                {rec.extractionNote && (
                  <div style={{
                    fontSize: 11,
                    color: rec.status === "extraction_failed" ? "#ef4444" : "#6b7280",
                    fontStyle: "italic",
                    marginBottom: 3,
                    lineHeight: 1.4,
                  }}>
                    {rec.extractionNote}
                  </div>
                )}
                {/* Line 3: Subject (word-wrap) + Received date */}
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 2, ...metaStyle }}>
                  <span style={{ flex: 1, minWidth: 0, wordBreak: "break-word", whiteSpace: "normal" }}>
                    <span style={labelStyle}>Subject</span>{rec.subject ?? "—"}
                  </span>
                  <span style={{ flexShrink: 0 }}>
                    <span style={labelStyle}>Received</span>{rec.receivedAt ? formatDate(rec.receivedAt) : formatDate(rec.createdAt)}
                  </span>
                </div>
                {/* Line 4: Received from */}
                <div style={{ display: "flex", alignItems: "center", gap: 12, ...metaStyle }}>
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    <span style={labelStyle}>Received</span>{rec.senderEmail ?? "—"}
                  </span>
                </div>
              </div>
            </label>
            </React.Fragment>
          );
          });
        })()}
      </div>

      {/* Sticky action bar */}
      {selected.size > 0 && (
        <div className="upload-action-bar">
          <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
            {selected.size} selected
          </span>
          <button
            className="btn-sm"
            onClick={() => setSelected(new Set())}
            style={{ marginLeft: "auto" }}
          >
            Clear
          </button>
          <button
            onClick={() => setConfirmDelete(true)}
            style={{ fontSize: 13, padding: "6px 16px", borderRadius: "var(--radius-sm)", border: "1.5px solid #ef4444", background: "transparent", color: "#ef4444", cursor: "pointer", fontWeight: 600 }}
          >
            Delete ({selected.size})
          </button>
          <button
            className="btn-sm"
            onClick={openBulkTagging}
          >
            🏷 Tag
          </button>
          {isSupabaseEnabled() && (() => {
            const selectedRecords = records.filter((r) => r.id != null && selected.has(r.id!));
            const anyS = selectedRecords.some((r) => detectSensitiveData(r).sensitive);
            return anyS ? (
              <button
                disabled
                title="One or more selected invoices contain sensitive/personal data and cannot be uploaded."
                style={{ fontSize: 13, padding: "6px 14px", whiteSpace: "nowrap", width: "auto", borderRadius: 6, border: "1px solid #fca5a5", background: "#fee2e2", color: "#b91c1c", fontWeight: 600, cursor: "not-allowed", opacity: 0.75 }}
              >
                ☁ Save to Cloud
              </button>
            ) : (
              <button
                className="btn-sm"
                onClick={handleSaveToCloud}
                disabled={cloudSyncing}
                style={{ fontSize: 13, padding: "6px 14px", whiteSpace: "nowrap", width: "auto" }}
              >
                {cloudSyncing ? "Saving…" : cloudSyncMsg ?? "☁ Save to Cloud"}
              </button>
            );
          })()}
          {(() => {
            const hasSelectedInvoices = records.some(
              (r) => r.id != null && selected.has(r.id) &&
              ((r.docTypes ?? (r.docType ? [r.docType] : [])).some((t) => t === "invoice") || r.docType === "invoice")
            );
            if (!hasSelectedInvoices) return null;
            return (
              <button
                className="btn-sync-primary"
                onClick={handleUpload}
                disabled={preparing}
                style={{ fontSize: 13, padding: "6px 14px", whiteSpace: "nowrap", width: "auto" }}
              >
                {preparing ? "…" : "Upload to Cloud"}
              </button>
            );
          })()}
        </div>
      )}

      {uploadEntries && (
        <UploadModal entries={uploadEntries} onClose={() => setUploadEntries(null)} />
      )}

      {confirmDelete && (
        <div className="modal-overlay" onClick={() => setConfirmDelete(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 380 }}>
            <h2 style={{ marginBottom: 8 }}>Delete {selected.size} invoice{selected.size !== 1 ? "s" : ""}?</h2>
            <p style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 20 }}>
              This will permanently remove the selected record{selected.size !== 1 ? "s" : ""} and all associated line items. This cannot be undone.
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn-ghost-sm" onClick={() => setConfirmDelete(false)}>Cancel</button>
              <button
                onClick={handleDelete}
                style={{ fontSize: 13, padding: "6px 16px", borderRadius: "var(--radius-sm)", border: "none", background: "#ef4444", color: "#fff", cursor: "pointer", fontWeight: 600 }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {renamingId != null && (
        <div className="modal-overlay" onClick={() => { setRenamingId(null); setRenameValue(""); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <h2 style={{ marginBottom: 4 }}>Rename File</h2>
            {(() => {
              const rec = records.find((r) => r.id === renamingId);
              const orig = rec?.sourceFilename;
              return orig ? (
                <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 10 }}>
                  Current: <span style={{ fontStyle: "italic" }}>{orig}</span>
                </p>
              ) : null;
            })()}
            <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 6 }}>Suggested from invoice data — edit or accept:</p>
            <input
              autoFocus
              className="settings-input"
              style={{ width: "100%", marginBottom: 12 }}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") saveRename(); if (e.key === "Escape") { setRenamingId(null); setRenameValue(""); } }}
              placeholder="File name (without .pdf)"
            />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn-ghost-sm" onClick={() => { setRenamingId(null); setRenameValue(""); }}>Cancel</button>
              <button className="btn-primary" onClick={saveRename} disabled={!renameValue.trim()}>Save</button>
            </div>
          </div>
        </div>
      )}


      {bulkTaggingOpen && (() => {
        const selectedIds = [...selected];
        return (
          <>
            <div style={{ position: "fixed", inset: 0, zIndex: 199 }} onClick={() => setBulkTaggingOpen(false)} />
            <div style={{ position: "fixed", bottom: bulkTagPos.bottom, left: bulkTagPos.left, zIndex: 200, background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 8, boxShadow: "0 -4px 16px rgba(0,0,0,.14)", minWidth: 220, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em", padding: "8px 12px 4px" }}>
                Tag {selectedIds.length} selected
              </div>
              {clientTags.length === 0 && (
                <div style={{ fontSize: 12, color: "var(--color-text-secondary)", padding: "4px 12px 8px" }}>No clients yet — add one below</div>
              )}
              {clientTags.map((tag) => {
                const allHave = selectedIds.every((id) => {
                  const rec = records.find((r) => r.id === id);
                  return rec?.clientTags?.includes(tag) ?? false;
                });
                const someHave = !allHave && selectedIds.some((id) => {
                  const rec = records.find((r) => r.id === id);
                  return rec?.clientTags?.includes(tag) ?? false;
                });
                return (
                  <label key={tag}
                    onClick={(e) => e.stopPropagation()}
                    style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", fontSize: 12.5, cursor: "pointer", background: allHave ? "var(--color-surface-2)" : "none", userSelect: "none" }}
                  >
                    <input
                      type="checkbox"
                      checked={allHave}
                      ref={(el) => { if (el) el.indeterminate = someHave; }}
                      onChange={() => bulkToggleClientTag(tag)}
                      style={{ accentColor: "#0891b2", width: 14, height: 14, flexShrink: 0, cursor: "pointer" }}
                    />
                    <span style={{ flex: 1, color: "var(--color-text)" }}>{tag}</span>
                    {allHave && <span style={{ fontSize: 10, color: "#0891b2", fontWeight: 700 }}>All ✓</span>}
                    {someHave && <span style={{ fontSize: 10, color: "#6b7280", fontWeight: 600 }}>Some</span>}
                  </label>
                );
              })}
              {selectedIds.some((id) => (records.find((r) => r.id === id)?.clientTags ?? []).length > 0) && (
                <button
                  onClick={(e) => { e.stopPropagation(); bulkToggleClientTag(null); }}
                  style={{ padding: "7px 12px", fontSize: 12, border: "none", borderTop: clientTags.length ? "1px solid var(--color-border)" : "none", background: "none", cursor: "pointer", color: "#ef4444", textAlign: "left" }}
                >Clear all tags</button>
              )}
              <div style={{ borderTop: "1px solid var(--color-border)", padding: "7px 10px", display: "flex", gap: 6 }} onClick={(e) => e.stopPropagation()}>
                <input
                  autoFocus
                  value={bulkNewClientName}
                  onChange={(e) => setBulkNewClientName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && bulkNewClientName.trim()) bulkToggleClientTag(bulkNewClientName.trim()); e.stopPropagation(); }}
                  placeholder="New client…"
                  style={{ flex: 1, fontSize: 12, padding: "3px 6px", border: "1px solid var(--color-border)", borderRadius: 4, background: "var(--color-surface)", color: "var(--color-text)", outline: "none" }}
                />
                <button
                  onClick={() => bulkNewClientName.trim() && bulkToggleClientTag(bulkNewClientName.trim())}
                  style={{ fontSize: 11, padding: "3px 8px", borderRadius: 4, border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--color-primary)", cursor: "pointer", fontWeight: 600 }}
                >Add</button>
              </div>
            </div>
          </>
        );
      })()}

      {detailRec && (() => {
        const r = detailRec;
        const merchant = r.merchantName ?? "Unknown Merchant";
        const initial = merchant.trim()[0]?.toUpperCase() ?? "?";
        const method = extractionMethod(r.pdfSourceType);
        const inr = (paise: number | null | undefined) =>
          paise == null ? null : `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

        const fields: Array<{ label: string; value: string | null; badgeInfo: { badge: AccBadge; note?: string } }> = [
          { label: "Shop Name",       value: r.merchantName,    badgeInfo: accBadge(r.merchantName) },
          { label: "Platform",        value: r.platform ?? null, badgeInfo: accBadge(r.platform) },
          { label: "GSTIN",           value: r.merchantGstin,   badgeInfo: accBadge(r.merchantGstin, "gstin") },
          { label: "Invoice Number",  value: r.invoiceNumber ?? null,   badgeInfo: accBadge(r.invoiceNumber) },
          { label: "Date of Purchase",value: r.invoiceDate,     badgeInfo: accBadge(r.invoiceDate, "date") },
          { label: "Pincode",         value: r.merchantPincode ?? null, badgeInfo: accBadge(r.merchantPincode, "pincode") },
          { label: "Subtotal",        value: inr(r.subtotalPaise), badgeInfo: accBadge(r.subtotalPaise) },
          { label: "GST Amount",      value: inr(r.taxPaise),   badgeInfo: accBadge(r.taxPaise) },
          { label: "Discount",        value: r.discountPaise ? inr(r.discountPaise) : null, badgeInfo: accBadge(r.discountPaise || null) },
          { label: "Final Payment",   value: inr(r.grandTotalPaise), badgeInfo: accBadge(r.grandTotalPaise) },
        ];

        return (
          <>
            <div
              style={{ position: "fixed", inset: 0, zIndex: 299, background: "rgba(0,0,0,0.4)" }}
              onClick={closeDetailPanel}
            />
            <div style={{
              position: "fixed", top: 0, right: 0, bottom: 0, width: 460, zIndex: 300,
              background: "var(--color-surface)", borderLeft: "1px solid var(--color-border)",
              display: "flex", flexDirection: "column", overflow: "hidden",
              boxShadow: "-4px 0 24px rgba(0,0,0,0.15)",
            }}>
              {/* Scrollable content area */}
              <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
              {/* Header */}
              <div style={{ padding: "16px 20px 12px", borderBottom: "1px solid var(--color-border)", flexShrink: 0 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text)" }}>
                    {isPreviewMode ? "Extraction Preview" : r.status === "pending_extraction" ? "Pending AI Extraction" : "Extraction Result"}
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {!isPreviewMode && (
                      <button
                        disabled={aiExtracting}
                        style={{
                          padding: "6px 14px", borderRadius: 6, border: "none",
                          background: "#8b5cf6", color: "#fff", fontSize: 13, fontWeight: 700,
                          cursor: aiExtracting ? "wait" : "pointer", opacity: aiExtracting ? 0.7 : 1,
                        }}
                        onClick={async () => {
                          if (!r.id) return;
                          if (prefs.isDailyLimitReached) {
                            alert(`Daily limit reached — Free plan allows ${prefs.FREE_DAILY_LIMIT} invoices per day. Try again tomorrow or upgrade to Pro for unlimited extractions.`);
                            return;
                          }
                          setAiExtracting(true);
                          try {
                            const inv = await extractInvoiceWithAI(r.id);
                            // Always reload the record so the card reflects any status change
                            load();
                            const updated = await db.invoices.get(r.id);
                            if (updated) setDetailRec(updated);
                            const items = await db.lineItems.where("invoiceId").equals(r.id).toArray();
                            setDetailItems(items);
                            if (inv && updated?.status === "duplicate") {
                              alert("This invoice is a duplicate of one already imported (same merchant, amount, and date). Marked as Duplicate.");
                            }
                            // Show warranty prompt if a sentinel was created
                            if (inv && updated?.status !== "duplicate") {
                              await checkWarrantyPrompt([r.id]);
                            }
                          } finally {
                            setAiExtracting(false);
                          }
                        }}
                      >
                        {aiExtracting ? "Extracting…" : r.status === "pending_extraction" ? "Extract with AI" : "Re-extract with AI"}
                      </button>
                    )}
                    {isPreviewMode && (() => {
                      const doInsert = async (inv: typeof previewExtracted) => {
                        if (!inv) return null;
                        const now = new Date().toISOString();
                        const lineItemNames = inv.lineItems.map((li) => li.name);
                        const category = detectCategory(inv.merchantName, lineItemNames);
                        const filename = r.sourceFilename;
                        const docTypes = detectDocType(inv.merchantName, lineItemNames, filename, undefined);
                        const docType = docTypes[0] ?? "other";
                        const newId = await insertInvoiceWithItems(
                          {
                            merchantName: inv.merchantName,
                            merchantAddress: inv.merchantAddress,
                            merchantGstin: inv.merchantGstin,
                            merchantPhone: inv.merchantPhone ?? null,
                            merchantPincode: inv.merchantPincode ?? null,
                            platform: inv.platform ?? null,
                            invoiceNumber: inv.invoiceNumber,
                            invoiceDate: inv.invoiceDate,
                            subtotalPaise: inv.subtotalPaise,
                            grandTotalPaise: inv.grandTotalPaise,
                            discountPaise: inv.discountPaise ?? 0,
                            taxPaise: inv.taxPaise,
                            paymentMode: inv.paymentMode,
                            importSource: "manual_upload",
                            pdfSourceType: inv.sourceType,
                            importRecordId: null,
                            status: "imported",
                            category,
                            docType,
                            docTypes,
                            sourceFilename: filename,
                            subject: "Unknown",
                            senderEmail: "Manual",
                            createdAt: now,
                            updatedAt: now,
                          },
                          inv.lineItems.map((li) => ({
                            name: li.name,
                            quantity: li.quantity,
                            unitPricePaise: li.unitPricePaise,
                            totalPricePaise: li.totalPricePaise,
                            discountPaise: li.discountPaise ?? 0,
                          })),
                        );
                        prefs.incrementDailyCount();
                        const isComplete = !!(inv.merchantName && inv.grandTotalPaise && inv.invoiceDate && inv.lineItems.length > 0);
                        rewards.recordUpload(isComplete);
                        // Create warranty sentinel for manually submitted previews (not done by processFile for this path)
                        await computeSentinelForInvoice(newId, inv.invoiceDate, inv.merchantName, lineItemNames, inv.rawText ?? null);
                        return newId;
                      };
                      return (
                        <>
                          {isSupabaseEnabled() && (
                            <button
                              disabled={previewCloudSaving || previewSubmitting}
                              style={{
                                padding: "6px 14px", borderRadius: 6,
                                border: "1px solid var(--color-border)",
                                background: "var(--color-surface-2)", color: "var(--color-text-secondary)",
                                fontSize: 13, fontWeight: 700,
                                cursor: previewCloudSaving ? "wait" : "pointer",
                                opacity: previewCloudSaving ? 0.7 : 1,
                              }}
                              onClick={async () => {
                                if (!previewExtracted) return;
                                if (prefs.isDailyLimitReached) {
                                  alert(`Daily limit reached — Free plan allows ${prefs.FREE_DAILY_LIMIT} invoices per day. Upgrade to Pro for unlimited.`);
                                  return;
                                }
                                setPreviewCloudSaving(true);
                                try {
                                  const newId = await doInsert(previewExtracted);
                                  if (newId != null) {
                                    try { await syncNewInvoice(newId); rewards.recordCloudSync(); } catch {}
                                    await checkWarrantyPrompt([newId]);
                                  }
                                  load();
                                  closeDetailPanel();
                                } finally { setPreviewCloudSaving(false); }
                              }}
                            >
                              {previewCloudSaving ? "Saving…" : "☁ Save to Cloud"}
                            </button>
                          )}
                          <button
                            disabled={previewSubmitting || previewCloudSaving}
                            style={{
                              padding: "6px 14px", borderRadius: 6, border: "none",
                              background: "var(--color-primary)", color: "#fff", fontSize: 13, fontWeight: 700,
                              cursor: previewSubmitting ? "wait" : "pointer", opacity: previewSubmitting ? 0.7 : 1,
                            }}
                            onClick={async () => {
                              if (!previewExtracted) return;
                              if (prefs.isDailyLimitReached) {
                                alert(`Daily limit reached — Free plan allows ${prefs.FREE_DAILY_LIMIT} invoices per day. Upgrade to Pro for unlimited.`);
                                return;
                              }
                              setPreviewSubmitting(true);
                              try {
                                const newId = await doInsert(previewExtracted);
                                if (newId != null) await checkWarrantyPrompt([newId]);
                                load();
                                closeDetailPanel();
                              } finally { setPreviewSubmitting(false); }
                            }}
                          >
                            {previewSubmitting ? "Saving…" : "Submit & Save"}
                          </button>
                        </>
                      );
                    })()}
                    {!isPreviewMode && isSupabaseEnabled() && r.id != null && (() => {
                      const sensitivity = detectSensitiveData(r);
                      if (sensitivity.sensitive) {
                        return (
                          <button
                            disabled
                            title={sensitivity.reasons.join(" · ")}
                            style={{
                              padding: "5px 12px", borderRadius: 6,
                              border: "1px solid #fca5a5",
                              background: "#fee2e2", color: "#b91c1c",
                              fontSize: 12, fontWeight: 600, cursor: "not-allowed", opacity: 0.75,
                            }}
                          >
                            ☁ Save to Cloud
                          </button>
                        );
                      }
                      return (
                        <button
                          disabled={syncingId === r.id}
                          style={{
                            padding: "5px 12px", borderRadius: 6, border: "1px solid var(--color-border)",
                            background: "var(--color-surface-2)", color: "var(--color-text-secondary)",
                            fontSize: 12, fontWeight: 600, cursor: syncingId === r.id ? "wait" : "pointer",
                          }}
                          onClick={async () => {
                            if (!r.id) return;
                            setSyncingId(r.id);
                            try {
                              await syncNewInvoice(r.id);
                              rewards.recordCloudSync();
                            } catch {}
                            setSyncingId(null);
                          }}
                        >
                          {syncingId === r.id ? "Syncing…" : "☁ Save to Cloud"}
                        </button>
                      );
                    })()}
                    {!isPreviewMode && (() => {
                      const isInv = (r.docTypes ?? (r.docType ? [r.docType] : [])).some((t) => t === "invoice") || r.docType === "invoice";
                      if (!isInv) return null;
                      return (
                        <button
                          style={{
                            padding: "5px 12px", borderRadius: 6,
                            border: "1px solid var(--color-border)",
                            background: "var(--color-surface-2)", color: "var(--color-text-secondary)",
                            fontSize: 12, fontWeight: 600, cursor: "pointer",
                          }}
                          onClick={() => {
                            setUploadEntries([{
                              rec: r,
                              items: detailItems,
                              pincode: extractPincode(r.merchantAddress),
                              discountPct: discountPercent(r.discountPaise, r.grandTotalPaise),
                              claude: null,
                            }]);
                          }}
                        >
                          Upload to Cloud
                        </button>
                      );
                    })()}
                    <button
                      onClick={closeDetailPanel}
                      style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "var(--color-text-secondary)", lineHeight: 1, padding: "0 2px" }}
                    >×</button>
                  </div>
                </div>
                <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
                  {isPreviewMode ? (r.sourceFilename ?? "Invoice PDF") : `${merchant} · Invoice PDF`} · {method}
                </div>
              </div>

              {/* Sensitive data warning */}
              {!isPreviewMode && r.id != null && (() => {
                const sensitivity = detectSensitiveData(r);
                if (!sensitivity.sensitive) return null;
                return (
                  <div style={{ margin: "12px 20px 0", padding: "10px 14px", borderRadius: 8, background: "#fff7ed", border: "1px solid #fed7aa", display: "flex", alignItems: "flex-start", gap: 8 }}>
                    <span style={{ flexShrink: 0 }}>🔒</span>
                    <div style={{ fontSize: 12.5, color: "#9a3412" }}>
                      <div style={{ fontWeight: 700, marginBottom: 2 }}>This file has sensitive/personal data. Can't upload.</div>
                      <div style={{ color: "#c2410c" }}>{sensitivity.reasons.join(" · ")}</div>
                    </div>
                  </div>
                );
              })()}

              {/* Fraud/duplicate warnings */}
              {r.id != null && (billIssues.get(r.id) ?? []).length > 0 && (
                <div style={{ margin: "12px 20px 0", display: "flex", flexDirection: "column", gap: 6 }}>
                  {(billIssues.get(r.id) ?? []).map((issue, i) => (
                    <div key={i} style={{
                      display: "flex", alignItems: "flex-start", gap: 8,
                      padding: "10px 14px", borderRadius: 8,
                      background: issue.severity === "error" ? "#fee2e2" : "#fef3c7",
                      border: `1px solid ${issue.severity === "error" ? "#fca5a5" : "#fcd34d"}`,
                      fontSize: 12.5, color: issue.severity === "error" ? "#991b1b" : "#92400e",
                    }}>
                      <span style={{ flexShrink: 0 }}>{issue.severity === "error" ? "🚨" : "⚠️"}</span>
                      <span>{issue.message}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Merchant card */}
              <div style={{ margin: "16px 20px 4px", background: "var(--color-surface-2)", border: "1px solid var(--color-border)", borderRadius: 10, padding: "14px 16px", display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{ width: 42, height: 42, borderRadius: 10, background: "var(--color-primary)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 700, flexShrink: 0 }}>
                  {initial}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text)", marginBottom: 2 }}>{merchant.toUpperCase()}</div>
                  {r.merchantAddress && (
                    <div style={{ fontSize: 12, color: "var(--color-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.merchantAddress}
                    </div>
                  )}
                </div>
              </div>

              {/* Extracted fields */}
              <div style={{ padding: "16px 20px 0" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>
                  Extracted Fields
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {fields.map(({ label, value, badgeInfo }) => (
                    <div key={label} style={{ background: "var(--color-surface-2)", border: "1px solid var(--color-border)", borderRadius: 8, padding: "10px 12px" }}>
                      <div style={{ fontSize: 10, fontWeight: 600, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 5 }}>
                        {label}
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: value ? "var(--color-text)" : "var(--color-text-tertiary)", marginBottom: 6, wordBreak: "break-all" }}>
                        {value ?? "null"}
                      </div>
                      {badgeChip(badgeInfo.badge, badgeInfo.note)}
                    </div>
                  ))}
                </div>
              </div>

              {/* Category — auto-detected at import for all non-personal profiles */}
              {!isPreviewMode && prefs.activeMode !== "personal" && (() => {
                const mode = prefs.activeMode;
                const label = detailCategory
                  ? mode === "society"
                    ? (SOCIETY_CATEGORY_LABEL[detailCategory as SocietyExpenseCategory] ?? detailCategory.replace(/_/g, " "))
                    : getProfessionalCategoryLabel(mode as ProfessionalProfile, detailCategory)
                  : null;
                return (
                  <div style={{ padding: "12px 20px 0" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                      Category
                    </div>
                    {label ? (
                      <span style={{ display: "inline-block", fontSize: 13, fontWeight: 600, padding: "4px 10px", borderRadius: 6, background: "var(--color-accent-light, rgba(99,102,241,0.12))", color: "var(--color-accent, #6366f1)" }}>
                        {label}
                      </span>
                    ) : (
                      <span style={{ fontSize: 13, color: "var(--color-text-tertiary)" }}>Not detected</span>
                    )}
                  </div>
                );
              })()}

              {/* Line items */}
              {detailItems.length > 0 && (
                <div style={{ padding: "16px 20px 24px" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>
                    Line Items ({detailItems.length} extracted)
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                      <thead>
                        <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                          {["#", "Item Name", "Qty", "Amount (₹)"].map((h) => (
                            <th key={h} style={{ padding: "6px 8px", textAlign: h === "Amount (₹)" ? "right" : "left", fontSize: 10, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {detailItems.map((it, i) => {
                          const nameUnclear = it.name.trim().length < 3;
                          return (
                            <tr key={it.id ?? i} style={{ borderBottom: "1px solid var(--color-border)" }}>
                              <td style={{ padding: "8px 8px", color: "var(--color-text-secondary)", fontVariantNumeric: "tabular-nums" }}>{i + 1}</td>
                              <td style={{ padding: "8px 8px" }}>
                                <span style={{ color: "var(--color-text)" }}>{it.name}</span>
                                {nameUnclear && (
                                  <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: "#92400e", background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 4, padding: "1px 5px" }}>
                                    NAME UNCLEAR
                                  </span>
                                )}
                              </td>
                              <td style={{ padding: "8px 8px", color: "var(--color-text-secondary)", fontVariantNumeric: "tabular-nums" }}>{it.quantity}</td>
                              <td style={{ padding: "8px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--color-text)", fontWeight: 600 }}>
                                {(it.totalPricePaise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {detailItems.length === 0 && (
                <div style={{ padding: "12px 20px 24px", fontSize: 13, color: "var(--color-text-secondary)" }}>
                  No line items extracted.
                </div>
              )}
              </div>{/* /scrollable content */}
            </div>
          </>
        );
      })()}

      {projectTaggingId != null && (() => {
        const rec = records.find((r) => r.id === projectTaggingId);
        const current = rec?.projectTag ?? null;
        return (
          <>
            <div style={{ position: "fixed", inset: 0, zIndex: 199 }} onClick={() => setProjectTaggingId(null)} />
            <div style={{ position: "fixed", top: projectTaggingPos.top, left: projectTaggingPos.left, zIndex: 200, background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,.14)", minWidth: 220, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em", padding: "8px 12px 4px" }}>
                Assign Project
              </div>
              {projectTags.length === 0 && (
                <div style={{ fontSize: 12, color: "var(--color-text-secondary)", padding: "4px 12px 8px" }}>No projects yet — add one below</div>
              )}
              {projectTags.map((tag) => {
                const active = current === tag;
                return (
                  <button key={tag}
                    onClick={(e) => { e.stopPropagation(); assignProjectTag(projectTaggingId, tag); }}
                    style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", fontSize: 12.5, cursor: "pointer", border: "none", background: active ? "#ecfdf5" : "none", color: "var(--color-text)", textAlign: "left" }}
                  >
                    <span style={{ color: active ? "#059669" : "var(--color-text-tertiary)", fontSize: 14 }}>📁</span>
                    <span style={{ flex: 1 }}>{tag}</span>
                    {active && <span style={{ fontSize: 10, color: "#059669", fontWeight: 700 }}>✓</span>}
                  </button>
                );
              })}
              {current && (
                <button
                  onClick={(e) => { e.stopPropagation(); assignProjectTag(projectTaggingId, null); }}
                  style={{ padding: "7px 12px", fontSize: 12, border: "none", borderTop: projectTags.length ? "1px solid var(--color-border)" : "none", background: "none", cursor: "pointer", color: "#ef4444", textAlign: "left" }}
                >Remove project</button>
              )}
              <div style={{ borderTop: "1px solid var(--color-border)", padding: "7px 10px", display: "flex", gap: 6 }} onClick={(e) => e.stopPropagation()}>
                <input
                  autoFocus
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && newProjectName.trim()) assignProjectTag(projectTaggingId, newProjectName.trim()); e.stopPropagation(); }}
                  placeholder="New project…"
                  style={{ flex: 1, fontSize: 12, padding: "3px 6px", border: "1px solid var(--color-border)", borderRadius: 4, background: "var(--color-surface)", color: "var(--color-text)", outline: "none" }}
                />
                <button
                  onClick={() => newProjectName.trim() && assignProjectTag(projectTaggingId, newProjectName.trim())}
                  style={{ fontSize: 11, padding: "3px 8px", borderRadius: 4, border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "#059669", cursor: "pointer", fontWeight: 600 }}
                >Add</button>
              </div>
            </div>
          </>
        );
      })()}

      {taggingId != null && (() => {
        const rec = records.find((r) => r.id === taggingId);
        const assigned = rec?.clientTags ?? [];
        return (
          <>
            <div style={{ position: "fixed", inset: 0, zIndex: 199 }} onClick={() => setTaggingId(null)} />
            <div style={{ position: "fixed", top: taggingPos.top, left: taggingPos.left, zIndex: 200, background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,.14)", minWidth: 210, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              {clientTags.length === 0 && (
                <div style={{ fontSize: 12, color: "var(--color-text-secondary)", padding: "8px 12px" }}>No clients yet — add one below</div>
              )}
              {clientTags.map((tag) => {
                const checked = assigned.includes(tag);
                return (
                  <label key={tag}
                    onClick={(e) => e.stopPropagation()}
                    style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", fontSize: 12.5, cursor: "pointer", background: checked ? "var(--color-surface-2)" : "none", userSelect: "none" }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleClientTag(taggingId, tag)}
                      style={{ accentColor: "#0891b2", width: 14, height: 14, flexShrink: 0, cursor: "pointer" }}
                    />
                    <span style={{ flex: 1, color: "var(--color-text)" }}>{tag}</span>
                    {checked && <span style={{ fontSize: 10, color: "#0891b2", fontWeight: 700 }}>✓</span>}
                  </label>
                );
              })}
              {assigned.length > 0 && (
                <button
                  onClick={(e) => { e.stopPropagation(); toggleClientTag(taggingId, null); }}
                  style={{ padding: "7px 12px", fontSize: 12, border: "none", borderTop: clientTags.length ? "1px solid var(--color-border)" : "none", background: "none", cursor: "pointer", color: "#ef4444", textAlign: "left" }}
                >Clear all tags</button>
              )}
              <div style={{ borderTop: "1px solid var(--color-border)", padding: "7px 10px", display: "flex", gap: 6 }} onClick={(e) => e.stopPropagation()}>
                <input
                  autoFocus
                  value={newClientName}
                  onChange={(e) => setNewClientName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && newClientName.trim()) toggleClientTag(taggingId, newClientName.trim()); e.stopPropagation(); }}
                  placeholder="New client…"
                  style={{ flex: 1, fontSize: 12, padding: "3px 6px", border: "1px solid var(--color-border)", borderRadius: 4, background: "var(--color-surface)", color: "var(--color-text)", outline: "none" }}
                />
                <button
                  onClick={() => newClientName.trim() && toggleClientTag(taggingId, newClientName.trim())}
                  style={{ fontSize: 11, padding: "3px 8px", borderRadius: 4, border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--color-primary)", cursor: "pointer", fontWeight: 600 }}
                >Add</button>
              </div>
            </div>
          </>
        );
      })()}
    </>
  );
}
