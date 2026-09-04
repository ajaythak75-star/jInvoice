/**
 * Pre-extraction strategy hint.
 *
 * Uses only signals available BEFORE reading the PDF — filename, email subject,
 * sender address — to decide which extraction path to take.
 *
 * "local_first"    – try local regex extraction; fall back to Gemini if low confidence.
 *                    Well-structured native PDFs: GST invoices, e-commerce, government
 *                    portals, SaaS billing, utilities, insurance portals, travel tickets.
 *
 * "gemini_direct"  – skip local extraction entirely; go straight to Gemini Vision.
 *                    Documents that never have a machine-readable invoice structure:
 *                    cheques, legal deeds, scanned forms, service job cards, prescriptions.
 *
 * "skip"           – do not attempt any extraction at all; save with a "not an invoice"
 *                    note. For documents that have zero financial data: society admin
 *                    forms, consent/declaration forms, ID document scans, gate passes.
 *
 * Default is "local_first" — matches current pipeline behaviour for anything not listed.
 */
export type ExtractionStrategy = "local_first" | "gemini_direct" | "text_capture" | "skip";

// ── LOCAL_FIRST: filename / subject keyword sets ───────────────────────────

/** E-commerce portals — all emit structured GST PDFs. */
const LOCAL_ECOMMERCE_KW = [
  "amazon", "flipkart", "myntra", "meesho", "nykaa", "jiomart", "tatacliq",
  "ajio", "blinkit", "swiggy", "zomato", "bigbasket", "snapdeal", "paytm mall",
  "shopsy", "glowroad", "firstcry", "pepperfry", "urban ladder",
  "dunzo", "zepto", "instamart",
];

/** Retail chains that email PDF receipts from their POS / billing software. */
const LOCAL_RETAIL_KW = [
  // Electronics
  "croma", "reliance digital", "vijay sales", "poorvika", "sangeetha mobile",
  // Fashion / department stores
  "lifestyle", "shoppers stop", "max fashion", "pantaloons", "westside",
  "fbb", "central", "trends", "limeroad",
  // Grocery / hypermarkets
  "dmart", "more supermarket", "star bazaar", "spencer", "reliance fresh",
  "reliance smart",
  // Optical
  "lenskart", "vision express", "specsmakers", "clearfit", "titan eye",
  // Health / Pharmacy
  "apollo pharmacy", "medplus", "netmeds", "pharmeasy", "1mg", "wellness forever",
  "guardian pharmacy",
  // Fuel
  "hp petrol", "indian oil", "bharat petroleum", "iocl", "hpcl", "bpcl",
  "petrol pump", "fuel receipt",
  // Automobile dealers — GST invoices from billing software
  "showroom invoice", "vehicle invoice", "car invoice", "bike invoice",
  "two wheeler invoice", "maruti invoice", "hyundai invoice", "honda invoice",
  "tata motors invoice", "mahindra invoice",
];

/** Telecom bills — all carry structured usage + amount data. */
const LOCAL_TELECOM_KW = [
  "airtel bill", "airtel invoice", "jio bill", "jio invoice",
  "vi bill", "vi invoice", "vodafone bill", "idea bill",
  "bsnl bill", "mtnl bill", "act fibernet", "hathway bill",
  "broadband invoice", "postpaid bill",
];

/** OTT / streaming — digital invoice from billing portal. */
const LOCAL_OTT_KW = [
  "netflix", "hotstar", "disney+", "jiocinema", "sonyliv", "zee5",
  "amazon prime", "prime video", "spotify", "gaana", "wynk",
  "youtube premium", "apple music", "apple one",
];

/** Travel — airline, rail, hotel, cab receipts from booking portals. */
const LOCAL_TRAVEL_KW = [
  "irctc", "train ticket", "e-ticket", "pnr",
  "makemytrip", "cleartrip", "yatra", "ease my trip", "goibibo",
  "indigo", "air india", "spicejet", "akasa", "vistara", "goair",
  "boarding pass", "flight itinerary", "hotel booking", "booking confirmation",
  "ola receipt", "uber receipt", "rapido receipt",
  "redbus", "bus ticket",
];

