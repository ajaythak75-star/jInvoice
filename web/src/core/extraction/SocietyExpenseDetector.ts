export type SocietyExpenseCategory =
  | "utilities"
  | "lift_amc"
  | "security"
  | "housekeeping"
  | "civil_work"
  | "insurance"
  | "government_dues"
  | "cheque"
  | "agreement"
  | "share_certificate"
  | "legal_document"
  | "financial_document"
  | "meeting_record"
  | "other";

const SOCIETY_KEYWORDS: Array<{ cat: SocietyExpenseCategory; keywords: string[] }> = [
  {
    cat: "utilities",
    keywords: [
      "electricity", "msedcl", "bescom", "tpddl", "bses", "adani electricity",
      "water charges", "water bill", "piped gas", "mgl", "igl", "mahanagar gas",
      "broadband", "internet", "airtel", "jio fiber", "bsnl",
      "common area electricity", "dg set", "diesel", "generator fuel",
    ],
  },
  {
    cat: "lift_amc",
    keywords: [
      "lift", "elevator", "escalator", "otis", "kone", "schindler", "thyssenkrupp",
      "johnson lifts", "fujitec", "mitsubishi elevator",
    ],
  },
  {
    cat: "security",
    keywords: [
      "security agency", "security guard", "cctv", "surveillance", "intercom",
      "access control", "boom barrier", "watchman", "security services",
      "g4s", "securitas", "topsgrup", "ssd security",
    ],
  },
  {
    cat: "housekeeping",
    keywords: [
      "housekeeping", "cleaning", "sweeping", "pest control", "fumigation",
      "landscaping", "gardening", "garbage", "waste management", "sanitation",
      "janitorial", "caretaker",
    ],
  },
  {
    cat: "civil_work",
    keywords: [
      "civil work", "repair", "renovation", "painting", "plumber", "plumbing",
      "electrician", "waterproofing", "terrace", "flooring", "carpentry",
      "construction", "contractor", "masonry", "tiling",
    ],
  },
  {
    cat: "insurance",
    keywords: [
      "building insurance", "fire insurance", "workmen compensation",
      "lift insurance", "society insurance", "property insurance",
      "premium", "policy", "insurance", "insured",
    ],
  },
  {
    cat: "government_dues",
    keywords: [
      "property tax", "municipal tax", "bmc", "mcgm", "nmmc", "pcmc",
      "professional tax", "labour cess", "stamp duty", "government",
      "municipal corporation", "nagar palika", "registration fees",
    ],
  },
  {
    cat: "cheque",
    keywords: [
      "cheque", "check", "bearer", "pay to", "drawn on", "account payee",
      "bank draft", "demand draft", "dd no",
    ],
  },
  {
    cat: "agreement",
    keywords: [
      "agreement", "contract", "memorandum", "mou", "service agreement",
      "maintenance contract", "amc contract", "terms and conditions",
    ],
  },
  {
    cat: "share_certificate",
    keywords: [
      "share certificate", "share no", "share holder", "equity share",
      "cooperative society share", "society membership", "form no 5",
    ],
  },
  {
    cat: "legal_document",
    keywords: [
      "noc", "no objection", "occupation certificate", "oc certificate",
      "completion certificate", "transfer letter", "mutation", "conveyance deed",
      "sale deed", "possession letter", "allotment letter",
    ],
  },
  {
    cat: "financial_document",
    keywords: [
      "bank statement", "audit report", "balance sheet", "income expenditure",
      "receipt and payment", "fixed deposit", "fd receipt", "passbook",
      "trial balance", "ledger", "chartered accountant",
    ],
  },
  {
    cat: "meeting_record",
    keywords: [
      "agm", "annual general meeting", "special general meeting", "sgm",
      "managing committee", "meeting notice", "minutes of meeting",
      "resolution", "agenda", "attendance register",
    ],
  },
];

export function detectSocietyCategory(
  merchantName: string | null,
  lineItemNames: string[],
  extraText?: string | null,
): SocietyExpenseCategory {
  const parts = [merchantName ?? "", ...lineItemNames];
  if (extraText) parts.push(extraText.slice(0, 3000));
  const haystack = parts.join(" ").toLowerCase();
  for (const { cat, keywords } of SOCIETY_KEYWORDS) {
    if (keywords.some((kw) => haystack.includes(kw))) return cat;
  }
  return "other";
}

export const SOCIETY_CATEGORY_LABEL: Record<SocietyExpenseCategory, string> = {
  utilities:          "Utilities",
  lift_amc:           "Lift / AMC",
  security:           "Security",
  housekeeping:       "Housekeeping",
  civil_work:         "Civil Work",
  insurance:          "Insurance",
  government_dues:    "Government Dues",
  cheque:             "Cheque",
  agreement:          "Agreement",
  share_certificate:  "Share Certificate",
  legal_document:     "Legal Document",
  financial_document: "Financial Document",
  meeting_record:     "Meeting Record",
  other:              "Other",
};
