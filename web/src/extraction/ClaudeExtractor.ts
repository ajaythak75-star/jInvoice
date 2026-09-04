import type { ExtractedInvoice } from "../core/extraction/models";
import type { RenderedPage } from "./WebPdfRenderer";
import { prefs } from "../data/AutoImportPreferences";

export interface ClaudeInvoiceData {
  shopName: string | null;
  address: string | null;
  pincode: string | null;
  invoiceNumber: string | null;
  gstNumber: string | null;
  gstPercent: string | null;
  gstAmountInr: number | null;
  subtotalInr: number | null;
  dateOfPurchase: string | null;
  discountInr: number | null;
  finalPaymentInr: number | null;
  items: Array<{
    name: string;
    quantity: number;
    unitPriceInr: number | null;
    discountInr: number | null;
    amountInr: number;
  }>;
}

const PROMPT_INVOICE = `You are an invoice data extractor for Indian businesses. Extract the following fields from the invoice and respond ONLY with a valid JSON object, no explanation or markdown.

{
  "shopName": <business/shop/merchant name as string, or null>,
  "address": <full merchant/seller address as string — NOT buyer/customer address, or null>,
  "pincode": <6-digit Indian PIN code from merchant address as string, or null>,
  "invoiceNumber": <invoice/bill/receipt number as string, or null>,
  "gstNumber": <merchant GSTIN in format 22AAAAA0000A1Z5, or null>,
  "gstPercent": <tax rate as string e.g. "18%" or "5%", or null>,
  "gstAmountInr": <total GST/tax/CGST+SGST+IGST amount as number in INR, or null>,
  "subtotalInr": <subtotal before GST and discount as number in INR, or null>,
  "dateOfPurchase": <purchase/invoice date in YYYY-MM-DD format — if year is not printed on the receipt assume ${new Date().getFullYear()}, or null>,
  "discountInr": <total discount amount as number in INR, or null>,
  "finalPaymentInr": <grand total / net payable / amount due as number in INR, or null>,
  "items": [
    {
      "name": <item/product/service name as string>,
      "quantity": <quantity as number, use 1 if not shown>,
      "unitPriceInr": <unit/MRP price in INR as number, or null>,
      "discountInr": <per-item discount in INR as number, or null>,
      "amountInr": <line total in INR as number>
    }
  ]
}

Rules:
- Extract merchant/seller details only, NOT buyer/customer details
- Capture all line items visible in the invoice
- Amounts must be numbers (not strings), in INR
- PIN code is a 6-digit number found in the merchant address`;

const PROMPT_SOCIETY = `You are a document data extractor for Indian residential societies and housing expenses.
This document may be a maintenance bill, rent receipt/agreement, insurance policy receipt, lift/equipment AMC invoice, utility bill, or any other housing/society-related financial record.
Extract the following fields and respond ONLY with a valid JSON object, no explanation or markdown.

{
  "shopName": <society name / vendor / landlord / insurer / service company as string, or null>,
  "address": <society or property address as string, or null>,
  "pincode": <6-digit Indian PIN code as string, or null>,
  "invoiceNumber": <bill number / receipt number / agreement number / policy number as string, or null>,
  "gstNumber": <GSTIN if present as string, or null>,
  "gstPercent": <GST rate if shown e.g. "18%" as string, or null>,
  "gstAmountInr": <GST/tax amount as number in INR, or null>,
  "subtotalInr": <subtotal before taxes as number in INR, or null>,
  "dateOfPurchase": <bill date / receipt date / agreement date in YYYY-MM-DD format — assume ${new Date().getFullYear()} if year missing, or null>,
  "discountInr": <discount amount as number in INR, or null>,
  "finalPaymentInr": <total amount due — maintenance total / monthly rent / insurance premium / AMC charge — as number in INR, or null>,
  "items": [
    {
      "name": <charge description e.g. "Monthly Maintenance", "Water Charges", "Parking Charges", "Sinking Fund", "Rent", "Insurance Premium", "AMC Charge">,
      "quantity": <quantity as number, use 1 if not shown>,
      "unitPriceInr": <unit price in INR as number, or null>,
      "discountInr": <per-item discount in INR as number, or null>,
      "amountInr": <line amount in INR as number>
    }
  ]
}

Rules:
- Maintenance bills: shopName = housing society name; list each charge type as a separate item (maintenance, water, parking, sinking fund, repair fund, club, etc.)
- Rent receipts/agreements: shopName = landlord or property name; finalPaymentInr = monthly rent amount
- Insurance policy receipts: shopName = insurance company name; finalPaymentInr = premium paid
- AMC / service contracts: shopName = service vendor name; finalPaymentInr = AMC/contract amount
- Amounts must be numbers (not strings) in INR
- PIN code is a 6-digit number`;

function getExtractionPrompt(): string {
  return prefs.activeMode === "society" ? PROMPT_SOCIETY : PROMPT_INVOICE;
}

