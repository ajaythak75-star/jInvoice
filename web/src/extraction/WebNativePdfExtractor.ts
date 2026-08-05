import type { ExtractionResult } from "../core/extraction/models";
import { parse } from "../core/extraction/InvoiceFieldParser";

const CONFIDENCE_THRESHOLD = 0.7;

async function getPdfJs() {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.mjs",
    import.meta.url
  ).toString();
  return pdfjsLib;
}

export async function extractNativePdf(file: File): Promise<ExtractionResult> {
  const pdfjsLib = await getPdfJs();
  const buffer = await file.arrayBuffer();
  let doc: any;
  try {
    doc = await pdfjsLib.getDocument({ data: buffer }).promise;
  } catch (e) {
    return { kind: "failure", reason: "Cannot open PDF", error: e };
  }

  let fullText = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    fullText += (content.items as any[]).map((it) => it.str ?? "").join(" ") + "\n";
  }

  const invoice = parse(fullText, "NATIVE_PDF");
  if (invoice.confidenceScore < CONFIDENCE_THRESHOLD) {
    return {
      kind: "lowConfidence",
      invoice,
      reason: `Confidence ${Math.round(invoice.confidenceScore * 100)}% < 70%`,
    };
  }
  return { kind: "success", invoice };
}
