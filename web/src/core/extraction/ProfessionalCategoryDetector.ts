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

// ─── Bookkeeper ────────────────────────────────────────────────────────────

export type BookkeeperCategory =
  | "purchases"
  | "sales_income"
  | "payroll"
  | "bank_charges"
  | "tax_payments"
  | "professional_fees"
  | "office_supplies"
  | "rent_utilities"
  | "transport"
  | "other";

export const BOOKKEEPER_CATEGORY_LABEL: Record<BookkeeperCategory, string> = {
  purchases:        "Purchases / Stock",
  sales_income:     "Sales / Income",
  payroll:          "Payroll / Salary",
  bank_charges:     "Bank Charges & Fees",
  tax_payments:     "Tax Payments (GST / TDS)",
  professional_fees:"Professional Fees",
  office_supplies:  "Office Supplies & Admin",
  rent_utilities:   "Rent & Utilities",
  transport:        "Transport & Logistics",
  other:            "Other",
};

const BOOKKEEPER_KEYWORDS: Array<{ cat: BookkeeperCategory; keywords: string[] }> = [
  { cat: "purchases", keywords: [
    "purchase order", "po number", "stock purchase", "supplier invoice", "goods received",
    "material purchase", "raw material", "inventory", "grn", "wholesale", "distributor",
  ]},
  { cat: "sales_income", keywords: [
    "sales invoice", "tax invoice", "customer invoice", "receipt", "credit note",
    "sales return", "debit note", "income", "revenue",
  ]},
  { cat: "payroll", keywords: [
    "salary", "wages", "payroll", "staff payment", "employee", "pf", "provident fund",
    "esic", "bonus", "labour charges", "stipend",
  ]},
  { cat: "bank_charges", keywords: [
    "bank charges", "bank fee", "processing fee", "loan interest", "emi", "dd charges",
    "cheque bounce", "atm fee", "interest debit", "neft charges", "rtgs charges",
  ]},
  { cat: "tax_payments", keywords: [
    "gst", "igst", "cgst", "sgst", "tds", "tcs", "advance tax", "income tax", "gstr",
    "tax payment", "challan", "gst filing", "tax filing", "e-way bill",
  ]},
  { cat: "professional_fees", keywords: [
    "audit fee", "ca fee", "legal fee", "consultant", "advisory", "retainer",
    "chartered accountant", "tax consultant", "professional charges",
  ]},
  { cat: "office_supplies", keywords: [
    "stationery", "office supplies", "printing", "cartridge", "toner", "paper",
    "pen", "folder", "stamp", "postage", "courier admin",
  ]},
  { cat: "rent_utilities", keywords: [
    "rent", "office rent", "electricity bill", "water charges", "broadband",
    "internet bill", "lease", "municipal charges", "maintenance charges",
  ]},
  { cat: "transport", keywords: [
    "transport", "freight", "courier", "delivery charges", "logistics", "petrol",
    "fuel", "travel", "cab", "auto", "vehicle maintenance",
  ]},
];

export function detectBookkeeperCategory(
  merchantName: string | null,
  lineItemNames: string[],
  extraText?: string | null,
): BookkeeperCategory {
  const haystack = buildHaystack(merchantName, lineItemNames, extraText);
  for (const { cat, keywords } of BOOKKEEPER_KEYWORDS) {
    if (keywords.some((kw) => haystack.includes(kw))) return cat;
  }
  return "other";
}

// ─── Freelancer ─────────────────────────────────────────────────────────────

export type FreelancerCategory =
  | "software_tool"
  | "hardware"
  | "coworking"
  | "utilities"
  | "client_income"
  | "travel"
  | "other";

export const FREELANCER_CATEGORY_LABEL: Record<FreelancerCategory, string> = {
  software_tool:  "Software & Tools",
  hardware:       "Hardware & Equipment",
  coworking:      "Co-working Space",
  utilities:      "Utilities",
  client_income:  "Client Fee / Income",
  travel:         "Travel",
  other:          "Other",
};

