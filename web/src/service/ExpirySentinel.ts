import { db } from "../data/InvoiceDatabase";
import type { SentinelRecord } from "../data/InvoiceDatabase";
import { detectCategory, WARRANTY_MONTHS } from "../core/extraction/CategoryDetector";
import type { ProductCategory } from "../core/extraction/CategoryDetector";
import type { UserProfile } from "../data/AutoImportPreferences";

const TYPE_MAP: Record<ProductCategory, SentinelRecord["type"]> = {
  mobile_smartphone: "warranty",
  electronics: "warranty",
  home_appliance: "warranty",
  eyeglasses_vision: "prescription",
  vehicle: "service_interval",
  insurance: "insurance",
  other: "warranty",
};

const LABEL_MAP: Record<ProductCategory, string> = {
  mobile_smartphone: "Warranty",
  electronics: "Warranty",
  home_appliance: "Warranty",
  eyeglasses_vision: "Prescription renewal",
  vehicle: "Service interval / warranty",
  insurance: "Policy renewal",
  other: "Warranty",
};

export async function computeSentinelForInvoice(
  invoiceId: number,
  invoiceDate: string | null,
  merchantName: string | null,
  lineItemNames: string[],
  rawText?: string | null,
): Promise<void> {
  if (!invoiceDate) return;

  const cat = detectCategory(merchantName, lineItemNames, rawText);
  const months = WARRANTY_MONTHS[cat];
  if (!months) return;

  const sentinelType = TYPE_MAP[cat];
  const existing = await db.sentinelRecords
    .where("invoiceId").equals(invoiceId)
    .and((r) => r.type === sentinelType)
    .count();
  if (existing > 0) return;

  const expiresAt = new Date(invoiceDate);
  expiresAt.setMonth(expiresAt.getMonth() + months);

  await db.sentinelRecords.add({
    invoiceId,
    type: sentinelType,
    label: `${LABEL_MAP[cat]} — ${merchantName ?? "Unknown merchant"}`,
    expiresAt: expiresAt.toISOString().slice(0, 10),
    status: "active",
    createdAt: new Date().toISOString(),
  });
}

export async function getActiveSentinels(): Promise<SentinelRecord[]> {
  const all = await db.sentinelRecords.where("status").equals("active").toArray();
  return all.sort((a, b) => a.expiresAt.localeCompare(b.expiresAt));
}

export async function dismissSentinel(id: number): Promise<void> {
  await db.sentinelRecords.update(id, { status: "dismissed" });
}

export async function dismissAllSentinels(): Promise<void> {
  await db.sentinelRecords.where("status").equals("active").modify({ status: "dismissed" });
}

export async function updateSentinelExpiry(id: number, expiresAt: string): Promise<void> {
  await db.sentinelRecords.update(id, { expiresAt });
}

/** Create a fully manual alert with any type. Pass invoiceId > 0 to link it to an invoice record so renames are reflected automatically. */
export async function addManualAlert(
  label: string,
  type: SentinelRecord["type"],
  expiresAt: string,
  reminderDays?: number,
  invoiceId = 0,
  customType?: string,
): Promise<void> {
  const rec: Omit<SentinelRecord, "id"> = {
    invoiceId,
    type,
    label,
    expiresAt,
    status: "active",
    isManual: true,
    createdAt: new Date().toISOString(),
  };
  if (reminderDays != null) rec.reminderDays = reminderDays;
  if (customType?.trim()) rec.customType = customType.trim();
  await db.sentinelRecords.add(rec as SentinelRecord);
}

export async function updateSentinelReminderDays(id: number, reminderDays: number | undefined): Promise<void> {
  await db.sentinelRecords.update(id, { reminderDays });
}

/** Create a warranty sentinel manually when none was auto-detected. */
export async function addManualSentinel(
  invoiceId: number,
  expiresAt: string,
  merchantName: string | null,
): Promise<void> {
  const existing = await db.sentinelRecords
    .where("invoiceId").equals(invoiceId)
    .and((r) => r.type === "warranty")
    .count();
  if (existing > 0) return;
  await db.sentinelRecords.add({
    invoiceId,
    type: "warranty",
    label: `Warranty — ${merchantName ?? "Unknown merchant"}`,
    expiresAt,
    status: "active",
    createdAt: new Date().toISOString(),
  });
}

