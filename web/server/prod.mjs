// ╔══════════════════════════════════════════════════════════╗
// ║  prod.mjs — DESKTOP server (local Electron / dev)        ║
// ║  Serves the React SPA + desktop OAuth callbacks.         ║
// ║  NOT deployed to Render. Mobile relay lives in proxy.mjs ║
// ╚══════════════════════════════════════════════════════════╝
import express from "express";
import multer from "multer";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, "..", "dist");

const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID     ?? "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "";
const AZURE_CLIENT_ID      = process.env.AZURE_CLIENT_ID      ?? "";
const AZURE_CLIENT_SECRET  = process.env.AZURE_CLIENT_SECRET  ?? "";
const PORT                 = Number(process.env.PORT ?? 3000);
const SUPABASE_URL         = process.env.SUPABASE_URL         ?? "";
const SUPABASE_ANON_KEY    = process.env.SUPABASE_ANON_KEY    ?? "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ?? "";
const STRIPE_SECRET_KEY    = process.env.STRIPE_SECRET_KEY    ?? "";
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? "";
// Price IDs from your Stripe dashboard
const STRIPE_PRICES = {
  shared_monthly: process.env.STRIPE_PRICE_SHARED_MONTHLY ?? "",
  shared_yearly:  process.env.STRIPE_PRICE_SHARED_YEARLY  ?? "",
  own_monthly:    process.env.STRIPE_PRICE_OWN_MONTHLY    ?? "",
  own_yearly:     process.env.STRIPE_PRICE_OWN_YEARLY     ?? "",
};

const GMAIL_SCOPE        = "https://www.googleapis.com/auth/gmail.readonly email openid";
const GOOGLE_LOGIN_SCOPE = "openid email profile";
const OUTLOOK_SCOPE      = "openid email Mail.Read offline_access";

function appOrigin(req) {
  const proto = req.headers["x-forwarded-proto"] ?? req.protocol ?? "https";
  const host  = req.headers["x-forwarded-host"] ?? req.headers.host;
  return `${proto}://${host}`;
}

// Only allow redirecting back to the Render origin or to localhost (for the desktop EXE).
function sanitizeReturnTo(raw, req) {
  try {
    const url = new URL(raw);
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return raw;
    if (raw.startsWith(appOrigin(req))) return raw;
  } catch {}
  return appOrigin(req);
}

// ── Mobile relay ──────────────────────────────────────────────────────────────

function getSecret() { return process.env.JINVOICE_SECRET || "jinvoice-change-me"; }

function mobileAuth(req, res, next) {
  const key = req.headers["x-jinvoice-key"] || req.query.key;
  if (key !== getSecret()) return res.status(401).json({ error: "invalid key" });
  next();
}

// Validate a Supabase JWT and return the user_id, or null if invalid.
async function validateSupabaseJWT(token) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !token) return null;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
    });
    if (!r.ok) return null;
    const user = await r.json();
    return user.id ?? null;
  } catch {
    return null;
  }
}

const GEMINI_MODEL = "gemini-3.6-flash";

const EXTRACTION_PROMPT_INVOICE = `You are an invoice data extractor for Indian businesses. Extract the following fields and respond ONLY with valid JSON, no explanation or markdown.

{
  "shopName": <business/merchant name as string or null>,
  "address": <full merchant/seller address as string or null>,
  "pincode": <6-digit Indian PIN code from merchant address as string or null>,
  "phone": <merchant phone number as string or null>,
  "invoiceNumber": <invoice/bill/receipt number as string or null>,
  "gstNumber": <merchant GSTIN e.g. 22AAAAA0000A1Z5 as string or null>,
  "gstPercent": <tax rate e.g. "18%" as string or null>,
  "gstAmountInr": <total GST/tax amount as number in INR or null>,
  "subtotalInr": <subtotal before GST/discount as number in INR or null>,
  "dateOfPurchase": <purchase date in YYYY-MM-DD format, assume ${new Date().getFullYear()} if year missing, or null>,
  "discountInr": <total discount as number in INR or null>,
  "finalPaymentInr": <grand total / net payable as number in INR or null>,
  "items": [{"name": <item name>,"quantity": <qty, 1 if unknown>,"unitPriceInr": <unit price or null>,"discountInr": <discount or null>,"amountInr": <line total>}]
}

Rules: extract merchant/seller details only (NOT buyer). Amounts must be numbers in INR.`;

const EXTRACTION_PROMPT_SOCIETY = `You are a document data extractor for Indian residential societies and housing expenses.
This document may be a maintenance bill, rent receipt/agreement, insurance policy receipt, lift/equipment AMC invoice, utility bill, vendor quotation, AGM/meeting minutes, or other housing/society-related financial record.
Extract the following fields and respond ONLY with valid JSON, no explanation or markdown.

{
  "shopName": <society name / vendor / landlord / insurer / service company as string or null>,
  "address": <society or property address as string or null>,
  "pincode": <6-digit Indian PIN code as string or null>,
  "phone": <contact phone number as string or null>,
  "invoiceNumber": <bill number / receipt number / quotation number / agreement number / policy number as string or null>,
  "gstNumber": <GSTIN if present as string or null>,
  "gstPercent": <GST rate if shown e.g. "18%" as string or null>,
  "gstAmountInr": <GST/tax amount as number in INR or null>,
  "subtotalInr": <subtotal before taxes as number in INR or null>,
  "dateOfPurchase": <bill date / receipt date / quotation date / meeting date in YYYY-MM-DD format, assume ${new Date().getFullYear()} if year missing, or null>,
  "discountInr": <discount amount as number in INR or null>,
  "finalPaymentInr": <total amount due — maintenance total / monthly rent / insurance premium / AMC charge / quotation total — as number in INR or null>,
  "items": [{"name": <charge/scope description e.g. "Monthly Maintenance" / "Water Charges" / "Sinking Fund" / "Exterior Painting" / "Labour Charges">,"quantity": <qty, 1 if not shown>,"unitPriceInr": <unit price or null>,"discountInr": <discount or null>,"amountInr": <line amount>}],
  "validUntil": <quotation validity date in YYYY-MM-DD or null — quotations only>,
  "paymentTerms": <payment terms e.g. "50% advance, balance on completion" as string or null>,
  "warrantyPeriod": <warranty/defect-liability period e.g. "1 year" as string or null — quotations only>,
  "resolutionNo": <resolution number from meeting minutes as string or null — meeting records only>,
  "attendeeCount": <number of members present at meeting as string e.g. "42" or null — meeting records only>,
  "meetingType": <"AGM" / "SGM" / "EGM" / "Committee Meeting" or null — meeting records only>
}

Rules:
- Maintenance bills: shopName = society name; list each charge type as a separate item
- Rent receipts: shopName = landlord/property name; finalPaymentInr = monthly rent
- Insurance receipts: shopName = insurance company; finalPaymentInr = premium paid
- AMC/service: shopName = service vendor; finalPaymentInr = AMC amount
- Vendor quotations: shopName = vendor/contractor; finalPaymentInr = quoted total; populate validUntil, paymentTerms, warrantyPeriod where present
- AGM/meeting minutes: shopName = society name; dateOfPurchase = meeting date; populate resolutionNo, attendeeCount, meetingType; finalPaymentInr = null unless a specific expenditure was approved
- Leave quotation/meeting fields null for documents where they don't apply
- Amounts must be numbers in INR`;

const EXTRACTION_PROMPT_TAX = `You are a tax document data extractor for Indian tax and compliance documents.
This document may be an ITR acknowledgment, Challan 280, TDS certificate (Form 16/16A), Form 26AS, advance tax receipt, or GST filing receipt.
Extract the following fields and respond ONLY with valid JSON, no explanation or markdown.

{
  "shopName": <assessee name (taxpayer/employee) or deductor/employer name as string or null>,
  "address": <assessee or deductor address as string or null>,
  "pincode": <6-digit Indian PIN code as string or null>,
  "phone": null,
  "invoiceNumber": <challan number / acknowledgment number / TDS certificate number / BSR code as string or null>,
  "gstNumber": <PAN of assessee or deductor e.g. ABCDE1234F as string or null>,
  "gstPercent": <tax rate or surcharge rate if shown as string or null>,
  "gstAmountInr": <education cess + surcharge combined as number in INR or null>,
  "subtotalInr": <basic tax before cess/surcharge as number in INR or null>,
  "dateOfPurchase": <filing date / payment date in YYYY-MM-DD format, assume ${new Date().getFullYear()} if year missing, or null>,
  "discountInr": <TDS already deducted or advance tax paid as number in INR or null>,
  "finalPaymentInr": <total tax paid / TDS deducted / net tax amount as number in INR or null>,
  "items": [{"name": <tax component e.g. "Income Tax" / "Surcharge" / "Education Cess" / "Interest u/s 234B" / "TDS Deducted" / "Advance Tax Paid">,"quantity": 1,"unitPriceInr": null,"discountInr": null,"amountInr": <amount in INR>}]
}

Rules: ITR ack → shopName = assessee, invoiceNumber = ack number, gstNumber = PAN. Challan 280 → invoiceNumber = CRN/challan number, list each tax head as item. Form 16/16A → shopName = employer/deductor, gstNumber = employee PAN. Amounts must be numbers in INR.`;

