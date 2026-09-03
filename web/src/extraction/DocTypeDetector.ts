export type DocType =
  | "invoice"
  | "tax"
  | "financial"
  | "payroll"
  | "legal"
  | "society"
  | "utility"
  | "medical"
  | "insurance"
  | "travel"
  | "education"
  | "rent"
  | "shopping"
  | "coupon"
  | "warranty"
  | "other";

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  invoice:   "Invoice",
  tax:       "Tax",
  financial: "Financial",
  payroll:   "Payroll",
  legal:     "Legal",
  society:   "Society",
  utility:   "Utility",
  medical:   "Medical",
  insurance: "Insurance",
  travel:    "Travel",
  education: "Education",
  rent:      "Rent",
  shopping:  "Shopping",
  coupon:    "Coupon",
  warranty:  "Warranty",
  other:     "Other",
};

export const DOC_TYPE_SUBFOLDER: Record<DocType, string> = {
  invoice:   "Invoices",
  tax:       "Tax",
  financial: "Financial",
  payroll:   "Payroll",
  legal:     "Legal",
  society:   "Society",
  utility:   "Utility",
  medical:   "Medical",
  insurance: "Insurance",
  travel:    "Travel",
  education: "Education",
  rent:      "Rent",
  shopping:  "Shopping",
  coupon:    "Coupons",
  warranty:  "Warranty",
  other:     "Other",
};

const TRAVEL_KW = [
  "flight", "airline", "air india", "indigo", "spicejet", "vistara", "akasa", "goair",
  "travel", "trip", "itinerary", "pnr", "boarding", "e-ticket", "train", "irctc",
  "hotel", "hostel", "booking.com", "makemytrip", "cleartrip", "yatra",
  "ola", "uber", "redbus", "bus ticket",
];

