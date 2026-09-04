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

const PROMPT_TAX = `You are a tax document data extractor for Indian tax and compliance documents.
This document may be an ITR acknowledgment, Challan 280, TDS certificate (Form 16/16A), Form 26AS, advance tax receipt, or GST filing receipt.
Extract the following fields and respond ONLY with a valid JSON object, no explanation or markdown.

{
  "shopName": <assessee name (taxpayer/employee) or deductor/employer name as string, or null>,
  "address": <assessee or deductor address as string, or null>,
  "pincode": <6-digit Indian PIN code as string, or null>,
  "invoiceNumber": <challan number / acknowledgment number / TDS certificate number / BSR code as string, or null>,
  "gstNumber": <PAN of assessee or deductor as string e.g. ABCDE1234F, or null>,
  "gstPercent": <tax rate or surcharge rate if shown as string, or null>,
  "gstAmountInr": <education cess + surcharge combined as number in INR, or null>,
  "subtotalInr": <basic tax before cess/surcharge as number in INR, or null>,
  "dateOfPurchase": <filing date / payment date / deduction date in YYYY-MM-DD format — assume ${new Date().getFullYear()} if year missing, or null>,
  "discountInr": <TDS already deducted or advance tax paid as number in INR, or null>,
  "finalPaymentInr": <total tax paid / TDS deducted / net tax amount as number in INR, or null>,
  "items": [
    {
      "name": <tax component e.g. "Income Tax", "Surcharge", "Education Cess", "Interest u/s 234B", "Interest u/s 234C", "Penalty", "TDS Deducted", "Advance Tax Paid">,
      "quantity": 1,
      "unitPriceInr": null,
      "discountInr": null,
      "amountInr": <amount in INR as number>
    }
  ]
}

Rules:
- ITR acknowledgment: shopName = assessee name; invoiceNumber = acknowledgment number; gstNumber = PAN
- Challan 280: shopName = assessee name; invoiceNumber = CRN/challan number; list each tax head as a separate item
- TDS certificate (Form 16/16A): shopName = employer/deductor name; gstNumber = PAN of employee/deductee; finalPaymentInr = total TDS
- Amounts must be numbers in INR; PAN is 10 characters e.g. AFPPC4942K`;

const PROMPT_LEGAL = `You are a legal document data extractor for Indian property and legal documents.
This document may be a property sale deed, lease or rent agreement, vakalatnama, stamp duty receipt, property registration certificate, court fee receipt, or bar council membership/fee receipt.
Extract the following fields and respond ONLY with a valid JSON object, no explanation or markdown.

{
  "shopName": <primary party name — seller / developer / landlord / client / authority / court name as string, or null>,
  "address": <property address or party address as string, or null>,
  "pincode": <6-digit Indian PIN code as string, or null>,
  "invoiceNumber": <deed number / registration number / case number / agreement number / receipt number as string, or null>,
  "gstNumber": <registration number / stamp duty reference / CIN / bar council number / court case number as string, or null>,
  "gstPercent": <stamp duty rate or GST rate if shown as string, or null>,
  "gstAmountInr": <stamp duty amount as number in INR, or null>,
  "subtotalInr": <consideration / agreement value before charges as number in INR, or null>,
  "dateOfPurchase": <execution date / registration date / agreement date in YYYY-MM-DD format — assume ${new Date().getFullYear()} if year missing, or null>,
  "discountInr": null,
  "finalPaymentInr": <total consideration / total fees paid / total amount as number in INR, or null>,
  "items": [
    {
      "name": <charge type e.g. "Stamp Duty", "Registration Fee", "Legal Fee", "Court Fee", "Bar Council Fee", "Advocate Fee", "Property Value">,
      "quantity": 1,
      "unitPriceInr": null,
      "discountInr": null,
      "amountInr": <amount in INR as number>
    }
  ]
}

Rules:
- Sale deed: shopName = seller/developer name; finalPaymentInr = total sale consideration; list stamp duty + registration fee as items
- Lease/rent agreement: shopName = landlord name; finalPaymentInr = monthly rent or agreement value
- Vakalatnama/retainer: shopName = client or advocate name; finalPaymentInr = retainer/fee amount
- Court fee receipt: shopName = court name; invoiceNumber = case number; finalPaymentInr = court fee paid
- Bar council: shopName = Bar Council of [State]; finalPaymentInr = membership/renewal fee
- Amounts must be numbers in INR`;

