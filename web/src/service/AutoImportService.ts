import { prefs } from "../data/AutoImportPreferences";
import { GmailConnector } from "../autoimport/GmailConnector";
import { OutlookConnector } from "../autoimport/OutlookConnector";
import { ImapConnector, isImapAvailable } from "../autoimport/ImapConnector";
import { DesktopFolderConnector } from "../autoimport/DesktopFolderConnector";
import { processFile } from "../extraction/ExtractionPipeline";
import { markAsImported, deduplicateInvoices, addSecurityAlert } from "../data/InvoiceDatabase";
import { assessEmailThreat } from "./SpamDetector";

const SCHEDULE_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const CONCURRENT_EXTRACTIONS = 3;

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

  if (now < scheduledToday) return false;

  const lastSync = prefs.lastAutoSync;
  if (!lastSync) return true;

  const last = new Date(lastSync);
  return last < scheduledToday;
}

export function schedulePolling(): void {
  if (timer) { clearInterval(timer); timer = null; }

  if (prefs.syncSchedule === "manual") return;

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
    if (!isSenderAllowed(senderEmail)) {
      console.log(`[AutoImport] Sender blocked by filter: ${senderEmail}`);
      return "block";
    }

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

// Worker-pool: runs up to `concurrency` tasks at a time, respects _syncCancelled.
// Each item failure is isolated — one bad file doesn't abort the rest.
async function runConcurrent<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  if (!items.length) return;
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (queue.length > 0 && !_syncCancelled) {
        const item = queue.shift();
        if (item !== undefined) {
          try {
            await fn(item);
          } catch (e) {
            console.error("[AutoImport] Item processing failed, continuing with next:", e);
          }
        }
      }
    })
  );
}

type EmailResult = {
  file: File;
  messageId: string;
  subject: string;
  senderEmail: string;
  receivedAt: string;
  accountEmail: string;
};

type SourcedResult = EmailResult & { source: "gmail" | "outlook" | "imap" };

export async function poll(): Promise<{ found: number; processed: number; cancelled: boolean }> {
  if (_syncRunning) return { found: 0, processed: 0, cancelled: false };
  _syncRunning = true;
  _syncCancelled = false;
  window.dispatchEvent(new CustomEvent("jinvoice:sync-start"));

  let found = 0;
  let processed = 0;

  try {
    // ── build active account lists ────────────────────────────────────────
    const gmailAccounts = [
      ...(prefs.gmailEnabled && prefs.gmailAccessToken
        ? [{ email: prefs.gmailEmail ?? "", accessToken: prefs.gmailAccessToken, refreshToken: prefs.gmailRefreshToken }]
        : []),
      ...prefs.gmailAccounts.filter((a) => a.enabled && a.email !== prefs.gmailEmail),
    ];
    const outlookAccounts = [
      ...(prefs.outlookEnabled && prefs.outlookAccessToken
        ? [{ email: prefs.outlookEmail ?? "", accessToken: prefs.outlookAccessToken }]
        : []),
      ...prefs.outlookAccounts.filter((a) => a.enabled && a.email !== prefs.outlookEmail),
    ];
    const enabledImapAccounts = isImapAvailable()
      ? ImapConnector.getAccounts().filter((a) => a.enabled)
      : [];

    // ── create checkers (one per provider) ──────────────────────────────
    const gmailChecker   = gmailAccounts.length        > 0 ? await makeEmailChecker("gmail")   : null;
    const outlookChecker = outlookAccounts.length      > 0 ? await makeEmailChecker("outlook") : null;
    const imapChecker    = enabledImapAccounts.length  > 0 ? await makeEmailChecker("imap")    : null;

    // ── fetch ALL accounts across ALL providers in parallel ──────────────
    const failedAccounts: string[] = [];

    const [gmailResults, outlookResults, imapResults] = await Promise.all([
      gmailChecker
        ? Promise.all(gmailAccounts.map(async (acct) => {
            try {
              const raw = await new GmailConnector(acct).pollAndDownload(gmailChecker);
              return raw.map((r): SourcedResult => ({ ...r, accountEmail: acct.email, source: "gmail" }));
            } catch (e) {
              console.error(`[AutoImport] Gmail ${acct.email} sync failed:`, e);
              failedAccounts.push(acct.email);
              return [] as SourcedResult[];
            }
          })).then((nested) => nested.flat())
        : Promise.resolve([] as SourcedResult[]),

      outlookChecker
        ? Promise.all(outlookAccounts.map(async (acct) => {
            try {
              const raw = await new OutlookConnector(acct).pollAndDownload(outlookChecker);
              return raw.map((r): SourcedResult => ({ ...r, accountEmail: acct.email, source: "outlook" }));
            } catch (e) {
              console.error(`[AutoImport] Outlook ${acct.email} sync failed:`, e);
              failedAccounts.push(acct.email);
              return [] as SourcedResult[];
            }
          })).then((nested) => nested.flat())
        : Promise.resolve([] as SourcedResult[]),

      imapChecker
        ? Promise.all(enabledImapAccounts.map(async (acct) => {
            try {
              const raw = await ImapConnector.pollAndDownload(
                acct.email, acct.appPassword, prefs.syncMonths, imapChecker,
                acct.folderPaths.length ? acct.folderPaths : undefined
              );
              return raw.map((r): SourcedResult => ({ ...r, accountEmail: acct.email, source: "imap" }));
            } catch (e) {
              console.error(`[AutoImport] IMAP ${acct.email} sync failed:`, e);
              failedAccounts.push(acct.email);
              return [] as SourcedResult[];
            }
          })).then((nested) => nested.flat())
        : Promise.resolve([] as SourcedResult[]),
    ]);

    if (failedAccounts.length > 0) {
      window.dispatchEvent(new CustomEvent("jinvoice:sync-account-failed", { detail: { accounts: failedAccounts } }));
    }

    // ── extract all email results through a shared concurrent pool ────────
    const allEmailResults = [...gmailResults, ...outlookResults, ...imapResults];
    found = allEmailResults.length;

    await runConcurrent(allEmailResults, CONCURRENT_EXTRACTIONS, async ({ file, messageId, subject, senderEmail, receivedAt, accountEmail, source }) => {
      await processFile(file, source, { subject, senderEmail, receivedAt }, { skipGemini: true });
      await markAsImported(messageId, source);
      await savePdfToFolder(file, accountEmail);
      processed++;
      window.dispatchEvent(new CustomEvent("jinvoice:sync-progress", { detail: { processed, found } }));
    });

    if (prefs.desktopFolderName && !_syncCancelled) {
      const dResults = await desktopConnector.scanForNewPdfs();
      found += dResults.length;
      // Desktop files don't hit the network so sequential is fine here
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

async function savePdfToFolder(file: File, accountEmail?: string): Promise<void> {
  if (!prefs.desktopFolderName) return;
  const bytes = new Uint8Array(await file.arrayBuffer());
  await desktopConnector.saveInvoiceToFolder(bytes, file.name, accountEmail ?? "imported");
}

export { desktopConnector };
