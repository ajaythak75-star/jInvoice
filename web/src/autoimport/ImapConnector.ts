import { isAlreadyImported } from "../data/InvoiceDatabase";

const ACCOUNTS_KEY = "jinvoice_imap_accounts";
const LEGACY_KEY   = "jinvoice_imap_creds";

export interface ImapAccount {
  email: string;
  appPassword: string;
  enabled: boolean;
  folderPaths: string[];
}

function loadAccounts(): ImapAccount[] {
  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY);
    if (raw) return JSON.parse(raw) as ImapAccount[];
    // One-time migration from the old single-account key
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const { email, appPassword } = JSON.parse(legacy) as { email: string; appPassword: string };
      const accounts: ImapAccount[] = [{ email, appPassword, enabled: true, folderPaths: [] }];
      localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
      localStorage.removeItem(LEGACY_KEY);
      return accounts;
    }
    return [];
  } catch { return []; }
}

function saveAccounts(accounts: ImapAccount[]): void {
  try { localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts)); } catch {}
}

export function isImapAvailable(): boolean { return true; }

export class ImapConnector {
  static getAccounts(): ImapAccount[] { return loadAccounts(); }

  static async status(): Promise<{ configured: boolean; email: string | null }> {
    const accounts = loadAccounts();
    return { configured: accounts.length > 0, email: accounts[0]?.email ?? null };
  }

  static async addAccount(email: string, appPassword: string): Promise<void> {
    const accounts = loadAccounts();
    const idx = accounts.findIndex((a) => a.email === email);
    if (idx >= 0) {
      accounts[idx] = { ...accounts[idx], email, appPassword };
    } else {
      accounts.push({ email, appPassword, enabled: true, folderPaths: [] });
    }
    saveAccounts(accounts);
  }

  static async removeAccount(email: string): Promise<void> {
    saveAccounts(loadAccounts().filter((a) => a.email !== email));
  }

  static setEnabled(email: string, enabled: boolean): void {
    const accounts = loadAccounts();
    const i = accounts.findIndex((a) => a.email === email);
    if (i >= 0) { accounts[i].enabled = enabled; saveAccounts(accounts); }
  }

  static setFolderPaths(email: string, paths: string[]): void {
    const accounts = loadAccounts();
    const i = accounts.findIndex((a) => a.email === email);
    if (i >= 0) { accounts[i].folderPaths = paths; saveAccounts(accounts); }
  }

  static async saveCredentials(email: string, appPassword: string): Promise<void> {
    await this.addAccount(email, appPassword);
  }

  static async disconnect(): Promise<void> {
    const accounts = loadAccounts();
    if (accounts.length === 1) saveAccounts([]);
  }

  static async fetchFolders(email: string, appPassword: string): Promise<{ path: string; name: string }[]> {
    const res = await fetch("/api/imap/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, appPassword }),
    });
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: "Failed to load folders" }));
      throw new Error(error);
    }
    const { folders } = await res.json() as { folders: { path: string; name: string }[] };
    return folders;
  }

  static async testConnection(email: string, appPassword: string): Promise<void> {
    const res = await fetch("/api/imap/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, appPassword }),
    });
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: "Connection failed" }));
      throw new Error(error);
    }
  }

  static async pollAndDownload(
    email: string,
    appPassword: string,
    months: number,
    onEmail?: (meta: { id: string; subject: string; senderEmail: string; receivedAt: string }) => Promise<"allow" | "block">,
    folderPaths?: string[]
  ): Promise<{ file: File; messageId: string; subject: string; senderEmail: string; receivedAt: string }[]> {
    const res = await fetch("/api/imap/poll", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, appPassword, months, ...(folderPaths?.length ? { folderPaths } : {}) }),
    });
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: "Poll failed" }));
      throw new Error(error);
    }
    const { results, scanned } = await res.json() as {
      scanned: number;
      results: {
        messageId: string; subject: string; senderEmail: string; receivedAt: string;
        attachments: { filename: string; data: string }[];
      }[];
    };
    console.log(`[IMAP] ${email}: server scanned ${scanned} emails, returned ${results.length} with attachments`);

    const output: { file: File; messageId: string; subject: string; senderEmail: string; receivedAt: string }[] = [];
    for (const msg of results) {
      if (await isAlreadyImported(msg.messageId)) { console.log("[IMAP] Already imported:", msg.messageId); continue; }
      if (onEmail) {
        const decision = await onEmail({ id: msg.messageId, subject: msg.subject, senderEmail: msg.senderEmail, receivedAt: msg.receivedAt });
        if (decision === "block") { console.log("[IMAP] Blocked:", msg.subject); continue; }
      }
      for (const att of msg.attachments) {
        const isHtml = att.filename.endsWith(".html");
        const mimeType = isHtml ? "text/html" : "application/pdf";
        const binary = atob(att.data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        output.push({ file: new File([bytes], att.filename, { type: mimeType }), messageId: msg.messageId, subject: msg.subject, senderEmail: msg.senderEmail, receivedAt: msg.receivedAt });
      }
    }
    return output;
  }
}
