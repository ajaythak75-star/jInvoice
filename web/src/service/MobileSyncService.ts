import { insertInvoiceWithItems } from "../data/InvoiceDatabase";
import { detectCategory } from "../core/extraction/CategoryDetector";
import { detectDocType } from "../extraction/DocTypeDetector";
import { prefs } from "../data/AutoImportPreferences";

const POLL_INTERVAL_MS = 30_000;
let timerId: ReturnType<typeof setInterval> | null = null;

// Render relay info — loaded once on startMobileSync
let renderInfo: { renderUrl: string; secret: string } | null = null;

async function loadRenderInfo(): Promise<void> {
  try {
    const r = await fetch("/api/local-info");
    if (!r.ok) return;
    const data = await r.json();
    if (data.renderUrl && data.secret) {
      renderInfo = { renderUrl: data.renderUrl, secret: data.secret };
    }
  } catch {}
}

interface CloudInvoice {
  id: number;
  filename?: string;
  shopName?: string | null;
  address?: string | null;
  pincode?: string | null;
  phone?: string | null;
  invoiceNumber?: string | null;
  gstNumber?: string | null;
  gstPercent?: string | null;
  gstAmountInr?: number | null;
  subtotalInr?: number | null;
  discountInr?: number | null;
  finalPaymentInr?: number | null;
  dateOfPurchase?: string | null;
  items?: Array<{ name: string; quantity?: number; unitPriceInr?: number | null; amountInr?: number }>;
}

async function saveAndAck(inv: CloudInvoice, ackUrl: string, headers: Record<string, string>): Promise<void> {
  const lineItemNames = (inv.items ?? []).map((i) => i.name);
  const category = detectCategory(inv.shopName ?? null, lineItemNames);
  const docTypes = detectDocType(inv.shopName ?? null, lineItemNames, inv.filename, undefined);
  const docType = docTypes[0] ?? "other";
  const now = new Date().toISOString();

  await insertInvoiceWithItems(
    {
      merchantName:    inv.shopName    ?? null,
      merchantAddress: inv.address     ?? null,
      merchantGstin:   inv.gstNumber   ?? null,
      merchantPhone:   inv.phone       ?? null,
      merchantPincode: inv.pincode     ?? null,
      invoiceNumber:   inv.invoiceNumber ?? null,
      invoiceDate:     inv.dateOfPurchase ?? null,
      subtotalPaise:   inv.subtotalInr   != null ? Math.round(inv.subtotalInr * 100)   : null,
      taxPaise:        inv.gstAmountInr  != null ? Math.round(inv.gstAmountInr * 100)  : null,
      discountPaise:   inv.discountInr   != null ? Math.round(inv.discountInr * 100)   : 0,
      grandTotalPaise: inv.finalPaymentInr != null ? Math.round(inv.finalPaymentInr * 100) : null,
      paymentMode:     null,
      importSource:    "mobile_sync",
      pdfSourceType:   "SCANNED_PDF",
      importRecordId:  null,
      status:          "imported",
      category,
      docType,
      docTypes,
      sourceFilename:  inv.filename,
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
      discountPaise:   0,
    })),
  );

  await fetch(ackUrl, { method: "POST", headers });
}

async function pullFrom(pendingUrl: string, ackBase: string, headers: Record<string, string>): Promise<number> {
  const resp = await fetch(pendingUrl, { headers });
  if (!resp.ok) return 0;
  const pending: CloudInvoice[] = await resp.json();
  let count = 0;
  for (const inv of pending) {
    try {
      await saveAndAck(inv, `${ackBase}/${inv.id}`, headers);
      count++;
    } catch (e) {
      console.warn("[MobileSync] failed to save invoice", inv.id, e);
    }
  }
  return count;
}

async function syncOnce(): Promise<void> {
  if (!prefs.mobileSyncEnabled) return;
  try {
    let total = 0;

    // LAN source — localhost bypass, no key needed
    try {
      total += await pullFrom("/api/desktop/pending", "/api/desktop/ack", {});
    } catch {}

    // Render relay source — requires secret key header
    if (renderInfo) {
      try {
        const h = { "x-jinvoice-key": renderInfo.secret };
        total += await pullFrom(
          `${renderInfo.renderUrl}/api/desktop/pending`,
          `${renderInfo.renderUrl}/api/desktop/ack`,
          h,
        );
      } catch {}
    }

    if (total > 0) {
      window.dispatchEvent(new CustomEvent("jinvoice:sync-complete"));
      console.log(`[MobileSync] pulled ${total} invoice(s)`);
    }
  } catch (e) {
    console.warn("[MobileSync] poll error:", e);
  }
}

export async function startMobileSync(): Promise<void> {
  if (timerId) return;
  await loadRenderInfo();
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
