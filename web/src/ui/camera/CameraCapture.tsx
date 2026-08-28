import { useRef, useEffect, useState, useCallback } from "react";
import { processImageCapture } from "../../extraction/ExtractionPipeline";
import type { ExtractionResult } from "../../core/extraction/models";

type Status = "idle" | "streaming" | "capturing" | "done" | "error";

function ResultBanner({ result, onRetry }: { result: ExtractionResult; onRetry: () => void }) {
  if (result.kind === "success") {
    const inv = result.invoice;
    return (
      <div className="camera-result camera-result--ok">
        <div className="camera-result-title">Saved</div>
        {inv.merchantName && <div className="camera-result-row">{inv.merchantName}</div>}
        {inv.invoiceDate && <div className="camera-result-row">{inv.invoiceDate}</div>}
        {inv.grandTotalPaise != null && (
          <div className="camera-result-row">
            ₹{(inv.grandTotalPaise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </div>
        )}
        <button className="btn-primary" style={{ marginTop: 16 }} onClick={onRetry}>
          Scan another
        </button>
      </div>
    );
  }

  if (result.kind === "lowConfidence") {
    const inv = result.invoice;
    return (
      <div className="camera-result camera-result--warn">
        <div className="camera-result-title">Saved for review</div>
        <p className="camera-result-sub">
          Low confidence ({Math.round(inv.confidenceScore * 100)}%) — check the Invoices tab.
        </p>
        <button className="btn-primary" style={{ marginTop: 16 }} onClick={onRetry}>
          Scan another
        </button>
      </div>
    );
  }

  if (result.kind === "encryptedPdf") {
    return (
      <div className="camera-result camera-result--err">
        <div className="camera-result-title">Encrypted</div>
        <p className="camera-result-sub">Cannot read this receipt.</p>
        <button className="btn-primary" style={{ marginTop: 16 }} onClick={onRetry}>
          Try again
        </button>
      </div>
    );
  }

  if (result.kind === "dailyLimitReached") {
    return (
      <div className="camera-result camera-result--err">
        <div className="camera-result-title">Daily limit reached</div>
        <p className="camera-result-sub">
          Free plan allows {result.limit} invoices per day. Upgrade to Pro for unlimited.
        </p>
        <button className="btn-primary" style={{ marginTop: 16 }} onClick={onRetry}>
          OK
        </button>
      </div>
    );
  }

  return (
    <div className="camera-result camera-result--err">
      <div className="camera-result-title">No text found</div>
      <p className="camera-result-sub">Point the camera directly at the receipt in good light.</p>
      <button className="btn-primary" style={{ marginTop: 16 }} onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

export function CameraCapture() {
  const videoRef  = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [status, setStatus]   = useState<Status>("idle");
  const [result, setResult]   = useState<ExtractionResult | null>(null);
  const [errMsg, setErrMsg]   = useState<string | null>(null);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => () => stopStream(), [stopStream]);

  const startCamera = async () => {
    setErrMsg(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setStatus("streaming");
    } catch {
      setErrMsg("Camera not available or access was denied.");
      setStatus("error");
    }
  };

  const capture = async () => {
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")!.drawImage(video, 0, 0);
    stopStream();
    setStatus("capturing");

    const r = await processImageCapture(canvas, "camera_ocr");
    setResult(r);
    setStatus("done");
  };

  const reset = () => {
    setResult(null);
    setStatus("idle");
  };

  if (status === "done" && result) {
    return (
      <div className="camera-screen">
        <canvas ref={canvasRef} style={{ display: "none" }} />
        <ResultBanner result={result} onRetry={reset} />
      </div>
    );
  }

  return (
    <div className="camera-screen">
      <canvas ref={canvasRef} style={{ display: "none" }} />

      {status === "idle" && (
        <div className="camera-idle">
          <div className="camera-icon">📷</div>
          <p className="camera-hint">Point your camera at a paper receipt to scan it.</p>
          <button className="btn-primary" onClick={startCamera}>
            Open Camera
          </button>
        </div>
      )}

      {status === "error" && (
        <div className="camera-idle">
          <div className="camera-icon">⚠️</div>
          <p className="camera-hint">{errMsg}</p>
          <button className="btn-primary" onClick={startCamera}>
            Try again
          </button>
        </div>
      )}

      {(status === "streaming" || status === "capturing") && (
        <div className="camera-viewfinder">
          <video
            ref={videoRef}
            className="camera-video"
            playsInline
            muted
          />
          <div className="camera-overlay">
            <div className="camera-frame" />
          </div>
          <div className="camera-controls">
            {status === "capturing" ? (
              <div className="camera-ocr-label">Reading receipt…</div>
            ) : (
              <button className="camera-shutter" onClick={capture} aria-label="Capture" />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