const EXTRACTION_PROMPT_LEGAL = `You are a legal document data extractor for Indian property and legal documents.
This document may be a property sale deed, lease or rent agreement, vakalatnama, stamp duty receipt, property registration certificate, court fee receipt, or bar council membership receipt.
Extract the following fields and respond ONLY with valid JSON, no explanation or markdown.

{
  "shopName": <primary party name — seller / developer / landlord / client / authority / court as string or null>,
  "address": <property address or party address as string or null>,
  "pincode": <6-digit Indian PIN code as string or null>,
  "phone": null,
  "invoiceNumber": <deed number / registration number / case number / agreement number / receipt number as string or null>,
  "gstNumber": <registration number / stamp duty reference / CIN / bar council number / case number as string or null>,
  "gstPercent": <stamp duty rate or GST rate if shown as string or null>,
  "gstAmountInr": <stamp duty amount as number in INR or null>,
  "subtotalInr": <consideration / agreement value before charges as number in INR or null>,
  "dateOfPurchase": <execution date / registration date / agreement date in YYYY-MM-DD format, assume ${new Date().getFullYear()} if year missing, or null>,
  "discountInr": null,
  "finalPaymentInr": <total consideration / total fees paid / total amount as number in INR or null>,
  "items": [{"name": <charge e.g. "Stamp Duty" / "Registration Fee" / "Legal Fee" / "Court Fee" / "Bar Council Fee" / "Property Value">,"quantity": 1,"unitPriceInr": null,"discountInr": null,"amountInr": <amount in INR>}]
}

Rules: Sale deed → shopName = seller/developer, finalPaymentInr = total sale consideration, list stamp duty + registration fee as items. Lease/rent → shopName = landlord, finalPaymentInr = monthly rent. Court fee → shopName = court name, invoiceNumber = case number. Amounts must be numbers in INR.`;

const EXTRACTION_PROMPT_CORPORATE = `You are a corporate document data extractor for Indian company and professional documents.
This document may be a share certificate, audit engagement letter, ICAI/ICSI membership receipt, ROC filing receipt, or company incorporation document.
Extract the following fields and respond ONLY with valid JSON, no explanation or markdown.

{
  "shopName": <company name / ICAI / ICSI / issuing authority as string or null>,
  "address": <company registered address as string or null>,
  "pincode": <6-digit Indian PIN code as string or null>,
  "phone": null,
  "invoiceNumber": <certificate number / membership number / receipt number / SRN / DIN as string or null>,
  "gstNumber": <CIN / folio number / PAN / GSTIN of company as string or null>,
  "gstPercent": <GST rate if applicable as string or null>,
  "gstAmountInr": <GST amount if applicable as number in INR or null>,
  "subtotalInr": null,
  "dateOfPurchase": <issue date / membership date / filing date in YYYY-MM-DD format, assume ${new Date().getFullYear()} if year missing, or null>,
  "discountInr": null,
  "finalPaymentInr": <total paid-up share value / membership fee / filing fee / audit fee as number in INR or null>,
  "items": [{"name": <component e.g. "Equity Shares" / "Preference Shares" / "Annual Membership Fee" / "Filing Fee" / "Audit Fee">,"quantity": <shares count or 1>,"unitPriceInr": <face value per share or null>,"discountInr": null,"amountInr": <total amount in INR>}]
}

Rules: Share certificate → shopName = company name, invoiceNumber = certificate number, gstNumber = folio number, items = share classes with quantity = shares count and unitPriceInr = face value. ICAI/ICSI → invoiceNumber = membership number. Amounts must be numbers in INR.`;

const EXTRACTION_PROMPT_PAYROLL = `You are a payroll document data extractor for Indian salary payslips and compensation statements.
This document is a salary payslip, pay stub, or compensation statement.
Extract the following fields and respond ONLY with valid JSON, no explanation or markdown.

{
  "shopName": <employer / company name as string or null>,
  "address": <company address as string or null>,
  "pincode": <6-digit Indian PIN code as string or null>,
  "phone": null,
  "invoiceNumber": <employee ID / payslip number as string or null>,
  "gstNumber": <PAN of employee e.g. ABCDE1234F as string or null>,
  "gstPercent": null,
  "gstAmountInr": null,
  "subtotalInr": <total gross earnings (sum of all earnings) as number in INR or null>,
  "dateOfPurchase": <last day of pay period month in YYYY-MM-DD e.g. 2026-05-31 for May 2026, or null>,
  "discountInr": <total deductions amount as number in INR or null>,
  "finalPaymentInr": <net pay / take-home salary as number in INR or null>,
  "items": [{"name": <prefix ALL earnings with "EARN: " and ALL deductions with "DED: " e.g. "EARN: Basic Salary" / "EARN: HRA" / "DED: Provident Fund" / "DED: Income Tax">,"quantity": 1,"unitPriceInr": null,"discountInr": null,"amountInr": <positive amount in INR>}]
}

Rules: List ALL earnings first (prefixed "EARN: ") then ALL deductions (prefixed "DED: "). subtotalInr = total gross earnings. discountInr = total deductions. finalPaymentInr = net pay. gstNumber = employee PAN. All amounts must be positive numbers in INR.`;

const EXTRACTION_PROMPT_REALESTATE = `You are a real estate document data extractor for Indian property transactions. This document may be a sale deed, registration receipt, stamp duty challan, RERA payment, home loan statement, rental agreement, TDS 194IA challan, or capital gains worksheet. Extract the following fields and respond ONLY with valid JSON, no explanation or markdown.

{
  "shopName": <seller / developer / bank / registrar name as string or null>,
  "address": <property address as string or null>,
  "pincode": <6-digit property PIN code as string or null>,
  "phone": null,
  "invoiceNumber": <registration / challan / receipt number as string or null>,
  "gstNumber": <seller GSTIN or PAN as string or null>,
  "gstPercent": <GST percent as number or null>,
  "gstAmountInr": <GST amount in INR as number or null>,
  "subtotalInr": <property value / loan principal / stamp duty base as number in INR or null>,
  "dateOfPurchase": <transaction date in YYYY-MM-DD or null>,
  "discountInr": null,
  "finalPaymentInr": <total amount paid in INR as number or null>,
  "items": [{"name": <component e.g. "Stamp Duty" / "Registration Fee" / "TDS 194IA" / "RERA Advance" / "EMI Principal" / "EMI Interest" / "Property Value">,"quantity": 1,"unitPriceInr": null,"discountInr": null,"amountInr": <positive INR amount>}]
}

Rules: shopName = seller/developer/bank/registrar. invoiceNumber = document/challan/receipt number. subtotalInr = base property value or stamp duty base. TDS 194IA applies when property value > ₹50,00,000. Split EMI into "EMI Principal" and "EMI Interest" items. List stamp duty and registration fee as separate items. All amounts positive INR.`;

const EXTRACTION_PROMPT_ADVOCATE = `You are a legal professional document data extractor for Indian advocates and law firms. This document may be a court fee receipt, process fee receipt, stamp paper, vakalatnama, advocate fee invoice, law library subscription, or disbursement receipt. Extract the following fields and respond ONLY with valid JSON, no explanation or markdown.

{
  "shopName": <court / law firm / vendor / party name as string or null>,
  "address": <address as string or null>,
  "pincode": <6-digit PIN code as string or null>,
  "phone": null,
  "invoiceNumber": <case number / matter number / receipt number as string or null>,
  "gstNumber": <vendor GSTIN or bar registration number as string or null>,
  "gstPercent": <GST percent as number or null>,
  "gstAmountInr": <GST amount in INR as number or null>,
  "subtotalInr": <amount before GST in INR as number or null>,
  "dateOfPurchase": <date in YYYY-MM-DD or null>,
  "discountInr": null,
  "finalPaymentInr": <total amount paid in INR as number or null>,
  "items": [{"name": <component e.g. "Court Filing Fee" / "Process Fee" / "Stamp Paper" / "Advocate Fee" / "SCC Online Subscription" / "Manupatra Subscription" / "Travel Disbursement">,"quantity": 1,"unitPriceInr": null,"discountInr": null,"amountInr": <positive INR amount>}]
}

Rules: shopName = court/law firm/vendor. invoiceNumber = case/matter/receipt number. gstNumber = vendor GSTIN if available. subtotalInr = amount before GST. finalPaymentInr = total paid. All amounts positive INR.`;

const EXTRACTION_PROMPT_CA = `You are a professional services document data extractor for Indian Chartered Accountants and accounting firms. This document may be a professional fee invoice, audit fee invoice, ICAI seminar/CPE receipt, software subscription (Tally, ClearTax, Computax, MCA portal), DSC renewal, or GST challan. Extract the following fields and respond ONLY with valid JSON, no explanation or markdown.

{
  "shopName": <firm / client / vendor / ICAI / software vendor name as string or null>,
  "address": <address as string or null>,
  "pincode": <6-digit PIN code as string or null>,
  "phone": null,
  "invoiceNumber": <invoice / engagement / receipt number as string or null>,
  "gstNumber": <vendor GSTIN as string or null>,
  "gstPercent": <GST percent as number (usually 18% on professional services) or null>,
  "gstAmountInr": <GST amount in INR as number or null>,
  "subtotalInr": <amount before GST in INR as number or null>,
  "dateOfPurchase": <date in YYYY-MM-DD or null>,
  "discountInr": null,
  "finalPaymentInr": <total amount paid in INR as number or null>,
  "items": [{"name": <service e.g. "Statutory Audit Fee" / "Tax Audit Fee" / "GST Filing Fee" / "Tally Prime Subscription" / "ClearTax Subscription" / "ICAI CPE Seminar" / "DSC Renewal" / "Professional Fee">,"quantity": 1,"unitPriceInr": null,"discountInr": null,"amountInr": <positive INR amount>}]
}

Rules: gstNumber = vendor GSTIN. 18% GST typically applies on professional services. subtotalInr = amount before GST. finalPaymentInr = total including GST. Identify audit type in item name (statutory/tax/internal). All amounts positive INR.`;

