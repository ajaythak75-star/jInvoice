// Detects blur in a rendered PDF page image using Laplacian variance.
// A uniformly smooth (blurry) image has low variance in its second derivative.

const SAMPLE_DIM = 400;   // downsample to this for speed
const BLUR_THRESHOLD = 75; // variance below this → blurry

function laplacianVariance(ctx: CanvasRenderingContext2D, w: number, h: number): number {
  const { data } = ctx.getImageData(0, 0, w, h);
  const gray = new Float32Array(w * h);
  for (let i = 0; i < gray.length; i++) {
    const p = i * 4;
    gray[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  }
  let sum = 0, sumSq = 0, count = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = gray[i - w] + gray[i + w] + gray[i - 1] + gray[i + 1] - 4 * gray[i];
      sum += lap;
      sumSq += lap * lap;
      count++;
    }
  }
  const mean = sum / count;
  return sumSq / count - mean * mean;
}

// Checks blur from a base64 JPEG string (no "data:image/jpeg;base64," prefix).
export function blurScoreFromBase64(base64: string): Promise<{ score: number; isBlurry: boolean }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, SAMPLE_DIM / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale) || 1;
      const h = Math.round(img.height * scale) || 1;
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve({ score: 999, isBlurry: false }); return; }
      ctx.drawImage(img, 0, 0, w, h);
      const score = laplacianVariance(ctx, w, h);
      resolve({ score, isBlurry: score < BLUR_THRESHOLD });
    };
    img.onerror = () => resolve({ score: 999, isBlurry: false });
    img.src = `data:image/jpeg;base64,${base64}`;
  });
}
