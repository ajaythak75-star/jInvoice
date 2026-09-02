// Category detection for five professional profile types.
// Each type has its own union, label map, and keyword detector —
// mirroring the SocietyExpenseDetector pattern.

// ─── Shopkeeper ────────────────────────────────────────────────────────────

export type ShopkeeperCategory =
  | "purchase"
  | "sales_return"
  | "gst_tax"
  | "rent_utilities"
  | "staff_payroll"
  | "packaging_supplies"
  | "transport_freight"
  | "bank_charges"
  | "shop_maintenance"
  | "other";

export const SHOPKEEPER_CATEGORY_LABEL: Record<ShopkeeperCategory, string> = {
  purchase:            "Purchase / Stock",
  sales_return:        "Sales Return",
  gst_tax:             "GST / Tax",
  rent_utilities:      "Rent & Utilities",
  staff_payroll:       "Staff & Payroll",
  packaging_supplies:  "Packaging & Supplies",
  transport_freight:   "Transport / Freight",
  bank_charges:        "Bank Charges",
  shop_maintenance:    "Shop Maintenance",
  other:               "Other",
};

const SHOPKEEPER_KEYWORDS: Array<{ cat: ShopkeeperCategory; keywords: string[] }> = [
  { cat: "purchase", keywords: [
    "purchase order", "po number", "stock purchase", "goods received", "inventory",
    "wholesale", "distributor", "supplier invoice", "material purchase", "raw material",
    "stock inward", "grn", "goods receipt note",
  ]},
  { cat: "sales_return", keywords: [
    "sales return", "credit note", "return goods", "debit note", "refund", "return invoice",
    "goods returned", "customer return",
  ]},
  { cat: "gst_tax", keywords: [
    "gst", "igst", "cgst", "sgst", "gstr", "tax invoice", "e-way bill", "eway bill",
    "input tax credit", "itc", "gst return", "gst filing", "tax filing", "advance tax",
    "tds", "tcs", "income tax",
  ]},
  { cat: "rent_utilities", keywords: [
    "shop rent", "rent receipt", "electricity bill", "water charges", "broadband",
    "internet bill", "gas bill", "lease", "licence fee", "municipal charges",
  ]},
  { cat: "staff_payroll", keywords: [
    "salary", "wages", "payroll", "staff payment", "labour charges", "employee",
    "pf", "provident fund", "esic", "bonus", "incentive",
  ]},
  { cat: "packaging_supplies", keywords: [
    "packaging", "carton", "box", "bag", "wrapper", "label", "stationery",
    "office supplies", "printing", "carry bag",
  ]},
  { cat: "transport_freight", keywords: [
    "transport", "freight", "courier", "delivery charges", "logistics", "shipping",
    "loading", "unloading", "vehicle hire", "auto rickshaw", "tempo",
  ]},
  { cat: "bank_charges", keywords: [
    "bank charges", "transaction fee", "dd charges", "cheque return", "processing fee",
    "loan emi", "interest charges", "overdraft", "pos charges", "swipe charges",
  ]},
  { cat: "shop_maintenance", keywords: [
    "shop repair", "ac service", "refrigeration", "ac repair", "display board",
    "signage", "cctv", "security", "fire extinguisher", "pest control",
    "shop renovation", "electrician", "plumber",
  ]},
];

export function detectShopkeeperCategory(
  merchantName: string | null,
  lineItemNames: string[],
  extraText?: string | null,
): ShopkeeperCategory {
  const haystack = buildHaystack(merchantName, lineItemNames, extraText);
  for (const { cat, keywords } of SHOPKEEPER_KEYWORDS) {
    if (keywords.some((kw) => haystack.includes(kw))) return cat;
  }
  return "other";
}

// ─── Tax Consultant ────────────────────────────────────────────────────────

export type TaxConsultantCategory =
  | "itr_filing"
  | "gst_return"
  | "tds_tcs"
  | "advance_tax"
  | "professional_fees"
  | "client_reimbursement"
  | "software_subscription"
  | "office_expenses"
  | "other";

export const TAX_CONSULTANT_CATEGORY_LABEL: Record<TaxConsultantCategory, string> = {
  itr_filing:             "ITR Filing",
  gst_return:             "GST Return",
  tds_tcs:                "TDS / TCS",
  advance_tax:            "Advance Tax",
  professional_fees:      "Professional Fees",
  client_reimbursement:   "Client Reimbursement",
  software_subscription:  "Software / Subscription",
  office_expenses:        "Office Expenses",
  other:                  "Other",
};

