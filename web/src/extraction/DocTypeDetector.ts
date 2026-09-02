export type DocType = "invoice" | "tax" | "coupon" | "travel" | "warranty" | "finance" | "other";

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  invoice:  "Invoice",
  tax:      "Tax",
  coupon:   "Coupon",
  travel:   "Travel",
  warranty: "Warranty",
  finance:  "Finance",
  other:    "Other",
};

export const DOC_TYPE_SUBFOLDER: Record<DocType, string> = {
  invoice:  "Invoices",
  tax:      "Tax",
  coupon:   "Coupons",
  travel:   "Travel",
  warranty: "Warranty",
  finance:  "Finance",
  other:    "Other",
};

const TRAVEL_KW = [
  "flight", "airline", "air india", "indigo", "spicejet", "vistara", "akasa", "goair",
  "travel", "trip", "itinerary", "pnr", "boarding", "e-ticket", "train", "irctc",
  "hotel", "hostel", "booking.com", "makemytrip", "cleartrip", "yatra",
  "ola", "uber", "redbus", "bus ticket",
];

const TAX_KW = [
  "income tax", "tds certificate", "form 16", "form 26as", "gstr", "itr",
  "challan 280", "challan itns", "advance tax", "tax refund", "income tax receipt",
];

const COUPON_KW = [
  "coupon", "voucher", "gift card", "promo code", "discount code",
  "cashback voucher", "reward voucher", "e-voucher",
];

const WARRANTY_KW = [
  "warranty", "guarantee", "warranty card", "warranty certificate", "extended warranty",
  "service warranty", "product warranty", "warranty period", "warranty claim", "repair warranty",
];

const FINANCE_KW = [
  "emi", "loan", "account statement", "credit card statement", "bank statement",
  "payment schedule", "outstanding", "mutual fund", "insurance premium", "premium receipt",
  "policy", "statement of account", "loan account",
];

const INVOICE_KW = [
  "invoice", "bill", "receipt", "gstin", "gst", "tax invoice", "purchase order", "amount due",
];

function hits(text: string, keywords: string[]): number {
  return keywords.filter((kw) => text.includes(kw)).length;
}

/**
 * Returns an array of 1 or 2 DocTypes.
 * Two are returned when the PDF content signals both types roughly equally (second score > 50% of top).
 * Subject adds half-weight signal and can shift close calls but cannot override strong PDF evidence.
 */
export function detectDocType(
  merchantName: string | null,
  lineItemNames: string[],
  sourceFilename?: string,
  subject?: string,
): DocType[] {
  const pdfText = [merchantName, ...lineItemNames, sourceFilename].filter(Boolean).join(" ").toLowerCase();
  const subText  = (subject ?? "").toLowerCase();

  const scores: Record<string, number> = {
    travel:   hits(pdfText, TRAVEL_KW)   + hits(subText, TRAVEL_KW)   * 0.5,
    tax:      hits(pdfText, TAX_KW)      + hits(subText, TAX_KW)      * 0.5,
    coupon:   hits(pdfText, COUPON_KW)   + hits(subText, COUPON_KW)   * 0.5,
    warranty: hits(pdfText, WARRANTY_KW) + hits(subText, WARRANTY_KW) * 0.5,
    finance:  hits(pdfText, FINANCE_KW)  + hits(subText, FINANCE_KW)  * 0.5,
    // Invoice gets a base of 1 if merchant was extracted (PDF structured like an invoice)
    invoice:  (merchantName != null ? 1 : 0)
              + hits(pdfText, INVOICE_KW)
              + hits(subText, INVOICE_KW) * 0.5,
  };

  const ranked = (Object.entries(scores) as [string, number][])
    .filter(([, s]) => s > 0)
    .sort(([, a], [, b]) => b - a);

  if (ranked.length === 0) return ["other"];

  const [topType, topScore] = ranked[0];
  const result: DocType[] = [topType as DocType];

  if (ranked.length > 1) {
    const [secondType, secondScore] = ranked[1];
    // Second type saves to its own folder only when its score exceeds 50% of the winner —
    // meaning the content is genuinely mixed (e.g. airline invoice with GST breakup).
    if (secondScore > topScore * 0.5) {
      result.push(secondType as DocType);
    }
  }

  return result;
}
