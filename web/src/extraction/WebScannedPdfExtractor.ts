import { createWorker } from "tesseract.js";
import type { ExtractionResult } from "../core/extraction/models";
import { parse } from "../core/extraction/InvoiceFieldParser";

const CONFIDENCE_THRESHOLD = 0.7;
const RENDER_DPI = 300;
const POINTS_PER_INCH = 72;

async function getPdfJs() {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.mjs",
    import.meta.url
  ).toString();
  return pdfjsLib;
}

async function rasterisePage(page: any): Promise<HTMLCanvasElement> {
  const scale = RENDER_DPI / POINTS_PER_INCH;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

export async function extractScannedPdf(file: File): Promise<ExtractionResult> {
  const pdfjsLib = await getPdfJs();
  const buffer = await file.arrayBuffer();
  let doc: any;
  try {
    doc = await pdfjsLib.getDocument({ data: buffer }).promise;
  } catch (e) {
    return { kind: "failure", reason: "Cannot open PDF", error: e };
  }

  const worker = await createWorker(["eng", "hin"]);
  let combinedText = "";

  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const canvas = await rasterisePage(page);
      const { data } = await worker.recognize(canvas);
      combinedText += data.text + "\n";
    }
  } finally {
    await worker.terminate();
  }

  if (!combinedText.trim()) {
    return { kind: "failure", reason: "OCR produced no text" };
  }

  const invoice = parse(combinedText, "SCANNED_PDF");
  if (invoice.confidenceScore < CONFIDENCE_THRESHOLD) {
    return {
      kind: "lowConfidence",
      invoice,
      reason: `Confidence ${Math.round(invoice.confidenceScore * 100)}% < 70%`,
    };
  }
  return { kind: "success", invoice };
}
