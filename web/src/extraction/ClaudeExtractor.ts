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
  // Society-specific extras (quotations + AGM records)
  validUntil?: string | null;
  paymentTerms?: string | null;
  warrantyPeriod?: string | null;
  resolutionNo?: string | null;
  attendeeCount?: string | null;
  meetingType?: string | null;
  // Maintenance receipts: flat/unit number (e.g. "A-101")
  flatUnit?: string | null;
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
This document may be a maintenance bill, rent receipt/agreement, insurance policy receipt, lift/equipment AMC invoice, utility bill, vendor quotation, AGM/meeting minutes, or any other housing/society-related financial record.
Extract the following fields and respond ONLY with a valid JSON object, no explanation or markdown.

{
  "shopName": <society name / vendor / landlord / insurer / service company as string, or null>,
  "address": <society or property address as string, or null>,
  "pincode": <6-digit Indian PIN code as string, or null>,
  "invoiceNumber": <bill number / receipt number / quotation number / agreement number / policy number as string, or null>,
  "gstNumber": <GSTIN if present as string, or null>,
  "gstPercent": <GST rate if shown e.g. "18%" as string, or null>,
  "gstAmountInr": <GST/tax amount as number in INR, or null>,
  "subtotalInr": <subtotal before taxes as number in INR, or null>,
  "dateOfPurchase": <bill date / receipt date / quotation date / meeting date in YYYY-MM-DD format — assume ${new Date().getFullYear()} if year missing, or null>,
  "discountInr": <discount amount as number in INR, or null>,
  "finalPaymentInr": <total amount due — maintenance total / monthly rent / insurance premium / AMC charge / quotation total — as number in INR, or null>,
  "items": [
    {
      "name": <charge / scope description e.g. "Monthly Maintenance", "Water Charges", "Sinking Fund", "Exterior Painting", "Waterproofing", "Labour Charges">,
      "quantity": <quantity as number, use 1 if not shown>,
      "unitPriceInr": <unit price in INR as number, or null>,
      "discountInr": <per-item discount in INR as number, or null>,
      "amountInr": <line amount in INR as number>
    }
  ],
  "validUntil": <quotation validity / expiry date in YYYY-MM-DD format, or null — only for quotations>,
  "paymentTerms": <payment terms e.g. "50% advance, balance on completion" as string, or null — for quotations and agreements>,
  "warrantyPeriod": <warranty or defect-liability period offered e.g. "1 year" as string, or null — for quotations>,
  "resolutionNo": <resolution number or reference from meeting minutes as string, or null — only for AGM/SGM/committee meeting records>,
  "attendeeCount": <number of members / attendees present at the meeting as string e.g. "42", or null — only for meeting records>,
  "meetingType": <type of meeting e.g. "AGM", "SGM", "EGM", "Committee Meeting" as string, or null — only for meeting records>,
  "flatUnit": <flat or unit number of the member / resident e.g. "A-101", "B-202", "301" — extract from any "Flat / Unit", "Flat No", "Unit No", "Received From Flat", or "Member" field on any document type, or null if not present>
}

Rules:
- Maintenance bills: shopName = housing society name; list each charge type as a separate item (maintenance, water, parking, sinking fund, repair fund, club, etc.)
- Rent receipts/agreements: shopName = landlord or property name; finalPaymentInr = monthly rent amount
- Insurance policy receipts: shopName = insurance company name; finalPaymentInr = premium paid
- AMC / service contracts: shopName = service vendor name; finalPaymentInr = AMC/contract amount
- Vendor quotations: shopName = vendor/contractor name; finalPaymentInr = quoted total; populate validUntil, paymentTerms, warrantyPeriod where present
- AGM/SGM/meeting minutes: shopName = society name; dateOfPurchase = meeting date; populate resolutionNo, attendeeCount, meetingType; finalPaymentInr = null unless a specific expenditure was approved
- Amounts must be numbers (not strings) in INR
- Leave validUntil, paymentTerms, warrantyPeriod, resolutionNo, attendeeCount, meetingType as null for documents where they don't apply
- flatUnit: extract whenever a flat, unit, or member number is printed on the document regardless of document type; leave null only when completely absent
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