const PROMPT_CORPORATE = `You are a corporate document data extractor for Indian company and professional documents.
This document may be a share certificate, audit engagement letter, ICAI/ICSI membership receipt, ROC filing receipt, company incorporation document, or professional fee invoice.
Extract the following fields and respond ONLY with a valid JSON object, no explanation or markdown.

{
  "shopName": <company name / ICAI / ICSI / issuing authority / client company as string, or null>,
  "address": <company registered address as string, or null>,
  "pincode": <6-digit Indian PIN code as string, or null>,
  "invoiceNumber": <certificate number / membership number / receipt number / SRN / DIN as string, or null>,
  "gstNumber": <CIN (Company Identification Number) / folio number / PAN / GSTIN of company as string, or null>,
  "gstPercent": <GST rate if applicable as string, or null>,
  "gstAmountInr": <GST amount if applicable as number in INR, or null>,
  "subtotalInr": null,
  "dateOfPurchase": <issue date / membership date / filing date in YYYY-MM-DD format — assume ${new Date().getFullYear()} if year missing, or null>,
  "discountInr": null,
  "finalPaymentInr": <total paid-up share value / membership fee / filing fee / audit fee as number in INR, or null>,
  "items": [
    {
      "name": <component e.g. "Equity Shares", "Preference Shares", "Annual Membership Fee", "Filing Fee", "Audit Fee">,
      "quantity": <number of shares, or 1 for fees>,
      "unitPriceInr": <face value per share or unit price in INR, or null>,
      "discountInr": null,
      "amountInr": <total amount in INR as number>
    }
  ]
}

Rules:
- Share certificate: shopName = company name; invoiceNumber = certificate number; gstNumber = folio number; items = share classes (Equity/Preference) with quantity = number of shares, unitPriceInr = face value per share
- ICAI/ICSI membership: shopName = "ICAI" or "ICSI"; invoiceNumber = membership number; finalPaymentInr = fee paid
- ROC/company filing: shopName = company name; invoiceNumber = SRN; gstNumber = CIN
- Audit engagement: shopName = client company; finalPaymentInr = audit fee
- Amounts must be numbers in INR`;

const PROMPT_PAYROLL = `You are a payroll document data extractor for Indian salary payslips and compensation statements.
This document is a salary payslip, pay stub, or compensation statement.
Extract the following fields and respond ONLY with a valid JSON object, no explanation or markdown.

{
  "shopName": <employer / company name as string, or null>,
  "address": <company address as string, or null>,
  "pincode": <6-digit Indian PIN code as string, or null>,
  "invoiceNumber": <employee ID / payslip number as string, or null>,
  "gstNumber": <PAN of employee as string e.g. ABCDE1234F, or null>,
  "gstPercent": null,
  "gstAmountInr": null,
  "subtotalInr": <total gross earnings (sum of all earnings) as number in INR, or null>,
  "dateOfPurchase": <last day of the pay period month in YYYY-MM-DD format e.g. 2026-05-31 for May 2026, or null>,
  "discountInr": <total deductions amount as number in INR, or null>,
  "finalPaymentInr": <net pay / take-home salary as number in INR, or null>,
  "items": [
    {
      "name": <component name — prefix ALL earnings with "EARN: " and ALL deductions with "DED: " e.g. "EARN: Basic Salary", "EARN: HRA", "EARN: Performance Pay", "DED: Provident Fund", "DED: Income Tax", "DED: Professional Tax">,
      "quantity": 1,
      "unitPriceInr": null,
      "discountInr": null,
      "amountInr": <amount in INR as positive number>
    }
  ]
}

Rules:
- shopName = employer/company name (e.g. "Tata Consultancy Services")
- invoiceNumber = employee ID or payslip/slip number
- gstNumber = employee PAN
- subtotalInr = total gross earnings before deductions
- discountInr = total deductions (repurposed field)
- finalPaymentInr = net pay (gross − deductions)
- List ALL earnings components first (prefixed "EARN: "), then ALL deductions (prefixed "DED: ")
- Common earnings: Basic Salary, HRA, LTA, Special Allowance, Performance Pay, Car Allowance, City Allowance, NPS Contribution
- Common deductions: Provident Fund, Voluntary PF, Income Tax, Professional Tax, Health Insurance, NPS
- All amounts must be positive numbers in INR`;

function getExtractionPrompt(filename?: string): string {
  const mode = prefs.activeMode;
  if (mode === "society")                              return PROMPT_SOCIETY;
  if (mode === "tax_consultant")                       return PROMPT_TAX;
  if (mode === "ca")                                   return PROMPT_CORPORATE;
  if (mode === "real_estate" || mode === "advocate")   return PROMPT_LEGAL;
  if (filename && /payslip|payroll|salaryslip|salary.?slip|paystub/i.test(filename)) return PROMPT_PAYROLL;
  return PROMPT_INVOICE;
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

async function callOpenAIText(rawText: string, filename?: string): Promise<ClaudeInvoiceData> {
  const body = {
    model: OPENAI_MODEL,
    messages: [
      { role: "user", content: `${getExtractionPrompt(filename)}\n\nDocument text:\n\n${rawText.slice(0, 6000)}` },
    ],
    max_tokens: 4096,
  };
  return parseOpenAIResponse(await openaiPost(body));
}

async function callOpenAIVision(pages: RenderedPage[], filename?: string): Promise<ClaudeInvoiceData> {
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
          { type: "text", text: getExtractionPrompt(filename) },
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
export async function extractWithClaude(rawText: string, filename?: string): Promise<ClaudeInvoiceData> {
  return callOpenAIText(rawText, filename);
}

/** Vision-based extraction — call with rendered PDF page images */
export async function enhanceWithClaudeVision(
  invoice: ExtractedInvoice,
  pages: RenderedPage[],
  filename?: string,
): Promise<ExtractedInvoice> {
  if (pages.length === 0) return invoice;
  const data = await callOpenAIVision(pages, filename);
  return mergeClaudeData(invoice, data);
}

/** Text-based fallback — used when PDF rendering fails or no file is available */
export async function enhanceWithClaude(invoice: ExtractedInvoice, filename?: string): Promise<ExtractedInvoice> {
  if (!invoice.rawText) return invoice;
  const data = await callOpenAIText(invoice.rawText, filename);
  return mergeClaudeData(invoice, data);
}
