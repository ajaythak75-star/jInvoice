import { insertInvoiceWithItems } from "../data/InvoiceDatabase";
import { detectCategory } from "../core/extraction/CategoryDetector";
import { detectDocType } from "../extraction/DocTypeDetector";
import { prefs } from "../data/AutoImportPreferences";
import { supabase } from "../data/supabase";

const POLL_INTERVAL_MS = 30_000;
let timerId: ReturnType<typeof setInterval> | null = null;

interface MobileInvoiceRow {
  id: number;
  user_id: string;
  filename?: string | null;
  shop_name?: string | null;
  address?: string | null;
  pincode?: string | null;
  phone?: string | null;
  invoice_number?: string | null;
  gst_number?: string | null;
  gst_percent?: string | null;
  gst_amount_inr?: number | null;
  subtotal_inr?: number | null;
  discount_inr?: number | null;
  final_payment_inr?: number | null;
  date_of_purchase?: string | null;
  // items stored as camelCase JSONB from Gemini extraction
  items?: Array<{
    name: string;
    quantity?: number;
    unitPriceInr?: number | null;
    discountInr?: number | null;
    amountInr?: number | null;
  }> | null;
  pending_sync: boolean;
  synced_at: string | null;
  uploaded_at: string;
}

async function ackInvoice(id: number): Promise<void> {
  if (!supabase) return;
  await supabase
    .from("mobile_invoices")
    .update({ pending_sync: false, synced_at: new Date().toISOString() })
    .eq("id", id);
}

async function saveAndAck(inv: MobileInvoiceRow): Promise<void> {
  const lineItemNames = (inv.items ?? []).map((i) => i.name);
  const category = detectCategory(inv.shop_name ?? null, lineItemNames);
  const docTypes = detectDocType(inv.shop_name ?? null, lineItemNames, inv.filename ?? undefined, undefined);
  const docType = docTypes[0] ?? "other";
  const now = new Date().toISOString();

  await insertInvoiceWithItems(
    {
      merchantName:    inv.shop_name        ?? null,
      merchantAddress: inv.address          ?? null,
      merchantGstin:   inv.gst_number       ?? null,
      merchantPhone:   inv.phone            ?? null,
      merchantPincode: inv.pincode          ?? null,
      invoiceNumber:   inv.invoice_number   ?? null,
      invoiceDate:     inv.date_of_purchase ?? null,
      subtotalPaise:   inv.subtotal_inr     != null ? Math.round(inv.subtotal_inr * 100)     : null,
      taxPaise:        inv.gst_amount_inr   != null ? Math.round(inv.gst_amount_inr * 100)   : null,
      discountPaise:   inv.discount_inr     != null ? Math.round(inv.discount_inr * 100)     : 0,
      grandTotalPaise: inv.final_payment_inr != null ? Math.round(inv.final_payment_inr * 100) : null,
      paymentMode:     null,
      importSource:    "mobile_sync",
      pdfSourceType:   "SCANNED_PDF",
      importRecordId:  null,
      status:          "imported",
      category,
      docType,
      docTypes,
      sourceFilename:  inv.filename ?? undefined,
      createdAt: now,
      updatedAt: now,
    },
    (inv.items ?? []).map((it) => ({
      name:            it.name,
      quantity:        it.quantity ?? 1,
      unitPricePaise:  it.unitPriceInr != null
        ? Math.round(it.unitPriceInr * 100)
        : it.amountInr != null ? Math.round(it.amountInr * 100) : 0,
      totalPricePaise: it.amountInr != null ? Math.round(it.amountInr * 100) : 0,
      discountPaise:   it.discountInr != null ? Math.round(it.discountInr * 100) : 0,
    })),
  );

  await ackInvoice(inv.id);
}

async function syncOnce(): Promise<void> {
  if (!prefs.mobileSyncEnabled) return;
  if (!supabase) return;

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const { data: pending, error } = await supabase
      .from("mobile_invoices")
      .select("*")
      .eq("pending_sync", true)
      .is("synced_at", null);

    if (error || !pending?.length) return;

    let count = 0;
    for (const inv of pending) {
      try {
        await saveAndAck(inv as MobileInvoiceRow);
        count++;
      } catch (e) {
        console.warn("[MobileSync] failed to save invoice", inv.id, e);
      }
    }

    if (count > 0) {
      window.dispatchEvent(new CustomEvent("jinvoice:sync-complete"));
      console.log(`[MobileSync] pulled ${count} invoice(s)`);
    }
  } catch (e) {
    console.warn("[MobileSync] poll error:", e);
  }
}

export async function startMobileSync(): Promise<void> {
  if (timerId) return;
  syncOnce();
  timerId = setInterval(syncOnce, POLL_INTERVAL_MS);
}

export function stopMobileSync(): void {
  if (timerId) {
    clearInterval(timerId);
    timerId = null;
  }
}

export { syncOnce as syncMobileNow };
