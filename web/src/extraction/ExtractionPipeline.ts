import type { ExtractionResult } from "../core/extraction/models";
import type { PdfClassification } from "../core/extraction/PdfClassification";
import { classifyPdf } from "./WebPdfClassifier";
import { extractNativePdf } from "./WebNativePdfExtractor";
import { extractScannedPdf } from "./WebScannedPdfExtractor";
import { extractFromCanvas } from "./WebCameraExtractor";
import { insertInvoiceWithItems } from "../data/InvoiceDatabase";
import { detectCategory } from "../core/extraction/CategoryDetector";
import { detectDocType } from "./DocTypeDetector";
import { computeSentinelForInvoice } from "../service/ExpirySentinel";
import { prefs } from "../data/AutoImportPreferences";

export async function processFile(
  file: File,
  importSource: string,
  meta?: { subject?: string; senderEmail?: string; receivedAt?: string },
): Promise<ExtractionResult> {
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

  await persistResult(result, importSource, file.name, meta);
  return result;
}

export async function processImageCapture(
  canvas: HTMLCanvasElement,
  importSource: string,
): Promise<ExtractionResult> {
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

    const invoiceId = await insertInvoiceWithItems(
      {
        merchantName: inv.merchantName,
        merchantAddress: inv.merchantAddress,
        merchantGstin: inv.merchantGstin,
        invoiceDate: inv.invoiceDate,
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