const EXTRACTION_PROMPT_BOOKKEEPER = `You are a vendor invoice data extractor for Indian bookkeepers managing multiple client accounts. Extract all fields with special attention to GSTIN, HSN/SAC codes, and GST breakdown for purchase register compliance. Extract the following fields and respond ONLY with valid JSON, no explanation or markdown.

{
  "shopName": <vendor / supplier name as string or null>,
  "address": <vendor address as string or null>,
  "pincode": <6-digit vendor PIN code as string or null>,
  "phone": null,
  "invoiceNumber": <vendor invoice number as string or null>,
  "gstNumber": <vendor GSTIN — critical, 15-char code or null>,
  "gstPercent": <GST rate as number (0/5/12/18/28) or null>,
  "gstAmountInr": <total GST CGST+SGST or IGST in INR as number or null>,
  "subtotalInr": <taxable value before GST in INR as number or null>,
  "dateOfPurchase": <invoice date in YYYY-MM-DD or null>,
  "discountInr": <discount in INR as number or null>,
  "finalPaymentInr": <total invoice amount including GST in INR as number or null>,
  "items": [{"name": <item with HSN/SAC if visible e.g. "Office Supplies [HSN 4820]">,"quantity": <number>,"unitPriceInr": <unit price or null>,"discountInr": null,"amountInr": <positive line total in INR>}]
}

Rules: gstNumber = full 15-character GSTIN — extract with full accuracy. gstPercent = rate applied. subtotalInr = taxable value for ITC. gstAmountInr = CGST+SGST or IGST total. Include HSN/SAC in item name. All amounts positive INR.`;

const EXTRACTION_PROMPT_FREELANCER = `You are an expense document data extractor for Indian freelancers and independent professionals. This document may be a software/tool subscription, project expense, professional fee receipt, co-working space invoice, internet/utility bill, or hardware purchase. Extract the following fields and respond ONLY with valid JSON, no explanation or markdown.

{
  "shopName": <vendor / client / service provider name as string or null>,
  "address": <vendor address as string or null>,
  "pincode": <6-digit PIN code as string or null>,
  "phone": null,
  "invoiceNumber": <invoice / order / receipt number as string or null>,
  "gstNumber": <vendor GSTIN as string or null>,
  "gstPercent": <GST percent as number or null>,
  "gstAmountInr": <GST amount in INR as number or null>,
  "subtotalInr": <amount before GST in INR as number or null>,
  "dateOfPurchase": <date in YYYY-MM-DD or null>,
  "discountInr": <discount in INR as number or null>,
  "finalPaymentInr": <total paid in INR as number or null>,
  "items": [{"name": <prefixed item e.g. "SOFTWARE: Figma Pro" / "SOFTWARE: GitHub Copilot" / "HARDWARE: External SSD" / "COWORK: Seat Rental" / "UTIL: Internet Bill" / "CLIENT FEE: Project Name">,"quantity": <number>,"unitPriceInr": <unit price or null>,"discountInr": null,"amountInr": <positive INR amount>}]
}

Rules: Prefix items: SOFTWARE / HARDWARE / COWORK / UTIL / CLIENT FEE / TRAVEL / MISC. Include billing period in software item name if visible. subtotalInr = amount before GST. finalPaymentInr = total paid. All amounts positive INR.`;

const EXTRACTION_PROMPT_NGO = `You are a financial document data extractor for Indian NGOs, charitable trusts, and non-profit societies. This document may be a donation receipt, 80G certificate, CSR grant receipt, project expense invoice, FCRA receipt, or staff payroll slip. Extract the following fields and respond ONLY with valid JSON, no explanation or markdown.

{
  "shopName": <donor / grantor / vendor / NGO name as string or null>,
  "address": <address as string or null>,
  "pincode": <6-digit PIN code as string or null>,
  "invoiceNumber": <receipt / certificate / grant reference / invoice number as string or null>,
  "gstNumber": <GSTIN or PAN of the organization as string or null>,
  "gstPercent": <GST percent or null>,
  "gstAmountInr": <GST amount in INR as number or null>,
  "subtotalInr": <amount before GST or total grant before deductions in INR as number or null>,
  "dateOfPurchase": <receipt or transaction date in YYYY-MM-DD or null>,
  "discountInr": null,
  "finalPaymentInr": <total amount received or paid in INR as number or null>,
  "items": [{"name": <description e.g. "Donation — General Corpus" / "CSR Grant — Health Camp" / "80G Certificate" / "Project Expense — Food Kits" / "FCRA Foreign Grant" / "Staff Salary">,"quantity": 1,"unitPriceInr": null,"discountInr": null,"amountInr": <positive INR amount>}]
}

Rules: Donation receipts — shopName = donor name; gstNumber = NGO PAN. 80G certificates — capture certificate number in invoiceNumber. CSR/grant — shopName = corporate or funding agency. FCRA — convert to INR equivalent. All amounts positive INR.`;

const EXTRACTION_PROMPT_PERSONAL = `You are a personal expense data extractor for individual household purchases in India. This document may be a grocery bill, pharmacy receipt, restaurant bill, utility bill, online order invoice, clothing receipt, or any personal purchase receipt. Extract the following fields and respond ONLY with valid JSON, no explanation or markdown.

{
  "shopName": <store / merchant / app name as string or null>,
  "address": <store address as string or null>,
  "pincode": <6-digit PIN code as string or null>,
  "invoiceNumber": <bill / order ID / receipt number as string or null>,
  "gstNumber": <merchant GSTIN if printed as string or null>,
  "gstPercent": <GST rate as string e.g. "18%" or null>,
  "gstAmountInr": <total GST amount in INR as number or null>,
  "subtotalInr": <subtotal before GST and discount in INR as number or null>,
  "dateOfPurchase": <purchase date in YYYY-MM-DD or null>,
  "discountInr": <discount / coupon / cashback in INR as number or null>,
  "finalPaymentInr": <grand total / amount paid in INR as number or null>,
  "items": [{"name": <product or service name>,"quantity": <quantity or 1>,"unitPriceInr": <unit price or null>,"discountInr": <per-item discount or null>,"amountInr": <line total in INR>}]
}

Rules: Capture all visible line items. For restaurant bills list each dish separately. For utility bills list each charge component separately. Amounts must be numbers in INR.`;

function getExtractionPrompt(mode, filename = "") {
  if (filename && /payslip|payroll|salaryslip|salary.?slip|paystub/i.test(filename)) return EXTRACTION_PROMPT_PAYROLL;
  if (mode === "society")        return EXTRACTION_PROMPT_SOCIETY;
  if (mode === "tax_consultant") return EXTRACTION_PROMPT_TAX;
  if (mode === "ca")             return EXTRACTION_PROMPT_CA;
  if (mode === "real_estate")    return EXTRACTION_PROMPT_REALESTATE;
  if (mode === "advocate")       return EXTRACTION_PROMPT_ADVOCATE;
  if (mode === "bookkeeper")     return EXTRACTION_PROMPT_BOOKKEEPER;
  if (mode === "freelancer")     return EXTRACTION_PROMPT_FREELANCER;
  if (mode === "ngo")            return EXTRACTION_PROMPT_NGO;
  if (mode === "personal")       return EXTRACTION_PROMPT_PERSONAL;
  return EXTRACTION_PROMPT_INVOICE;
}

const EXTRACTION_PROMPT = EXTRACTION_PROMPT_INVOICE;

