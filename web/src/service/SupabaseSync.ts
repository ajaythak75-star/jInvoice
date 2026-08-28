/**
 * Syncs invoices from local Dexie DB → Supabase.
 *
 * Flow per invoice:
 *  1. Upsert vendor (by GSTIN if present, else name+pincode)
 *  2. Upsert invoice (by local_id to avoid duplicates)
 *  3. Upsert line items (delete+reinsert on each sync)
 */
import { supabase } from "../data/supabase";
import { db } from "../data/InvoiceDatabase";
import type { InvoiceMeta, LineItemRow } from "../data/InvoiceDatabase";

type VendorRow = {
  id?: string;
  name: string;
  address: string | null;
  gstin: string | null;
  phone: string | null;
  pincode: string | null;
};

async function upsertVendor(inv: InvoiceMeta): Promise<string | null> {
  if (!supabase) return null;
  if (!inv.merchantName) return null;

  const vendor: VendorRow = {
    name:    inv.merchantName,
    address: inv.merchantAddress ?? null,
    gstin:   inv.merchantGstin   ?? null,
    phone:   inv.merchantPhone   ?? null,
    pincode: inv.merchantPincode ?? null,
  };

  // Look up existing vendor: prefer GSTIN match, fall back to name match
  let existingId: string | null = null;

  if (vendor.gstin) {
    const { data } = await supabase
      .from("vendors")
      .select("id")
      .eq("gstin", vendor.gstin)
      .maybeSingle();
    existingId = data?.id ?? null;
  }

  if (!existingId) {
    const { data } = await supabase
      .from("vendors")
      .select("id")
      .ilike("name", vendor.name)
      .maybeSingle();
    existingId = data?.id ?? null;
  }

  if (existingId) {
    // Update with any new info
    await supabase
      .from("vendors")
      .update({ ...vendor, updated_at: new Date().toISOString() })
      .eq("id", existingId);
    return existingId;
  }

  // Insert new vendor
  const { data, error } = await supabase
    .from("vendors")
    .insert(vendor)
    .select("id")
    .single();

  if (error) { console.warn("[SupabaseSync] vendor insert error", error); return null; }
  return data.id;
}

async function syncInvoice(inv: InvoiceMeta, items: LineItemRow[]): Promise<void> {
  if (!supabase || inv.id == null) return;

  const vendorId = await upsertVendor(inv);

  const invoiceRow = {
    local_id:          inv.id,
    vendor_id:         vendorId,
    invoice_number:    inv.invoiceNumber   ?? null,
    invoice_date:      inv.invoiceDate     ?? null,
    subtotal_paise:    inv.subtotalPaise   ?? null,
    tax_paise:         inv.taxPaise        ?? null,
    discount_paise:    inv.discountPaise   ?? 0,
    grand_total_paise: inv.grandTotalPaise ?? null,
    payment_mode:      inv.paymentMode     ?? null,
    import_source:     inv.importSource,
    pdf_source_type:   inv.pdfSourceType,
    status:            inv.status,
    category:          inv.category        ?? null,
    doc_type:          inv.docType         ?? null,
    doc_types:         inv.docTypes        ?? null,
    source_filename:   inv.sourceFilename  ?? null,
    subject:           inv.subject         ?? null,
    sender_email:      inv.senderEmail     ?? null,
    received_at:       inv.receivedAt      ?? null,
    updated_at:        new Date().toISOString(),
  };

  // Check if already synced by local_id
  const { data: existing } = await supabase
    .from("invoices")
    .select("id")
    .eq("local_id", inv.id)
    .maybeSingle();

  let invoiceSupabaseId: string;

  if (existing?.id) {
    await supabase.from("invoices").update(invoiceRow).eq("id", existing.id);
    invoiceSupabaseId = existing.id;
  } else {
    const { data, error } = await supabase
      .from("invoices")
      .insert(invoiceRow)
      .select("id")
      .single();
    if (error || !data) { console.warn("[SupabaseSync] invoice insert error", error); return; }
    invoiceSupabaseId = data.id;
  }

  // Sync line items — delete then reinsert
  await supabase.from("invoice_items").delete().eq("invoice_id", invoiceSupabaseId);
  if (items.length > 0) {
    await supabase.from("invoice_items").insert(
      items.map((it) => ({
        invoice_id:        invoiceSupabaseId,
        name:              it.name,
        quantity:          it.quantity,
        unit_price_paise:  it.unitPricePaise,
        total_price_paise: it.totalPricePaise,
        discount_paise:    it.discountPaise,
      }))
    );
  }
}