/** Insurance portals — structured premium receipts from insurer portals. */
const LOCAL_INSURANCE_KW = [
  "lic", "lic premium", "life insurance corporation",
  "hdfc life", "hdfc ergo",
  "icici prudential", "icici lombard",
  "sbi life", "sbi general",
  "bajaj allianz",
  "star health", "star insurance",
  "new india assurance",
  "national insurance",
  "united india insurance",
  "niva bupa", "max bupa",
  "care insurance", "religare health",
  "tata aia", "tata aig",
  "kotak life", "kotak mahindra life",
  "premium receipt", "policy receipt", "renewal premium",
  "insurance premium", "policy renewal notice",
];

/** Government portals — always structured, always local-extractable. */
const LOCAL_GOVT_KW = [
  // Income tax / TDS
  "traces", "form 16", "form 26as", "challan 280", "itns 280",
  "advance tax", "tds certificate", "income tax", "itr", "e-filing",
  // GST
  "gstr", "gst return", "gst portal", "gst invoice", "tax invoice", "gstin",
  // MCA / company
  "mca", "roc filing", "din", "company filing",
  // Property / municipal
  "property tax", "municipal tax", "bmc", "nmmc", "mcgm",
  "passport", "aadhar", "pan card",
];

/** Banking documents — structured enough for local extraction. */
const LOCAL_BANKING_KW = [
  "bank statement", "account statement", "credit card statement",
  "fixed deposit", "fd receipt", "passbook", "loan statement",
  "emi receipt", "repayment schedule",
];

/** SaaS / professional software subscriptions. */
const LOCAL_SAAS_KW = [
  "cleartax", "taxmann", "winman", "computax", "saral tax",
  "tally", "zoho", "quickbooks", "manupatra", "scc online",
  "google ads", "facebook ads", "linkedin ads",
  "github", "gitlab", "figma", "notion", "slack", "dropbox",
  "google workspace", "microsoft 365", "office 365", "adobe",
  "canva", "semrush", "grammarly",
  "99acres", "magicbricks", "housing.com",
  "icai", "bar council", "membership receipt",
];

// Combined local keyword list (filename + subject)
const LOCAL_FILENAME_KW = [
  ...LOCAL_ECOMMERCE_KW,
  ...LOCAL_RETAIL_KW,
  ...LOCAL_TELECOM_KW,
  ...LOCAL_OTT_KW,
  ...LOCAL_TRAVEL_KW,
  ...LOCAL_INSURANCE_KW,
  ...LOCAL_GOVT_KW,
  ...LOCAL_BANKING_KW,
  ...LOCAL_SAAS_KW,
];

// ── LOCAL_FIRST: sender domain sets ──────────────────────────────────────

const LOCAL_SENDER_KW = [
  // E-commerce
  "amazon.in", "amazon.com", "flipkart.com", "myntra.com", "nykaa.com",
  "meesho.com", "swiggy.com", "zomato.com", "bigbasket.com", "snapdeal.com",
  "firstcry.com", "tatacliq.com", "ajio.com", "blinkit.com",
  // Retail / pharmacy
  "croma.com", "reliancedigital.in", "lenskart.com",
  "apollopharmacy.in", "1mg.com", "pharmeasy.in", "medplusmart.com", "netmeds.com",
  // Telecom
  "airtel.in", "jio.com", "vodafoneidea.com", "bsnl.co.in", "mtnl.net.in",
  // OTT / streaming
  "netflix.com", "hotstar.com", "disneyplus.com", "spotify.com",
  "primevideo.com", "sonyliv.com",
  // Travel
  "irctc.co.in", "makemytrip.com", "cleartrip.com", "goibibo.com",
  "goindigo.in", "airindia.in", "spicejet.com",
  "olacabs.com", "uber.com",
  // Insurance portals
  "licindia.in", "hdfclife.com", "iciciprulife.com",
  "starhealth.in", "bajajallianz.com", "bajajallianzlife.com",
  "newindia.co.in", "nationalinsurance.nic.co.in",
  "nivabupa.com", "careinsurance.com", "tataaig.com", "tataaia.com",
  // Government
  "mca.gov.in", "incometaxindia.gov.in", "gst.gov.in", "traces.gov.in",
  "irda.gov.in",
  // Banking / NBFC
  "hdfcbank.com", "icicibank.com", "sbicard.com", "axisbank.com",
  "kotakbank.com", "indusind.com", "yesbank.in",
  // SaaS / professional
  "cleartax.in", "taxmann.com", "winman.com",
  "tally.com", "zoho.com", "quickbooks.com",
  "icai.org", "icai.in",
  "google.com", "microsoft.com", "adobe.com",
];

