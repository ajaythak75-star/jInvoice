/**
 * Pre-extraction strategy hint.
 *
 * Uses only signals available BEFORE reading the PDF — filename, email subject,
 * sender address — to decide which extraction path to take.
 *
 * "local_first"    – try local regex extraction; fall back to Gemini if low confidence.
 *                    Use for well-structured native PDFs (GST invoices, SaaS billing,
 *                    government portals, e-commerce, bank statements).
 *
 * "gemini_direct"  – skip local extraction entirely; send straight to Gemini Vision.
 *                    Use for documents that never have an extractable invoice structure
 *                    (cheques, legal documents, scanned forms, meeting records).
 *
 * Default is "local_first" — matches current pipeline behaviour for anything not listed.
 */
export type ExtractionStrategy = "local_first" | "gemini_direct";

// ── "local_first" signal sets ─────────────────────────────────────────────

/** Filename / subject substrings that strongly suggest a structured native PDF. */
const LOCAL_FILENAME_KW = [
  // E-commerce
  "amazon", "flipkart", "myntra", "meesho", "nykaa", "jiomart", "tatacliq",
  "ajio", "blinkit", "swiggy", "zomato", "bigbasket",
  // GST / tax invoice
  "tax invoice", "gst invoice", "gstin",
  // Utilities (portal PDFs)
  "msedcl", "bescom", "bses", "tpddl", "adani electricity",
  "mahanagar gas", "mgl", "igl", "piped gas",
  "electricity bill", "water bill", "gas bill",
  // Government portals
  "traces", "form 16", "form 26as", "challan 280", "itns 280",
  "advance tax", "tds certificate",
  "gstr", "gst return", "gst portal",
  "mca", "roc filing", "din", "company filing",
  "income tax", "itr", "e-filing",
  // Subscriptions / SaaS
  "cleartax", "taxmann", "winman", "computax", "saral tax",
  "tally", "zoho", "quickbooks", "manupatra", "scc online",
  "99acres", "magicbricks", "housing.com",
  "google ads", "facebook ads",
  // Banking
  "bank statement", "account statement", "credit card statement",
  "fixed deposit", "fd receipt",
  // Insurance portals
  "premium receipt", "policy receipt", "renewal premium",
  // Membership receipts (ICAI, Bar Council portals)
  "icai", "bar council", "membership receipt",
];

/** Sender domains / email substrings that indicate a structured PDF source. */
const LOCAL_SENDER_KW = [
  "amazon.in", "amazon.com",
  "flipkart.com", "myntra.com", "nykaa.com", "meesho.com",
  "swiggy.com", "zomato.com", "bigbasket.com",
  "msedcl.com", "bescom.org", "bses.in",
  "mca.gov.in", "incometaxindia.gov.in", "gst.gov.in",
  "traces.gov.in",
  "cleartax.in", "taxmann.com", "winman.com",
  "tally.com", "tallyprimeserver.com",
  "zoho.com", "quickbooks.com",
  "icai.org", "icai.in",
];

// ── "gemini_direct" signal sets ───────────────────────────────────────────

/** Documents whose content is never structured as a machine-readable invoice. */
const GEMINI_FILENAME_KW = [
  // Negotiable instruments
  "cheque", "check", "demand draft", "dd no", "bearer",
  // Share / membership documents
  "share certificate", "membership certificate",
  // Legal & registration documents
  "sale deed", "conveyance deed", "power of attorney", "poa",
  "affidavit", "noc", "no objection certificate",
  "occupation certificate", "completion certificate",
  "allotment letter", "possession letter",
  "stamp paper", "e-stamp", "franking",
  // Society non-invoice documents
  "agm", "annual general meeting", "sgm", "special general meeting",
  "minutes of meeting", "meeting notice", "attendance register",
  "resolution", "agenda",
  // Legal profession
  "legal notice", "vakalatnama", "court order", "judgment",
  // Miscellaneous scanned forms
  "form 3ca", "form 3cb", "itr-v", "itr v",
];

// ── Detector ──────────────────────────────────────────────────────────────

function matchesAny(text: string, keywords: string[]): boolean {
  return keywords.some((kw) => text.includes(kw));
}

/**
 * Returns the recommended extraction strategy for a file using only pre-extraction
 * signals: filename, email subject, and sender email address.
 *
 * Falls back to "local_first" when no signal matches (safe default = current behaviour).
 */
export function detectExtractionStrategy(
  filename?: string | null,
  subject?: string | null,
  senderEmail?: string | null,
): ExtractionStrategy {
  const fn = (filename ?? "").toLowerCase();
  const sub = (subject ?? "").toLowerCase();
  const sender = (senderEmail ?? "").toLowerCase();

  // "gemini_direct" check runs first — non-invoice documents must not waste time
  // on local extraction that will always fail.
  if (matchesAny(fn, GEMINI_FILENAME_KW) || matchesAny(sub, GEMINI_FILENAME_KW)) {
    return "gemini_direct";
  }

  // "local_first" for known structured sources.
  if (
    matchesAny(fn, LOCAL_FILENAME_KW) ||
    matchesAny(sub, LOCAL_FILENAME_KW) ||
    matchesAny(sender, LOCAL_SENDER_KW)
  ) {
    return "local_first";
  }

  // Default — try local, fall back to Gemini (unchanged pipeline behaviour).
  return "local_first";
}
