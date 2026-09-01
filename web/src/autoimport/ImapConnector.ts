import { isAlreadyImported } from "../data/InvoiceDatabase";

const STORAGE_KEY = "jinvoice_imap_creds";

interface ImapCreds { email: string; appPassword: string; }

function loadCreds(): ImapCreds | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ImapCreds) : null;
  } catch { return null; }
}

function saveCreds(creds: ImapCreds): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(creds)); } catch {}
}

function clearCreds(): void {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

export function isImapAvailable(): boolean {
  return true;
}

export class ImapConnector {
  static async status(): Promise<{ configured: boolean; email: string | null }> {
    const creds = loadCreds();
    return { configured: !!creds, email: creds?.email ?? null };
  }

  static async saveCredentials(email: string, appPassword: string): Promise<void> {
    saveCreds({ email, appPassword });
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

  static async disconnect(): Promise<void> {
    clearCreds();
  }

  static async pollAndDownload(
    months: number,
    onEmail?: (meta: { id: string; subject: string; senderEmail: string; receivedAt: string }) => Promise<"allow" | "block">
  ): Promise<{ file: File; messageId: string; subject: string; senderEmail: string; receivedAt: string }[]> {
    const creds = loadCreds();
    if (!creds) return [];

    const res = await fetch("/api/imap/poll", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: creds.email, appPassword: creds.appPassword, months }),
    });
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: "Poll failed" }));
      throw new Error(error);
    }
    const { results } = await res.json() as {
      results: {
        messageId: string;
        subject: string;
        senderEmail: string;
        receivedAt: string;
        attachments: { filename: string; data: string }[];
      }[]
    };

    const output: { file: File; messageId: string; subject: string; senderEmail: string; receivedAt: string }[] = [];

    for (const msg of results) {
      if (await isAlreadyImported(msg.messageId)) {
        console.log("[IMAP] Already imported:", msg.messageId);
        continue;
      }

      if (onEmail) {
        const decision = await onEmail({
          id: msg.messageId,
          subject: msg.subject,
          senderEmail: msg.senderEmail,
          receivedAt: msg.receivedAt,
        });
        if (decision === "block") {
          console.log("[IMAP] Blocked:", msg.subject);
          continue;
        }
      }

      for (const att of msg.attachments) {
        const isHtml = att.filename.endsWith(".html");
        const mimeType = isHtml ? "text/html" : "application/pdf";
        const binary = atob(att.data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        output.push({
          file: new File([bytes], att.filename, { type: mimeType }),
          messageId: msg.messageId,
          subject: msg.subject,
          senderEmail: msg.senderEmail,
          receivedAt: msg.receivedAt,
        });
      }
    }

    return output;
  }
}