const TAX_CONSULTANT_KEYWORDS: Array<{ cat: TaxConsultantCategory; keywords: string[] }> = [
  { cat: "itr_filing", keywords: [
    "itr", "income tax return", "return filing", "form 16", "form 26as", "assessment year",
    "ay 20", "income tax department", "e-filing", "tax computation", "refund order",
  ]},
  { cat: "gst_return", keywords: [
    "gstr-1", "gstr-3b", "gstr-9", "gst return", "gst filing", "gst registration",
    "gstin", "gst annual return", "gst reconciliation", "gst audit",
  ]},
  { cat: "tds_tcs", keywords: [
    "tds", "tcs", "form 24q", "form 26q", "form 27q", "tds return", "tds certificate",
    "form 16a", "form 27d", "tan", "deductor", "traces",
  ]},
  { cat: "advance_tax", keywords: [
    "advance tax", "self assessment tax", "challan 280", "itns 280", "tax deposit",
    "quarterly advance", "tax payment",
  ]},
  { cat: "professional_fees", keywords: [
    "professional fees", "consultation fees", "advisory fees", "retainer", "service charges",
    "accounting fees", "tax planning", "professional charges",
  ]},
  { cat: "client_reimbursement", keywords: [
    "reimbursement", "out of pocket", "travel reimbursement", "expense claim",
    "client expenses", "government fees reimbursement",
  ]},
  { cat: "software_subscription", keywords: [
    "taxmann", "clear tax", "cleartax", "winman", "computax", "saral tax",
    "software subscription", "saas", "annual subscription", "license renewal",
    "traces subscription",
  ]},
  { cat: "office_expenses", keywords: [
    "rent", "electricity", "broadband", "stationery", "printing", "courier",
    "office maintenance", "housekeeping",
  ]},
];

export function detectTaxConsultantCategory(
  merchantName: string | null,
  lineItemNames: string[],
  extraText?: string | null,
): TaxConsultantCategory {
  const haystack = buildHaystack(merchantName, lineItemNames, extraText);
  for (const { cat, keywords } of TAX_CONSULTANT_KEYWORDS) {
    if (keywords.some((kw) => haystack.includes(kw))) return cat;
  }
  return "other";
}

// ─── Chartered Accountant (CA) ─────────────────────────────────────────────

export type CACategory =
  | "audit_fees"
  | "tax_filing"
  | "gst_compliance"
  | "roc_mca"
  | "professional_fees"
  | "client_reimbursement"
  | "icai_membership"
  | "office_software"
  | "other";

export const CA_CATEGORY_LABEL: Record<CACategory, string> = {
  audit_fees:           "Audit Fees",
  tax_filing:           "Tax Return Filing",
  gst_compliance:       "GST Compliance",
  roc_mca:              "ROC / MCA Filing",
  professional_fees:    "Professional Fees",
  client_reimbursement: "Client Reimbursement",
  icai_membership:      "ICAI Membership",
  office_software:      "Office & Software",
  other:                "Other",
};

const CA_KEYWORDS: Array<{ cat: CACategory; keywords: string[] }> = [
  { cat: "audit_fees", keywords: [
    "statutory audit", "tax audit", "internal audit", "audit report", "audit fees",
    "limited review", "concurrent audit", "stock audit", "form 3ca", "form 3cb", "form 3cd",
  ]},
  { cat: "tax_filing", keywords: [
    "itr", "income tax return", "form 16", "advance tax", "self assessment",
    "tax computation", "tax filing", "e-filing", "assessment", "tax planning",
  ]},
  { cat: "gst_compliance", keywords: [
    "gst", "gstr", "gst return", "gst registration", "gst audit", "gst reconciliation",
    "annual return", "gstin", "gst advisory",
  ]},
  { cat: "roc_mca", keywords: [
    "roc", "mca", "mca21", "company incorporation", "din", "form mgt", "annual filing",
    "aoc-4", "mgt-7", "director kyc", "company law", "llp filing", "lut",
  ]},
  { cat: "professional_fees", keywords: [
    "professional fees", "consultation", "advisory", "retainer", "chartered accountant",
    "ca fees", "accounting services", "bookkeeping", "payroll service",
  ]},
  { cat: "client_reimbursement", keywords: [
    "reimbursement", "out of pocket", "government fees", "stamp duty", "filing fees",
    "registration charges", "expense recovery",
  ]},
  { cat: "icai_membership", keywords: [
    "icai", "institute of chartered accountants", "membership fee", "cpe", "continuing education",
    "article ship", "training fees", "exam fees",
  ]},
  { cat: "office_software", keywords: [
    "rent", "electricity", "broadband", "stationery", "tally", "zoho",
    "quickbooks", "software license", "subscription", "cloud storage",
  ]},
];

