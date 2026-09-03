import Dexie, { type Table } from "dexie";
import type { InvoiceStatus, PaymentMode, PdfSourceType } from "../core/extraction/models";

export interface InvoiceMeta {
  id?: number;
  merchantName: string | null;
  merchantAddress: string | null;
  merchantGstin: string | null;
  invoiceDate: string | null;
  grandTotalPaise: number | null;
  discountPaise: number;
  taxPaise: number | null;
  paymentMode: PaymentMode | null;
  importSource: string;
  pdfSourceType: PdfSourceType;
  importRecordId: number | null;
  status: InvoiceStatus;
  category?: string;
  docType?: string;
  docTypes?: string[];
  sourceFilename?: string;
  isRenamed?: boolean;
  merchantPhone?: string | null;
  merchantPincode?: string | null;
  invoiceNumber?: string | null;
  subtotalPaise?: number | null;
  platform?: string | null;
  clientTags?: string[];
  projectTag?: string | null;
  extractionNote?: string | null;
  subject?: string;
  senderEmail?: string;
  receivedAt?: string;
  accountEmail?: string | null;
  docMetadata?: Record<string, string> | null;
  createdAt: string;
  updatedAt: string;
}

export interface SentinelRecord {
  id?: number;
  invoiceId: number;
  type:
    | "warranty"
    | "insurance"
    | "prescription"
    | "service_interval"
    | "amc_renewal"
    | "agreement_expiry"
    | "rent_agreement_expiry"
    | "gst_due"
    | "itr_filing"
    | "membership_renewal"
    | "software_renewal"
    | "retainer_renewal";
  label: string;
  expiresAt: string;
  status: "active" | "expired" | "dismissed";
  createdAt: string;
}

export interface LineItemRow {
  id?: number;
  invoiceId: number;
  name: string;
  quantity: number;
  unitPricePaise: number;
  totalPricePaise: number;
  discountPaise: number;
}

export interface ImportRecord {
  id?: number;
  messageId: string;
  source: string;
  status: string;
  importedAt: string;
}

export interface InvoiceRawText {
  id?: number;
  invoiceId: number;
  rawText: string;
}

export interface SecurityAlertRecord {
  id?: number;
  messageId: string;
  importSource: string;
  subject: string;
  senderEmail: string;
  receivedAt: string;
  riskLevel: "medium" | "high";
  reason: string;
  flaggedAt: string;
  dismissed: boolean;
}

export interface InvoicePdfFile {
  id?: number;
  invoiceId: number;
  bytes: Uint8Array;
  filename: string;
}

class JInvoiceDB extends Dexie {
  invoices!: Table<InvoiceMeta>;
  lineItems!: Table<LineItemRow>;
  importRecords!: Table<ImportRecord>;
  sentinelRecords!: Table<SentinelRecord>;
  rawTexts!: Table<InvoiceRawText>;
  securityAlerts!: Table<SecurityAlertRecord>;
  pdfFiles!: Table<InvoicePdfFile>;

  constructor() {
    super("jInvoice");
    this.version(1).stores({
      invoices: "++id, merchantName, invoiceDate, status, importSource",
      lineItems: "++id, invoiceId",
      importRecords: "++id, &messageId, source",
    });
    this.version(2).stores({
      invoices: "++id, merchantName, invoiceDate, status, importSource, category",
      sentinelRecords: "++id, invoiceId, status, expiresAt",
    });
    this.version(3).stores({
      rawTexts: "++id, &invoiceId",
    });
    this.version(4).stores({
      securityAlerts: "++id, &messageId, importSource, dismissed, flaggedAt",
    });
    this.version(5).stores({
      invoices: "++id, merchantName, invoiceDate, status, importSource, category, clientTag",
    });
    this.version(6).stores({
      invoices: "++id, merchantName, invoiceDate, status, importSource, category, *clientTags",
    }).upgrade((tx) =>
      tx.table("invoices").toCollection().modify((inv: any) => {
        if (inv.clientTag && !inv.clientTags?.length) {
          inv.clientTags = [inv.clientTag];
        } else if (!inv.clientTags) {
          inv.clientTags = [];
        }
        delete inv.clientTag;
      })
    );
    this.version(7).stores({
      invoices: "++id, merchantName, invoiceDate, status, importSource, category, *clientTags, projectTag",
    });
    this.version(8).stores({
      pdfFiles: "++id, &invoiceId",
    });
    this.version(9).stores({
      invoices: "++id, merchantName, invoiceDate, status, importSource, category, *clientTags, projectTag, sourceFilename",
    });
  }
}