/** Sync a single invoice (call right after insert). */
export async function syncNewInvoice(invoiceId: number): Promise<void> {
  if (!supabase) return;
  try {
    const inv   = await db.invoices.get(invoiceId);
    const items = await db.lineItems.where("invoiceId").equals(invoiceId).toArray();
    if (inv) await syncInvoice(inv, items);
  } catch (e) {
    console.warn("[SupabaseSync] syncNewInvoice failed", e);
  }
}

/** Full sync — push all local invoices to Supabase. Can take a while. */
export async function syncAll(): Promise<{ synced: number; errors: number }> {
  if (!supabase) return { synced: 0, errors: 0 };
  let synced = 0, errors = 0;
  const all = await db.invoices.toArray();
  for (const inv of all) {
    try {
      const items = await db.lineItems.where("invoiceId").equals(inv.id!).toArray();
      await syncInvoice(inv, items);
      synced++;
    } catch {
      errors++;
    }
  }
  return { synced, errors };
}

// ── Customer / Gamification ───────────────────────────────────────────────────

export interface CustomerProfile {
  id: string;
  email: string;
  name: string | null;
  total_spend_paise: number;
  invoice_count: number;
  points: number;
  level: "bronze" | "silver" | "gold" | "platinum";
  badges: string[];
  streak_days: number;
  last_activity_at: string | null;
}

export async function getOrCreateCustomer(email: string, name?: string): Promise<CustomerProfile | null> {
  if (!supabase) return null;
  const { data: existing } = await supabase
    .from("customers")
    .select("*")
    .eq("email", email)
    .maybeSingle();

  if (existing) return existing as CustomerProfile;

  const { data, error } = await supabase
    .from("customers")
    .insert({ email, name: name ?? null })
    .select("*")
    .single();

  if (error) { console.warn("[SupabaseSync] customer create error", error); return null; }
  return data as CustomerProfile;
}

export async function getCustomer(email: string): Promise<CustomerProfile | null> {
  if (!supabase) return null;
  const { data } = await supabase
    .from("customers")
    .select("*")
    .eq("email", email)
    .maybeSingle();
  return (data as CustomerProfile) ?? null;
}

export const LEVEL_THRESHOLDS = {
  bronze:   { min: 0,     label: "Bronze",   next: 1000  },
  silver:   { min: 1000,  label: "Silver",   next: 5000  },
  gold:     { min: 5000,  label: "Gold",     next: 15000 },
  platinum: { min: 15000, label: "Platinum", next: null  },
} as const;

export const BADGE_META: Record<string, { label: string; icon: string }> = {
  first_invoice: { label: "First Invoice",   icon: "🧾" },
  invoice_10:    { label: "10 Invoices",      icon: "📦" },
  invoice_100:   { label: "100 Invoices",     icon: "🏆" },
  spend_10k:     { label: "Spent ₹10,000",    icon: "💸" },
  spend_1l:      { label: "Spent ₹1,00,000",  icon: "💎" },
};

// ── GST Report export ─────────────────────────────────────────────────────────

export interface GSTReportExportRow {
  gstin: string;
  supplierNames: string[];
  invoiceCount: number;
  taxablePaise: number;
  gstPaise: number;
  totalPaise: number;
}

export interface GSTReportExport {
  period: string;
  periodLabel: string;
  fromDate: string | null;
  toDate: string | null;
  totals: { invoices: number; taxablePaise: number; gstPaise: number; totalPaise: number };
  rows: GSTReportExportRow[];
}

export async function saveGstReport(report: GSTReportExport): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.from("gst_reports").insert({
    period:               report.period,
    period_label:         report.periodLabel,
    from_date:            report.fromDate,
    to_date:              report.toDate,
    total_invoices:       report.totals.invoices,
    total_taxable_paise:  report.totals.taxablePaise,
    total_gst_paise:      report.totals.gstPaise,
    total_paise:          report.totals.totalPaise,
    rows:                 report.rows,
    exported_at:          new Date().toISOString(),
  });
  if (error) { console.warn("[SupabaseSync] saveGstReport error", error); return false; }
  return true;
}

// ── Rewards sync ──────────────────────────────────────────────────────────────

export interface RewardsRow {
  user_email: string;
  points: number;
  upload_count: number;
  cloud_sync_count: number;
  history: Array<{ points: number; reason: string; at: string }>;
  last_used_at: string | null;
  disabled_at: string | null;
}