const FREELANCER_KEYWORDS: { cat: FreelancerCategory; keywords: string[] }[] = [
  { cat: "software_tool", keywords: [
    "figma", "github", "notion", "adobe", "canva", "slack", "zoom", "linear",
    "vercel", "netlify", "aws", "gcp", "azure", "digitalocean", "cloudflare",
    "postman", "jira", "confluence", "dropbox", "google workspace", "microsoft 365",
    "subscription", "saas", "software", "license", "annual plan", "monthly plan",
  ]},
  { cat: "hardware", keywords: [
    "laptop", "monitor", "keyboard", "mouse", "ssd", "hard disk", "webcam",
    "headphones", "microphone", "tablet", "ipad", "external drive", "usb hub",
    "router", "hardware", "computer", "desktop", "printer",
  ]},
  { cat: "coworking", keywords: [
    "coworking", "co-working", "co working", "hot desk", "dedicated desk",
    "day pass", "meeting room", "office space", "seat rental", "workspace",
  ]},
  { cat: "utilities", keywords: [
    "internet", "broadband", "electricity", "mobile recharge", "phone bill",
    "wifi", "utility", "water bill",
  ]},
  { cat: "client_income", keywords: [
    "professional fee", "consulting fee", "project fee", "retainer",
    "client payment", "invoice raised", "service charges",
  ]},
  { cat: "travel", keywords: [
    "flight", "train", "hotel", "cab", "taxi", "fuel", "travel", "accommodation",
    "boarding", "lodging", "air ticket", "bus ticket",
  ]},
];

export function detectFreelancerCategory(
  merchantName: string | null,
  lineItemNames: string[],
  extraText?: string | null,
): FreelancerCategory {
  const haystack = buildHaystack(merchantName, lineItemNames, extraText);
  for (const { cat, keywords } of FREELANCER_KEYWORDS) {
    if (keywords.some((kw) => haystack.includes(kw))) return cat;
  }
  return "other";
}

// ─── NGO / Non-Profit ──────────────────────────────────────────────────────

export type NGOCategory =
  | "donation_receipt"
  | "grant_csr"
  | "project_expense"
  | "staff_costs"
  | "office_admin"
  | "fcra"
  | "80g_certificate"
  | "other";

export const NGO_CATEGORY_LABEL: Record<NGOCategory, string> = {
  donation_receipt: "Donation Receipt",
  grant_csr:        "Grant / CSR Funding",
  project_expense:  "Project Expense",
  staff_costs:      "Staff & HR",
  office_admin:     "Office & Admin",
  fcra:             "FCRA / Foreign Funds",
  "80g_certificate":"80G Certificate",
  other:            "Other",
};

const NGO_KEYWORDS: Array<{ cat: NGOCategory; keywords: string[] }> = [
  { cat: "donation_receipt", keywords: [
    "donation receipt", "charitable donation", "donation acknowledgment", "donor receipt",
    "voluntary contribution", "corpus donation", "general donation", "trust donation",
    "society donation", "ngo donation", "crowdfund",
  ]},
  { cat: "grant_csr", keywords: [
    "csr", "corporate social responsibility", "grant", "funding letter", "grant agreement",
    "project grant", "institutional grant", "bilateral grant", "ministry grant",
    "government grant", "district fund", "mplads", "mlalads",
  ]},
  { cat: "project_expense", keywords: [
    "project", "program expense", "activity expense", "fieldwork", "community",
    "beneficiary", "distribution", "relief material", "aid", "camp expense",
    "training expense", "awareness", "workshop expense",
  ]},
  { cat: "staff_costs", keywords: [
    "salary", "wages", "stipend", "honorarium", "volunteer allowance", "payroll",
    "staff", "employee", "pf", "provident fund", "esic", "gratuity",
  ]},
  { cat: "office_admin", keywords: [
    "rent", "electricity", "broadband", "stationery", "printing", "courier",
    "office maintenance", "audit fee", "ca fee", "legal fee", "registration fee",
    "annual filing", "mca", "roc", "trust renewal",
  ]},
  { cat: "fcra", keywords: [
    "fcra", "foreign contribution", "foreign currency", "foreign grant", "usd",
    "eur", "gbp", "foreign fund", "nri donation", "overseas grant", "fcra receipt",
  ]},
  { cat: "80g_certificate", keywords: [
    "80g", "section 80g", "80-g", "tax exemption certificate", "income tax exemption",
    "form 10be", "donation certificate", "exemption u/s 80g",
  ]},
];

export function detectNGOCategory(
  merchantName: string | null,
  lineItemNames: string[],
  extraText?: string | null,
): NGOCategory {
  const haystack = buildHaystack(merchantName, lineItemNames, extraText);
  for (const { cat, keywords } of NGO_KEYWORDS) {
    if (keywords.some((kw) => haystack.includes(kw))) return cat;
  }
  return "other";
}

// ─── Personal ──────────────────────────────────────────────────────────────

export type PersonalCategory =
  | "grocery_household"
  | "medical_health"
  | "food_dining"
  | "transport_fuel"
  | "education"
  | "entertainment"
  | "utilities_bills"
  | "clothing_lifestyle"
  | "other";

export const PERSONAL_CATEGORY_LABEL: Record<PersonalCategory, string> = {
  grocery_household:  "Grocery & Household",
  medical_health:     "Medical & Health",
  food_dining:        "Food & Dining",
  transport_fuel:     "Transport & Fuel",
  education:          "Education",
  entertainment:      "Entertainment",
  utilities_bills:    "Utilities & Bills",
  clothing_lifestyle: "Clothing & Lifestyle",
  other:              "Other",
};

