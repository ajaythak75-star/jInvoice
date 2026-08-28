import type { ExtractionResult, ExtractedInvoice } from "../core/extraction/models";
import type { PdfClassification } from "../core/extraction/PdfClassification";
import { classifyPdf } from "./WebPdfClassifier";
import { htmlToText } from "./HtmlExtractor";
import { extractNativePdf } from "./WebNativePdfExtractor";
import { extractScannedPdf } from "./WebScannedPdfExtractor";
import { extractFromCanvas } from "./WebCameraExtractor";
import { enhanceWithClaude, enhanceWithClaudeVision } from "./ClaudeExtractor";
import { renderPdfToImages } from "./WebPdfRenderer";
import { db, insertInvoiceWithItems } from "../data/InvoiceDatabase";
import { detectCategory } from "../core/extraction/CategoryDetector";
import { detectDocType } from "./DocTypeDetector";
import { computeSentinelForInvoice } from "../service/ExpirySentinel";
import { prefs } from "../data/AutoImportPreferences";

function hasGeminiKey(): boolean {
  if (hasGeminiKey()) return true;
  try { return !!localStorage.getItem("jinvoice:gemini_api_key"); } catch { return false; }
}

async function processHtmlFile(
  file: File,
  importSource: string,
  meta?: { subject?: string; senderEmail?: string; receivedAt?: string },
): Promise<ExtractionResult> {
  const html = await file.text();
  const plainText = htmlToText(html);
  const blank: ExtractedInvoice = {
    merchantName: null, merchantAddress: null, merchantGstin: null,
    merchantPhone: null, merchantPincode: null, invoiceNumber: null,
    invoiceDate: null, lineItems: [], subtotalPaise: null, discountPaise: 0,
    taxPaise: null, grandTotalPaise: null, paymentMode: null,
    sourceType: "HTML_EMAIL", rawText: plainText, confidenceScore: 0,
  };

  let result: ExtractionResult;
  if (hasGeminiKey()) {
    try {
      const enhanced = await enhanceWithClaude(blank);
      console.log("[Pipeline] HTML Gemini result — merchant:", enhanced.merchantName, "total:", enhanced.grandTotalPaise);
      if (enhanced.grandTotalPaise != null || enhanced.merchantName != null) {
        result = enhanced.confidenceScore >= 0.7
          ? { kind: "success", invoice: enhanced }
          : { kind: "lowConfidence", invoice: enhanced, reason: "html-low" };
      } else {
        result = { kind: "failure", reason: "html-no-data" };
      }
    } catch (e) {
      console.warn("[Pipeline] HTML enhancement failed:", e);
      result = { kind: "failure", reason: "html-enhance-failed", error: e };
    }
  } else {
    result = { kind: "lowConfidence", invoice: blank, reason: "html-no-key" };
  }

  await persistResult(result, importSource, file.name, meta);
  return result;
}