const PROMPT_REALESTATE = `You are a real estate document data extractor for Indian property transactions.
This document may be a sale deed, registration receipt, stamp duty challan, RERA payment receipt, home loan statement, rental agreement, TDS 194IA challan, or capital gains worksheet.
Extract the following fields and respond ONLY with a valid JSON object, no explanation or markdown.

{
  "shopName": <seller / developer / bank / Sub-Registrar office name as string, or null>,
  "address": <property address as string, or null>,
  "pincode": <6-digit PIN code of the property as string, or null>,
  "invoiceNumber": <registration number / challan number / receipt number as string, or null>,
  "gstNumber": <seller GSTIN or PAN of the primary party as string, or null>,
  "gstPercent": <GST percent as number if applicable, or null>,
  "gstAmountInr": <GST amount in INR as number, or null>,
  "subtotalInr": <property value / loan principal / stamp duty base value as number in INR, or null>,
  "dateOfPurchase": <transaction date in YYYY-MM-DD format, or null>,
  "discountInr": null,
  "finalPaymentInr": <total amount paid in this transaction as number in INR, or null>,
  "items": [
    {
      "name": <component e.g. "Stamp Duty", "Registration Fee", "TDS 194IA", "RERA Advance", "EMI Principal", "EMI Interest", "Property Value", "Capital Gain">,
      "quantity": 1,
      "unitPriceInr": null,
      "discountInr": null,
      "amountInr": <amount in INR as positive number>
    }
  ]
}

Rules:
- shopName = seller / developer / bank / registrar office name
- invoiceNumber = document registration number, challan number, or receipt number
- subtotalInr = base property value, loan principal, or stamp duty base
- finalPaymentInr = total amount paid in this transaction
- For TDS 194IA: list TDS amount as item "TDS 194IA"; applies when property value exceeds ₹50,00,000
- For home loan EMI: list "EMI Principal" and "EMI Interest" as separate items
- For stamp duty receipts: list "Stamp Duty" and "Registration Fee" as separate items
- All amounts must be positive numbers in INR`;

const PROMPT_ADVOCATE = `You are a legal professional document data extractor for Indian advocates and law firms.
This document may be a court fee receipt, process fee receipt, stamp paper, vakalatnama, advocate fee invoice, law library subscription, disbursement receipt, or legal filing receipt.
Extract the following fields and respond ONLY with a valid JSON object, no explanation or markdown.

{
  "shopName": <court / law firm / vendor / party name as string, or null>,
  "address": <address as string, or null>,
  "pincode": <6-digit PIN code as string, or null>,
  "invoiceNumber": <case number / matter number / receipt number as string, or null>,
  "gstNumber": <vendor GSTIN or advocate bar registration number as string, or null>,
  "gstPercent": <GST percent as number if applicable, or null>,
  "gstAmountInr": <GST amount in INR as number, or null>,
  "subtotalInr": <total before GST/tax as number in INR, or null>,
  "dateOfPurchase": <date in YYYY-MM-DD format, or null>,
  "discountInr": null,
  "finalPaymentInr": <total amount paid as number in INR, or null>,
  "items": [
    {
      "name": <component e.g. "Court Filing Fee", "Process Fee", "Stamp Paper", "Advocate Fee", "SCC Online Subscription", "Manupatra Subscription", "Travel Disbursement", "Miscellaneous Charges">,
      "quantity": 1,
      "unitPriceInr": null,
      "discountInr": null,
      "amountInr": <amount in INR as positive number>
    }
  ]
}

Rules:
- shopName = court name, law firm, or vendor name
- invoiceNumber = case/matter number or receipt/invoice number
- gstNumber = vendor GSTIN if available, else advocate bar registration number
- subtotalInr = amount before GST
- finalPaymentInr = total amount paid
- Law library subscriptions: list as separate items (SCC Online, Manupatra, LexisNexis)
- All amounts must be positive numbers in INR`;

