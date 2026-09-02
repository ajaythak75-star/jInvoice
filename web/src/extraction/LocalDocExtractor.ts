// Type-specific local extractors for Indian financial documents.
// Run before Gemini — if confidence is high enough, the Gemini call is skipped entirely.

import type { ExtractedInvoice, PdfSourceType } from "../core/extraction/models";
import {
  extractDate,
  extractGrandTotal,
  extractPaymentMode,
  computeConfidence,
  extractMerchantName,
  extractGstin,
  extractLineItems,
  extractInvoiceNumber,
  extractMerchantAddress,
  extractMerchantPincode,
  extractPlatform,
} from "../core/extraction/InvoiceFieldParser";

// ── Known Indian banks ────────────────────────────────────────────────────────

const KNOWN_BANKS: [string, string][] = [
  ["state bank of india", "State Bank of India"],
  ["sbi bank", "State Bank of India"],
  ["hdfc bank", "HDFC Bank"],
  ["icici bank", "ICICI Bank"],
  ["axis bank", "Axis Bank"],
  ["kotak mahindra bank", "Kotak Mahindra Bank"],
  ["kotak bank", "Kotak Bank"],
  ["yes bank", "Yes Bank"],
  ["punjab national bank", "Punjab National Bank"],
  ["bank of baroda", "Bank of Baroda"],
  ["canara bank", "Canara Bank"],
  ["union bank of india", "Union Bank of India"],
  ["idfc first bank", "IDFC First Bank"],
  ["idbi bank", "IDBI Bank"],
  ["indian bank", "Indian Bank"],
  ["bank of india", "Bank of India"],
  ["central bank of india", "Central Bank of India"],
  ["federal bank", "Federal Bank"],
  ["south indian bank", "South Indian Bank"],
  ["karnataka bank", "Karnataka Bank"],
  ["indusind bank", "IndusInd Bank"],
  ["rbl bank", "RBL Bank"],
  ["bandhan bank", "Bandhan Bank"],
  ["pnb", "PNB"],
];

function detectBankName(text: string): string | null {
  const l = text.toLowerCase();
  for (const [kw, label] of KNOWN_BANKS) {
    if (l.includes(kw)) return label;
  }
  return null;
}

function parseMoney(s: string): number | null {
  const n = parseFloat(s.replace(/,/g, ""));
  return isNaN(n) ? null : Math.round(n * 100);
}

// ── Bank Statement ────────────────────────────────────────────────────────────

const BANK_STMT_KW = [
  "account statement", "bank statement", "statement of account",
  "transaction history", "account summary", "passbook",
];