export function detectCACategory(
  merchantName: string | null,
  lineItemNames: string[],
  extraText?: string | null,
): CACategory {
  const haystack = buildHaystack(merchantName, lineItemNames, extraText);
  for (const { cat, keywords } of CA_KEYWORDS) {
    if (keywords.some((kw) => haystack.includes(kw))) return cat;
  }
  return "other";
}

// ─── Real Estate Agent ─────────────────────────────────────────────────────

export type RealEstateCategory =
  | "commission_brokerage"
  | "property_registration"
  | "site_visit"
  | "marketing_ads"
  | "legal_documentation"
  | "client_entertainment"
  | "office_expenses"
  | "other";

export const REAL_ESTATE_CATEGORY_LABEL: Record<RealEstateCategory, string> = {
  commission_brokerage:  "Commission / Brokerage",
  property_registration: "Property Registration",
  site_visit:            "Site Visit Expenses",
  marketing_ads:         "Marketing & Ads",
  legal_documentation:   "Legal & Documentation",
  client_entertainment:  "Client Entertainment",
  office_expenses:       "Office Expenses",
  other:                 "Other",
};

const REAL_ESTATE_KEYWORDS: Array<{ cat: RealEstateCategory; keywords: string[] }> = [
  { cat: "commission_brokerage", keywords: [
    "brokerage", "commission", "agency fee", "finder's fee", "referral fee",
    "sale commission", "brokerage invoice", "agent commission", "rera fee",
  ]},
  { cat: "property_registration", keywords: [
    "registration", "stamp duty", "sub registrar", "sale deed", "conveyance deed",
    "property transfer", "mutation", "khata", "encumbrance certificate", "ec",
    "igr", "registration charges",
  ]},
  { cat: "site_visit", keywords: [
    "site visit", "travel reimbursement", "fuel", "toll", "cab", "ola", "uber",
    "site inspection", "property visit", "vehicle hire",
  ]},
  { cat: "marketing_ads", keywords: [
    "advertisement", "ads", "facebook ads", "google ads", "99acres", "magicbricks",
    "housing.com", "print ad", "newspaper", "hoarding", "banner", "brochure",
    "digital marketing", "seo", "listing fee",
  ]},
  { cat: "legal_documentation", keywords: [
    "agreement to sell", "sale agreement", "power of attorney", "poa", "noc",
    "occupancy certificate", "oc", "completion certificate", "possession letter",
    "allotment letter", "legal fees", "advocate fees", "documentation charges",
  ]},
  { cat: "client_entertainment", keywords: [
    "dinner", "lunch", "restaurant", "hotel", "hospitality", "gift", "entertainment",
    "client meeting", "food & beverage",
  ]},
  { cat: "office_expenses", keywords: [
    "rent", "electricity", "broadband", "stationery", "printing", "software",
    "crm", "subscription", "office maintenance",
  ]},
];

export function detectRealEstateCategory(
  merchantName: string | null,
  lineItemNames: string[],
  extraText?: string | null,
): RealEstateCategory {
  const haystack = buildHaystack(merchantName, lineItemNames, extraText);
  for (const { cat, keywords } of REAL_ESTATE_KEYWORDS) {
    if (keywords.some((kw) => haystack.includes(kw))) return cat;
  }
  return "other";
}

// ─── Advocate / Lawyer ─────────────────────────────────────────────────────

export type AdvocateCategory =
  | "court_fees"
  | "stamp_duty"
  | "client_retainer"
  | "consultation_fees"
  | "legal_notice"
  | "documentation_charges"
  | "bar_council"
  | "office_expenses"
  | "other";

export const ADVOCATE_CATEGORY_LABEL: Record<AdvocateCategory, string> = {
  court_fees:             "Court Fees",
  stamp_duty:             "Stamp Duty",
  client_retainer:        "Client Retainer",
  consultation_fees:      "Consultation Fees",
  legal_notice:           "Legal Notice",
  documentation_charges:  "Documentation Charges",
  bar_council:            "Bar Council Fees",
  office_expenses:        "Office Expenses",
  other:                  "Other",
};