async function extractWithGemini(fileBuf, mimeType, apiKey, mode, filename = "") {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [
        { inline_data: { mime_type: mimeType, data: fileBuf.toString("base64") } },
        { text: getExtractionPrompt(mode, filename) },
      ]}],
      generationConfig: { maxOutputTokens: 4096 },
    }),
  });
  if (!resp.ok) {
    const err = await resp.text().catch(() => resp.statusText);
    throw new Error(`Gemini ${resp.status}: ${err}`);
  }
  const d = await resp.json();
  let raw = (d?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}");
  raw = raw.replace(/^```json?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  if (!raw.startsWith("{")) { const m = raw.match(/\{[\s\S]*\}/); raw = m ? m[0] : "{}"; }
  try { return JSON.parse(raw); } catch { return {}; }
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// ── In-memory relay (mobile→desktop, never persisted to cloud) ────────────────
// Holds up to MAX_RELAY_PER_USER invoices per user for up to RELAY_TTL_MS.
// Survives Render restarts only while the dyno is running; user taps
// "Send to Desktop" again if the server was restarted in the interim.
const relay = new Map(); // Map<userId, [{id,ts,...snakeCaseFields}]>
let _relayId = 0;
const RELAY_TTL_MS      = 5 * 24 * 60 * 60 * 1000; // 5 days
const MAX_RELAY_PER_USER = 5;

function pruneRelay() {
  const cutoff = Date.now() - RELAY_TTL_MS;
  for (const [uid, rows] of relay) {
    const fresh = rows.filter(r => r.ts > cutoff);
    if (fresh.length) relay.set(uid, fresh); else relay.delete(uid);
  }
}
setInterval(pruneRelay, 60 * 60 * 1000).unref(); // hourly sweep

const app = express();

// ── Stripe webhook — must be BEFORE express.json() to access raw body ─────────
// Deploy this same route in proxy.mjs too (Stripe calls the public Render URL).
app.post("/api/stripe-webhook", express.raw({ type: "application/json" }), async (req, res) => {
  if (!STRIPE_WEBHOOK_SECRET) return res.status(503).json({ error: "STRIPE_WEBHOOK_SECRET not set" });
  const sig = req.headers["stripe-signature"] ?? "";
  // Manual Stripe signature verification (no stripe package required)
  const parts = Object.fromEntries(sig.split(",").map((p) => p.split("=")));
  const payload = `${parts.t}.${req.body}`;
  const expected = crypto.createHmac("sha256", STRIPE_WEBHOOK_SECRET).update(payload).digest("hex");
  if (expected !== parts.v1) return res.status(400).json({ error: "invalid signature" });
  let event;
  try { event = JSON.parse(req.body); } catch { return res.status(400).json({ error: "bad json" }); }
  if (event.type === "checkout.session.completed" || event.type === "invoice.paid") {
    const obj = event.data.object;
    const customerId = obj.customer;
    const subscriptionId = obj.subscription ?? null;
    // Lookup user_id from subscriptions table via stripe_customer_id
    if (customerId && SUPABASE_URL && SUPABASE_ANON_KEY) {
      try {
        const lookup = await fetch(
          `${SUPABASE_URL}/rest/v1/subscriptions?stripe_customer_id=eq.${customerId}&select=user_id`,
          { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
        );
        const rows = await lookup.json();
        if (rows?.[0]?.user_id) {
          const paidUntil = new Date(Date.now() + 32 * 24 * 60 * 60 * 1000).toISOString(); // +32 days safety buffer
          await fetch(`${SUPABASE_URL}/rest/v1/subscriptions?user_id=eq.${rows[0].user_id}`, {
            method: "PATCH",
            headers: {
              apikey: SUPABASE_ANON_KEY,
              Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              plan: "pro_paid", status: "active",
              stripe_subscription_id: subscriptionId,
              paid_from: new Date().toISOString(),
              paid_until: paidUntil,
              cancelled_at: null,
              updated_at: new Date().toISOString(),
            }),
          });
        }
      } catch (e) { console.error("webhook patch failed", e); }
    }
  }
  res.json({ received: true });
});

app.use(express.json());

// CORS: allow desktop app (localhost) to call Render endpoints for sync
app.use((req, res, next) => {
  const origin = req.headers.origin ?? "";
  if (origin.startsWith("http://localhost") || origin.startsWith("http://127.0.0.1")) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Access-Control-Allow-Headers", "Content-Type, x-jinvoice-key, Authorization");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") return res.sendStatus(204);
  }
  next();
});

// ── Mobile UI & relay routes ───────────────────────────────────────────────────

app.get("/mobile", (_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(MOBILE_HTML);
});

// Upload: validate Supabase JWT → Gemini extraction → return data (no cloud storage)
app.post("/api/mobile/upload", upload.single("file"), async (req, res) => {
  const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  const userId = await validateSupabaseJWT(token);
  if (!userId) return res.status(401).json({ error: "Unauthorized. Please sign in again." });

  if (!req.file) return res.status(400).json({ error: "no file attached" });
  const apiKey = req.headers["x-gemini-key"] || process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
  if (!apiKey) return res.status(503).json({ error: "No Gemini API key configured on server." });
  const profileMode = (req.body?.mode ?? "").toString().trim() || "personal";
  const uploadFilename = (req.file.originalname ?? "").toString();

  try {
    const data = await extractWithGemini(req.file.buffer, req.file.mimetype, apiKey, profileMode, uploadFilename);
    const inv = {
      id:               ++_relayId,
      user_id:          userId,
      filename:         req.file.originalname || "upload",
      shop_name:        data.shopName        ?? null,
      address:          data.address         ?? null,
      pincode:          data.pincode         ?? null,
      phone:            data.phone           ?? null,
      invoice_number:   data.invoiceNumber   ?? null,
      gst_number:       data.gstNumber       ?? null,
      gst_percent:      data.gstPercent      ?? null,
      gst_amount_inr:   data.gstAmountInr    ?? null,
      subtotal_inr:     data.subtotalInr     ?? null,
      discount_inr:     data.discountInr     ?? null,
      final_payment_inr: data.finalPaymentInr ?? null,
      date_of_purchase: data.dateOfPurchase  ?? null,
      items:            data.items           ?? null,
      uploaded_at:      new Date().toISOString(),
      pending_sync:     false,
      synced_at:        null,
    };
    res.json({ ok: true, invoice: inv });
  } catch (e) {
    console.error("[mobile upload]", e);
    res.status(500).json({ error: e.message });
  }
});

// Queue an invoice for desktop pickup (called when user taps "Send to Desktop")
app.post("/api/mobile/queue", express.json(), async (req, res) => {
  const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  const userId = await validateSupabaseJWT(token);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const inv = req.body;
  if (!inv || typeof inv !== "object") return res.status(400).json({ error: "no data" });
  const entry = { ...inv, id: ++_relayId, ts: Date.now(), user_id: userId, pending_sync: true, synced_at: null };
  const existing = relay.get(userId) ?? [];
  // Drop oldest entries if at cap so newest always fits
  const trimmed = existing.length >= MAX_RELAY_PER_USER
    ? existing.slice(existing.length - MAX_RELAY_PER_USER + 1)
    : existing;
  relay.set(userId, [...trimmed, entry]);
  res.json({ ok: true, id: entry.id });
});

// Desktop polls this to get invoices waiting to sync
app.get("/api/mobile/pending", async (req, res) => {
  const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  const userId = await validateSupabaseJWT(token);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  pruneRelay();
  res.json({ invoices: relay.get(userId) ?? [] });
});

// Desktop calls this after saving invoices locally
app.post("/api/mobile/ack", express.json(), async (req, res) => {
  const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  const userId = await validateSupabaseJWT(token);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const { ids } = req.body ?? {};
  if (Array.isArray(ids) && ids.length) {
    const rows = relay.get(userId) ?? [];
    relay.set(userId, rows.filter(r => !ids.includes(r.id)));
  }
  res.json({ ok: true });
});

// ── Google login ───────────────────────────────────────────────────────────

app.get("/auth/google/login/start", (req, res) => {
  const returnTo = sanitizeReturnTo(req.query.return_to, req);
  const params = new URLSearchParams({
    client_id:     GOOGLE_CLIENT_ID,
    redirect_uri:  `${appOrigin(req)}/auth/google/login/callback`,
    response_type: "code",
    scope:         GOOGLE_LOGIN_SCOPE,
    access_type:   "online",
    state:         JSON.stringify({ flow: "google_login", returnTo }),
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

app.get("/auth/google/login/callback", async (req, res) => {
  const code = req.query.code;
  let returnTo = appOrigin(req);
  try { returnTo = sanitizeReturnTo(JSON.parse(req.query.state ?? "{}").returnTo, req); } catch {}
  if (!code) return res.redirect(`${returnTo}/#error=oauth_denied`);
  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id:     GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri:  `${appOrigin(req)}/auth/google/login/callback`,
        grant_type:    "authorization_code",
      }),
    });
    const tokens = await tokenRes.json();
    if (!tokens.access_token) throw new Error("no access_token");

    const profileRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = await profileRes.json();
    res.redirect(`${returnTo}/#${new URLSearchParams({ google_login_email: profile.email ?? "", google_login_name: profile.name ?? "" })}`);
  } catch {
    res.redirect(`${returnTo}/#error=oauth_failed`);
  }
});

// ── Gmail ──────────────────────────────────────────────────────────────────

app.get("/auth/gmail/start", (req, res) => {
  const returnTo = sanitizeReturnTo(req.query.return_to, req);
  const params = new URLSearchParams({
    client_id:     GOOGLE_CLIENT_ID,
    redirect_uri:  `${appOrigin(req)}/auth/gmail/callback`,
    response_type: "code",
    scope:         GMAIL_SCOPE,
    access_type:   "offline",
    prompt:        "consent",
    state:         JSON.stringify({ flow: "gmail", returnTo }),
  });
  if (req.query.login_hint) params.set("login_hint", req.query.login_hint);
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

app.get("/auth/gmail/callback", async (req, res) => {
  const code = req.query.code;
  let returnTo = appOrigin(req);
  try { returnTo = sanitizeReturnTo(JSON.parse(req.query.state ?? "{}").returnTo, req); } catch {}
  if (!code) return res.redirect(`${returnTo}/#error=oauth_denied`);
  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id:     GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri:  `${appOrigin(req)}/auth/gmail/callback`,
        grant_type:    "authorization_code",
      }),
    });
    const tokens = await tokenRes.json();
    if (!tokens.access_token) throw new Error("no access_token");

    const profileRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = await profileRes.json();
    const hashParams = { gmail_access_token: tokens.access_token, gmail_email: profile.email ?? "" };
    if (tokens.refresh_token) hashParams.gmail_refresh_token = tokens.refresh_token;
    res.redirect(`${returnTo}/#${new URLSearchParams(hashParams)}`);
  } catch {
    res.redirect(`${returnTo}/#error=oauth_failed`);
  }
});

app.get("/auth/gmail/refresh", async (req, res) => {
  const refreshToken = req.query.refresh_token;
  if (!refreshToken) return res.status(400).end();
  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id:     GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type:    "refresh_token",
      }),
    });
    const tokens = await tokenRes.json();
    if (!tokens.access_token) throw new Error("no access_token");
    res.json({ access_token: tokens.access_token });
  } catch {
    res.status(401).end();
  }
});

