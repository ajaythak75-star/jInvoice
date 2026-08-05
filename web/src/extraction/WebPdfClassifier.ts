import type { PdfClassification, PageType } from "../core/extraction/PdfClassification";

const NATIVE_TEXT_THRESHOLD = 50;

export { NATIVE_TEXT_THRESHOLD };

async function getPdfJs() {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.mjs",
    import.meta.url
  ).toString();
  return pdfjsLib;
}

export async function classifyPdf(file: File): Promise<PdfClassification> {
  const pdfjsLib = await getPdfJs();
  const buffer = await file.arrayBuffer();

  let doc: any;
  try {
    doc = await pdfjsLib.getDocument({ data: buffer }).promise;
  } catch {
    return "scanned";
  }

  if (doc.isEncrypted ?? false) return "encrypted";

  const numPages: number = doc.numPages;
  const pageTypes: Record<number, PageType> = {};

  for (let i = 1; i <= numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = (content.items as any[]).map((it) => it.str ?? "").join("");
    const printable = text.replace(/\s/g, "").length;
    pageTypes[i] = printable >= NATIVE_TEXT_THRESHOLD ? "native" : "scanned";
  }

  const nativeCount = Object.values(pageTypes).filter((t) => t === "native").length;
  if (nativeCount === numPages) return "native";
  if (nativeCount === 0) return "scanned";
  return { mixed: pageTypes };
}
