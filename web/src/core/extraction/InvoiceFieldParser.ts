import type { ExtractedInvoice, LineItem, PaymentMode, PdfSourceType } from "./models";

const MONTH_MAP: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

const DATE_PATTERNS: Array<{ rx: RegExp; fmt: "dmy" | "ymd" | "dmy_mon" }> = [
  { rx: /(\d{2})[\/\-.](\d{2})[\/\-.](\d{4})/,                    fmt: "dmy" },
  { rx: /(\d{4})[\/\-](\d{2})[\/\-](\d{2})/,                     fmt: "ymd" },
  { rx: /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})/i, fmt: "dmy_mon" },
];

const GSTIN_RX = /\b(\d{2}[A-Z]{5}\d{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1})\b/;
const INVOICE_NO_RX = /invoice\s*(?:no|number|#)\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-\/]{3,29})/i;
// Order matters: more specific patterns first
const TOTAL_RX = [
  // "Invoice Value" label (Amazon, Flipkart)
  /invoice\s*value[:\s]*(?:₹|Rs\.?|INR)?\s*([\d,]+\.?\d{0,2})/i,
  // Standard grand total keywords
  /(?:grand\s*total|total\s*amount|net\s*payable|amount\s*due|amount\s*payable|payable\s*amount)\s*[:\-]?\s*(?:₹|Rs\.?|INR)?\s*([\d,]+\.?\d{0,2})/i,
  // "TOTAL: ₹tax ₹grandtotal" — two ₹ on same TOTAL line; take the last one
  /^total[:\s]+(?:₹|Rs\.?)?\s*[\d,]+\.?\d*\s+(?:₹|Rs\.?)\s*([\d,]+\.?\d{0,2})/im,
  // Last ₹ amount on a line ending with it
  /(?:₹|Rs\.?)\s*([\d,]+\.?\d{0,2})\s*$/im,
];
const LINE_ITEM_RX = /^(.+?)\s+(\d+(?:\.\d+)?)\s+(?:₹|Rs\.?)?\s*([\d,]+\.?\d{0,2})/gim;

// Lines to skip when looking for merchant name or line item names
const HEADER_SKIP = [
  "tax invoice", "bill of supply", "cash memo", "original for recipient",
  "duplicate", "invoice", "receipt", "page ", "gstin", "pan no", "cin no",
  "authorized signatory", "e-invoice", "irn", "ack no",
];

// Additional phrases that disqualify a line-item name match
const ITEM_HEADER_SKIP = [
  ...HEADER_SKIP,
  "description", "item name", "sl. no", "hsn code", "unit price",
  "net amount", "tax rate", "tax type", "tax amount", "total amount",
  "original for", "seller services", "retail india", "fulfillment",
  "customers desirous", "business account", "demand for payment",
];

export function extractDate(text: string): string | null {
  for (const { rx, fmt } of DATE_PATTERNS) {
    const m = rx.exec(text);
    if (!m) continue;
    if (fmt === "dmy") return `${m[3]}-${m[2]}-${m[1]}`;
    if (fmt === "ymd") return `${m[1]}-${m[2]}-${m[3]}`;
    if (fmt === "dmy_mon") {
      const mon = MONTH_MAP[m[2].toLowerCase().slice(0, 3)] ?? "01";
      return `${m[3]}-${mon}-${m[1].padStart(2, "0")}`;
    }
  }
  return null;
}

export function extractGstin(text: string): string | null {
  return GSTIN_RX.exec(text)?.[1] ?? null;
}

export function extractInvoiceNumber(text: string): string | null {
  return INVOICE_NO_RX.exec(text)?.[1]?.trim() ?? null;
}

export function extractMerchantName(text: string): string | null {
  // 1. "Sold By :" / "Seller:" label (Amazon, Flipkart, etc.) — name is on the next line
  const soldByM = /(?:sold\s+by|seller)\s*[:\-]\s*\n?\s*([A-Z][A-Za-z0-9\s,.()\-&']{4,80})/im.exec(text);
  if (soldByM) return soldByM[1].trim().replace(/\s+/g, " ");

  // 2. First line that contains a known company-type suffix
  const companyM = /^([A-Z][A-Za-z0-9\s,.()\-&']{3,70}(?:private\s+limited|pvt\.?\s*ltd\.?|(?<!\b\w)\blimited\b|llp|llc))/im.exec(text);
  if (companyM) return companyM[1].trim().replace(/\s+/g, " ");

  // 3. Fallback: first non-empty, digit-sparse line that isn't a known invoice header
  const lines = text.split("\n");
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    const tl = t.toLowerCase();
    if (HEADER_SKIP.some((w) => tl.includes(w))) continue;
    const digits = (t.match(/\d/g) ?? []).length;
    if (digits / t.length < 0.4) return t;
  }
  return null;
}

export function extractGrandTotal(text: string): number | null {
  for (const rx of TOTAL_RX) {
    const m = rx.exec(text);
    if (m) {
      const val = parseFloat(m[1].replace(/,/g, ""));
      if (!isNaN(val)) return Math.round(val * 100);
    }
  }
  return null;
}

export function extractPaymentMode(text: string): PaymentMode {
  const l = text.toLowerCase();
  if (l.includes("cash")) return "cash";
  if (l.includes("upi") || l.includes("gpay") || l.includes("phonepe")) return "upi";
  if (l.includes("card") || l.includes("credit") || l.includes("debit")) return "card";
  if (l.includes("bnpl") || l.includes("buy now") || l.includes("emi")) return "bnpl";
  return "unknown";
}

export function extractLineItems(text: string): LineItem[] {
  const items: LineItem[] = [];
  let m: RegExpExecArray | null;
  LINE_ITEM_RX.lastIndex = 0;
  while ((m = LINE_ITEM_RX.exec(text)) !== null) {
    const name = m[1].trim();
    const qty = parseFloat(m[2]);
    const unitPricePaise = Math.round(parseFloat(m[3].replace(/,/g, "")) * 100);
    if (!name || unitPricePaise <= 0) continue;
    // Reject obvious header rows and boilerplate blobs
    if (name.length > 200) continue;
    const nameLower = name.toLowerCase();
    if (ITEM_HEADER_SKIP.some((w) => nameLower.includes(w))) continue;
    items.push({
      name,
      quantity: qty,
      unitPricePaise,
      totalPricePaise: Math.round(qty * unitPricePaise),
      discountPaise: 0,
    });
  }
  return items;
}

export function computeConfidence(invoice: Partial<ExtractedInvoice>): number {
  let hits = 0;
  if (invoice.merchantName) hits++;
  if (invoice.invoiceDate) hits++;
  if (invoice.grandTotalPaise != null) hits++;
  if (invoice.paymentMode && invoice.paymentMode !== "unknown") hits++;
  return hits / 4;
}

export function parse(text: string, sourceType: PdfSourceType): ExtractedInvoice {
  const merchantName = extractMerchantName(text);
  const invoiceDate = extractDate(text);
  const merchantGstin = extractGstin(text);
  const grandTotalPaise = extractGrandTotal(text);
  const paymentMode = extractPaymentMode(text);
  const lineItems = extractLineItems(text);
  const invoiceNumber = extractInvoiceNumber(text);

  const partial = { merchantName, invoiceDate, grandTotalPaise, paymentMode };
  const confidenceScore = computeConfidence(partial);

  return {
    merchantName,
    merchantAddress: null,
    merchantGstin,
    merchantPhone: null,
    merchantPincode: null,
    invoiceNumber,
    invoiceDate,
    lineItems,
    subtotalPaise: null,
    discountPaise: 0,
    taxPaise: null,
    grandTotalPaise,
    paymentMode,
    sourceType,
    rawText: text,
    confidenceScore,
  };
}
