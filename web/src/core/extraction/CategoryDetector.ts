export type ProductCategory =
  | "mobile_smartphone"
  | "electronics"
  | "home_appliance"
  | "eyeglasses_vision"
  | "vehicle"
  | "insurance"
  | "other";

const CATEGORY_KEYWORDS: Array<{ cat: ProductCategory; keywords: string[] }> = [
  {
    cat: "mobile_smartphone",
    keywords: [
      "iphone", "samsung", "oneplus", "redmi", "realme", "oppo", "vivo", "pixel",
      "smartphone", "mobile phone", "motorola", "nokia", "xiaomi", "poco",
    ],
  },
  {
    cat: "electronics",
    keywords: [
      "laptop", "macbook", "thinkpad", "dell", "hp pavilion", "lenovo", "asus", "acer",
      "television", "monitor", "speaker", "headphone", "earphone", "earbuds",
      "camera", "tablet", "ipad", "kindle", "projector", "smartwatch",
    ],
  },
  {
    cat: "home_appliance",
    keywords: [
      "washing machine", "refrigerator", "fridge", "air conditioner", "microwave",
      "dishwasher", "geyser", "water heater", "vacuum cleaner", "mixer", "blender",
      "oven", "chimney", "cooler", "water purifier", "air purifier",
    ],
  },
  {
    cat: "eyeglasses_vision",
    keywords: [
      "spectacles", "eyeglasses", "optical", "vision", "contact lens", "reading glasses",
      "progressive lens", "bifocal", "anti-glare", "eye care",
    ],
  },
  {
    cat: "vehicle",
    keywords: [
      "two wheeler", "two-wheeler", "motorcycle", "scooter", "bajaj", "hero",
      "tvs", "yamaha", "suzuki", "maruti", "hyundai", "tata motors", "mahindra",
      "kia", "mg motor", "ford", "honda cars", "showroom", "dealership", "automobile",
    ],
  },
  {
    cat: "insurance",
    keywords: [
      "premium", "policy no", "insurance", "insured", "coverage", "sum assured",
      "mediclaim", "health plan", "motor insurance", "term plan", "renewal notice",
    ],
  },
];

export function detectCategory(
  merchantName: string | null,
  lineItemNames: string[],
): ProductCategory {
  const haystack = [merchantName ?? "", ...lineItemNames].join(" ").toLowerCase();
  for (const { cat, keywords } of CATEGORY_KEYWORDS) {
    if (keywords.some((kw) => haystack.includes(kw))) return cat;
  }
  return "other";
}

export const WARRANTY_MONTHS: Record<ProductCategory, number | null> = {
  mobile_smartphone: 12,
  electronics: 12,
  home_appliance: 24,
  eyeglasses_vision: 12,
  vehicle: 24,
  insurance: 12,
  other: null,
};
