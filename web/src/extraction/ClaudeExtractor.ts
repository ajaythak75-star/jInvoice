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

const PROMPT = `You are an invoice data extractor for Indian businesses. Extract the following fields from the invoice and respond ONLY with a valid JSON object, no explanation or markdown.

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

// Always proxy Gemini calls through the server — keeps the API key server-side,
// avoids CORS, and works identically in Electron and web/Render.
const GEMINI_MODEL = "gemini-3.6-flash";

function geminiEndpoint(): { url: string; isProxy: boolean } {
  return { url: "/api/gemini", isProxy: true };
}

function parseGeminiResponse(data: unknown): ClaudeInvoiceData {
  const parts: any[] = (data as any)?.candidates?.[0]?.content?.parts ?? [];
  // Thinking models (gemini-3.6-flash) prepend a thought part (thought:true) before the output part.
  // Always use the first non-thought part as the model's actual response.
  const outputPart = parts.find((p: any) => !p.thought) ?? parts[0] ?? {};
  const text: string = outputPart.text ?? "{}";
  // Strip markdown fences
  let clean = text.replace(/^```json?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  // If still not JSON, try extracting the first {...} block
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

async function geminiPost(url: string, body: Record<string, unknown>, label: string): Promise<unknown> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  // TEST OVERRIDE: bypass pro check to allow own key — comment out after testing
  const userKey = prefs.geminiApiKey.trim();
  // const userKey = prefs.isProActive ? prefs.geminiApiKey.trim() : ""; // restore this line after testing
  if (userKey) headers["x-gemini-key"] = userKey;

  const attempt = async () => fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  let resp = await attempt();
  for (let retry = 0; retry < 2 && resp.status === 429; retry++) {
    const wait = (retry + 1) * 60_000;
    console.warn(`[Gemini] ${label} rate-limited — retrying in ${wait / 1000}s (attempt ${retry + 2}/3)`);
    await new Promise((r) => setTimeout(r, wait));
    resp = await attempt();
  }

  if (!resp.ok) {
    const err = await resp.text().catch(() => resp.statusText);
    throw new Error(`${label} ${resp.status}: ${err}`);
  }
  return resp.json();
}

async function callGeminiText(rawText: string): Promise<ClaudeInvoiceData> {
  const { url, isProxy } = geminiEndpoint();

  const body: Record<string, unknown> = {
    contents: [{ parts: [{ text: `${PROMPT}\n\nInvoice text:\n\n${rawText.slice(0, 6000)}` }] }],
    generationConfig: { maxOutputTokens: 8192 },
  };
  if (isProxy) body.model = GEMINI_MODEL;

  return parseGeminiResponse(await geminiPost(url, body, "Gemini text API"));
}

async function callGeminiVision(pages: RenderedPage[]): Promise<ClaudeInvoiceData> {
  const { url, isProxy } = geminiEndpoint();

  const imageParts = pages.map((p) => ({
    inline_data: { mime_type: p.mimeType, data: p.data },
  }));

  const body: Record<string, unknown> = {
    contents: [{ parts: [...imageParts, { text: PROMPT }] }],
    generationConfig: { maxOutputTokens: 8192 },
  };
  if (isProxy) body.model = GEMINI_MODEL;

  return parseGeminiResponse(await geminiPost(url, body, "Gemini vision API"));
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
    grandTotalPaise: data.finalPaymentInr != null ? Math.round(data.finalPaymentInr * 100) : invoice.grandTotalPaise,
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
  return callGeminiText(rawText);
}

/** Vision-based extraction — call with rendered PDF page images */
export async function enhanceWithClaudeVision(
  invoice: ExtractedInvoice,
  pages: RenderedPage[],
): Promise<ExtractedInvoice> {
  if (pages.length === 0) return invoice;
  const data = await callGeminiVision(pages);
  return mergeClaudeData(invoice, data);
}

/** Text-based fallback — used when PDF rendering fails or no file is available */
export async function enhanceWithClaude(invoice: ExtractedInvoice): Promise<ExtractedInvoice> {
  if (!invoice.rawText) return invoice;
  const data = await callGeminiText(invoice.rawText);
  return mergeClaudeData(invoice, data);
}
