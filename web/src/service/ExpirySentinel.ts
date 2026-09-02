import { db } from "../data/InvoiceDatabase";
import type { SentinelRecord } from "../data/InvoiceDatabase";
import { detectCategory, WARRANTY_MONTHS } from "../core/extraction/CategoryDetector";
import type { ProductCategory } from "../core/extraction/CategoryDetector";

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
