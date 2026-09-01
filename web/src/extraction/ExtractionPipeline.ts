import type { ExtractionResult, ExtractedInvoice } from "../core/extraction/models";
import type { PdfClassification } from "../core/extraction/PdfClassification";
import { classifyPdf } from "./WebPdfClassifier";
import { htmlToText } from "./HtmlExtractor";
import { extractNativePdf } from "./WebNativePdfExtractor";
import { extractScannedPdf } from "./WebScannedPdfExtractor";
import { extractFromCanvas } from "./WebCameraExtractor";
import { enhanceWithClaude, enhanceWithClaudeVision } from "./ClaudeExtractor";
import { renderPdfToImages } from "./WebPdfRenderer";
import { db, insertInvoiceWithItems, isDuplicateInvoice, isDuplicateByFilename, markAsDuplicate } from "../data/InvoiceDatabase";
import type { InvoicePdfFile } from "../data/InvoiceDatabase";
import { detectCategory } from "../core/extraction/CategoryDetector";
import { detectDocType } from "./DocTypeDetector";
import { computeSentinelForInvoice } from "../service/ExpirySentinel";
import { prefs } from "../data/AutoImportPreferences";

// Gemini is always attempted via the server-side proxy (/api/gemini).
// If the server has no key it returns 503, caught by the try/catch fallback.
function hasGeminiKey(): boolean { return true; }

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
  options?: { skipGemini?: boolean },
): Promise<ExtractionResult> {
  if (prefs.isDailyLimitReached) {
    return { kind: "dailyLimitReached", limit: prefs.FREE_DAILY_LIMIT };
  }

  if (file.type === "text/html" || file.name.toLowerCase().endsWith(".html")) {
    return processHtmlFile(file, importSource, meta);
  }

  const classification = await classifyPdf(file);

  // Skip Gemini — save file metadata with pending_extraction status for later AI processing in View screen
  if (options?.skipGemini) {
    if (classification === "encrypted") return { kind: "encryptedPdf" };

    // Filename duplicate — same file was already saved; mark visible as duplicate
    if (file.name && await isDuplicateByFilename(file.name)) {
      console.log("[Pipeline] skipGemini filename duplicate:", file.name);
      const pdfSourceType =
        classification === "native" ? "NATIVE_PDF" :
        classification === "scanned" ? "SCANNED_PDF" : "MIXED_PDF";
      const now = new Date().toISOString();
      await insertInvoiceWithItems(
        {
          merchantName: null, merchantAddress: null, merchantGstin: null,
          merchantPincode: null, invoiceNumber: null, invoiceDate: null,
          subtotalPaise: null, grandTotalPaise: null, discountPaise: 0,
          taxPaise: null, paymentMode: null,
          importSource, pdfSourceType, importRecordId: null,
          status: "duplicate", docType: "other", docTypes: ["other"],
          sourceFilename: file.name,
          subject: meta?.subject, senderEmail: meta?.senderEmail, receivedAt: meta?.receivedAt,
          createdAt: now, updatedAt: now,
        },
        [],
      );
      return { kind: "pendingExtraction" };
    }

    const now = new Date().toISOString();
    const pdfSourceType =
      classification === "native" ? "NATIVE_PDF" :
      classification === "scanned" ? "SCANNED_PDF" : "MIXED_PDF";
    let rawText: string | null = null;
    if (classification !== "scanned") {
      try {
        const tr = await extractNativePdf(file);
        if ((tr.kind === "success" || tr.kind === "lowConfidence") && tr.invoice.rawText) {
          rawText = tr.invoice.rawText;
        }
      } catch {}
    }
    const invoiceId = await insertInvoiceWithItems(
      {
        merchantName: null, merchantAddress: null, merchantGstin: null,
        merchantPincode: null, invoiceNumber: null, invoiceDate: null,
        subtotalPaise: null, grandTotalPaise: null, discountPaise: 0,
        taxPaise: null, paymentMode: null,
        importSource, pdfSourceType, importRecordId: null,
        status: "pending_extraction", docType: "other", docTypes: ["other"],
        sourceFilename: file.name,
        subject: meta?.subject, senderEmail: meta?.senderEmail, receivedAt: meta?.receivedAt,
        createdAt: now, updatedAt: now,
      },
      [],
    );
    if (rawText) await db.rawTexts.add({ invoiceId, rawText });
    // Store PDF bytes so vision extraction can be re-run from ViewScreen
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      await db.pdfFiles.add({ invoiceId, bytes, filename: file.name } as InvoicePdfFile);
    } catch {}
    return { kind: "pendingExtraction" };
  }
  let result: ExtractionResult;

  if (classification === "encrypted") {
    result = { kind: "encryptedPdf" };
  } else if (hasGeminiKey()) {
    // Vision-first: render PDF to images so Gemini reads the visual layout —
    // table structure, column alignment, GST breakdowns — rather than garbled extracted text.
    try {
      const pages = await renderPdfToImages(file);
      console.log("[Pipeline] vision-first pages:", pages.length);
      if (pages.length > 0) {
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
      } else {
        // Rendering returned no pages — fall back to text + Gemini text
        result = await textExtractPdf(file, classification);
        if ((result.kind === "success" || result.kind === "lowConfidence") && result.invoice.rawText) {
          const enhanced = await enhanceWithClaude(result.invoice);
          result = enhanced.confidenceScore >= 0.7 && result.kind === "lowConfidence"
            ? { kind: "success", invoice: enhanced }
            : { ...result, invoice: enhanced };
        }
      }
    } catch (e) {
      // Vision failed (render error or Gemini error) — fall back to text + Gemini text
      console.warn("[Pipeline] vision failed:", e);
      result = await textExtractPdf(file, classification);
      if ((result.kind === "success" || result.kind === "lowConfidence") && result.invoice.rawText) {
        try {
          const enhanced = await enhanceWithClaude(result.invoice);
          result = enhanced.confidenceScore >= 0.7 && result.kind === "lowConfidence"
            ? { kind: "success", invoice: enhanced }
            : { ...result, invoice: enhanced };
        } catch (e2) {
          console.warn("[Pipeline] text enhancement also failed:", e2);
        }
      }
    }
  } else {
    // No Gemini key: text extraction only
    console.log("[Pipeline] no Gemini key — using text extraction only");
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

    // Filename duplicate — same file already imported; save as duplicate so it's visible in View
    if (sourceFilename && await isDuplicateByFilename(sourceFilename)) {
      console.log("[Pipeline] filename duplicate:", sourceFilename);
      const docTypes = detectDocType(inv.merchantName, inv.lineItems.map(li => li.name), sourceFilename, meta?.subject);
      await insertInvoiceWithItems(
        {
          merchantName: inv.merchantName, merchantAddress: inv.merchantAddress,
          merchantGstin: inv.merchantGstin, merchantPincode: inv.merchantPincode,
          invoiceNumber: inv.invoiceNumber, invoiceDate: inv.invoiceDate,
          subtotalPaise: inv.subtotalPaise, grandTotalPaise: inv.grandTotalPaise,
          discountPaise: inv.discountPaise, taxPaise: inv.taxPaise, paymentMode: inv.paymentMode,
          importSource, pdfSourceType: inv.sourceType, importRecordId: null,
          status: "duplicate", category: detectCategory(inv.merchantName, inv.lineItems.map(li => li.name)),
          docType: docTypes[0], docTypes, sourceFilename,
          subject: meta?.subject, senderEmail: meta?.senderEmail, receivedAt: meta?.receivedAt,
          createdAt: now, updatedAt: now,
        },
        [],
      );
      return true;
    }

    // Content duplicate — same merchant + total + date already saved; skip silently
    if (await isDuplicateInvoice(inv.merchantName, inv.grandTotalPaise, inv.invoiceDate)) {
      console.log("[Pipeline] content duplicate skipped:", inv.merchantName, inv.invoiceDate, inv.grandTotalPaise);
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

/** Run Gemini on a pending_extraction invoice — uses vision if PDF bytes are stored, text otherwise. */
export async function extractInvoiceWithAI(invoiceId: number): Promise<ExtractedInvoice | null> {
  const blank: ExtractedInvoice = {
    merchantName: null, merchantAddress: null, merchantGstin: null,
    merchantPhone: null, merchantPincode: null, invoiceNumber: null,
    invoiceDate: null, lineItems: [], subtotalPaise: null, discountPaise: 0,
    taxPaise: null, grandTotalPaise: null, paymentMode: null,
    sourceType: "NATIVE_PDF", rawText: null, confidenceScore: 0,
  };

  let enhanced: ExtractedInvoice | null = null;

  // Vision path — preferred if original PDF bytes were stored
  const pdfRec = await db.pdfFiles.where("invoiceId").equals(invoiceId).first();
  if (pdfRec?.bytes) {
    try {
      const file = new File([pdfRec.bytes.buffer as ArrayBuffer], pdfRec.filename, { type: "application/pdf" });
      const pages = await renderPdfToImages(file);
      if (pages.length > 0) {
        enhanced = await enhanceWithClaudeVision(blank, pages);
      }
    } catch (e) {
      console.warn("[extractInvoiceWithAI] vision failed, falling back to text:", e);
    }
  }

  // Text fallback
  if (!enhanced || (enhanced.grandTotalPaise == null && enhanced.merchantName == null)) {
    const rawRec = await db.rawTexts.where("invoiceId").equals(invoiceId).first();
    if (!rawRec?.rawText) return null;
    enhanced = await enhanceWithClaude({ ...blank, rawText: rawRec.rawText });
  }

  if (!enhanced || (enhanced.grandTotalPaise == null && enhanced.merchantName == null)) return null;

  // Content duplicate check — same merchant + total + date already saved
  if (await isDuplicateInvoice(enhanced.merchantName, enhanced.grandTotalPaise, enhanced.invoiceDate)) {
    console.log("[extractInvoiceWithAI] content duplicate:", enhanced.merchantName, enhanced.invoiceDate);
    await markAsDuplicate(invoiceId);
    return enhanced;
  }

  const now = new Date().toISOString();
  const lineItemNames = enhanced.lineItems.map((li) => li.name);
  const category = detectCategory(enhanced.merchantName, lineItemNames);
  const docTypes = detectDocType(enhanced.merchantName, lineItemNames, undefined, undefined);
  const status = enhanced.confidenceScore >= 0.7 ? "imported" : "pending_review";
  await db.invoices.update(invoiceId, {
    merchantName: enhanced.merchantName,
    merchantAddress: enhanced.merchantAddress,
    merchantGstin: enhanced.merchantGstin,
    merchantPhone: enhanced.merchantPhone,
    merchantPincode: enhanced.merchantPincode,
    invoiceNumber: enhanced.invoiceNumber,
    invoiceDate: enhanced.invoiceDate,
    subtotalPaise: enhanced.subtotalPaise,
    grandTotalPaise: enhanced.grandTotalPaise,
    discountPaise: enhanced.discountPaise,
    taxPaise: enhanced.taxPaise,
    paymentMode: enhanced.paymentMode,
    status,
    category,
    docType: docTypes[0] ?? "other",
    docTypes,
    updatedAt: now,
  });
  await db.lineItems.where("invoiceId").equals(invoiceId).delete();
  if (enhanced.lineItems.length > 0) {
    await db.lineItems.bulkAdd(enhanced.lineItems.map((li) => ({
      invoiceId,
      name: li.name,
      quantity: li.quantity,
      unitPricePaise: li.unitPricePaise,
      totalPricePaise: li.totalPricePaise,
      discountPaise: li.discountPaise,
    })));
  }
  // Free the stored PDF bytes — no longer needed after extraction
  await db.pdfFiles.where("invoiceId").equals(invoiceId).delete();
  return enhanced;
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
    try {
      const pages = await renderPdfToImages(file);
      if (pages.length > 0) {
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
      }
    } catch (e) {
      console.warn("[Pipeline] preview vision failed, falling back to text:", e);
    }
    // Rendering failed or returned no pages — fall back to text + Gemini text
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
