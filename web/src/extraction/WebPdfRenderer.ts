async function getPdfJs() {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.mjs",
    import.meta.url
  ).toString();
  return pdfjsLib;
}

export interface RenderedPage {
  data: string;
  mimeType: "image/jpeg";
}

export async function renderPdfToImages(file: File, maxPages = 4): Promise<RenderedPage[]> {
  const pdfjsLib = await getPdfJs();
  const buffer = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buffer }).promise;
  const pages = Math.min(doc.numPages, maxPages);
  const results: RenderedPage[] = [];

  for (let i = 1; i <= pages; i++) {
    const page = await doc.getPage(i);
    // scale 2 for legibility; cap dimensions to stay under Anthropic's 8000px limit
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = Math.min(2.0, 7800 / Math.max(baseViewport.width, baseViewport.height));
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext("2d")!;

    await page.render({ canvasContext: ctx, viewport }).promise;

    const dataUrl = canvas.toDataURL("image/jpeg", 0.88);
    results.push({ data: dataUrl.split(",")[1], mimeType: "image/jpeg" });
  }

  return results;
}