// ── SKIP: filename / subject keyword sets ────────────────────────────────
// These documents have NO financial data whatsoever — no amount, no merchant,
// no invoice number. Attempting any extraction wastes time and API tokens.

const SKIP_FILENAME_KW = [
  // Society administrative / consent forms
  "stay intimation", "intimation form", "close relative",
  "society form", "society notice", "flat transfer form",
  "transfer form", "flat transfer",
  "nomination form", "nominee form",
  "declaration form", "self declaration", "consent form",
  "no dues certificate", "noc for transfer",
  "visitor pass", "gate pass", "entry pass",
  "member register", "flat register",
  // Identity document scans (no financial data)
  "aadhar card", "aadhaar card", "pan card scan",
  "voter id", "driving license scan", "passport scan",
  // General admin
  "authorization letter", "covering letter", "forwarding letter",
  "complaint letter", "grievance",
];

// ── TEXT_CAPTURE: native-text documents with no financial data ────────────
// These have readable text worth preserving (meeting notices, agreements,
// legal records). Extract the full native text and store it; skip Gemini.

const TEXT_CAPTURE_FILENAME_KW = [
  // Society governance
  "agm", "annual general meeting", "sgm", "special general meeting",
  "minutes of meeting", "meeting notice", "attendance register",
  "resolution", "agenda",
  // Legal agreements
  "rental agreement", "leave and license", "leave & license",
  "service agreement", "maintenance contract",
  // Legal records (native-text only — not scanned deeds)
  "legal notice", "vakalatnama", "court order", "judgment",
  // Society admin text docs
  "noc letter", "no objection letter",
];

// ── GEMINI_DIRECT: filename / subject keyword sets ────────────────────────

const GEMINI_FILENAME_KW = [
  // Negotiable instruments — image scans, no structured data
  "cheque", "check", "demand draft", "dd no", "bearer",
  // Share / society membership documents
  "share certificate", "membership certificate",
  // Legal & property registration documents (typically scanned image PDFs)
  "sale deed", "conveyance deed", "power of attorney", "poa",
  "affidavit", "noc", "no objection certificate",
  "occupation certificate", "completion certificate",
  "allotment letter", "possession letter",
  "stamp paper", "e-stamp", "franking",
  // Personal: service / repair job cards — unstructured thermal/handwritten print
  "job card", "service job card", "repair order", "workshop invoice",
  "service bill", "repair bill", "service estimate",
  // Personal: handwritten / unstructured medical / diagnostic docs
  "prescription", "discharge summary", "lab report", "diagnostic report",
  "pathology report", "radiology report",
  // Miscellaneous scanned government forms
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
  const fn  = (filename    ?? "").toLowerCase();
  const sub = (subject     ?? "").toLowerCase();
  const sndr = (senderEmail ?? "").toLowerCase();

  // "skip" runs first — documents with zero financial data must not waste
  // any extraction time or API tokens.
  if (matchesAny(fn, SKIP_FILENAME_KW) || matchesAny(sub, SKIP_FILENAME_KW)) {
    return "skip";
  }

  // "text_capture" — readable text docs with no financial data worth Gemini.
  // Extract native text and store it directly; no AI call needed.
  if (matchesAny(fn, TEXT_CAPTURE_FILENAME_KW) || matchesAny(sub, TEXT_CAPTURE_FILENAME_KW)) {
    return "text_capture";
  }

  // "gemini_direct" next — non-invoice documents that DO have extractable
  // data (amounts, parties, dates) but no machine-readable invoice structure.
  if (matchesAny(fn, GEMINI_FILENAME_KW) || matchesAny(sub, GEMINI_FILENAME_KW)) {
    return "gemini_direct";
  }

  // "local_first" for known structured sources.
  if (
    matchesAny(fn,   LOCAL_FILENAME_KW) ||
    matchesAny(sub,  LOCAL_FILENAME_KW) ||
    matchesAny(sndr, LOCAL_SENDER_KW)
  ) {
    return "local_first";
  }

  // Default — try local, fall back to Gemini (unchanged pipeline behaviour).
  return "local_first";
}