const PROMPT_CA = `You are a professional services document data extractor for Indian Chartered Accountants and accounting firms.
This document may be a professional fee invoice, audit fee invoice, ICAI seminar receipt, software subscription (Tally, ClearTax, Computax, MCA portal), DSC renewal receipt, client fee receipt, or GST registration fee challan.
Extract the following fields and respond ONLY with a valid JSON object, no explanation or markdown.

{
  "shopName": <firm / client / vendor / ICAI / software vendor name as string, or null>,
  "address": <address as string, or null>,
  "pincode": <6-digit PIN code as string, or null>,
  "invoiceNumber": <invoice number / engagement number / receipt number as string, or null>,
  "gstNumber": <vendor GSTIN as string, or null>,
  "gstPercent": <GST percent as number if applicable (usually 18% on professional services), or null>,
  "gstAmountInr": <GST amount in INR as number, or null>,
  "subtotalInr": <amount before GST as number in INR, or null>,
  "dateOfPurchase": <date in YYYY-MM-DD format, or null>,
  "discountInr": null,
  "finalPaymentInr": <total amount paid as number in INR, or null>,
  "items": [
    {
      "name": <service e.g. "Statutory Audit Fee", "Tax Audit Fee", "GST Filing Fee", "Tally Prime Subscription", "ClearTax Subscription", "ICAI CPE Seminar", "DSC Renewal", "MCA Portal Fee", "Professional Fee">,
      "quantity": 1,
      "unitPriceInr": null,
      "discountInr": null,
      "amountInr": <amount in INR as positive number>
    }
  ]
}

Rules:
- shopName = client firm name, software vendor, ICAI, or service provider
- invoiceNumber = invoice/engagement/receipt number
- gstNumber = vendor GSTIN (18% GST typically applies on professional services)
- subtotalInr = amount before GST
- finalPaymentInr = total including GST
- Identify audit type: statutory / tax / internal / concurrent
- Software subscriptions: note renewal period in item name if visible
- All amounts must be positive numbers in INR`;

const PROMPT_BOOKKEEPER = `You are a vendor invoice data extractor for Indian bookkeepers managing multiple client accounts.
This document is a vendor invoice or purchase bill. Extract all fields with special attention to GSTIN, HSN/SAC codes, and GST breakdown for purchase register compliance.
Extract the following fields and respond ONLY with a valid JSON object, no explanation or markdown.

{
  "shopName": <vendor / supplier name as string, or null>,
  "address": <vendor address as string, or null>,
  "pincode": <6-digit vendor PIN code as string, or null>,
  "invoiceNumber": <vendor invoice number as string, or null>,
  "gstNumber": <vendor GSTIN as string — critical field, extract carefully, or null>,
  "gstPercent": <GST rate as number (0, 5, 12, 18, 28), or null>,
  "gstAmountInr": <total GST amount in INR as number, or null>,
  "subtotalInr": <taxable value before GST as number in INR, or null>,
  "dateOfPurchase": <invoice date in YYYY-MM-DD format, or null>,
  "discountInr": <discount amount in INR as number, or null>,
  "finalPaymentInr": <total invoice amount including GST as number in INR, or null>,
  "items": [
    {
      "name": <item/service description — include HSN/SAC code if printed e.g. "Office Supplies [HSN 4820]">,
      "quantity": <quantity as number>,
      "unitPriceInr": <unit price in INR as number, or null>,
      "discountInr": null,
      "amountInr": <line total in INR as positive number>
    }
  ]
}

Rules:
- gstNumber = vendor GSTIN (15-character code starting with state code) — extract with full accuracy
- gstPercent = GST rate applied (0/5/12/18/28%)
- subtotalInr = taxable value before GST (for ITC calculation)
- gstAmountInr = CGST + SGST or IGST total
- finalPaymentInr = subtotal + GST
- Include HSN/SAC code in item name if visible on invoice
- All amounts must be positive numbers in INR`;

