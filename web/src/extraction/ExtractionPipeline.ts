import type { ExtractionResult, ExtractedInvoice } from "../core/extraction/models";
import type { PdfClassification } from "../core/extraction/PdfClassification";
import { classifyPdf } from "./WebPdfClassifier";
import { htmlToText } from "./HtmlExtractor";
import { extractNativePdf } from "./WebNativePdfExtractor";
import { extractScannedPdf } from "./WebScannedPdfExtractor";
import { extractFromCanvas } from "./WebCameraExtractor";
import { enhanceWithClaude, enhanceWithClaudeVision } from "./ClaudeExtractor";
import { renderPdfToImages } from "./WebPdfRenderer";
import { blurScoreFromBase64 } from "./BlurDetector";
import { extractLocalDoc } from "./LocalDocExtractor";
import { db, insertInvoiceWithItems, isDuplicateInvoice, isDuplicateByFilename, markAsDuplicate } from "../data/InvoiceDatabase";
import type { InvoicePdfFile } from "../data/InvoiceDatabase";
import { detectCategory } from "../core/extraction/CategoryDetector";
import { detectSocietyCategory } from "../core/extraction/SocietyExpenseDetector";
import { detectProfessionalCategory, type ProfessionalProfile } from "../core/extraction/ProfessionalCategoryDetector";
import { detectDocType } from "./DocTypeDetector";
import { computeSentinelForInvoice, computeSentinelForProfileCategory } from "../service/ExpirySentinel";
import { detectSentinelCandidates } from "./WarrantyDetector";
import { prefs } from "../data/AutoImportPreferences";
import { detectExtractionStrategy } from "./ExtractionStrategyDetector";

const PROFESSIONAL_PROFILES: ProfessionalProfile[] = ["shopkeeper", "tax_consultant", "ca", "real_estate", "advocate"];

function resolveCategory(merchantName: string | null, lineItemNames: string[], extraText?: string | null): string {
  const mode = prefs.activeMode;
  if (mode === "society") return detectSocietyCategory(merchantName, lineItemNames, extraText);
  if (PROFESSIONAL_PROFILES.includes(mode as ProfessionalProfile))
    return detectProfessionalCategory(mode as ProfessionalProfile, merchantName, lineItemNames, extraText);
  return detectCategory(merchantName, lineItemNames);
}

// Tracks filenames currently being processed by concurrent workers.
// Checked synchronously (before any await) so concurrent processFile calls
// detect duplicates even when the DB insert hasn't happened yet.
const inFlightFilenames = new Set<string>();

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

// Returns a local ExtractionResult if the text is confident enough, or null to fall through to Gemini.
async function tryLocalTextExtraction(
  file: File,
  classification: PdfClassification,
): Promise<ExtractionResult | null> {
  // Local extraction only works on PDF documents with embedded text.
  if (classification === "scanned" || classification === "encrypted") return null;

  try {
    const textResult = await extractNativePdf(file);
    if ((textResult.kind !== "success" && textResult.kind !== "lowConfidence") || !textResult.invoice.rawText) {
      return null;
    }
    const inv = extractLocalDoc(textResult.invoice.rawText, textResult.invoice.sourceType);
    if (inv.confidenceScore < 0.65) return null;
    // If no line items were found and confidence isn't very high, let Gemini try.
    // High-confidence documents with no items (bank statements, cheques) score ≥ 0.9
    // and are correctly skipped; shopping invoices with table-layout PDFs score ~0.75
    // and fall through so Gemini can extract the line items.
    if (inv.lineItems.length === 0 && inv.confidenceScore < 0.9) return null;
    return inv.confidenceScore >= 0.7
      ? { kind: "success", invoice: inv }
      : { kind: "lowConfidence", invoice: inv, reason: "local-only" };
  } catch {
    return null;
  }
}

async function processHtmlFile(
  file: File,
  importSource: string,
  meta?: { subject?: string; senderEmail?: string; receivedAt?: string; accountEmail?: string | null },
  filenameKnown?: boolean,
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

  const wasDup = await persistResult(result, importSource, file.name, meta, filenameKnown);
  if (wasDup && (result.kind === "success" || result.kind === "lowConfidence")) {
    return { kind: "duplicate", invoice: result.invoice };
  }
  return result;
}