const OPENAI_MODEL = "gpt-4o-mini";

function parseOpenAIResponse(data: unknown): ClaudeInvoiceData {
  const text: string = (data as any)?.choices?.[0]?.message?.content ?? "{}";
  let clean = text.replace(/^```json?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  if (!clean.startsWith("{")) {
    const m = clean.match(/\{[\s\S]*\}/);
    clean = m ? m[0] : "{}";
  }
  try {
    return JSON.parse(clean) as ClaudeInvoiceData;
  } catch {
    return { shopName: null, address: null, pincode: null, invoiceNumber: null, gstNumber: null, gstPercent: null, gstAmountInr: null, subtotalInr: null, dateOfPurchase: null, discountInr: null, finalPaymentInr: null, items: [] };
  }
}

async function openaiPost(body: Record<string, unknown>): Promise<unknown> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const userKey = prefs.openaiApiKey.trim();
  if (userKey) headers["x-openai-key"] = userKey;

  const resp = await fetch("/api/openai", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const err = await resp.text().catch(() => resp.statusText);
    throw new Error(`OpenAI ${resp.status}: ${err}`);
  }
  return resp.json();
}

async function callOpenAIText(rawText: string): Promise<ClaudeInvoiceData> {
  const body = {
    model: OPENAI_MODEL,
    messages: [
      { role: "user", content: `${getExtractionPrompt()}\n\nDocument text:\n\n${rawText.slice(0, 6000)}` },
    ],
    max_tokens: 4096,
  };
  return parseOpenAIResponse(await openaiPost(body));
}

async function callOpenAIVision(pages: RenderedPage[]): Promise<ClaudeInvoiceData> {
  const imageContent = pages.map((p) => ({
    type: "image_url",
    image_url: { url: `data:${p.mimeType};base64,${p.data}`, detail: "high" },
  }));

  const body = {
    model: OPENAI_MODEL,
    messages: [
      {
        role: "user",
        content: [
          ...imageContent,
          { type: "text", text: getExtractionPrompt() },
        ],
      },
    ],
    max_tokens: 4096,
  };
  return parseOpenAIResponse(await openaiPost(body));
}

function mergeClaudeData(invoice: ExtractedInvoice, data: ClaudeInvoiceData): ExtractedInvoice {
  return {
    ...invoice,
    merchantName:    data.shopName      ?? invoice.merchantName,
    merchantAddress: data.address       ?? invoice.merchantAddress,
    merchantGstin:   data.gstNumber     ?? invoice.merchantGstin,
    merchantPincode: data.pincode       ?? invoice.merchantPincode,
    invoiceNumber:   data.invoiceNumber ?? invoice.invoiceNumber,
    invoiceDate:     data.dateOfPurchase ?? invoice.invoiceDate,
    subtotalPaise:   data.subtotalInr   != null ? Math.round(data.subtotalInr * 100)      : invoice.subtotalPaise,
    discountPaise:   data.discountInr   != null ? Math.round(data.discountInr * 100)      : invoice.discountPaise,
    taxPaise:        data.gstAmountInr  != null ? Math.round(data.gstAmountInr * 100)     : invoice.taxPaise,
    grandTotalPaise: data.finalPaymentInr != null
      ? Math.round(data.finalPaymentInr * 100)
      : (data.items?.length > 0
          ? data.items.reduce((sum, it) => sum + Math.round(it.amountInr * 100), 0)
          : invoice.grandTotalPaise),
    lineItems: (data.items ?? []).length > 0
      ? (data.items ?? []).map((it) => ({
          name:            it.name,
          quantity:        it.quantity ?? 1,
          unitPricePaise:  it.unitPriceInr != null ? Math.round(it.unitPriceInr * 100) : Math.round(it.amountInr * 100),
          totalPricePaise: Math.round(it.amountInr * 100),
          discountPaise:   it.discountInr != null ? Math.round(it.discountInr * 100) : 0,
        }))
      : invoice.lineItems,
    confidenceScore: Math.max(invoice.confidenceScore, 0.9),
  };
}

/** On-demand export used by ViewScreen */
export async function extractWithClaude(rawText: string): Promise<ClaudeInvoiceData> {
  return callOpenAIText(rawText);
}

/** Vision-based extraction — call with rendered PDF page images */
export async function enhanceWithClaudeVision(
  invoice: ExtractedInvoice,
  pages: RenderedPage[],
): Promise<ExtractedInvoice> {
  if (pages.length === 0) return invoice;
  const data = await callOpenAIVision(pages);
  return mergeClaudeData(invoice, data);
}

/** Text-based fallback — used when PDF rendering fails or no file is available */
export async function enhanceWithClaude(invoice: ExtractedInvoice): Promise<ExtractedInvoice> {
  if (!invoice.rawText) return invoice;
  const data = await callOpenAIText(invoice.rawText);
  return mergeClaudeData(invoice, data);
}
