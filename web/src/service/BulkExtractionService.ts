import { extractInvoiceWithAI } from "../extraction/ExtractionPipeline";
import { db } from "../data/InvoiceDatabase";

export type BulkState = { running: boolean; done: number; total: number };

const CONCURRENCY = 1;
const INTER_REQUEST_DELAY_MS = 3_000; // avoid Gemini free-tier rate limits

let _state: BulkState = { running: false, done: 0, total: 0 };

export function getBulkExtractionState(): BulkState {
  return { ..._state };
}

function notify() {
  window.dispatchEvent(
    new CustomEvent("jinvoice:bulk-extract-progress", { detail: { ..._state } })
  );
}

export async function runBulkReExtraction(ids: number[]): Promise<void> {
  if (_state.running) return;
  if (ids.length === 0) return;

  _state = { running: true, done: 0, total: ids.length };
  notify();

  const queue = [...ids];
  let quotaExhausted = false;

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, ids.length) }, async () => {
      while (queue.length > 0 && !quotaExhausted) {
        const id = queue.shift()!;
        try {
          await extractInvoiceWithAI(id);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.includes("daily quota exhausted")) {
            quotaExhausted = true;
            window.dispatchEvent(new CustomEvent("jinvoice:quota-exhausted", { detail: { message: msg } }));
          } else {
            console.error("[BulkReExtract] failed for id", id, e);
          }
        }
        _state = { ..._state, done: _state.done + 1 };
        notify();
        window.dispatchEvent(new CustomEvent("jinvoice:sync-progress"));
        if (queue.length > 0 && !quotaExhausted) await new Promise((r) => setTimeout(r, INTER_REQUEST_DELAY_MS));
      }
    })
  );

  _state = { running: false, done: 0, total: 0 };
  notify();
  window.dispatchEvent(new CustomEvent("jinvoice:sync-complete"));
}

export async function runBulkExtraction(ids: number[]): Promise<void> {
  if (_state.running) return;

  // Filter to only records that still need extraction
  const toProcess: number[] = [];
  for (const id of ids) {
    const rec = await db.invoices.get(id);
    if (rec && rec.status === "pending_extraction") toProcess.push(id);
  }
  if (toProcess.length === 0) return;

  _state = { running: true, done: 0, total: toProcess.length };
  notify();

  const queue = [...toProcess];
  let quotaExhausted = false;

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, toProcess.length) }, async () => {
      while (queue.length > 0 && !quotaExhausted) {
        const id = queue.shift()!;
        try {
          await extractInvoiceWithAI(id);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.includes("daily quota exhausted")) {
            quotaExhausted = true;
            console.warn("[BulkExtract] Gemini daily quota exhausted — stopping batch.");
            window.dispatchEvent(new CustomEvent("jinvoice:quota-exhausted", { detail: { message: msg } }));
          } else {
            console.error("[BulkExtract] failed for id", id, e);
          }
        }
        _state = { ..._state, done: _state.done + 1 };
        notify();
        // Trigger list refresh so the card updates in real time
        window.dispatchEvent(new CustomEvent("jinvoice:sync-progress"));
        // Brief pause between requests to stay within Gemini free-tier rate limits
        if (queue.length > 0 && !quotaExhausted) await new Promise((r) => setTimeout(r, INTER_REQUEST_DELAY_MS));
      }
    })
  );

  _state = { running: false, done: 0, total: 0 };
  notify();
  window.dispatchEvent(new CustomEvent("jinvoice:sync-complete"));
}
