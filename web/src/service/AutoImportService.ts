import { prefs } from "../data/AutoImportPreferences";
import { GmailConnector } from "../autoimport/GmailConnector";
import { OutlookConnector } from "../autoimport/OutlookConnector";
import { ImapConnector, isImapAvailable } from "../autoimport/ImapConnector";
import { DesktopFolderConnector } from "../autoimport/DesktopFolderConnector";
import { processFile } from "../extraction/ExtractionPipeline";
import { markAsImported, deduplicateInvoices, addSecurityAlert } from "../data/InvoiceDatabase";
import { detectDocType, DOC_TYPE_SUBFOLDER } from "../extraction/DocTypeDetector";
import { assessEmailThreat } from "./SpamDetector";
import type { ExtractionResult } from "../core/extraction/models";

const SCHEDULE_CHECK_INTERVAL_MS = 5 * 60 * 1000; // check every 5 min

let timer: ReturnType<typeof setInterval> | null = null;
const desktopConnector = new DesktopFolderConnector();

let _syncRunning = false;
let _syncCancelled = false;

export function isSyncing(): boolean { return _syncRunning; }
export function cancelSync(): void { if (_syncRunning) _syncCancelled = true; }

function isSyncDue(): boolean {
  const schedule = prefs.syncSchedule;
  if (schedule === "manual") return false;

  const now = new Date();
  const [h, m] = (prefs.syncTime || "09:00").split(":").map(Number);
  const scheduledToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);

  if (now < scheduledToday) return false;   // scheduled time not yet reached today

  const lastSync = prefs.lastAutoSync;
  if (!lastSync) return true;               // never auto-synced → always due

  const last = new Date(lastSync);
  const diffMs = now.getTime() - last.getTime();

  switch (schedule) {
    // Daily: fire if we haven't auto-synced at/after today's scheduled time yet
    case "daily":   return last < scheduledToday;
    case "weekly":  return diffMs >= 6 * 24 * 60 * 60 * 1000;
    case "monthly": return diffMs >= 28 * 24 * 60 * 60 * 1000;
    default:        return false;
  }
}

export function schedulePolling(): void {
  if (timer) { clearInterval(timer); timer = null; }

  if (prefs.syncSchedule === "manual") return;

  // Run immediately if due, then check every 5 min
  if (isSyncDue()) {
    poll().then(() => { prefs.lastAutoSync = new Date().toISOString(); }).catch(console.error);
  }

  timer = setInterval(() => {
    if (!_syncRunning && isSyncDue()) {
      poll().then(() => { prefs.lastAutoSync = new Date().toISOString(); }).catch(console.error);
    }
  }, SCHEDULE_CHECK_INTERVAL_MS);
}

export function cancelPolling(): void {
  if (timer) { clearInterval(timer); timer = null; }
}

function isSenderAllowed(senderEmail: string): boolean {
  const allowed = prefs.allowedSenders;
  if (!allowed.length) return true;
  const le = senderEmail.toLowerCase();
  return allowed.some((s) => le.includes(s.toLowerCase()));
}

async function makeEmailChecker(importSource: string): Promise<(meta: { id: string; subject: string; senderEmail: string; receivedAt: string }) => Promise<"allow" | "block">> {
  return async ({ id, subject, senderEmail, receivedAt }) => {
    // Sender filter
    if (!isSenderAllowed(senderEmail)) {
      console.log(`[AutoImport] Sender blocked by filter: ${senderEmail}`);
      return "block";
    }

    // Spam / fraud check
    try {
      const threat = await assessEmailThreat(subject, senderEmail);
      if (threat.isSuspicious && threat.riskLevel !== "low") {
        await addSecurityAlert({
          messageId: id,
          importSource,
          subject,
          senderEmail,
          receivedAt,
          riskLevel: threat.riskLevel,
          reason: threat.reason,
          flaggedAt: new Date().toISOString(),
          dismissed: false,
        });
        await markAsImported(id, importSource);
        console.log(`[AutoImport] Flagged as ${threat.riskLevel} risk: ${subject}`);
        window.dispatchEvent(new CustomEvent("jinvoice:security-alert"));
        return "block";
      }
    } catch (e) {
      console.warn("[AutoImport] Threat check failed:", e);
    }

    return "allow";
  };
}