// ── Outlook ────────────────────────────────────────────────────────────────

app.get("/auth/outlook/start", (req, res) => {
  const returnTo = sanitizeReturnTo(req.query.return_to, req);
  const params = new URLSearchParams({
    client_id:     AZURE_CLIENT_ID,
    redirect_uri:  `${appOrigin(req)}/auth/outlook/callback`,
    response_type: "code",
    scope:         OUTLOOK_SCOPE,
    response_mode: "query",
    state:         JSON.stringify({ flow: "outlook", returnTo }),
  });
  if (req.query.login_hint) params.set("login_hint", req.query.login_hint);
  res.redirect(`https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params}`);
});

app.get("/auth/outlook/callback", async (req, res) => {
  const code = req.query.code;
  let returnTo = appOrigin(req);
  try { returnTo = sanitizeReturnTo(JSON.parse(req.query.state ?? "{}").returnTo, req); } catch {}
  if (!code) return res.redirect(`${returnTo}/#error=oauth_denied`);
  try {
    const tokenRes = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id:     AZURE_CLIENT_ID,
        client_secret: AZURE_CLIENT_SECRET,
        redirect_uri:  `${appOrigin(req)}/auth/outlook/callback`,
        grant_type:    "authorization_code",
        scope:         OUTLOOK_SCOPE,
      }),
    });
    const tokens = await tokenRes.json();
    if (!tokens.access_token) throw new Error("no access_token");

    const profileRes = await fetch("https://graph.microsoft.com/v1.0/me", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = await profileRes.json();
    res.redirect(`${returnTo}/#${new URLSearchParams({ outlook_access_token: tokens.access_token, outlook_email: profile.mail ?? profile.userPrincipalName ?? "" })}`);
  } catch {
    res.redirect(`${returnTo}/#error=oauth_failed`);
  }
});

// ── Local info (used by Settings → Mobile Sync) ───────────────────────────

app.get("/api/local-info", (req, res) => {
  const origin = appOrigin(req);
  const renderUrl = process.env.RENDER_EXTERNAL_URL ?? process.env.RENDER_URL ?? null;
  res.json({
    url:             origin,
    mobileUrl:       `${origin}/mobile`,
    renderUrl,
    renderMobileUrl: renderUrl ? `${renderUrl}/mobile` : null,
    desktopFolder:   { configured: false },
  });
});

// ── Subscription / pricing ────────────────────────────────────────────────

async function sbFetch(path, token, opts = {}) {
  const method = (opts.method ?? "GET").toUpperCase();
  const isWrite = method === "POST" || method === "PATCH" || method === "PUT" || method === "DELETE";
  // Use service key for server-side writes so RLS doesn't block inserts on new rows.
  // Reads still use the user JWT so RLS row-isolation still applies there.
  const authKey = isWrite && SUPABASE_SERVICE_KEY ? SUPABASE_SERVICE_KEY : token;
  const r = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...opts,
    headers: {
      apikey: isWrite && SUPABASE_SERVICE_KEY ? SUPABASE_SERVICE_KEY : SUPABASE_ANON_KEY,
      Authorization: `Bearer ${authKey}`,
      "Content-Type": "application/json",
      Prefer: opts.upsert ? "resolution=merge-duplicates" : "return=representation",
      ...opts.headers,
    },
  });
  const text = await r.text();
  return { ok: r.ok, status: r.status, data: text ? JSON.parse(text) : null };
}

async function getSubscription(userId, token) {
  const r = await sbFetch(`/subscriptions?user_id=eq.${userId}&limit=1`, token);
  return r.ok && r.data?.length ? r.data[0] : null;
}

async function requireAuth(req, res) {
  const token = (req.headers.authorization ?? "").replace("Bearer ", "");
  const userId = await validateSupabaseJWT(token);
  if (!userId) { res.status(401).json({ error: "unauthorized" }); return null; }
  return { userId, token };
}

// GET /api/subscription
app.get("/api/subscription", async (req, res) => {
  const auth = await requireAuth(req, res); if (!auth) return;
  const { userId, token } = auth;
  let sub = await getSubscription(userId, token);
  if (!sub) {
    // first login — create free row
    const r = await sbFetch("/subscriptions", token, {
      method: "POST",
      upsert: true,
      body: JSON.stringify({ user_id: userId, plan: "free" }),
    });
    sub = r.data?.[0] ?? { plan: "free", status: "active", trial_used: false };
  }
  // auto-expire trial
  if (sub.plan === "pro_trial" && sub.trial_ends_at && new Date(sub.trial_ends_at) < new Date()) {
    await sbFetch(`/subscriptions?user_id=eq.${userId}`, token, {
      method: "PATCH",
      body: JSON.stringify({ plan: "free", status: "active", updated_at: new Date().toISOString() }),
    });
    sub.plan = "free";
  }
  res.json(sub);
});

// POST /api/subscription/start-trial
app.post("/api/subscription/start-trial", async (req, res) => {
  const auth = await requireAuth(req, res); if (!auth) return;
  const { userId, token } = auth;
  const sub = await getSubscription(userId, token);
  if (sub?.trial_used) return res.status(409).json({ error: "trial already used" });
  const now = new Date();
  const ends = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const r = await sbFetch(`/subscriptions?user_id=eq.${userId}`, token, {
    method: sub ? "PATCH" : "POST",
    body: JSON.stringify({
      ...(sub ? {} : { user_id: userId }),
      plan: "pro_trial",
      trial_used: true,
      trial_started_at: now.toISOString(),
      trial_ends_at: ends.toISOString(),
      status: "active",
      updated_at: now.toISOString(),
    }),
  });
  res.json(r.data?.[0] ?? { plan: "pro_trial", trial_ends_at: ends.toISOString() });
});

// POST /api/subscription/activate-pro  body: { stripe_customer_id, stripe_subscription_id, paid_until }
app.post("/api/subscription/activate-pro", async (req, res) => {
  const auth = await requireAuth(req, res); if (!auth) return;
  const { userId, token } = auth;
  const { stripe_customer_id, stripe_subscription_id, paid_until } = req.body ?? {};
  if (!paid_until) return res.status(400).json({ error: "paid_until required" });
  const now = new Date();
  const r = await sbFetch(`/subscriptions?user_id=eq.${userId}`, token, {
    method: "PATCH",
    body: JSON.stringify({
      plan: "pro_paid",
      status: "active",
      stripe_customer_id: stripe_customer_id ?? null,
      stripe_subscription_id: stripe_subscription_id ?? null,
      paid_from: now.toISOString(),
      paid_until,
      cancelled_at: null,
      updated_at: now.toISOString(),
    }),
  });
  res.json(r.data?.[0] ?? { plan: "pro_paid" });
});

// POST /api/subscription/cancel
app.post("/api/subscription/cancel", async (req, res) => {
  const auth = await requireAuth(req, res); if (!auth) return;
  const { userId, token } = auth;
  const sub = await getSubscription(userId, token);
  if (!sub) return res.status(404).json({ error: "no subscription" });
  const now = new Date();
  if (sub.plan === "pro_trial" && new Date(sub.trial_ends_at) > now)
    return res.status(403).json({ error: "cannot cancel during 14-day trial" });
  if (sub.plan === "pro_paid" && sub.paid_until && new Date(sub.paid_until) > now)
    return res.status(403).json({ error: "current period not expired — pay period ends " + sub.paid_until });
  const r = await sbFetch(`/subscriptions?user_id=eq.${userId}`, token, {
    method: "PATCH",
    body: JSON.stringify({ plan: "free", status: "cancelled", cancelled_at: now.toISOString(), updated_at: now.toISOString() }),
  });
  res.json(r.data?.[0] ?? { plan: "free", status: "cancelled" });
});