export async function processFile(
  file: File,
  importSource: string,
  meta?: { subject?: string; senderEmail?: string; receivedAt?: string },
): Promise<ExtractionResult> {
  if (prefs.isDailyLimitReached) {
    return { kind: "dailyLimitReached", limit: prefs.FREE_DAILY_LIMIT };
  }

  if (file.type === "text/html" || file.name.toLowerCase().endsWith(".html")) {
    return processHtmlFile(file, importSource, meta);
  }

  const classification: PdfClassification = await classifyPdf(file);
  let result: ExtractionResult;

  if (classification === "encrypted") {
    result = { kind: "encryptedPdf" };
  } else if (classification === "native") {
    result = await extractNativePdf(file);
  } else if (classification === "scanned") {
    result = await extractScannedPdf(file);
  } else {
    const pageTypes = classification.mixed;
    const nativeCount = Object.values(pageTypes).filter((t) => t === "native").length;
    result = nativeCount >= Object.keys(pageTypes).length / 2
      ? await extractNativePdf(file)
      : await extractScannedPdf(file);
  }

  console.log("[Pipeline] gemini key present:", !!hasGeminiKey(), "result kind:", result.kind);

  if ((result.kind === "success" || result.kind === "lowConfidence") && hasGeminiKey()) {
    try {
      let enhanced = result.invoice;
      if (file.type === "application/pdf" && result.invoice.sourceType === "NATIVE_PDF" && result.invoice.rawText) {
        console.log("[Pipeline] calling Gemini text (native PDF)");
        enhanced = await enhanceWithClaude(result.invoice);
      } else if (file.type === "application/pdf") {
        const pages = await renderPdfToImages(file);
        console.log("[Pipeline] calling Gemini vision, pages:", pages.length);
        enhanced = await enhanceWithClaudeVision(result.invoice, pages);
      } else {
        enhanced = await enhanceWithClaude(result.invoice);
      }
      console.log("[Pipeline] Gemini returned merchant:", enhanced.merchantName, "total:", enhanced.grandTotalPaise);
      result = enhanced.confidenceScore >= 0.7 && result.kind === "lowConfidence"
        ? { kind: "success", invoice: enhanced }
        : { ...result, invoice: enhanced };
    } catch (e) {
      console.warn("[Pipeline] Claude enhancement failed:", e);
    }
  }

  // Fallback: for PDFs where native/OCR extraction failed entirely, try pure Gemini vision
  if (result.kind === "failure" && file.type === "application/pdf" && hasGeminiKey()) {
    try {
      const pages = await renderPdfToImages(file);
      console.log("[Pipeline] vision fallback, pages:", pages.length);
      const blank: import("../core/extraction/models").ExtractedInvoice = {
        merchantName: null, merchantAddress: null, merchantGstin: null,
        merchantPhone: null, merchantPincode: null, invoiceNumber: null,
        invoiceDate: null, lineItems: [], subtotalPaise: null, discountPaise: 0,
        taxPaise: null, grandTotalPaise: null, paymentMode: null,
        sourceType: "SCANNED_PDF", rawText: null, confidenceScore: 0,
      };
      const enhanced = await enhanceWithClaudeVision(blank, pages);
      console.log("[Pipeline] vision fallback result — merchant:", enhanced.merchantName, "total:", enhanced.grandTotalPaise, "items:", enhanced.lineItems.length);
      if (enhanced.grandTotalPaise != null || enhanced.merchantName != null) {
        result = { kind: "lowConfidence", invoice: enhanced, reason: "vision-only" };
      }
    } catch (e) {
      console.warn("[Pipeline] Claude vision fallback failed:", e);
    }
  }

  await persistResult(result, importSource, file.name, meta);
  return result;
}

export async function processImageCapture(
  canvas: HTMLCanvasElement,
  importSource: string,
): Promise<ExtractionResult> {
  if (prefs.isDailyLimitReached) {
    return { kind: "dailyLimitReached", limit: prefs.FREE_DAILY_LIMIT };
  }
  const result = await extractFromCanvas(canvas);
  await persistResult(result, importSource);
  return result;
}

async function persistResult(
  result: ExtractionResult,
  importSource: string,
  sourceFilename?: string,
  meta?: { subject?: string; senderEmail?: string; receivedAt?: string },
): Promise<void> {
  const now = new Date().toISOString();
  console.log("[Pipeline]", sourceFilename, "→ kind:", result.kind);
  if (result.kind === "success" || result.kind === "lowConfidence") {
    const inv = result.invoice;
    const status = result.kind === "success" ? "imported" : "pending_review";
    const lineItemNames = inv.lineItems.map((li) => li.name);
    const category = detectCategory(inv.merchantName, lineItemNames);
    const docTypes = detectDocType(inv.merchantName, lineItemNames, sourceFilename, meta?.subject);
    const docType  = docTypes[0];
    console.log("[Pipeline]", sourceFilename, "docTypes:", docTypes, "allowed:", prefs.importDocTypes);

    if (!docTypes.some((dt) => prefs.importDocTypes.includes(dt))) {
      console.log("[Pipeline]", sourceFilename, "SKIPPED — doc type not in filter");
      return;
    }

    prefs.incrementDailyCount();

    const invoiceId = await insertInvoiceWithItems(
      {
        merchantName: inv.merchantName,
        merchantAddress: inv.merchantAddress,
        merchantGstin: inv.merchantGstin,
        merchantPincode: inv.merchantPincode,
        invoiceNumber: inv.invoiceNumber,
        invoiceDate: inv.invoiceDate,
        subtotalPaise: inv.subtotalPaise,
        grandTotalPaise: inv.grandTotalPaise,
        discountPaise: inv.discountPaise,
        taxPaise: inv.taxPaise,
        paymentMode: inv.paymentMode,
        importSource,
        pdfSourceType: inv.sourceType,
        importRecordId: null,
        status,
        category,
        docType,
        docTypes,
        sourceFilename,
        subject: meta?.subject,
        senderEmail: meta?.senderEmail,
        receivedAt: meta?.receivedAt,
        createdAt: now,
        updatedAt: now,
      },
      inv.lineItems.map((li) => ({
        name: li.name,
        quantity: li.quantity,
        unitPricePaise: li.unitPricePaise,
        totalPricePaise: li.totalPricePaise,
        discountPaise: li.discountPaise,
      })),
    );

    if (inv.rawText) {
      await db.rawTexts.add({ invoiceId, rawText: inv.rawText });
    }

    await computeSentinelForInvoice(invoiceId, inv.invoiceDate, inv.merchantName, lineItemNames);
  } else {
    const status = result.kind === "encryptedPdf" ? "import_blocked_encrypted" : "extraction_failed";
    await insertInvoiceWithItems(
      {
        merchantName: null, merchantAddress: null, merchantGstin: null,
        invoiceDate: null, grandTotalPaise: null, discountPaise: 0, taxPaise: null,
        paymentMode: null, importSource, pdfSourceType: "NATIVE_PDF",
        importRecordId: null, status, docType: "other", docTypes: ["other"], sourceFilename,
        subject: meta?.subject, senderEmail: meta?.senderEmail, receivedAt: meta?.receivedAt,
        createdAt: now, updatedAt: now,
      },
      [],
    );
  }
}