export async function poll(): Promise<{ found: number; processed: number; cancelled: boolean }> {
  if (_syncRunning) return { found: 0, processed: 0, cancelled: false };
  _syncRunning = true;
  _syncCancelled = false;
  window.dispatchEvent(new CustomEvent("jinvoice:sync-start"));

  let found = 0;
  let processed = 0;

  try {
    if (prefs.gmailEnabled && !_syncCancelled) {
      const checker = await makeEmailChecker("gmail");
      // Primary account + extra accounts from gmailAccounts array
      const gmailAccounts = [
        ...(prefs.gmailAccessToken ? [{ email: prefs.gmailEmail ?? "", accessToken: prefs.gmailAccessToken, refreshToken: prefs.gmailRefreshToken }] : []),
        ...prefs.gmailAccounts.filter((a) => a.enabled && a.email !== prefs.gmailEmail),
      ];
      for (const acct of gmailAccounts) {
        if (_syncCancelled) break;
        const gResults = await new GmailConnector(acct).pollAndDownload(checker);
        found += gResults.length;
        for (const { file, messageId, subject, senderEmail, receivedAt } of gResults) {
          if (_syncCancelled) break;
          const r = await processFile(file, "gmail", { subject, senderEmail, receivedAt });
          await markAsImported(messageId, "gmail");
          await savePdfToFolder(file, r, subject);
          processed++;
          window.dispatchEvent(new CustomEvent("jinvoice:sync-progress", { detail: { processed, found } }));
        }
      }
    }

    if (prefs.outlookEnabled && !_syncCancelled) {
      const checker = await makeEmailChecker("outlook");
      const outlookAccounts = [
        ...(prefs.outlookAccessToken ? [{ email: prefs.outlookEmail ?? "", accessToken: prefs.outlookAccessToken }] : []),
        ...prefs.outlookAccounts.filter((a) => a.enabled && a.email !== prefs.outlookEmail),
      ];
      for (const acct of outlookAccounts) {
        if (_syncCancelled) break;
        const oResults = await new OutlookConnector(acct).pollAndDownload(checker);
        found += oResults.length;
        for (const { file, messageId, subject, senderEmail, receivedAt } of oResults) {
          if (_syncCancelled) break;
          const r = await processFile(file, "outlook", { subject, senderEmail, receivedAt });
          await markAsImported(messageId, "outlook");
          await savePdfToFolder(file, r, subject);
          processed++;
          window.dispatchEvent(new CustomEvent("jinvoice:sync-progress", { detail: { processed, found } }));
        }
      }
    }

    if (prefs.imapEnabled && isImapAvailable() && !_syncCancelled) {
      const checker = await makeEmailChecker("imap");
      const imapResults = await ImapConnector.pollAndDownload(prefs.syncMonths, checker);
      found += imapResults.length;
      for (const { file, messageId, subject, senderEmail, receivedAt } of imapResults) {
        if (_syncCancelled) break;
        const r = await processFile(file, "imap", { subject, senderEmail, receivedAt });
        await markAsImported(messageId, "imap");
        await savePdfToFolder(file, r, subject);
        processed++;
        window.dispatchEvent(new CustomEvent("jinvoice:sync-progress", { detail: { processed, found } }));
      }
    }

    if (prefs.desktopFolderName && !_syncCancelled) {
      const dResults = await desktopConnector.scanForNewPdfs();
      found += dResults.length;
      for (const { file, key } of dResults) {
        if (_syncCancelled) break;
        await processFile(file, "desktop_folder");
        await markAsImported(key, "desktop_folder");
        processed++;
        window.dispatchEvent(new CustomEvent("jinvoice:sync-progress", { detail: { processed, found } }));
      }
    }

    if (processed > 0) {
      await deduplicateInvoices();
      window.dispatchEvent(new CustomEvent("jinvoice:sync-complete"));
    }

    const result = { found, processed, cancelled: _syncCancelled };
    window.dispatchEvent(new CustomEvent("jinvoice:sync-done", { detail: result }));
    return result;
  } catch (e) {
    window.dispatchEvent(new CustomEvent("jinvoice:sync-error", { detail: { message: e instanceof Error ? e.message : String(e) } }));
    throw e;
  } finally {
    _syncRunning = false;
    _syncCancelled = false;
  }
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
