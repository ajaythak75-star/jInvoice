import { prefs } from "../data/AutoImportPreferences";
import { GmailConnector } from "../autoimport/GmailConnector";
import { OutlookConnector } from "../autoimport/OutlookConnector";
import { DesktopFolderConnector } from "../autoimport/DesktopFolderConnector";
import { processFile } from "../extraction/ExtractionPipeline";
import { markAsImported, deduplicateInvoices } from "../data/InvoiceDatabase";
import { detectDocType, DOC_TYPE_SUBFOLDER } from "../extraction/DocTypeDetector";
import type { ExtractionResult } from "../core/extraction/models";

const POLL_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

let timer: ReturnType<typeof setInterval> | null = null;
const desktopConnector = new DesktopFolderConnector();

export function schedulePolling(): void {
  if (timer) return;
  poll();
  timer = setInterval(poll, POLL_INTERVAL_MS);
}

export function cancelPolling(): void {
  if (timer) { clearInterval(timer); timer = null; }
}

export async function poll(): Promise<{ found: number; processed: number }> {
  let found = 0;
  let processed = 0;

  if (prefs.gmailEnabled) {
    const gResults = await new GmailConnector().pollAndDownload();
    found += gResults.length;
    for (const { file, messageId, subject, senderEmail, receivedAt } of gResults) {
      const r = await processFile(file, "gmail", { subject, senderEmail, receivedAt });
      await markAsImported(messageId, "gmail");
      await savePdfToFolder(file, r, subject);
      processed++;
    }
  }

  if (prefs.outlookEnabled) {
    const oResults = await new OutlookConnector().pollAndDownload();
    found += oResults.length;
    for (const { file, messageId, subject, senderEmail, receivedAt } of oResults) {
      const r = await processFile(file, "outlook", { subject, senderEmail, receivedAt });
      await markAsImported(messageId, "outlook");
      await savePdfToFolder(file, r, subject);
      processed++;
    }
  }

  if (prefs.desktopFolderName) {
    const dResults = await desktopConnector.scanForNewPdfs();
    found += dResults.length;
    for (const { file, key } of dResults) {
      await processFile(file, "desktop_folder");
      await markAsImported(key, "desktop_folder");
      processed++;
    }
  }

  if (processed > 0) {
    await deduplicateInvoices();
    window.dispatchEvent(new CustomEvent("jinvoice:sync-complete"));
  }

  return { found, processed };
}

async function savePdfToFolder(file: File, result: ExtractionResult, subject?: string): Promise<void> {
  if (!prefs.desktopFolderName) return;
  const docTypes = (result.kind === "success" || result.kind === "lowConfidence")
    ? detectDocType(result.invoice.merchantName, result.invoice.lineItems.map((li) => li.name), file.name, subject)
    : ["other" as const];
  const bytes = new Uint8Array(await file.arrayBuffer());
  for (const docType of docTypes) {
    await desktopConnector.saveInvoiceToFolder(bytes, file.name, DOC_TYPE_SUBFOLDER[docType]);
  }
}

export { desktopConnector };
