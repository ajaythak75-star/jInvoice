import { extractInvoiceWithAI } from "../extraction/ExtractionPipeline";
import { db } from "../data/InvoiceDatabase";

export type BulkState = { running: boolean; done: number; total: number };

const CONCURRENCY = 2;

let _state: BulkState = { running: false, done: 0, total: 0 };

export function getBulkExtractionState(): BulkState {
  return { ..._state };
}

function notify() {
  window.dispatchEvent(
    new CustomEvent("jinvoice:bulk-extract-progress", { detail: { ..._state } })
  );
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

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, toProcess.length) }, async () => {
      while (queue.length > 0) {
        const id = queue.shift()!;
        try {
          await extractInvoiceWithAI(id);
        } catch (e) {
          console.error("[BulkExtract] failed for id", id, e);
        }
        _state = { ..._state, done: _state.done + 1 };
        notify();
        // Trigger list refresh so the card updates in real time
        window.dispatchEvent(new CustomEvent("jinvoice:sync-progress"));
      }
    })
  );

  _state = { running: false, done: 0, total: 0 };
  notify();
  window.dispatchEvent(new CustomEvent("jinvoice:sync-complete"));
}
