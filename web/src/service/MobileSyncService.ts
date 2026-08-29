import { insertInvoiceWithItems } from "../data/InvoiceDatabase";
import { detectCategory } from "../core/extraction/CategoryDetector";
import { detectDocType } from "../extraction/DocTypeDetector";
import { prefs } from "../data/AutoImportPreferences";
import { supabase } from "../data/supabase";
import { AUTH_BASE } from "../config";

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

async function ackInvoices(ids: number[], token: string): Promise<void> {
  const base = AUTH_BASE || window.location.origin;
  await fetch(`${base}/api/mobile/ack`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
}

async function saveInvoice(inv: MobileInvoiceRow): Promise<void> {
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
}

async function syncOnce(): Promise<void> {
  if (!prefs.mobileSyncEnabled) return;

  const base = AUTH_BASE || "";
  if (!base) {
    console.warn("[MobileSync] skipped — VITE_AUTH_BASE not configured");
    return;
  }

  // Use Supabase session for auth (auth only, data never touches Supabase)
  const token = supabase
    ? (await supabase.auth.getSession()).data.session?.access_token
    : null;
  if (!token) {
    console.warn("[MobileSync] no auth session — sign out and sign back in");
    return;
  }

  try {
    const r = await fetch(`${base}/api/mobile/pending`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) {
      console.error("[MobileSync] relay error:", r.status);
      return;
    }
    const { invoices: pending } = await r.json() as { invoices: MobileInvoiceRow[] };
    console.log(`[MobileSync] found ${pending?.length ?? 0} pending invoice(s)`);
    if (!pending?.length) return;

    const saved: number[] = [];
    for (const inv of pending) {
      try {
        await saveInvoice(inv);
        saved.push(inv.id);
      } catch (e) {
        console.warn("[MobileSync] failed to save invoice", inv.id, e);
      }
    }

    if (saved.length) {
      await ackInvoices(saved, token);
      window.dispatchEvent(new CustomEvent("jinvoice:sync-complete"));
      console.log(`[MobileSync] pulled ${saved.length} invoice(s)`);
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
