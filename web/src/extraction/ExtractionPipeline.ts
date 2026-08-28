import type { ExtractionResult, ExtractedInvoice } from "../core/extraction/models";
import type { PdfClassification } from "../core/extraction/PdfClassification";
import { classifyPdf } from "./WebPdfClassifier";
import { htmlToText } from "./HtmlExtractor";
import { extractNativePdf } from "./WebNativePdfExtractor";
import { extractScannedPdf } from "./WebScannedPdfExtractor";
import { extractFromCanvas } from "./WebCameraExtractor";
import { enhanceWithClaude, enhanceWithClaudeVision } from "./ClaudeExtractor";
import { renderPdfToImages } from "./WebPdfRenderer";
import { db, insertInvoiceWithItems, isDuplicateInvoice } from "../data/InvoiceDatabase";
import { detectCategory } from "../core/extraction/CategoryDetector";
import { detectDocType } from "./DocTypeDetector";
import { computeSentinelForInvoice } from "../service/ExpirySentinel";
import { prefs } from "../data/AutoImportPreferences";

function hasGeminiKey(): boolean {
  if (import.meta.env.VITE_GEMINI_API_KEY) return true;
  try { return !!localStorage.getItem("jinvoice:gemini_api_key"); } catch { return false; }
}

// Text-based fallback for when vision is unavailable or rendering fails.
async function textExtractPdf(file: File, classification: PdfClassification): Promise<ExtractionResult> {
  if (classification === "native") return extractNativePdf(file);
  if (classification === "scanned") return extractScannedPdf(file);
  if (classification === "encrypted") return { kind: "encryptedPdf" };
  const pageTypes = classification.mixed;
  const nativeCount = Object.values(pageTypes).filter((t) => t === "native").length;
  return nativeCount >= Object.keys(pageTypes).length / 2
    ? extractNativePdf(file)
    : extractScannedPdf(file);
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

  const wasDup = await persistResult(result, importSource, file.name, meta);
  if (wasDup && (result.kind === "success" || result.kind === "lowConfidence")) {
    return { kind: "duplicate", invoice: result.invoice };
  }
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

  const classification = await classifyPdf(file);
  let result: ExtractionResult;

  if (classification === "encrypted") {
    result = { kind: "encryptedPdf" };
  } else if (hasGeminiKey()) {
    // Vision-first: render PDF to images immediately so Gemini reads the visual layout —
    // table structure, column alignment, GST breakdowns — rather than garbled extracted text.
    const pages = await renderPdfToImages(file);
    console.log("[Pipeline] vision-first pages:", pages.length);
    if (pages.length > 0) {
      try {
        const blank: ExtractedInvoice = {
          merchantName: null, merchantAddress: null, merchantGstin: null,
          merchantPhone: null, merchantPincode: null, invoiceNumber: null,
          invoiceDate: null, lineItems: [], subtotalPaise: null, discountPaise: 0,
          taxPaise: null, grandTotalPaise: null, paymentMode: null,
          sourceType: "NATIVE_PDF", rawText: null, confidenceScore: 0,
        };
        const enhanced = await enhanceWithClaudeVision(blank, pages);
        console.log("[Pipeline] vision merchant:", enhanced.merchantName, "total:", enhanced.grandTotalPaise);
        if (enhanced.grandTotalPaise != null || enhanced.merchantName != null) {
          result = enhanced.confidenceScore >= 0.7
            ? { kind: "success", invoice: enhanced }
            : { kind: "lowConfidence", invoice: enhanced, reason: "vision-only" };
        } else {
          result = { kind: "failure", reason: "vision-no-data" };
        }
      } catch (e) {
        console.warn("[Pipeline] vision-first failed:", e);
        result = { kind: "failure", reason: "vision-failed", error: e };
      }
    } else {
      // PDF rendering returned no pages — fall back to text extraction + Gemini text
      result = await textExtractPdf(file, classification);
      if ((result.kind === "success" || result.kind === "lowConfidence") && result.invoice.rawText) {
        try {
          const enhanced = await enhanceWithClaude(result.invoice);
          result = enhanced.confidenceScore >= 0.7 && result.kind === "lowConfidence"
            ? { kind: "success", invoice: enhanced }
            : { ...result, invoice: enhanced };
        } catch (e) {
          console.warn("[Pipeline] text fallback enhancement failed:", e);
        }
      }
    }
  } else {
    // No Gemini key: text extraction only
    result = await textExtractPdf(file, classification);
  }

  const wasDup = await persistResult(result, importSource, file.name, meta);
  if (wasDup && (result.kind === "success" || result.kind === "lowConfidence")) {
    return { kind: "duplicate", invoice: result.invoice };
  }
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

// Returns true if the invoice was a duplicate and was NOT saved.
async function persistResult(
  result: ExtractionResult,
  importSource: string,
  sourceFilename?: string,
  meta?: { subject?: string; senderEmail?: string; receivedAt?: string },
): Promise<boolean> {
  const now = new Date().toISOString();
  console.log("[Pipeline]", sourceFilename, "→ kind:", result.kind);
  if (result.kind === "success" || result.kind === "lowConfidence") {
    const inv = result.invoice;

    // Duplicate check: same merchant + total + date already saved
    if (await isDuplicateInvoice(inv.merchantName, inv.grandTotalPaise, inv.invoiceDate)) {
      console.log("[Pipeline] duplicate skipped:", inv.merchantName, inv.invoiceDate, inv.grandTotalPaise);
      return true;
    }

    const status = result.kind === "success" ? "imported" : "pending_review";
    const lineItemNames = inv.lineItems.map((li) => li.name);
    const category = detectCategory(inv.merchantName, lineItemNames);
    const docTypes = detectDocType(inv.merchantName, lineItemNames, sourceFilename, meta?.subject);
    const docType  = docTypes[0];
    console.log("[Pipeline]", sourceFilename, "docTypes:", docTypes, "allowed:", prefs.importDocTypes);

    if (!docTypes.some((dt) => prefs.importDocTypes.includes(dt))) {
      console.log("[Pipeline]", sourceFilename, "SKIPPED — doc type not in filter");
      return false;
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
  return false;
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

  const classification = await classifyPdf(file);

  if (classification === "encrypted") return { kind: "encryptedPdf" };

  if (hasGeminiKey()) {
    const pages = await renderPdfToImages(file);
    if (pages.length > 0) {
      try {
        const blank: ExtractedInvoice = {
          merchantName: null, merchantAddress: null, merchantGstin: null,
          merchantPhone: null, merchantPincode: null, invoiceNumber: null,
          invoiceDate: null, lineItems: [], subtotalPaise: null, discountPaise: 0,
          taxPaise: null, grandTotalPaise: null, paymentMode: null,
          sourceType: "NATIVE_PDF", rawText: null, confidenceScore: 0,
        };
        const enhanced = await enhanceWithClaudeVision(blank, pages);
        if (enhanced.grandTotalPaise != null || enhanced.merchantName != null) {
          return enhanced.confidenceScore >= 0.7
            ? { kind: "success", invoice: enhanced }
            : { kind: "lowConfidence", invoice: enhanced, reason: "vision-only" };
        }
        return { kind: "failure", reason: "vision-no-data" };
      } catch (e) {
        console.warn("[Pipeline] preview vision failed:", e);
      }
    }
    // Rendering failed — fall back to text + Gemini text
    const result = await textExtractPdf(file, classification);
    if ((result.kind === "success" || result.kind === "lowConfidence") && result.invoice.rawText) {
      try {
        const enhanced = await enhanceWithClaude(result.invoice);
        return enhanced.confidenceScore >= 0.7 && result.kind === "lowConfidence"
          ? { kind: "success", invoice: enhanced }
          : { ...result, invoice: enhanced };
      } catch {}
    }
    return result;
  }

  return textExtractPdf(file, classification);
}