const ACCT_NO_RX     = /account\s*(?:no|number|#)[.\s:]*(\d[\d\s]{7,17}\d)/i;
const CLOSE_BAL_RX   = /closing\s*balance[.\s:₹Rs]*([0-9,]+(?:\.[0-9]{1,2})?)/i;
const OPEN_BAL_RX    = /opening\s*balance[.\s:₹Rs]*([0-9,]+(?:\.[0-9]{1,2})?)/i;
const STMT_PERIOD_RX = /(?:statement\s*(?:period|date)|for\s*the\s*period|from)[.\s:]*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i;

export function extractBankStatement(text: string, sourceType: PdfSourceType): ExtractedInvoice | null {
  const l = text.toLowerCase();
  if (!BANK_STMT_KW.some((k) => l.includes(k))) return null;

  const bankName = detectBankName(text);
  const closingBalM = CLOSE_BAL_RX.exec(text);
  const closingBal  = closingBalM ? parseMoney(closingBalM[1]) : null;
  const hasOpenBal  = OPEN_BAL_RX.test(text);
  const periodM     = STMT_PERIOD_RX.exec(text);
  const date        = periodM ? (extractDate(periodM[0]) ?? extractDate(text)) : extractDate(text);
  const acctM       = ACCT_NO_RX.exec(text);
  const acctNo      = acctM ? acctM[1].replace(/\s/g, "") : null;

  const merchantName = bankName
    ? (acctNo ? `${bankName} (...${acctNo.slice(-4)})` : bankName)
    : null;

  const hits = [bankName, closingBal, date, hasOpenBal || acctNo].filter(Boolean).length;
  const confidenceScore = hits / 4;

  return {
    merchantName,
    merchantAddress: null,
    merchantGstin: null,
    merchantPhone: null,
    merchantPincode: null,
    invoiceNumber: acctNo,
    invoiceDate: date,
    lineItems: [],
    subtotalPaise: null,
    discountPaise: 0,
    taxPaise: null,
    grandTotalPaise: closingBal,
    paymentMode: null,
    sourceType,
    rawText: text,
    confidenceScore,
  };
}

// ── Cheque ────────────────────────────────────────────────────────────────────

const CHEQUE_KW = ["cheque", "drawn on", "pay to", "pay and", "bearer"];
const CHEQUE_NO_RX = /cheque\s*(?:no|number|#)[.\s:]*(\d{6,9})/i;
const PAYEE_RX     = /pay(?:\s+to\s+(?:the\s+(?:order\s+of)?)?)?[:\s]+([A-Za-z][A-Za-z\s,.]{2,50}?)(?=\s*[\n\/\-]|$)/im;
const CHQ_AMOUNT_RX = /(?:₹|Rs\.?\s*|INR\s*)([0-9,]+(?:\.[0-9]{1,2})?)/i;

export function extractCheque(text: string, sourceType: PdfSourceType): ExtractedInvoice | null {
  const l = text.toLowerCase();
  if (!CHEQUE_KW.some((k) => l.includes(k))) return null;

  const chequeNoM = CHEQUE_NO_RX.exec(text);
  const payeeM    = PAYEE_RX.exec(text);
  const amountM   = CHQ_AMOUNT_RX.exec(text);
  const date      = extractDate(text);
  const bankName  = detectBankName(text);
  const chequeNo  = chequeNoM?.[1] ?? null;
  const payee     = payeeM?.[1]?.trim() ?? null;
  const amount    = amountM ? parseMoney(amountM[1]) : null;

  const merchantName = payee ?? bankName;
  const hits = [payee ?? bankName, amount, date, chequeNo].filter(Boolean).length;
  const confidenceScore = hits / 4;

  return {
    merchantName,
    merchantAddress: null,
    merchantGstin: null,
    merchantPhone: null,
    merchantPincode: null,
    invoiceNumber: chequeNo,
    invoiceDate: date,
    lineItems: [],
    subtotalPaise: null,
    discountPaise: 0,
    taxPaise: null,
    grandTotalPaise: amount,
    paymentMode: "card",
    sourceType,
    rawText: text,
    confidenceScore,
  };
}

// ── Utility / Telecom Bill ────────────────────────────────────────────────────

const UTILITY_KW = [
  "electricity bill", "power bill", "energy bill",
  "water bill", "gas bill", "broadband bill", "internet bill",
  "mobile bill", "telephone bill", "dth bill", "postpaid bill",
  "consumer number", "meter number",
];

const BILL_NO_RX     = /bill\s*(?:no|number)[.\s:]*([A-Z0-9\-]{4,20})/i;
const CONSUMER_NO_RX = /consumer\s*(?:no|number|id)[.\s:]*([A-Z0-9\-]{4,20})/i;
const DUE_DATE_RX    = /(?:due\s*date|last\s*date\s*of\s*payment)[.\s:]*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i;

export function extractUtilityBill(text: string, sourceType: PdfSourceType): ExtractedInvoice | null {
  const l = text.toLowerCase();
  if (!UTILITY_KW.some((k) => l.includes(k))) return null;

  const amount   = extractGrandTotal(text);
  const dueDateM = DUE_DATE_RX.exec(text);
  const date     = dueDateM ? (extractDate(dueDateM[0]) ?? extractDate(text)) : extractDate(text);
  const billNo   = BILL_NO_RX.exec(text)?.[1] ?? CONSUMER_NO_RX.exec(text)?.[1] ?? null;
  const merchant = extractMerchantName(text);

  const hits = [merchant, amount, date].filter(Boolean).length;
  const confidenceScore = hits / 3;

  return {
    merchantName: merchant,
    merchantAddress: null,
    merchantGstin: extractGstin(text),
    merchantPhone: null,
    merchantPincode: null,
    invoiceNumber: billNo,
    invoiceDate: date,
    lineItems: extractLineItems(text),
    subtotalPaise: null,
    discountPaise: 0,
    taxPaise: null,
    grandTotalPaise: amount,
    paymentMode: extractPaymentMode(text),
    sourceType,
    rawText: text,
    confidenceScore,
  };
}

// ── General invoice / receipt ─────────────────────────────────────────────────

export function extractGeneralInvoice(text: string, sourceType: PdfSourceType): ExtractedInvoice {
  const merchantName    = extractMerchantName(text);
  const invoiceDate     = extractDate(text);
  const merchantGstin   = extractGstin(text);
  const grandTotalPaise = extractGrandTotal(text);
  const paymentMode     = extractPaymentMode(text);
  const lineItems       = extractLineItems(text);
  const invoiceNumber   = extractInvoiceNumber(text);
  const merchantAddress = extractMerchantAddress(text);
  const merchantPincode = extractMerchantPincode(text);
  const platform        = extractPlatform(text);
  const confidenceScore = computeConfidence({ merchantName, invoiceDate, grandTotalPaise, paymentMode });

  return {
    merchantName,
    merchantAddress,
    merchantGstin,
    merchantPhone: null,
    merchantPincode,
    platform,
    invoiceNumber,
    invoiceDate,
    lineItems,
    subtotalPaise: null,
    discountPaise: 0,
    taxPaise: null,
    grandTotalPaise,
    paymentMode,
    sourceType,
    rawText: text,
    confidenceScore,
  };
}

// ── Main dispatcher ───────────────────────────────────────────────────────────

// Tries type-specific parsers in priority order. Always returns a result
// (falls back to general invoice). Check .confidenceScore before trusting it.
export function extractLocalDoc(text: string, sourceType: PdfSourceType): ExtractedInvoice {
  const bankResult = extractBankStatement(text, sourceType);
  if (bankResult && bankResult.confidenceScore >= 0.4) return bankResult;

  const chequeResult = extractCheque(text, sourceType);
  if (chequeResult && chequeResult.confidenceScore >= 0.4) return chequeResult;

  const utilityResult = extractUtilityBill(text, sourceType);
  if (utilityResult && utilityResult.confidenceScore >= 0.4) return utilityResult;

  return extractGeneralInvoice(text, sourceType);
}