const TAX_KW = [
  "income tax", "tds certificate", "form 26as", "gstr", "itr",
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

const FINANCIAL_KW = [
  "emi", "loan", "account statement", "credit card statement", "bank statement",
  "payment schedule", "outstanding", "mutual fund", "statement of account", "loan account",
  "bond", "bonds", "debenture", "ncd", "non-convertible",
  "capital gain", "capital gains", "54ec", "section 54ec",
  "redemption", "allotment", "maturity date",
  "nav", "sip", "dividend", "portfolio", "securities",
  "investment", "rate of interest", "lock-in period", "demat", "dpid", "client id",
];

const INSURANCE_KW = [
  "insurance premium", "policy no", "policy number", "insured", "coverage", "sum assured",
  "mediclaim", "health plan", "motor insurance", "term plan", "renewal notice",
  "lic", "hdfc life", "icici prudential", "bajaj allianz", "star health",
  "new india assurance", "united india insurance", "oriental insurance",
  "premium receipt", "policy receipt", "renewal premium",
];

const PAYROLL_KW = [
  "salary slip", "pay slip", "payslip", "pay stub", "salary statement",
  "pf contribution", "professional tax", "esic", "gratuity",
  "basic salary", "hra", "house rent allowance", "da ", "dearness allowance",
  "gross salary", "net salary", "take home", "ctc", "cost to company",
  "employee id", "employee code", "designation", "department",
  "provident fund", "epf", "nps contribution",
];

const LEGAL_KW = [
  "agreement", "contract", "deed", "affidavit", "mou", "memorandum of understanding",
  "lease agreement", "power of attorney", "legal notice", "court order",
  "arbitration", "undertaking", "indemnity", "notary", "stamp duty",
  "sale deed", "gift deed", "mortgage deed", "conveyance deed",
  "rent agreement", "rental agreement",
];

const SOCIETY_KW = [
  "maintenance bill", "society maintenance", "housing society", "flat no", "flat number",
  "wing ", "maintenance charges", "society fee", "water charges", "parking charges",
  "sinking fund", "repair fund", "noc", "society receipt", "monthly maintenance",
  "quarterly maintenance", "society name", "amenity", "club house",
  "building maintenance", "co-operative housing", "chs", "apartment",
];

const UTILITY_KW = [
  "electricity bill", "electric bill", "eb bill", "power bill", "unit consumed",
  "water bill", "water supply", "gas bill", "piped gas", "natural gas", "lpg",
  "internet bill", "broadband", "postpaid bill", "prepaid recharge",
  "jio", "airtel", "bsnl", "vi ", "vodafone", "idea cellular",
  "bescom", "tata power", "msedcl", "adani electricity", "torrent power",
  "bwssb", "mahanagar gas", "indraprastha gas", "consumer no", "meter reading",
  "telephone bill", "landline", "dth recharge", "cable bill",
];

const MEDICAL_KW = [
  "hospital", "clinic", "pharmacy", "medical store", "doctor", "patient name",
  "consultation", "diagnosis", "prescription", "lab report", "test report",
  "discharge summary", "physiotherapy", "dental", "dentist", "optical",
  "ayurvedic", "homeopathy", "pathology", "radiology", "x-ray", "mri", "ct scan",
  "blood test", "urine test", "ecg", "ultrasound", "biopsy", "endoscopy",
  "medicine", "tablet", "capsule", "syrup", "injection", "apollo", "fortis",
  "max hospital", "aiims", "medanta",
];

const EDUCATION_KW = [
  "school fees", "college fees", "tuition fees", "admission fees", "course fee",
  "exam fee", "semester fee", "library fee", "hostel fee", "coaching",
  "university", "institute", "academy", "school", "college", "academic",
  "student name", "roll no", "class ", "grade ", "scholarship",
  "annual fees", "term fees", "development fees", "transport fees",
];

const RENT_KW = [
  "rent receipt", "monthly rent", "rental receipt", "landlord", "tenant",
  "house rent", "flat rent", "room rent", "pg rent", "accommodation",
  "lease rent", "property rent", "rent payment", "rent for the month",
  "rental income", "rent paid", "lessor", "lessee",
];

const SHOPPING_KW = [
  "amazon", "flipkart", "meesho", "myntra", "ajio", "nykaa", "snapdeal",
  "zepto", "blinkit", "swiggy instamart", "zomato", "bigbasket", "jiomart",
  "reliance fresh", "d-mart", "dmart", "supermarket", "hypermarket",
  "retail invoice", "cash memo", "sale receipt", "mrp", "item count",
  "shopping", "purchase receipt", "store receipt",
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
 */
export function detectDocType(
  merchantName: string | null,
  lineItemNames: string[],
  sourceFilename?: string,
  subject?: string,
  rawText?: string | null,
): DocType[] {
  const pdfText = [merchantName, ...lineItemNames, sourceFilename].filter(Boolean).join(" ").toLowerCase();
  const subText  = (subject  ?? "").toLowerCase();
  const rawLower = (rawText  ?? "").toLowerCase();

  const scores: Record<string, number> = {
    travel:    hits(pdfText, TRAVEL_KW)    + hits(subText, TRAVEL_KW)    * 0.5 + hits(rawLower, TRAVEL_KW)    * 0.25,
    tax:       hits(pdfText, TAX_KW)       + hits(subText, TAX_KW)       * 0.5 + hits(rawLower, TAX_KW)       * 0.25,
    coupon:    hits(pdfText, COUPON_KW)    + hits(subText, COUPON_KW)    * 0.5 + hits(rawLower, COUPON_KW)    * 0.25,
    warranty:  hits(pdfText, WARRANTY_KW)  + hits(subText, WARRANTY_KW)  * 0.5 + hits(rawLower, WARRANTY_KW)  * 0.25,
    financial: hits(pdfText, FINANCIAL_KW) + hits(subText, FINANCIAL_KW) * 0.5 + hits(rawLower, FINANCIAL_KW) * 0.25,
    insurance: hits(pdfText, INSURANCE_KW) + hits(subText, INSURANCE_KW) * 0.5 + hits(rawLower, INSURANCE_KW) * 0.25,
    payroll:   hits(pdfText, PAYROLL_KW)   + hits(subText, PAYROLL_KW)   * 0.5 + hits(rawLower, PAYROLL_KW)   * 0.25,
    legal:     hits(pdfText, LEGAL_KW)     + hits(subText, LEGAL_KW)     * 0.5 + hits(rawLower, LEGAL_KW)     * 0.25,
    society:   hits(pdfText, SOCIETY_KW)   + hits(subText, SOCIETY_KW)   * 0.5 + hits(rawLower, SOCIETY_KW)   * 0.25,
    utility:   hits(pdfText, UTILITY_KW)   + hits(subText, UTILITY_KW)   * 0.5 + hits(rawLower, UTILITY_KW)   * 0.25,
    medical:   hits(pdfText, MEDICAL_KW)   + hits(subText, MEDICAL_KW)   * 0.5 + hits(rawLower, MEDICAL_KW)   * 0.25,
    education: hits(pdfText, EDUCATION_KW) + hits(subText, EDUCATION_KW) * 0.5 + hits(rawLower, EDUCATION_KW) * 0.25,
    rent:      hits(pdfText, RENT_KW)      + hits(subText, RENT_KW)      * 0.5 + hits(rawLower, RENT_KW)      * 0.25,
    shopping:  hits(pdfText, SHOPPING_KW)  + hits(subText, SHOPPING_KW)  * 0.5 + hits(rawLower, SHOPPING_KW)  * 0.25,
    // Invoice gets a small base if merchant was extracted, reduced to 0.3 so a single keyword match in any other type overrides it.
    invoice:   (merchantName != null ? 0.3 : 0)
               + hits(pdfText, INVOICE_KW)
               + hits(subText, INVOICE_KW)  * 0.5
               + hits(rawLower, INVOICE_KW) * 0.25,
  };

  const ranked = (Object.entries(scores) as [string, number][])
    .filter(([, s]) => s > 0)
    .sort(([, a], [, b]) => b - a);

  if (ranked.length === 0) return ["other"];

  const [topType, topScore] = ranked[0];
  const result: DocType[] = [topType as DocType];

  if (ranked.length > 1) {
    const [secondType, secondScore] = ranked[1];
    if (secondScore > topScore * 0.5) {
      result.push(secondType as DocType);
    }
  }

  return result;
}
