import { db } from "../data/InvoiceDatabase";
import type { InvoiceMeta } from "../data/InvoiceDatabase";

export interface BillIssue {
  type: "duplicate" | "fraud";
  severity: "warning" | "error";
  message: string;
}

const VALID_GST_RATES = [0, 5, 12, 18, 28];

type InvoiceFields = Pick<
  InvoiceMeta,
  "id" | "merchantName" | "grandTotalPaise" | "invoiceDate" | "taxPaise" | "discountPaise" | "subtotalPaise" | "merchantGstin"
>;

export async function detectBillIssues(inv: InvoiceFields): Promise<BillIssue[]> {
  const issues: BillIssue[] = [];

  // Duplicate: same merchant + same total + same date
  if (inv.merchantName && inv.grandTotalPaise != null && inv.invoiceDate) {
    const candidates = await db.invoices
      .where("merchantName")
      .equalsIgnoreCase(inv.merchantName)
      .toArray();
    const dupe = candidates.find(
      (r) =>
        r.id !== inv.id &&
        r.grandTotalPaise === inv.grandTotalPaise &&
        r.invoiceDate === inv.invoiceDate,
    );
    if (dupe) {
      issues.push({
        type: "duplicate",
        severity: "warning",
        message: `Possible duplicate of #${dupe.id} — same merchant, amount & date`,
      });
    }
  }

  const total    = inv.grandTotalPaise ?? 0;
  const tax      = inv.taxPaise ?? 0;
  const discount = inv.discountPaise ?? 0;
  const subtotal = inv.subtotalPaise;

  // GST >= grand total
  if (tax > 0 && total > 0 && tax >= total) {
    issues.push({ type: "fraud", severity: "error", message: "GST equals or exceeds grand total — likely a fake bill" });
  }

  // Unusual GST rate
  if (tax > 0 && total > 0) {
    const base = subtotal != null ? subtotal : total - tax + discount;
    if (base > 0) {
      const rate    = (tax / base) * 100;
      const nearest = VALID_GST_RATES.reduce((a, b) => (Math.abs(b - rate) < Math.abs(a - rate) ? b : a));
      if (Math.abs(rate - nearest) > 2) {
        issues.push({
          type: "fraud",
          severity: "warning",
          message: `Unusual GST rate ${rate.toFixed(1)}% — valid: 0%, 5%, 12%, 18%, 28%`,
        });
      }
    }
  }

  // Subtotal > grand total (math error)
  if (subtotal != null && total > 0 && subtotal > total + discount + 1) {
    issues.push({ type: "fraud", severity: "error", message: "Subtotal exceeds grand total — bill doesn't add up" });
  }

  // Zero total with a merchant name (blank/fake)
  if (inv.grandTotalPaise === 0 && inv.merchantName) {
    issues.push({ type: "fraud", severity: "warning", message: "Grand total is ₹0 — may be a sample or fake bill" });
  }

  // Invalid GSTIN format
  if (inv.merchantGstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/.test(inv.merchantGstin)) {
    issues.push({ type: "fraud", severity: "warning", message: `GSTIN "${inv.merchantGstin}" has invalid format` });
  }

  return issues;
}

export async function runBillChecksForAll(
  records: InvoiceMeta[],
): Promise<Map<number, BillIssue[]>> {
  const result = new Map<number, BillIssue[]>();
  for (const rec of records) {
    if (rec.id == null) continue;
    const issues = await detectBillIssues(rec);
    if (issues.length > 0) result.set(rec.id, issues);
  }
  return result;
}