// POST /api/subscription/request-refund
app.post("/api/subscription/request-refund", async (req, res) => {
  const auth = await requireAuth(req, res); if (!auth) return;
  const { userId, token } = auth;
  const sub = await getSubscription(userId, token);
  if (!sub?.cancelled_at) return res.status(403).json({ error: "must cancel before requesting refund" });
  if (sub.refund_requested_at) return res.status(409).json({ error: "refund already requested" });
  const r = await sbFetch(`/subscriptions?user_id=eq.${userId}`, token, {
    method: "PATCH",
    body: JSON.stringify({ status: "refund_pending", refund_requested_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
  });
  res.json(r.data?.[0] ?? { status: "refund_pending" });
});

// ── Stripe checkout session creation ─────────────────────────────────────────
// body: { plan: "shared"|"own", billing: "monthly"|"yearly" }
app.post("/api/stripe-checkout", async (req, res) => {
  const auth = await requireAuth(req, res); if (!auth) return;
  if (!STRIPE_SECRET_KEY) return res.status(503).json({ error: "STRIPE_SECRET_KEY not set" });
  const { plan = "shared", billing = "monthly" } = req.body ?? {};
  const priceId = STRIPE_PRICES[`${plan}_${billing}`];
  if (!priceId) return res.status(400).json({ error: "unknown plan/billing combination or price ID not configured" });
  const { userId, token } = auth;
  // Fetch existing stripe customer id
  const sub = await getSubscription(userId, token);
  const origin = appOrigin(req);
  const body = new URLSearchParams({
    mode: "subscription",
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    success_url: `${origin}/pricing?payment=success`,
    cancel_url: `${origin}/pricing`,
    "metadata[user_id]": userId,
    ...(sub?.stripe_customer_id ? { customer: sub.stripe_customer_id } : {}),
  });
  try {
    const r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
    const session = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: session.error?.message ?? "stripe error" });
    // Store Stripe customer_id immediately if we got one
    if (session.customer && sub && !sub.stripe_customer_id) {
      await sbFetch(`/subscriptions?user_id=eq.${userId}`, token, {
        method: "PATCH",
        body: JSON.stringify({ stripe_customer_id: session.customer, updated_at: new Date().toISOString() }),
      });
    }
    res.json({ url: session.url });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ── Secret update (mirrors Electron's /api/set-secret) ───────────────────
// Updates JINVOICE_SECRET in-memory for the running dyno session.
// Persists until the next Render redeploy; update the JINVOICE_SECRET env var
// in the Render dashboard for permanent changes.

app.post("/api/set-secret", (req, res) => {
  const { secret } = req.body ?? {};
  if (!secret || typeof secret !== "string" || secret.trim().length < 6) {
    return res.status(400).json({ error: "Secret must be at least 6 characters." });
  }
  process.env.JINVOICE_SECRET = secret.trim();
  res.json({ ok: true });
});

// ── Gemini proxy (avoids CORS + keeps API key server-side) ───────────────────

const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? process.env.VITE_GEMINI_API_KEY ?? "";

// Strip personal identifiers from invoice text before sending to Gemini (DPDPA compliance)
function sanitizePII(text) {
  if (typeof text !== "string") return text;
  // Protect GSTINs (business ID — keep for invoice accuracy)
  const GSTIN_RE = /\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]\b/g;
  const gstins = [];
  const guarded = text.replace(GSTIN_RE, (m) => { gstins.push(m); return `__G${gstins.length - 1}__`; });
  let out = guarded
    // Aadhaar: 12 digits optionally separated by spaces or hyphens
    .replace(/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, "[AADHAAR]")
    // Credit/debit card: 16 digits in 4-4-4-4 pattern
    .replace(/\b\d{4}[\s-]\d{4}[\s-]\d{4}[\s-]\d{4}\b/g, "[CARD]")
    // Standalone PAN (5 alpha + 4 digits + 1 alpha), not already replaced by GSTIN guard
    .replace(/\b[A-Z]{5}\d{4}[A-Z]\b/g, "[PAN]");
  // Restore GSTINs
  gstins.forEach((g, i) => { out = out.replace(`__G${i}__`, g); });
  return out;
}

function sanitizeGeminiBody(body) {
  const contents = body?.contents;
  if (!Array.isArray(contents)) return body;
  return {
    ...body,
    contents: contents.map((c) => ({
      ...c,
      parts: Array.isArray(c.parts)
        ? c.parts.map((p) => p.text ? { ...p, text: sanitizePII(p.text) } : p)
        : c.parts,
    })),
  };
}

app.post("/api/gemini", async (req, res) => {
  if (!GEMINI_API_KEY) return res.status(503).json({ error: "GEMINI_API_KEY not configured on server" });
  const { model = "gemini-3.6-flash", ...body } = req.body ?? {};
  try {
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sanitizeGeminiBody(body)) },
    );
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── Reminder email (nodemailer) ───────────────────────────────────────────────

const SMTP_HOST = process.env.SMTP_HOST ?? "";
const SMTP_PORT = Number(process.env.SMTP_PORT ?? 587);
const SMTP_USER = process.env.SMTP_USER ?? "";
const SMTP_PASS = process.env.SMTP_PASS ?? "";
const SMTP_FROM = process.env.SMTP_FROM ?? SMTP_USER;

app.post("/api/send-reminder", async (req, res) => {
  const { email, subject, html } = req.body ?? {};
  if (!email || !subject) return res.status(400).json({ error: "email and subject required" });
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    return res.status(503).json({ error: "SMTP not configured" });
  }
  try {
    const { default: nodemailer } = await import("nodemailer");
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
    await transporter.sendMail({
      from: `jInvoice <${SMTP_FROM}>`,
      to: email,
      subject,
      html: html ?? `<p>${subject}</p>`,
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── Static files + SPA fallback ────────────────────────────────────────────

// Mobile redirect must come before express.static (which would serve index.html for /)
app.get("/", (req, res, next) => {
  const ua = req.headers["user-agent"] ?? "";
  if (/android|iphone|ipad|ipod|mobile/i.test(ua)) return res.redirect("/mobile");
  next();
});

app.use(express.static(DIST));
app.get("/*path", (_req, res) => res.sendFile(join(DIST, "index.html")));

app.listen(PORT, () => console.log(`jInvoice running on http://localhost:${PORT}`));

// ── Mobile HTML ────────────────────────────────────────────────────────────────
// SB_URL and SB_ANON are injected at request time so the client can call
// Supabase REST directly (anon key is public by design; RLS enforces isolation).

const MOBILE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<title>jInvoice</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
:root{
  --bg:#f0eeff;--surface:#fff;--surface2:#f7f5ff;--border:#e0daf8;
  --text:#0d0d1c;--text2:#4a4a6a;--text3:#9898b8;
  --accent:#5c3ef0;--accent-light:#ede9fe;
  --danger:#ef4444;--success:#22c55e;--warn:#f59e0b;
  --radius:14px;--shadow:0 2px 12px rgba(92,62,240,.1);
}
@media(prefers-color-scheme:dark){
  :root{--bg:#0a0a14;--surface:#14141f;--surface2:#1c1c2e;--border:#2a2a40;
    --text:#f0f0f8;--text2:#9898b8;--text3:#4a4a6a;--accent-light:#1e1a3f;}
}
.auth-tabs{display:flex;width:100%;border:1.5px solid var(--border);border-radius:12px;overflow:hidden;margin-bottom:16px}
.auth-tab{flex:1;padding:10px;border:none;background:transparent;color:var(--text2);font-size:14px;font-weight:600;cursor:pointer;transition:all .15s;touch-action:manipulation}
.auth-tab.active{background:var(--accent);color:#fff}
html{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:16px}
body{min-height:100dvh;padding-bottom:calc(env(safe-area-inset-bottom)+16px)}
.screen{display:none;flex-direction:column;min-height:100dvh}
.screen.active{display:flex}
.auth-wrap{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:32px 24px}
.logo{width:64px;height:64px;background:var(--accent);border-radius:18px;display:flex;align-items:center;justify-content:center;font-size:30px;font-weight:800;color:#fff;margin-bottom:24px;box-shadow:0 6px 24px rgba(92,62,240,.35)}
.auth-title{font-size:24px;font-weight:700;margin-bottom:6px;text-align:center}
.auth-sub{font-size:14px;color:var(--text2);text-align:center;margin-bottom:32px;line-height:1.5}
.inp{width:100%;padding:14px 16px;border:1.5px solid var(--border);border-radius:12px;background:var(--surface);color:var(--text);font-size:15px;outline:none;-webkit-appearance:none}
.inp:focus{border-color:var(--accent)}
.btn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:15px;border:none;border-radius:12px;font-size:15px;font-weight:600;cursor:pointer;transition:opacity .15s;-webkit-appearance:none;touch-action:manipulation;user-select:none;-webkit-user-select:none}
.btn-primary{background:var(--accent);color:#fff;margin-top:12px}
.btn-primary:active{opacity:.85}
.btn-secondary{background:var(--surface2);color:var(--accent);border:1.5px solid var(--border);margin-top:8px}
.err{color:var(--danger);font-size:13px;margin-top:10px;text-align:center}
header{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;padding-top:calc(16px + env(safe-area-inset-top));background:var(--surface);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:10}
header h1{font-size:18px;font-weight:700;letter-spacing:-.3px}
header h1 span{color:var(--accent)}
.icon-btn{width:38px;height:38px;border:none;background:var(--surface2);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px;cursor:pointer;border:1px solid var(--border)}
.list{flex:1;padding:12px 16px;display:flex;flex-direction:column;gap:10px;overflow-y:auto}
.card{background:var(--surface);border:1.5px solid var(--border);border-radius:var(--radius);overflow:hidden;box-shadow:var(--shadow)}
.card.pending-sync{border-color:var(--accent)}
.card-top{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;padding:14px 14px 10px;cursor:pointer}
.card-name{font-size:14px;font-weight:700;flex:1;line-height:1.3}
.card-amount{font-size:15px;font-weight:700;color:var(--accent);white-space:nowrap;font-variant-numeric:tabular-nums}
.card-meta{font-size:12px;color:var(--text3);padding:0 14px 10px;display:flex;gap:10px}
.card-detail{padding:0 14px 14px;display:none;flex-direction:column;gap:10px}
.card.open .card-detail{display:flex}
.detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 16px}
.field label{display:block;font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px}
.field span{font-size:13px;color:var(--text)}
.items-table{width:100%;border-collapse:collapse;font-size:12px}
.items-table th{text-align:left;padding:4px 0;color:var(--text3);font-size:10px;text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid var(--border)}
.items-table td{padding:5px 0;border-bottom:1px solid var(--border);color:var(--text)}
.items-table td:last-child{text-align:right;font-variant-numeric:tabular-nums;font-weight:500}
.sync-btn{display:block;width:100%;padding:10px;background:var(--accent-light);border:1.5px solid var(--accent);color:var(--accent);border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;text-align:center}
.synced-badge{font-size:11px;font-weight:600;text-align:center;padding:6px}
.toggle-row{text-align:center;padding:8px;font-size:12px;color:var(--accent);font-weight:600;border-top:1px solid var(--border)}
.empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;color:var(--text3);padding:48px;text-align:center}
.empty-icon{font-size:48px}
.fab{position:fixed;bottom:calc(24px + env(safe-area-inset-bottom));right:24px;width:58px;height:58px;background:var(--accent);border:none;border-radius:18px;display:flex;align-items:center;justify-content:center;font-size:26px;color:#fff;box-shadow:0 6px 20px rgba(92,62,240,.4);cursor:pointer;transition:transform .1s}
.fab:active{transform:scale(.94)}
.overlay{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:50;display:none}
.overlay.open{display:block}
.sheet{position:fixed;bottom:0;left:0;right:0;background:var(--surface);border-radius:20px 20px 0 0;padding:0 0 calc(env(safe-area-inset-bottom)+24px);z-index:51;max-height:92dvh;overflow-y:auto;transform:translateY(100%);transition:transform .3s ease}
.sheet.open{transform:translateY(0)}
.sheet-handle{width:36px;height:4px;background:var(--border);border-radius:4px;margin:12px auto 0}
.sheet-body{padding:20px 20px 0}
.sheet-title{font-size:18px;font-weight:700;margin-bottom:6px}
.sheet-sub{font-size:13px;color:var(--text2);margin-bottom:20px;line-height:1.5}
.upload-options{display:flex;flex-direction:column;gap:12px;margin-bottom:16px}
.upload-opt{display:flex;align-items:center;gap:14px;padding:16px;background:var(--surface2);border:1.5px solid var(--border);border-radius:14px;cursor:pointer;width:100%;text-align:left;transition:border-color .15s}
.upload-opt:active{border-color:var(--accent);background:var(--accent-light)}
.upload-opt-icon{font-size:28px;line-height:1;flex-shrink:0}
.upload-opt-label{font-size:15px;font-weight:700;color:var(--text)}
.upload-opt-sub{font-size:12px;color:var(--text2);margin-top:2px}
.result-card{background:var(--surface2);border:1.5px solid var(--accent);border-radius:12px;padding:14px;margin-bottom:16px}
.result-name{font-size:16px;font-weight:700;margin-bottom:10px}
.result-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 16px}
.spinner{display:inline-block;width:20px;height:20px;border:2.5px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin .7s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.loading-row{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:32px;color:var(--text2);font-size:14px;text-align:center}
.loading-label{font-size:13px;color:var(--text3)}
</style>
</head>
<body>
<div class="screen active" id="screen-auth">
  <div class="auth-wrap">
    <div class="logo">j</div>
    <div class="auth-title">jInvoice Mobile</div>
    <div class="auth-sub">Sign in or create an account to capture and sync invoices.</div>
    <div style="width:100%">
      <div class="auth-tabs">
        <button class="auth-tab active" id="tab-signin" onclick="switchTab('signin')">Sign In</button>
        <button class="auth-tab" id="tab-signup" onclick="switchTab('signup')">Create Account</button>
      </div>
      <input id="email-input" class="inp" type="email" placeholder="your@email.com" autocomplete="email" inputmode="email">
      <input id="password-input" class="inp" type="password" placeholder="Password" autocomplete="current-password" style="margin-top:10px" onkeydown="if(event.key==='Enter'){event.preventDefault();doAuth();}">
      <div id="auth-err" class="err"></div>
      <button id="connect-btn" class="btn btn-primary" onclick="doAuth()">Sign In &#x2192;</button>
    </div>
    <div style="margin-top:16px;text-align:center">
      <button type="button" onclick="toggleGeminiField()" style="background:none;border:none;color:var(--accent);font-size:13px;cursor:pointer;padding:4px 8px">&#x2699; Gemini AI key (optional)</button>
      <div id="gemini-section" style="display:none;margin-top:8px">
        <input id="gemini-input" class="inp" type="password" placeholder="Paste your Gemini API key" autocomplete="off">
        <div style="font-size:11px;color:var(--text3);margin-top:6px;text-align:center">Used for invoice extraction. Leave blank to use server key.</div>
      </div>
    </div>
  </div>
</div>
<div class="screen" id="screen-home">
  <header>
    <h1>j<span>Invoice</span></h1>
    <button class="icon-btn" onclick="signOut()" title="Sign out">&#x2935;</button>
  </header>
  <div class="list" id="invoice-list">
    <div class="empty"><div class="empty-icon">&#x1F9FE;</div><div>No invoices yet.<br>Tap + to photograph or upload an invoice.</div></div>
  </div>
  <button class="fab" onclick="openSheet()" aria-label="Add invoice">+</button>
</div>
<div class="overlay" id="overlay" onclick="closeSheet()"></div>
<div class="sheet" id="upload-sheet">
  <div class="sheet-handle"></div>
  <div class="sheet-body" id="sheet-body"></div>
</div>
<input type="file" id="camera-input" accept="image/*" capture="environment" style="display:none" onchange="onFileChosen(event)">
<input type="file" id="folder-input" accept="application/pdf,image/*" style="display:none" onchange="onFileChosen(event)">
<script>
const API=window.location.origin;
const SB_URL='${SUPABASE_URL}';
const SB_ANON='${SUPABASE_ANON_KEY}';
let TOKEN=sessionStorage.getItem('sb_token')||'';
let GEMINI_KEY=sessionStorage.getItem('jgk')||'';
let _authBusy=false;
let _authMode='signin';

function switchTab(mode){
  _authMode=mode;
  document.getElementById('tab-signin').classList.toggle('active',mode==='signin');
  document.getElementById('tab-signup').classList.toggle('active',mode==='signup');
  const btn=document.getElementById('connect-btn');
  btn.textContent=mode==='signin'?'Sign In →':'Create Account →';
  document.getElementById('password-input').setAttribute('autocomplete',mode==='signin'?'current-password':'new-password');
  document.getElementById('auth-err').textContent='';
}
async function doAuth(){
  if(_authBusy)return;
  const email=document.getElementById('email-input').value.trim();
  const password=document.getElementById('password-input').value;
  const gk=document.getElementById('gemini-input').value.trim();
  const errEl=document.getElementById('auth-err');
  const btn=document.getElementById('connect-btn');
  if(!email||!email.includes('@')){errEl.textContent='Enter a valid email address.';return;}
  if(!password||password.length<6){errEl.textContent='Password must be at least 6 characters.';return;}
  _authBusy=true;errEl.textContent='';btn.textContent='Please wait…';btn.disabled=true;
  try{
    let d;
    if(_authMode==='signup'){
      const r=await fetch(SB_URL+'/auth/v1/signup',{method:'POST',headers:{'Content-Type':'application/json',apikey:SB_ANON},body:JSON.stringify({email,password})});
      d=await r.json();
      if(!r.ok)throw new Error(d.error_description||d.msg||'Sign up failed');
      const r2=await fetch(SB_URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json',apikey:SB_ANON},body:JSON.stringify({email,password})});
      d=await r2.json();
      if(!r2.ok)throw new Error(d.error_description||d.msg||'Sign in failed after signup');
    }else{
      const r=await fetch(SB_URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json',apikey:SB_ANON},body:JSON.stringify({email,password})});
      d=await r.json();
      if(!r.ok)throw new Error(d.error_description||d.msg||'Sign in failed');
    }
    TOKEN=d.access_token;
    sessionStorage.setItem('sb_token',TOKEN);
    sessionStorage.setItem('sb_email',email);
    if(gk){GEMINI_KEY=gk;sessionStorage.setItem('jgk',gk);}else{GEMINI_KEY=sessionStorage.getItem('jgk')||'';}
    showHome();
  }catch(e){
    errEl.textContent=e.message||'Authentication failed';
    btn.textContent=_authMode==='signin'?'Sign In →':'Create Account →';
    btn.disabled=false;_authBusy=false;
  }
}
async function signOut(){
  try{await fetch(SB_URL+'/auth/v1/logout',{method:'POST',headers:{apikey:SB_ANON,Authorization:'Bearer '+TOKEN}});}catch{}
  sessionStorage.removeItem('sb_token');sessionStorage.removeItem('sb_email');
  TOKEN='';_authBusy=false;show('screen-auth');
}
function toggleGeminiField(){var s=document.getElementById('gemini-section');s.style.display=s.style.display==='none'?'block':'none';}
(function init(){
  if(TOKEN){
    if(GEMINI_KEY){document.getElementById('gemini-section').style.display='block';document.getElementById('gemini-input').value=GEMINI_KEY;}
    showHome();
  }
})();
function show(id){document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));document.getElementById(id).classList.add('active');}
function showHome(){show('screen-home');loadInvoices();}
async function sbFetch(path,opts){
  return fetch(SB_URL+path,{...opts,headers:{...(opts&&opts.headers),apikey:SB_ANON,Authorization:'Bearer '+TOKEN}});
}
function listKey(){return'jinvoice_list_'+(sessionStorage.getItem('sb_email')||'anon');}
function saveList(list){try{localStorage.setItem(listKey(),JSON.stringify(list));}catch{}}
function readList(){try{return JSON.parse(localStorage.getItem(listKey())||'[]');}catch{return[];}}
function loadInvoices(){renderList(readList());}
function fmt(v){return v!=null&&v!==''?'₹'+Number(v).toFixed(2):'—';}
function fmtDate(s){if(!s)return'—';try{return new Date(s).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});}catch{return s;}}
function esc(s){return s?String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'):'—';}
function renderList(list){
  const el=document.getElementById('invoice-list');
  if(!list.length){el.innerHTML='<div class="empty"><div class="empty-icon">&#x1F9FE;</div><div>No invoices yet.<br>Tap + to photograph or upload an invoice.</div></div>';return;}
  el.innerHTML=list.map((inv,i)=>{
    const items=(inv.items||[]).map(it=>'<tr><td>'+esc(it.name)+'</td><td>'+fmt(it.amountInr)+'</td></tr>').join('');
    const syncPart=inv.synced_at
      ?'<div class="synced-badge" style="color:var(--success)">&#x2713; Synced to desktop '+fmtDate(inv.synced_at)+'</div>'
      :inv.pending_sync
      ?'<div class="synced-badge" style="color:var(--warn)">&#x23F3; Waiting for desktop sync&hellip;</div>'
      :'<button class="sync-btn" onclick="markSync('+inv.id+',this)">Send to Desktop &#x2192;</button>';
    return '<div class="card '+(inv.pending_sync&&!inv.synced_at?'pending-sync':'')+'" id="inv-'+i+'">'+
      '<div class="card-top" onclick="toggleCard('+i+')">'+
        '<div class="card-name">'+esc(inv.shop_name||inv.filename||'Invoice')+'</div>'+
        '<div class="card-amount">'+fmt(inv.final_payment_inr)+'</div>'+
      '</div>'+
      '<div class="card-meta">'+(inv.date_of_purchase?'<span>'+fmtDate(inv.date_of_purchase)+'</span>':'')+
        '<span>'+esc(inv.filename||'')+'</span></div>'+
      '<div class="card-detail">'+
        '<div class="detail-grid">'+
          (inv.address?'<div class="field" style="grid-column:1/-1"><label>Address</label><span>'+esc(inv.address)+'</span></div>':'')+
          '<div class="field"><label>GST No.</label><span>'+esc(inv.gst_number)+'</span></div>'+
          '<div class="field"><label>GST %</label><span>'+esc(inv.gst_percent)+'</span></div>'+
          '<div class="field"><label>GST Amt</label><span>'+fmt(inv.gst_amount_inr)+'</span></div>'+
          '<div class="field"><label>Discount</label><span>'+fmt(inv.discount_inr)+'</span></div>'+
          '<div class="field"><label>Total</label><span style="color:var(--accent);font-weight:700">'+fmt(inv.final_payment_inr)+'</span></div>'+
        '</div>'+
        (items?'<table class="items-table"><thead><tr><th>Item</th><th style="text-align:right">Amt</th></tr></thead><tbody>'+items+'</tbody></table>':'')+
        syncPart+
      '</div>'+
      '<div class="toggle-row" onclick="toggleCard('+i+')">Details &#x25BE;</div>'+
    '</div>';
  }).join('');
}
function toggleCard(i){const c=document.getElementById('inv-'+i);c.querySelector('.toggle-row').textContent=c.classList.toggle('open')?'Hide ▴':'Details ▾';}
async function markSync(id,btn){
  btn.disabled=true;btn.textContent='Sending…';
  const list=readList();
  const inv=list.find(i=>i.id===id);
  if(!inv){btn.disabled=false;btn.textContent='Send to Desktop →';return;}
  try{
    const r=await fetch(API+'/api/mobile/queue',{method:'POST',headers:{Authorization:'Bearer '+TOKEN,'Content-Type':'application/json'},body:JSON.stringify(inv)});
    const d=await r.json();
    if(!d.ok)throw new Error(d.error||'failed');
    inv.pending_sync=true;saveList(list);loadInvoices();
  }catch{btn.disabled=false;btn.textContent='Send to Desktop →';}
}
function openSheet(){renderChoiceStep();document.getElementById('overlay').classList.add('open');setTimeout(()=>document.getElementById('upload-sheet').classList.add('open'),10);}
function closeSheet(){document.getElementById('upload-sheet').classList.remove('open');document.getElementById('overlay').classList.remove('open');}
function pickCamera(){document.getElementById('camera-input').click();}
function pickFolder(){document.getElementById('folder-input').click();}
function renderChoiceStep(){
  document.getElementById('sheet-body').innerHTML=
    '<div class="sheet-title">Add Invoice</div>'+
    '<div class="sheet-sub">Choose how to capture your invoice.</div>'+
    '<div class="upload-options">'+
      '<button class="upload-opt" onclick="pickCamera()">'+
        '<div class="upload-opt-icon">&#x1F4F7;</div>'+
        '<div><div class="upload-opt-label">Camera</div><div class="upload-opt-sub">Photograph a paper receipt or invoice</div></div>'+
      '</button>'+
      '<button class="upload-opt" onclick="pickFolder()">'+
        '<div class="upload-opt-icon">&#x1F4C1;</div>'+
        '<div><div class="upload-opt-label">From Files</div><div class="upload-opt-sub">Pick a PDF or image from your device</div></div>'+
      '</button>'+
    '</div>'+
    '<button class="btn btn-secondary" onclick="closeSheet()">Cancel</button>';
}
function onFileChosen(e){
  const f=e.target.files[0];if(!f)return;e.target.value='';
  renderProcessing(f.name);doUpload(f);
}
function renderProcessing(name){
  document.getElementById('sheet-body').innerHTML=
    '<div class="sheet-title">Extracting…</div>'+
    '<div class="loading-row"><div class="spinner"></div>'+
    '<div>Reading <strong>'+esc(name)+'</strong></div>'+
    '<div class="loading-label">Gemini AI is extracting invoice data.<br>This may take a few seconds.</div></div>';
}
async function doUpload(file){
  const fd=new FormData();fd.append('file',file,file.name);
  try{
    const uploadHeaders={'Authorization':'Bearer '+TOKEN};
    if(GEMINI_KEY)uploadHeaders['x-gemini-key']=GEMINI_KEY;
    const r=await fetch(API+'/api/mobile/upload',{method:'POST',headers:uploadHeaders,body:fd});
    const d=await r.json();
    if(!d.ok)throw new Error(d.error||'Upload failed');
    const inv=d.invoice;
    const list=readList();list.unshift(inv);saveList(list);
    renderResult(inv,file);
  }catch(e){
    document.getElementById('sheet-body').innerHTML=
      '<div class="sheet-title">Error</div>'+
      '<div class="sheet-sub" style="color:var(--danger)">'+esc(e.message)+'</div>'+
      '<button class="btn btn-secondary" style="margin-top:8px" onclick="renderChoiceStep()">Try again</button>'+
      '<button class="btn btn-primary" style="margin-top:8px" onclick="closeSheet()">Close</button>';
  }
}
function renderResult(inv,file){
  const isImage=file&&file.type.startsWith('image/');
  const previewUrl=isImage?URL.createObjectURL(file):null;
  const items=(inv.items||[]).map(it=>'<tr><td>'+esc(it.name)+'</td><td style="text-align:right">'+fmt(it.amountInr)+'</td></tr>').join('');
  document.getElementById('sheet-body').innerHTML=
    '<div class="sheet-title">&#x2705; Extracted</div>'+
    '<div class="sheet-sub">Saved on your device. Send to desktop when ready.</div>'+
    (previewUrl?'<img id="cam-prev" style="width:100%;max-height:220px;object-fit:cover;border-radius:10px;margin-bottom:14px;border:1.5px solid var(--border)" src="'+previewUrl+'">':'')+
    '<div class="result-card">'+
      '<div class="result-name">'+esc(inv.shop_name||inv.filename||'Invoice')+'</div>'+
      '<div class="result-grid">'+
        '<div class="field"><label>Date</label><span>'+fmtDate(inv.date_of_purchase)+'</span></div>'+
        '<div class="field"><label>Total</label><span style="color:var(--accent);font-weight:700">'+fmt(inv.final_payment_inr)+'</span></div>'+
        '<div class="field"><label>GST No.</label><span>'+esc(inv.gst_number)+'</span></div>'+
        '<div class="field"><label>GST %</label><span>'+esc(inv.gst_percent)+'</span></div>'+
        '<div class="field"><label>Discount</label><span>'+fmt(inv.discount_inr)+'</span></div>'+
        '<div class="field"><label>GST Amt</label><span>'+fmt(inv.gst_amount_inr)+'</span></div>'+
      '</div>'+
      (items?'<table class="items-table" style="margin-top:10px"><thead><tr><th>Item</th><th style="text-align:right">Amt</th></tr></thead><tbody>'+items+'</tbody></table>':'')+
    '</div>'+
    '<button class="btn btn-primary" onclick="doSyncAndClose('+inv.id+')">Send to Desktop &#x2192;</button>'+
    '<button class="btn btn-secondary" onclick="closeSheet();loadInvoices()">Not now</button>';
  if(previewUrl){const img=document.getElementById('cam-prev');if(img){img.onload=()=>URL.revokeObjectURL(previewUrl);}}
}
async function doSyncAndClose(id){
  const list=readList();
  const inv=list.find(i=>i.id===id);
  if(inv){
    try{
      const r=await fetch(API+'/api/mobile/queue',{method:'POST',headers:{Authorization:'Bearer '+TOKEN,'Content-Type':'application/json'},body:JSON.stringify(inv)});
      const d=await r.json();
      if(d.ok){inv.pending_sync=true;saveList(list);}
    }catch{}
  }
  closeSheet();loadInvoices();
}
</script>
</body>
</html>`;