/**
 * Create a category-specific expiry alert for society and professional profile imports.
 * Each profile category with a natural renewal/due cycle gets a timed sentinel.
 */
export async function computeSentinelForProfileCategory(
  invoiceId: number,
  invoiceDate: string | null,
  category: string,
  mode: UserProfile,
  merchantName: string | null,
): Promise<void> {
  if (!invoiceDate || mode === "personal") return;

  type Rule = { type: SentinelRecord["type"]; label: string; months: number };

  const SOCIETY_RULES: Partial<Record<string, Rule>> = {
    lift_amc:       { type: "amc_renewal",          label: "AMC Renewal",              months: 12 },
    insurance:      { type: "insurance",             label: "Insurance Policy Renewal", months: 12 },
    rent_agreement: { type: "rent_agreement_expiry", label: "Rent Agreement Expiry",    months: 36 },
    agreement:      { type: "agreement_expiry",      label: "Agreement Expiry",         months: 11 },
  };

  const SHOPKEEPER_RULES: Partial<Record<string, Rule>> = {
    gst_tax: { type: "gst_due", label: "GST Return Due", months: 3 },
  };

  const TAX_CONSULTANT_RULES: Partial<Record<string, Rule>> = {
    itr_filing:            { type: "itr_filing",        label: "ITR Filing Reminder",   months: 12 },
    software_subscription: { type: "software_renewal",  label: "Software Renewal",       months: 12 },
  };

  const CA_RULES: Partial<Record<string, Rule>> = {
    icai_membership: { type: "membership_renewal", label: "ICAI Membership Renewal", months: 12 },
    office_software:  { type: "software_renewal",   label: "Software Renewal",         months: 12 },
  };

  const ADVOCATE_RULES: Partial<Record<string, Rule>> = {
    bar_council:     { type: "membership_renewal", label: "Bar Council Renewal",  months: 12 },
    client_retainer: { type: "retainer_renewal",   label: "Retainer Renewal",     months: 12 },
  };

  const REAL_ESTATE_RULES: Partial<Record<string, Rule>> = {
    legal_documentation: { type: "agreement_expiry", label: "Agreement Expiry", months: 11 },
  };

  const PROFILE_RULES: Partial<Record<UserProfile, Partial<Record<string, Rule>>>> = {
    society:        SOCIETY_RULES,
    shopkeeper:     SHOPKEEPER_RULES,
    tax_consultant: TAX_CONSULTANT_RULES,
    ca:             CA_RULES,
    advocate:       ADVOCATE_RULES,
    real_estate:    REAL_ESTATE_RULES,
  };

  const rule = PROFILE_RULES[mode]?.[category];
  if (!rule) return;

  const already = await db.sentinelRecords
    .where("invoiceId").equals(invoiceId)
    .and((r) => r.type === rule.type)
    .count();
  if (already > 0) return;

  const expiresAt = new Date(invoiceDate);
  expiresAt.setMonth(expiresAt.getMonth() + rule.months);

  await db.sentinelRecords.add({
    invoiceId,
    type: rule.type,
    label: `${rule.label} — ${merchantName ?? "Unknown"}`,
    expiresAt: expiresAt.toISOString().slice(0, 10),
    status: "active",
    createdAt: new Date().toISOString(),
  });
}

/** Returns the active warranty sentinel for an invoice, or null. */
export async function getWarrantySentinel(invoiceId: number): Promise<SentinelRecord | null> {
  const rec = await db.sentinelRecords
    .where("invoiceId").equals(invoiceId)
    .and((r) => r.type === "warranty" && r.status === "active")
    .first();
  return rec ?? null;
}

export function daysUntilExpiry(expiresAt: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const exp = new Date(expiresAt);
  return Math.ceil((exp.getTime() - today.getTime()) / 86_400_000);
}