const PERSONAL_KEYWORDS: Array<{ cat: PersonalCategory; keywords: string[] }> = [
  { cat: "grocery_household", keywords: [
    "grocery", "supermarket", "dmart", "bigbasket", "blinkit", "zepto", "swiggy instamart",
    "reliance fresh", "more", "nature's basket", "vegetables", "fruits", "household",
    "cleaning", "detergent", "toiletries", "personal care",
  ]},
  { cat: "medical_health", keywords: [
    "pharmacy", "medical", "hospital", "clinic", "doctor", "consultation",
    "medicine", "tablet", "capsule", "health checkup", "lab test", "diagnostic",
    "apollo", "practo", "netmeds", "1mg", "health insurance", "dental",
  ]},
  { cat: "food_dining", keywords: [
    "restaurant", "cafe", "zomato", "swiggy", "hotel", "dhaba", "food",
    "lunch", "dinner", "breakfast", "tea", "coffee", "pizza", "burger", "biryani",
  ]},
  { cat: "transport_fuel", keywords: [
    "petrol", "diesel", "fuel", "ola", "uber", "rapido", "auto", "taxi",
    "cab", "metro", "bus", "train ticket", "irctc", "toll", "fastag", "vehicle",
  ]},
  { cat: "education", keywords: [
    "school", "college", "tuition", "coaching", "course", "exam fee", "udemy",
    "coursera", "byju", "unacademy", "books", "stationery", "library", "admission",
    "fees", "educational",
  ]},
  { cat: "entertainment", keywords: [
    "movie", "cinema", "netflix", "hotstar", "amazon prime", "spotify", "youtube",
    "gaming", "steam", "concert", "event ticket", "amusement", "park", "theatre",
    "bookmyshow", "pvr", "inox",
  ]},
  { cat: "utilities_bills", keywords: [
    "electricity", "water", "gas", "lpg", "broadband", "internet", "mobile recharge",
    "dth", "tata sky", "airtel", "jio", "bsnl", "municipal", "maintenance",
  ]},
  { cat: "clothing_lifestyle", keywords: [
    "clothing", "apparel", "fashion", "shoes", "footwear", "accessories",
    "myntra", "ajio", "nykaa", "amazon", "flipkart", "salon", "spa", "beauty",
    "jewellery", "watch",
  ]},
];

export function detectPersonalCategory(
  merchantName: string | null,
  lineItemNames: string[],
  extraText?: string | null,
): PersonalCategory {
  const haystack = buildHaystack(merchantName, lineItemNames, extraText);
  for (const { cat, keywords } of PERSONAL_KEYWORDS) {
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
  | "advocate"
  | "bookkeeper"
  | "freelancer"
  | "ngo";

export const PROFESSIONAL_PROFILE_LABEL: Record<ProfessionalProfile, string> = {
  shopkeeper:     "Shopkeeper",
  tax_consultant: "Tax Consultant",
  ca:             "CA / Accountant",
  real_estate:    "Real Estate Agent",
  advocate:       "Advocate / Lawyer",
  bookkeeper:     "Bookkeeper",
  freelancer:     "Freelancer",
  ngo:            "NGO / Trust / Society",
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
    case "bookkeeper":     return detectBookkeeperCategory(merchantName, lineItemNames, extraText);
    case "freelancer":     return detectFreelancerCategory(merchantName, lineItemNames, extraText);
    case "ngo":            return detectNGOCategory(merchantName, lineItemNames, extraText);
  }
}

export function getProfessionalCategoryLabel(profile: ProfessionalProfile, category: string): string {
  switch (profile) {
    case "shopkeeper":     return SHOPKEEPER_CATEGORY_LABEL[category as ShopkeeperCategory] ?? category;
    case "tax_consultant": return TAX_CONSULTANT_CATEGORY_LABEL[category as TaxConsultantCategory] ?? category;
    case "ca":             return CA_CATEGORY_LABEL[category as CACategory] ?? category;
    case "real_estate":    return REAL_ESTATE_CATEGORY_LABEL[category as RealEstateCategory] ?? category;
    case "advocate":       return ADVOCATE_CATEGORY_LABEL[category as AdvocateCategory] ?? category;
    case "bookkeeper":     return BOOKKEEPER_CATEGORY_LABEL[category as BookkeeperCategory] ?? category;
    case "freelancer":     return FREELANCER_CATEGORY_LABEL[category as FreelancerCategory] ?? category;
    case "ngo":            return NGO_CATEGORY_LABEL[category as NGOCategory] ?? category;
  }
}