const ADVOCATE_KEYWORDS: Array<{ cat: AdvocateCategory; keywords: string[] }> = [
  { cat: "court_fees", keywords: [
    "court fee", "filing fee", "process fee", "vakalatnama", "court challan",
    "high court", "district court", "supreme court", "tribunal", "arbitration fee",
    "mediation", "lok adalat",
  ]},
  { cat: "stamp_duty", keywords: [
    "stamp duty", "stamp paper", "non-judicial stamp", "e-stamp", "franking",
    "stamp vendor", "court fee stamp",
  ]},
  { cat: "client_retainer", keywords: [
    "retainer", "retainership", "monthly retainer", "annual retainer",
    "legal retainer", "retainer agreement",
  ]},
  { cat: "consultation_fees", keywords: [
    "consultation", "legal opinion", "advisory", "counsel fee", "advocate fee",
    "legal advice", "professional fees", "hearing fee",
  ]},
  { cat: "legal_notice", keywords: [
    "legal notice", "demand notice", "statutory notice", "notice charges",
    "notice drafting", "notice sending", "registered post", "speed post",
  ]},
  { cat: "documentation_charges", keywords: [
    "drafting charges", "documentation", "agreement drafting", "deed drafting",
    "affidavit", "power of attorney", "notary", "attestation", "document preparation",
  ]},
  { cat: "bar_council", keywords: [
    "bar council", "state bar council", "bar association", "bci", "enrollment fee",
    "advocate renewal", "membership fee", "bar registration",
  ]},
  { cat: "office_expenses", keywords: [
    "rent", "electricity", "broadband", "library", "law books", "stationery",
    "printing", "research subscription", "manupatra", "scc online", "taxmann",
  ]},
];

export function detectAdvocateCategory(
  merchantName: string | null,
  lineItemNames: string[],
  extraText?: string | null,
): AdvocateCategory {
  const haystack = buildHaystack(merchantName, lineItemNames, extraText);
  for (const { cat, keywords } of ADVOCATE_KEYWORDS) {
    if (keywords.some((kw) => haystack.includes(kw))) return cat;
  }
  return "other";
}

// ─── Shared ────────────────────────────────────────────────────────────────

function buildHaystack(
  merchantName: string | null,
  lineItemNames: string[],
  extraText?: string | null,
): string {
  const parts = [merchantName ?? "", ...lineItemNames];
  if (extraText) parts.push(extraText.slice(0, 3000));
  return parts.join(" ").toLowerCase();
}

// ─── Unified profile type map ───────────────────────────────────────────────

export type ProfessionalProfile =
  | "shopkeeper"
  | "tax_consultant"
  | "ca"
  | "real_estate"
  | "advocate";

export const PROFESSIONAL_PROFILE_LABEL: Record<ProfessionalProfile, string> = {
  shopkeeper:     "Shopkeeper",
  tax_consultant: "Tax Consultant",
  ca:             "CA / Accountant",
  real_estate:    "Real Estate Agent",
  advocate:       "Advocate / Lawyer",
};

export function detectProfessionalCategory(
  profile: ProfessionalProfile,
  merchantName: string | null,
  lineItemNames: string[],
  extraText?: string | null,
): string {
  switch (profile) {
    case "shopkeeper":     return detectShopkeeperCategory(merchantName, lineItemNames, extraText);
    case "tax_consultant": return detectTaxConsultantCategory(merchantName, lineItemNames, extraText);
    case "ca":             return detectCACategory(merchantName, lineItemNames, extraText);
    case "real_estate":    return detectRealEstateCategory(merchantName, lineItemNames, extraText);
    case "advocate":       return detectAdvocateCategory(merchantName, lineItemNames, extraText);
  }
}

export function getProfessionalCategoryLabel(profile: ProfessionalProfile, category: string): string {
  switch (profile) {
    case "shopkeeper":     return SHOPKEEPER_CATEGORY_LABEL[category as ShopkeeperCategory] ?? category;
    case "tax_consultant": return TAX_CONSULTANT_CATEGORY_LABEL[category as TaxConsultantCategory] ?? category;
    case "ca":             return CA_CATEGORY_LABEL[category as CACategory] ?? category;
    case "real_estate":    return REAL_ESTATE_CATEGORY_LABEL[category as RealEstateCategory] ?? category;
    case "advocate":       return ADVOCATE_CATEGORY_LABEL[category as AdvocateCategory] ?? category;
  }
}
