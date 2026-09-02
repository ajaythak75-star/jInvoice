export type SocietyExpenseCategory =
  | "utilities"
  | "lift_amc"
  | "security"
  | "housekeeping"
  | "civil_work"
  | "insurance"
  | "government_dues"
  | "other_expense";

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
      "johnson lifts", "fujitec", "mitsubishi elevator", "amc", "annual maintenance",
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
      "janitorial", "maid", "caretaker",
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
      "professional tax", "labour cess", "stamp duty", "registration",
      "government", "municipal corporation", "nagar palika",
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
  return "other_expense";
}

export const SOCIETY_CATEGORY_LABEL: Record<SocietyExpenseCategory, string> = {
  utilities: "Utilities",
  lift_amc: "Lift / AMC",
  security: "Security",
  housekeeping: "Housekeeping",
  civil_work: "Civil Work",
  insurance: "Insurance",
  government_dues: "Government Dues",
  other_expense: "Other Expense",
};