const PROMPT_FREELANCER = `You are an expense document data extractor for Indian freelancers and independent professionals.
This document may be a project expense invoice, software/tool subscription receipt, professional fee receipt from a client, co-working space invoice, home internet/utility bill, or hardware purchase.
Extract the following fields and respond ONLY with a valid JSON object, no explanation or markdown.

{
  "shopName": <vendor / client / service provider name as string, or null>,
  "address": <vendor address as string, or null>,
  "pincode": <6-digit PIN code as string, or null>,
  "invoiceNumber": <invoice number / order ID / receipt number as string, or null>,
  "gstNumber": <vendor GSTIN as string, or null>,
  "gstPercent": <GST percent as number if applicable, or null>,
  "gstAmountInr": <GST amount in INR as number, or null>,
  "subtotalInr": <amount before GST / taxes as number in INR, or null>,
  "dateOfPurchase": <date in YYYY-MM-DD format, or null>,
  "discountInr": <discount amount in INR as number, or null>,
  "finalPaymentInr": <total amount paid as number in INR, or null>,
  "items": [
    {
      "name": <item/service — prefix category if clear e.g. "SOFTWARE: Figma Pro", "SOFTWARE: GitHub Copilot", "HARDWARE: External SSD", "COWORK: Seat Rental", "UTIL: Internet Bill", "CLIENT FEE: Project Name">,
      "quantity": <quantity as number>,
      "unitPriceInr": <unit price in INR as number, or null>,
      "discountInr": null,
      "amountInr": <amount in INR as positive number>
    }
  ]
}

Rules:
- Prefix items with category: SOFTWARE / HARDWARE / COWORK / UTIL / CLIENT FEE / TRAVEL / MISC
- Software subscriptions: note billing period (monthly/annual) in item name if visible
- Client fee receipts: include project or client name in item name
- subtotalInr = amount before GST
- finalPaymentInr = total paid including GST
- All amounts must be positive numbers in INR`;

const PROMPT_NGO = `You are a financial document data extractor for Indian NGOs, charitable trusts, and non-profit societies.
This document may be a donation receipt, 80G certificate, grant award letter, CSR funding receipt, project expense invoice, FCRA receipt, or staff payroll slip for an NGO.
Extract the following fields and respond ONLY with a valid JSON object, no explanation or markdown.

{
  "shopName": <donor / grantor / vendor / NGO name as string, or null>,
  "address": <address as string, or null>,
  "pincode": <6-digit PIN code as string, or null>,
  "invoiceNumber": <receipt number / certificate number / grant reference / invoice number as string, or null>,
  "gstNumber": <GSTIN or PAN of the organization as string, or null>,
  "gstPercent": <GST percent if applicable, or null>,
  "gstAmountInr": <GST amount in INR as number, or null>,
  "subtotalInr": <amount before GST or total grant/donation before deductions as number in INR, or null>,
  "dateOfPurchase": <receipt date / transaction date in YYYY-MM-DD format, or null>,
  "discountInr": null,
  "finalPaymentInr": <total amount received or paid as number in INR, or null>,
  "items": [
    {
      "name": <description e.g. "Donation — General Corpus", "Donation — Education Project", "CSR Grant — Health Camp", "80G Certificate", "Project Expense — Food Kits", "FCRA Foreign Grant", "Staff Salary", "Office Rent">,
      "quantity": 1,
      "unitPriceInr": null,
      "discountInr": null,
      "amountInr": <amount in INR as positive number>
    }
  ]
}

Rules:
- Donation receipts: shopName = donor name; invoiceNumber = receipt number; gstNumber = NGO PAN
- 80G certificates: capture certificate number in invoiceNumber; note PAN of NGO in gstNumber
- CSR / grant: shopName = corporate donor or funding agency name
- Project expenses: shopName = vendor/supplier name; describe the project in item name
- FCRA receipts: note foreign currency equivalent if shown; convert to INR equivalent in amounts
- All amounts must be positive numbers in INR`;

