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
  subject?: string;
  senderEmail?: string;
  receivedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SentinelRecord {
  id?: number;
  invoiceId: number;
  type: "warranty" | "insurance" | "prescription" | "service_interval";
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

class JInvoiceDB extends Dexie {
  invoices!: Table<InvoiceMeta>;
  lineItems!: Table<LineItemRow>;
  importRecords!: Table<ImportRecord>;
  sentinelRecords!: Table<SentinelRecord>;

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
  }
}

export const db = new JInvoiceDB();

export async function insertInvoiceWithItems(
  invoice: Omit<InvoiceMeta, "id">,
  items: Omit<LineItemRow, "id" | "invoiceId">[]
): Promise<number> {
  return db.transaction("rw", db.invoices, db.lineItems, async () => {
    const id = await db.invoices.add(invoice as InvoiceMeta);
    const invoiceId = id as number;
    for (const item of items) {
      await db.lineItems.add({ ...item, invoiceId });
    }
    return invoiceId;
  });
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
  if (inv.sourceFilename) {
    return `file:${inv.sourceFilename.toLowerCase()}`;
  }
  return null;
}

export async function deduplicateInvoices(): Promise<number> {
  const all = await db.invoices.orderBy("id").toArray();
  const best = new Map<string, InvoiceMeta>(); // key → record to keep

  for (const inv of all) {
    const key = dedupKey(inv);
    if (!key) continue;
    const existing = best.get(key);
    if (!existing) {
      best.set(key, inv);
    } else {
      const invRank = STATUS_RANK[inv.status] ?? 0;
      const exRank  = STATUS_RANK[existing.status] ?? 0;
      if (invRank > exRank) best.set(key, inv); // keep better-quality record
    }
  }

  const keepIds = new Set(Array.from(best.values()).map((r) => r.id!));
  const toDelete = all
    .filter((r) => r.id != null && dedupKey(r) !== null && !keepIds.has(r.id!))
    .map((r) => r.id!);

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
  await db.transaction("rw", db.invoices, db.lineItems, db.importRecords, db.sentinelRecords, async () => {
    await db.invoices.clear();
    await db.lineItems.clear();
    await db.importRecords.clear();
    await db.sentinelRecords.clear();
  });
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