export const db = new JInvoiceDB();

type AfterInsertHook = (invoiceId: number) => void;
const afterInsertHooks: AfterInsertHook[] = [];
export function registerAfterInsertHook(fn: AfterInsertHook): void {
  afterInsertHooks.push(fn);
}

export async function insertInvoiceWithItems(
  invoice: Omit<InvoiceMeta, "id">,
  items: Omit<LineItemRow, "id" | "invoiceId">[]
): Promise<number> {
  const invoiceId = await db.transaction("rw", db.invoices, db.lineItems, async () => {
    const id = await db.invoices.add(invoice as InvoiceMeta);
    const iid = id as number;
    for (const item of items) {
      await db.lineItems.add({ ...item, invoiceId: iid });
    }
    return iid;
  });
  afterInsertHooks.forEach((fn) => fn(invoiceId));
  return invoiceId;
}

export async function markAsDuplicate(invoiceId: number): Promise<void> {
  await db.invoices.update(invoiceId, { status: "duplicate", updatedAt: new Date().toISOString() });
}

export async function isDuplicateByFilename(filename: string): Promise<boolean> {
  if (!filename) return false;
  const count = await db.invoices
    .where("sourceFilename").equals(filename)
    .filter((inv) => inv.status !== "duplicate")
    .count();
  return count > 0;
}

// Returns a filename with _duplicate(N) suffix that doesn't yet exist in the DB.
// e.g. "bill.pdf" → "bill_duplicate(1).pdf", or "bill_duplicate(2).pdf" if 1 is taken.
export async function nextDuplicateFilename(baseFilename: string): Promise<string> {
  const dotIdx = baseFilename.lastIndexOf(".");
  const stem = dotIdx >= 0 ? baseFilename.slice(0, dotIdx) : baseFilename;
  const ext  = dotIdx >= 0 ? baseFilename.slice(dotIdx) : "";
  let n = 1;
  while (n < 100) {
    const candidate = `${stem}_duplicate(${n})${ext}`;
    const count = await db.invoices.where("sourceFilename").equals(candidate).count();
    if (count === 0) return candidate;
    n++;
  }
  return `${stem}_duplicate(${Date.now()})${ext}`;
}

export async function isDuplicateInvoice(
  merchantName: string | null,
  grandTotalPaise: number | null,
  invoiceDate: string | null,
  excludeId?: number,
  invoiceNumber?: string | null,
): Promise<boolean> {
  if (!merchantName || grandTotalPaise == null || !invoiceDate) return false;
  const lower = merchantName.toLowerCase();
  const candidates = await db.invoices
    .filter(
      (inv) =>
        inv.merchantName?.toLowerCase() === lower &&
        inv.grandTotalPaise === grandTotalPaise &&
        inv.invoiceDate === invoiceDate &&
        (inv.status === "imported" || inv.status === "pending_review") &&
        inv.id !== excludeId,
    )
    .toArray();

  if (candidates.length === 0) return false;

  // If this invoice has a known invoice number, only count candidates with the SAME number
  // (or no number). Different invoice numbers on the same merchant+amount+date = distinct bills.
  if (invoiceNumber?.trim()) {
    const num = invoiceNumber.trim().toLowerCase();
    return candidates.some(
      (c) => !c.invoiceNumber?.trim() || c.invoiceNumber.trim().toLowerCase() === num,
    );
  }

  return true;
}