export async function processFile(
  file: File,
  importSource: string,
  meta?: { subject?: string; senderEmail?: string; receivedAt?: string; accountEmail?: string | null },
  options?: { skipGemini?: boolean },
): Promise<ExtractionResult> {
  if (prefs.isDailyLimitReached) {
    return { kind: "dailyLimitReached", limit: prefs.FREE_DAILY_LIMIT };
  }

  // Register in-flight synchronously (before any await) so concurrent workers
  // processing the same filename detect each other immediately.
  const filenameKnown = !!file.name && inFlightFilenames.has(file.name);
  if (file.name && !filenameKnown) inFlightFilenames.add(file.name);

  try {
  if (file.type === "text/html" || file.name.toLowerCase().endsWith(".html")) {
    return processHtmlFile(file, importSource, meta, filenameKnown);
  }

  const classification = await classifyPdf(file);

  // Skip Gemini — try local extraction first; if confident, save immediately.
  // Otherwise save with pending_extraction status for later AI processing in View screen.
  if (options?.skipGemini) {
    if (classification === "encrypted") {
      // Insert a visible record so the user can see it in the View screen
      const now = new Date().toISOString();
      await insertInvoiceWithItems(
        {
          merchantName: null, merchantAddress: null, merchantGstin: null,
          merchantPincode: null, invoiceNumber: null, invoiceDate: null,
          subtotalPaise: null, grandTotalPaise: null, discountPaise: 0,
          taxPaise: null, paymentMode: null,
          importSource, pdfSourceType: "NATIVE_PDF", importRecordId: null,
          status: "import_blocked_encrypted", docType: "other", docTypes: ["other"],
          sourceFilename: file.name,
          extractionNote: "PDF is password-protected",
          subject: meta?.subject, senderEmail: meta?.senderEmail, receivedAt: meta?.receivedAt, accountEmail: meta?.accountEmail,
          createdAt: now, updatedAt: now,
        },
        [],
      );
      return { kind: "encryptedPdf" };
    }

    // Filename duplicate — same file was already saved; mark visible as duplicate
    if (file.name && (filenameKnown || await isDuplicateByFilename(file.name))) {
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
          subject: meta?.subject, senderEmail: meta?.senderEmail, receivedAt: meta?.receivedAt, accountEmail: meta?.accountEmail,
          createdAt: now, updatedAt: now,
        },
        [],
      );
      return { kind: "pendingExtraction" };
    }

    // Try local extraction — may skip pending_extraction entirely for well-formatted PDFs
    let rawText: string | null = null;
    let localInv: ExtractedInvoice | null = null;

    if (classification !== "scanned") {
      try {
        const tr = await extractNativePdf(file);
        if ((tr.kind === "success" || tr.kind === "lowConfidence") && tr.invoice.rawText) {
          rawText = tr.invoice.rawText;
          const loc = extractLocalDoc(rawText, tr.invoice.sourceType);
          if (loc.confidenceScore >= 0.65) localInv = loc;
        }
      } catch {}
    }

    // Local extraction was confident enough — save now without pending_extraction
    if (localInv) {
      console.log("[Pipeline] skipGemini local extraction confidence:", localInv.confidenceScore);
      const localResult: ExtractionResult = localInv.confidenceScore >= 0.7
        ? { kind: "success", invoice: localInv }
        : { kind: "lowConfidence", invoice: localInv, reason: "local-only" };
      const wasDup = await persistResult(localResult, importSource, file.name, meta, filenameKnown);
      if (wasDup && (localResult.kind === "success" || localResult.kind === "lowConfidence")) {
        return { kind: "duplicate", invoice: localResult.invoice };
      }
      return localResult;
    }

    // Low local confidence — save as pending_extraction for AI later
    const now = new Date().toISOString();
    const pdfSourceType =
      classification === "native" ? "NATIVE_PDF" :
      classification === "scanned" ? "SCANNED_PDF" : "MIXED_PDF";
    const invoiceId = await insertInvoiceWithItems(
      {
        merchantName: null, merchantAddress: null, merchantGstin: null,
        merchantPincode: null, invoiceNumber: null, invoiceDate: null,
        subtotalPaise: null, grandTotalPaise: null, discountPaise: 0,
        taxPaise: null, paymentMode: null,
        importSource, pdfSourceType, importRecordId: null,
        status: "pending_extraction", docType: "other", docTypes: ["other"],
        sourceFilename: file.name,
        subject: meta?.subject, senderEmail: meta?.senderEmail, receivedAt: meta?.receivedAt, accountEmail: meta?.accountEmail,
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

  // Pre-extraction strategy hint — uses filename / subject / sender to decide
  // whether to attempt local extraction or skip straight to Gemini.
  const strategy = detectExtractionStrategy(file.name, meta?.subject, meta?.senderEmail);
  console.log("[Pipeline] extraction strategy:", strategy, "for", file.name);

  // "skip" — document has no financial data (society admin form, consent form,
  // ID scan, etc.). Save it with a clear note; don't waste any extraction time.
  if (strategy === "skip") {
    console.log("[Pipeline] skip — not an invoice document:", file.name);
    const skipResult: ExtractionResult = { kind: "failure", reason: "not-an-invoice" };
    await persistResultWithNote(
      skipResult, importSource, file.name, meta, filenameKnown,
      "Not an invoice — this document has no financial data to extract",
    );
    return skipResult;
  }

  let result: ExtractionResult;

  if (classification === "encrypted") {
    result = { kind: "encryptedPdf" };
  } else {
    // Local extraction first — skipped for "gemini_direct" docs (cheques, legal docs, etc.)
    // that are known to never yield a machine-readable invoice structure.
    if (strategy !== "gemini_direct") {
      const localFirst = await tryLocalTextExtraction(file, classification);
      if (localFirst) {
        console.log("[Pipeline] local extraction succeeded, skipping Gemini");
        const wasDup = await persistResult(localFirst, importSource, file.name, meta, filenameKnown);
        if (wasDup && (localFirst.kind === "success" || localFirst.kind === "lowConfidence")) {
          return { kind: "duplicate", invoice: localFirst.invoice };
        }
        return localFirst;
      }
    } else {
      console.log("[Pipeline] gemini_direct — skipping local extraction for", file.name);
    }

    if (hasGeminiKey()) {
      // Vision-first: render PDF to images so Gemini reads the visual layout.
      try {
        const pages = await renderPdfToImages(file);
        console.log("[Pipeline] vision-first pages:", pages.length);
        if (pages.length > 0) {
          // Blur check — avoid wasting Gemini tokens on unreadable images
          try {
            const { isBlurry, score } = await blurScoreFromBase64(pages[0].data);
            if (isBlurry) {
              console.log("[Pipeline] blurry image detected (score:", score, ") — skipping Gemini");
              result = { kind: "failure", reason: "blurry-image" };
              await persistResultWithNote(
                result, importSource, file.name, meta, filenameKnown,
                "Image too blurry to read — try uploading a higher-quality scan",
              );
              return result;
            }
          } catch {}

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
  }

  const wasDup = await persistResult(result, importSource, file.name, meta, filenameKnown);
  if (wasDup && (result.kind === "success" || result.kind === "lowConfidence")) {
    return { kind: "duplicate", invoice: result.invoice };
  }
  return result;
  } finally {
    if (file.name && !filenameKnown) inFlightFilenames.delete(file.name);
  }
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
  meta?: { subject?: string; senderEmail?: string; receivedAt?: string; accountEmail?: string | null },
  filenameKnown?: boolean,
  extractionNote?: string,
): Promise<boolean> {
  return persistResultWithNote(result, importSource, sourceFilename, meta, filenameKnown, extractionNote);
}

async function persistResultWithNote(
  result: ExtractionResult,
  importSource: string,
  sourceFilename?: string,
  meta?: { subject?: string; senderEmail?: string; receivedAt?: string; accountEmail?: string | null },
  filenameKnown?: boolean,
  extractionNote?: string,
): Promise<boolean> {
  const now = new Date().toISOString();
  console.log("[Pipeline]", sourceFilename, "→ kind:", result.kind);
  if (result.kind === "success" || result.kind === "lowConfidence") {
    const inv = result.invoice;

    // Filename duplicate — same file already imported; save as duplicate so it's visible in View
    if (sourceFilename && (filenameKnown || await isDuplicateByFilename(sourceFilename))) {
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
          subject: meta?.subject, senderEmail: meta?.senderEmail, receivedAt: meta?.receivedAt, accountEmail: meta?.accountEmail,
          extractionNote: extractionNote ?? null,
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
    const category = resolveCategory(inv.merchantName, lineItemNames);
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
        platform: inv.platform ?? null,
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
        accountEmail: meta?.accountEmail,
        extractionNote: extractionNote ?? null,
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

    await computeSentinelForInvoice(invoiceId, inv.invoiceDate, inv.merchantName, lineItemNames, inv.rawText);
    await computeSentinelForProfileCategory(invoiceId, inv.invoiceDate, category, prefs.activeMode, inv.merchantName);
  } else {
    const status = result.kind === "encryptedPdf" ? "import_blocked_encrypted" : "extraction_failed";
    await insertInvoiceWithItems(
      {
        merchantName: null, merchantAddress: null, merchantGstin: null,
        invoiceDate: null, grandTotalPaise: null, discountPaise: 0, taxPaise: null,
        paymentMode: null, importSource, pdfSourceType: "NATIVE_PDF",
        importRecordId: null, status, docType: "other", docTypes: ["other"], sourceFilename,
        subject: meta?.subject, senderEmail: meta?.senderEmail, receivedAt: meta?.receivedAt, accountEmail: meta?.accountEmail,
        extractionNote: extractionNote ?? null,
        createdAt: now, updatedAt: now,
      },
      [],
    );
  }
  return false;
}

/** Run AI (and local) extraction on a pending_extraction invoice. */
export async function extractInvoiceWithAI(invoiceId: number): Promise<ExtractedInvoice | null> {
  const blank: ExtractedInvoice = {
    merchantName: null, merchantAddress: null, merchantGstin: null,
    merchantPhone: null, merchantPincode: null, invoiceNumber: null,
    invoiceDate: null, lineItems: [], subtotalPaise: null, discountPaise: 0,
    taxPaise: null, grandTotalPaise: null, paymentMode: null,
    sourceType: "NATIVE_PDF", rawText: null, confidenceScore: 0,
  };

  // ── Step 1: try local extraction from stored raw text ─────────────────────
  const rawRec = await db.rawTexts.where("invoiceId").equals(invoiceId).first();
  if (rawRec?.rawText) {
    const inv = await db.invoices.get(invoiceId);
    const sourceType = (inv?.pdfSourceType ?? "NATIVE_PDF") as ExtractedInvoice["sourceType"];
    const localInv = extractLocalDoc(rawRec.rawText, sourceType);
    // Require items OR very high confidence to skip Gemini.
    // Bank statements / cheques score ≥ 0.9 and have no items by design — correctly skipped.
    // Shopping invoices (Amazon etc.) score ~0.75 with no items — fall through so Gemini can find them.
    if (localInv.confidenceScore >= 0.70 && (localInv.lineItems.length > 0 || localInv.confidenceScore >= 0.9)) {
      console.log("[extractInvoiceWithAI] local extraction succeeded (confidence:", localInv.confidenceScore, ") — skipping Gemini");
      return finalizeExtractedInvoice(invoiceId, localInv, "Extracted locally without AI");
    }
  }

  // ── Step 2: check blur before Gemini — skip if image is unreadable ────────
  const pdfRec = await db.pdfFiles.where("invoiceId").equals(invoiceId).first();
  if (pdfRec?.bytes) {
    let enhanced: ExtractedInvoice | null = null;
    try {
      const file = new File([pdfRec.bytes.buffer as ArrayBuffer], pdfRec.filename, { type: "application/pdf" });

      // Password-protected PDFs cannot be rendered or sent to Gemini
      const pdfClassification = await classifyPdf(file);
      if (pdfClassification === "encrypted") {
        console.log("[extractInvoiceWithAI] PDF is password-protected — skipping Gemini");
        await db.invoices.update(invoiceId, {
          status: "import_blocked_encrypted",
          extractionNote: "PDF is password-protected",
          updatedAt: new Date().toISOString(),
        });
        await db.pdfFiles.where("invoiceId").equals(invoiceId).delete();
        return null;
      }

      const pages = await renderPdfToImages(file);
      if (pages.length > 0) {
        // Blur check before sending to Gemini
        try {
          const { isBlurry, score } = await blurScoreFromBase64(pages[0].data);
          if (isBlurry) {
            console.log("[extractInvoiceWithAI] blurry image (score:", score, ") — not sending to Gemini");
            const note = "Image too blurry to read — try uploading a higher-quality scan";
            await db.invoices.update(invoiceId, {
              status: "extraction_failed",
              extractionNote: note,
              updatedAt: new Date().toISOString(),
            });
            return null;
          }
        } catch {}

        enhanced = await enhanceWithClaudeVision(blank, pages);
      }
    } catch (e) {
      console.warn("[extractInvoiceWithAI] vision failed, falling back to text:", e);
    }

    if (enhanced && (enhanced.grandTotalPaise != null || enhanced.merchantName != null)) {
      return finalizeExtractedInvoice(invoiceId, enhanced);
    }
  }

  // ── Step 3: Gemini text fallback ──────────────────────────────────────────
  if (!rawRec?.rawText) {
    await db.invoices.update(invoiceId, {
      status: "extraction_failed",
      extractionNote: "No PDF data stored — re-upload the original file to extract",
      updatedAt: new Date().toISOString(),
    });
    return null;
  }
  const enhanced = await enhanceWithClaude({ ...blank, rawText: rawRec.rawText });
  if (!enhanced || (enhanced.grandTotalPaise == null && enhanced.merchantName == null)) {
    await db.invoices.update(invoiceId, {
      status: "extraction_failed",
      extractionNote: "AI could not read the document — try re-uploading a clearer scan",
      updatedAt: new Date().toISOString(),
    });
    return null;
  }
  return finalizeExtractedInvoice(invoiceId, enhanced);
}

async function finalizeExtractedInvoice(
  invoiceId: number,
  enhanced: ExtractedInvoice,
  extractionNote?: string,
): Promise<ExtractedInvoice | null> {
  // Content duplicate check — same merchant + total + date already saved (exclude self)
  if (await isDuplicateInvoice(enhanced.merchantName, enhanced.grandTotalPaise, enhanced.invoiceDate, invoiceId)) {
    console.log("[extractInvoiceWithAI] content duplicate:", enhanced.merchantName, enhanced.invoiceDate);
    await markAsDuplicate(invoiceId);
    return enhanced;
  }

  const now = new Date().toISOString();
  const lineItemNames = enhanced.lineItems.map((li) => li.name);
  const category = resolveCategory(enhanced.merchantName, lineItemNames);
  const docTypes = detectDocType(enhanced.merchantName, lineItemNames, undefined, undefined);
  const status = enhanced.confidenceScore >= 0.7 ? "imported" : "pending_review";
  await db.invoices.update(invoiceId, {
    merchantName: enhanced.merchantName,
    merchantAddress: enhanced.merchantAddress,
    merchantGstin: enhanced.merchantGstin,
    merchantPhone: enhanced.merchantPhone,
    merchantPincode: enhanced.merchantPincode,
    platform: enhanced.platform ?? null,
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
    extractionNote: extractionNote ?? null,
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

  // ── Warranty / sentinel detection ─────────────────────────────────────────
  // Text-based: parse actual warranty/insurance/prescription text from raw content
  if (enhanced.rawText) {
    const candidates = detectSentinelCandidates(
      enhanced.rawText,
      enhanced.merchantName,
      enhanced.invoiceDate,
      invoiceId,
    );
    const createdAt = new Date().toISOString();
    for (const c of candidates) {
      const already = await db.sentinelRecords
        .where("invoiceId").equals(invoiceId)
        .and((r) => r.type === c.type)
        .count();
      if (already === 0) {
        await db.sentinelRecords.add({ ...c, status: "active", createdAt });
        console.log("[Pipeline] sentinel added:", c.type, c.label, c.expiresAt);
      }
    }
  }
  // Category-based fallback: covers electronics/appliances/vehicles via fixed durations
  await computeSentinelForInvoice(
    invoiceId,
    enhanced.invoiceDate,
    enhanced.merchantName,
    enhanced.lineItems.map((li) => li.name),
    enhanced.rawText,
  );
  await computeSentinelForProfileCategory(
    invoiceId,
    enhanced.invoiceDate,
    category,
    prefs.activeMode,
    enhanced.merchantName,
  );

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

  // Local extraction first (preview)
  const localFirst = await tryLocalTextExtraction(file, classification);
  if (localFirst) return localFirst;

  if (hasGeminiKey()) {
    try {
      const pages = await renderPdfToImages(file);
      if (pages.length > 0) {
        // Blur check before Gemini
        try {
          const { isBlurry } = await blurScoreFromBase64(pages[0].data);
          if (isBlurry) return { kind: "failure", reason: "blurry-image" };
        } catch {}

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