const PROMPT_PERSONAL = `You are a personal expense data extractor for individual household purchases in India.
This document may be a grocery bill, pharmacy/medical receipt, restaurant bill, utility bill, online order invoice, clothing receipt, or any personal purchase receipt.
Extract the following fields and respond ONLY with a valid JSON object, no explanation or markdown.

{
  "shopName": <store / merchant / app / service provider name as string, or null>,
  "address": <store address as string, or null>,
  "pincode": <6-digit PIN code as string, or null>,
  "invoiceNumber": <bill number / order ID / receipt number as string, or null>,
  "gstNumber": <merchant GSTIN if printed as string, or null>,
  "gstPercent": <GST rate as string e.g. "18%" or "5%", or null>,
  "gstAmountInr": <total GST/tax amount as number in INR, or null>,
  "subtotalInr": <subtotal before GST and discount as number in INR, or null>,
  "dateOfPurchase": <purchase date in YYYY-MM-DD format — assume ${new Date().getFullYear()} if year missing, or null>,
  "discountInr": <discount / coupon / cashback as number in INR, or null>,
  "finalPaymentInr": <grand total / amount paid as number in INR, or null>,
  "items": [
    {
      "name": <product/item name as string>,
      "quantity": <quantity as number, use 1 if not shown>,
      "unitPriceInr": <unit price in INR as number, or null>,
      "discountInr": <per-item discount in INR as number, or null>,
      "amountInr": <line total in INR as number>
    }
  ]
}

Rules:
- shopName = store name or app name (e.g. "D-Mart", "Blinkit", "Zomato", "Apollo Pharmacy")
- Capture all line items visible — products, services, delivery charges, platform fees
- For restaurant bills: list each dish as a separate item
- For utility bills: list each charge component separately (e.g. "Energy Charges", "Fixed Charges", "Electricity Duty")
- Amounts must be numbers in INR; discounts are positive numbers`;

const MULTILINGUAL_RULE =
  "\n- If the document is in a regional Indian language (Marathi, Hindi, Gujarati, Tamil, Bengali, Kannada, Telugu, Malayalam, etc.), translate ALL extracted text fields (shopName, address, item names, etc.) to English in your JSON response. Numeric values and dates must remain unchanged.";

function getExtractionPrompt(filename?: string): string {
  if (filename && /payslip|payroll|salaryslip|salary.?slip|paystub/i.test(filename)) return PROMPT_PAYROLL + MULTILINGUAL_RULE;
  const mode = prefs.activeMode;
  if (mode === "society")        return PROMPT_SOCIETY + MULTILINGUAL_RULE;
  if (mode === "tax_consultant") return PROMPT_TAX + MULTILINGUAL_RULE;
  if (mode === "ca")             return PROMPT_CA + MULTILINGUAL_RULE;
  if (mode === "real_estate")    return PROMPT_REALESTATE + MULTILINGUAL_RULE;
  if (mode === "advocate")       return PROMPT_ADVOCATE + MULTILINGUAL_RULE;
  if (mode === "bookkeeper")     return PROMPT_BOOKKEEPER + MULTILINGUAL_RULE;
  if (mode === "freelancer")     return PROMPT_FREELANCER + MULTILINGUAL_RULE;
  if (mode === "ngo")            return PROMPT_NGO + MULTILINGUAL_RULE;
  if (mode === "personal")       return PROMPT_PERSONAL + MULTILINGUAL_RULE;
  return PROMPT_INVOICE + MULTILINGUAL_RULE;
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
    const raw = JSON.parse(clean) as ClaudeInvoiceData;
    // Carry society-specific extras through as typed fields
    raw.validUntil     = (raw as any).validUntil     ?? null;
    raw.paymentTerms   = (raw as any).paymentTerms   ?? null;
    raw.warrantyPeriod = (raw as any).warrantyPeriod ?? null;
    raw.resolutionNo   = (raw as any).resolutionNo   ?? null;
    raw.attendeeCount  = (raw as any).attendeeCount  != null ? String((raw as any).attendeeCount) : null;
    raw.meetingType    = (raw as any).meetingType    ?? null;
    raw.flatUnit       = (raw as any).flatUnit        ?? null;
    return raw;
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
  const extras: Record<string, string> = {};
  if (data.validUntil)     extras.validUntil     = data.validUntil;
  if (data.paymentTerms)   extras.paymentTerms   = data.paymentTerms;
  if (data.warrantyPeriod) extras.warrantyPeriod = data.warrantyPeriod;
  if (data.resolutionNo)   extras.resolutionNo   = data.resolutionNo;
  if (data.attendeeCount)  extras.attendeeCount  = data.attendeeCount;
  if (data.meetingType)    extras.meetingType    = data.meetingType;
  if (data.flatUnit)       extras.flatUnit       = data.flatUnit;
  const docMetadata = Object.keys(extras).length > 0 ? extras : (invoice.docMetadata ?? null);

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
    docMetadata,
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
