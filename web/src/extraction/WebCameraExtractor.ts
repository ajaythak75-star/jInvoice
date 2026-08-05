import { createWorker } from "tesseract.js";
import type { ExtractionResult } from "../core/extraction/models";
import { parse } from "../core/extraction/InvoiceFieldParser";

const CONFIDENCE_THRESHOLD = 0.7;

export async function extractFromCanvas(canvas: HTMLCanvasElement): Promise<ExtractionResult> {
  const worker = await createWorker(["eng", "hin"]);
  let text = "";
  try {
    const { data } = await worker.recognize(canvas);
    text = data.text;
  } finally {
    await worker.terminate();
  }

  if (!text.trim()) {
    return { kind: "failure", reason: "No text detected in image" };
  }

  const invoice = parse(text, "CAMERA_OCR");
  if (invoice.confidenceScore < CONFIDENCE_THRESHOLD) {
    return {
      kind: "lowConfidence",
      invoice,
      reason: `Confidence ${Math.round(invoice.confidenceScore * 100)}% < 70%`,
    };
  }
  return { kind: "success", invoice };
}