export async function syncRewards(data: RewardsRow): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from("rewards").upsert(
    { ...data, updated_at: new Date().toISOString() },
    { onConflict: "user_email" }
  );
  if (error) console.warn("[SupabaseSync] syncRewards error", error);
}

export async function loadRewards(email: string): Promise<RewardsRow | null> {
  if (!supabase) return null;
  const { data } = await supabase
    .from("rewards")
    .select("user_email,points,upload_count,cloud_sync_count,history,last_used_at,disabled_at")
    .eq("user_email", email)
    .maybeSingle();
  return (data as RewardsRow) ?? null;
}

// ── Customer plan ─────────────────────────────────────────────────────────────

export interface CustomerPlanRow {
  plan: "free" | "pro_shared" | "pro_own";
  plan_status: "inactive" | "trial" | "active";
  billing_cycle: "monthly" | "yearly" | null;
  trial_started_at: string | null;
  plan_updated_at: string | null;
}

export async function saveCustomerPlan(email: string, update: Partial<CustomerPlanRow>): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from("customers").upsert(
    { email, ...update, plan_updated_at: new Date().toISOString() },
    { onConflict: "email" }
  );
  if (error) console.warn("[SupabaseSync] saveCustomerPlan error", error);
}

export async function loadCustomerPlan(email: string): Promise<CustomerPlanRow | null> {
  if (!supabase) return null;
  const { data } = await supabase
    .from("customers")
    .select("plan,plan_status,billing_cycle,trial_started_at,plan_updated_at")
    .eq("email", email)
    .maybeSingle();
  return (data as CustomerPlanRow) ?? null;
}

// ── reqres (API request/response log) ────────────────────────────────────────

export interface ReqresEntry {
  source: string;
  endpoint: string;
  method?: string;
  request?: unknown;
  response?: unknown;
  status_code?: number;
  duration_ms?: number;
  user_email?: string | null;
}

export async function logReqres(entry: ReqresEntry): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.from("reqres").insert({
      source:      entry.source,
      endpoint:    entry.endpoint,
      method:      entry.method ?? "POST",
      request:     entry.request  ?? null,
      response:    entry.response ?? null,
      status_code: entry.status_code ?? null,
      duration_ms: entry.duration_ms ?? null,
      user_email:  entry.user_email  ?? null,
    });
  } catch (e) {
    console.warn("[SupabaseSync] logReqres error", e);
  }
}

// ── customer_gst ──────────────────────────────────────────────────────────────

export interface CustomerGSTView {
  id: string;
  customer_id: string;
  gst_name: string;        // from customer row
  customer_email: string;
  gstin: string;
  state_code: string;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** Register a GSTIN for a customer (looks up customer by email first). */
export async function upsertCustomerGST(
  customerEmail: string,
  gstin: string,
  notes?: string,
): Promise<CustomerGSTView | null> {
  if (!supabase) return null;

  // Resolve customer id
  const { data: customer } = await supabase
    .from("customers")
    .select("id")
    .eq("email", customerEmail)
    .maybeSingle();

  if (!customer?.id) {
    console.warn("[SupabaseSync] upsertCustomerGST: customer not found for", customerEmail);
    return null;
  }

  const { error } = await supabase.from("customer_gst").upsert(
    { customer_id: customer.id, gstin: gstin.toUpperCase(), notes: notes ?? null, is_active: true },
    { onConflict: "gstin" },
  );
  if (error) { console.warn("[SupabaseSync] upsertCustomerGST error", error); return null; }

  return getCustomerGST(gstin);
}

/** Fetch one GST entry with the customer name resolved via the view. */
export async function getCustomerGST(gstin: string): Promise<CustomerGSTView | null> {
  if (!supabase) return null;
  const { data } = await supabase
    .from("customer_gst_view")
    .select("*")
    .eq("gstin", gstin.toUpperCase())
    .maybeSingle();
  return (data as CustomerGSTView) ?? null;
}

/** List all GST registrations for a customer (name included from view). */
export async function listCustomerGSTs(customerEmail: string): Promise<CustomerGSTView[]> {
  if (!supabase) return [];
  const { data } = await supabase
    .from("customer_gst_view")
    .select("*")
    .eq("customer_email", customerEmail)
    .order("created_at", { ascending: false });
  return (data as CustomerGSTView[]) ?? [];
}