export async function isAlreadyImported(messageId: string): Promise<boolean> {
  return (await db.importRecords.where("messageId").equals(messageId).count()) > 0;
}

export async function markAsImported(messageId: string, source: string): Promise<void> {
  const exists = await isAlreadyImported(messageId);
  if (!exists) {
    await db.importRecords.add({ messageId, source, status: "imported", importedAt: new Date().toISOString() });
  }
}

export async function clearImportHistory(): Promise<void> {
  await db.importRecords.clear();
}

const STATUS_RANK: Record<string, number> = {
  imported: 4, pending_review: 3, downloaded: 2, extraction_failed: 1, import_blocked_encrypted: 0,
};

function dedupKey(inv: InvoiceMeta): string | null {
  if (inv.merchantName && inv.grandTotalPaise != null && inv.invoiceDate) {
    return `content:${inv.merchantName.toLowerCase()}|${inv.grandTotalPaise}|${inv.invoiceDate}`;
  }
  // No filename fallback — same filename from different emails are distinct invoices.
  return null;
}

export async function deduplicateInvoices(): Promise<number> {
  const all = await db.invoices.orderBy("id").toArray();
  const groups = new Map<string, InvoiceMeta[]>();

  for (const inv of all) {
    const key = dedupKey(inv);
    if (!key) continue;
    const group = groups.get(key) ?? [];
    group.push(inv);
    groups.set(key, group);
  }

  const toDelete: number[] = [];

  for (const group of groups.values()) {
    if (group.length <= 1) continue;

    // Records in the same merchant+amount+date group that have DIFFERENT invoice numbers
    // are distinct bills — do not collapse them.
    const invoiceNums = group
      .map((r) => r.invoiceNumber?.trim().toLowerCase())
      .filter(Boolean) as string[];
    const uniqueNums = new Set(invoiceNums);
    if (uniqueNums.size > 1) continue;

    // Keep the best-quality record, delete the rest
    const ranked = [...group].sort(
      (a, b) => (STATUS_RANK[b.status] ?? 0) - (STATUS_RANK[a.status] ?? 0),
    );
    for (const inv of ranked.slice(1)) {
      if (inv.id != null) toDelete.push(inv.id);
    }
  }

  if (toDelete.length > 0) {
    await db.transaction("rw", db.invoices, db.lineItems, async () => {
      for (const id of toDelete) {
        await db.lineItems.where("invoiceId").equals(id).delete();
        await db.invoices.delete(id);
      }
    });
  }

  return toDelete.length;
}

export async function clearAllData(): Promise<void> {
  await db.transaction("rw", [db.invoices, db.lineItems, db.importRecords, db.sentinelRecords, db.rawTexts, db.securityAlerts], async () => {
    await db.invoices.clear();
    await db.lineItems.clear();
    await db.importRecords.clear();
    await db.sentinelRecords.clear();
    await db.rawTexts.clear();
    await db.securityAlerts.clear();
  });
}

export async function addSecurityAlert(alert: Omit<SecurityAlertRecord, "id">): Promise<void> {
  const exists = await db.securityAlerts.where("messageId").equals(alert.messageId).count();
  if (!exists) await db.securityAlerts.add(alert);
}

export async function getActiveSecurityAlerts(): Promise<SecurityAlertRecord[]> {
  return db.securityAlerts.where("dismissed").equals(0).reverse().sortBy("flaggedAt");
}

export async function dismissSecurityAlert(id: number): Promise<void> {
  await db.securityAlerts.update(id, { dismissed: true });
}

export async function searchByMerchant(query: string): Promise<InvoiceMeta[]> {
  const lower = query.toLowerCase();
  return db.invoices
    .filter(
      (inv) =>
        inv.merchantName?.toLowerCase().includes(lower) ||
        inv.merchantAddress?.toLowerCase().includes(lower) ||
        false
    )
    .limit(50)
    .toArray();
}