/** Extract + Gemini-enhance a file without saving to DB — for preview before submit */
export async function extractFilePreview(file: File): Promise<ExtractionResult> {
  if (file.type === "text/html" || file.name.toLowerCase().endsWith(".html")) {
    const html = await file.text();
    const plainText = htmlToText(html);
    const blank: ExtractedInvoice = {
      merchantName: null, merchantAddress: null, merchantGstin: null,
      merchantPhone: null, merchantPincode: null, invoiceNumber: null,
      invoiceDate: null, lineItems: [], subtotalPaise: null, discountPaise: 0,
      taxPaise: null, grandTotalPaise: null, paymentMode: null,
      sourceType: "HTML_EMAIL", rawText: plainText, confidenceScore: 0,
    };
    if (!hasGeminiKey()) return { kind: "lowConfidence", invoice: blank, reason: "html-no-key" };
    const enhanced = await enhanceWithClaude(blank);
    return enhanced.grandTotalPaise != null || enhanced.merchantName != null
      ? enhanced.confidenceScore >= 0.7
        ? { kind: "success", invoice: enhanced }
        : { kind: "lowConfidence", invoice: enhanced, reason: "html-low" }
      : { kind: "failure", reason: "html-no-data" };
  }

  const classification: PdfClassification = await classifyPdf(file);
  let result: ExtractionResult;

  if (classification === "encrypted") {
    result = { kind: "encryptedPdf" };
  } else if (classification === "native") {
    result = await extractNativePdf(file);
  } else if (classification === "scanned") {
    result = await extractScannedPdf(file);
  } else {
    const pageTypes = classification.mixed;
    const nativeCount = Object.values(pageTypes).filter((t) => t === "native").length;
    result = nativeCount >= Object.keys(pageTypes).length / 2
      ? await extractNativePdf(file)
      : await extractScannedPdf(file);
  }

  if ((result.kind === "success" || result.kind === "lowConfidence") && hasGeminiKey()) {
    try {
      let enhanced = result.invoice;
      if (file.type === "application/pdf" && result.invoice.sourceType === "NATIVE_PDF" && result.invoice.rawText) {
        enhanced = await enhanceWithClaude(result.invoice);
      } else if (file.type === "application/pdf") {
        const pages = await renderPdfToImages(file);
        enhanced = await enhanceWithClaudeVision(result.invoice, pages);
      } else {
        enhanced = await enhanceWithClaude(result.invoice);
      }
      result = enhanced.confidenceScore >= 0.7 && result.kind === "lowConfidence"
        ? { kind: "success", invoice: enhanced }
        : { ...result, invoice: enhanced };
    } catch (e) {
      console.warn("[Pipeline] preview enhancement failed:", e);
    }
  }

  return result;
}
