import { isAlreadyImported } from "../data/InvoiceDatabase";
import { getSupabase } from "../data/supabase";

export function isImapAvailable(): boolean {
  return true;
}

async function imapHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const sb = await getSupabase();
  if (sb) {
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
}

export class ImapConnector {
  static async status(): Promise<{ configured: boolean; email: string | null }> {
    const headers = await imapHeaders();
    const res = await fetch("/api/imap/status", { headers });
    if (!res.ok) return { configured: false, email: null };
    return res.json();
  }

  static async saveCredentials(email: string, appPassword: string): Promise<void> {
    const headers = await imapHeaders();
    const res = await fetch("/api/imap/save", {
      method: "POST",
      headers,
      body: JSON.stringify({ email, appPassword }),
    });
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: "Save failed" }));
      throw new Error(error);
    }
  }

  static async testConnection(email: string, appPassword: string): Promise<void> {
    const headers = await imapHeaders();
    const res = await fetch("/api/imap/test", {
      method: "POST",
      headers,
      body: JSON.stringify({ email, appPassword }),
    });
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: "Connection failed" }));
      throw new Error(error);
    }
  }

  static async disconnect(): Promise<void> {
    const headers = await imapHeaders();
    await fetch("/api/imap/disconnect", { method: "POST", headers });
  }

  static async pollAndDownload(
    months: number,
    onEmail?: (meta: { id: string; subject: string; senderEmail: string; receivedAt: string }) => Promise<"allow" | "block">
  ): Promise<{ file: File; messageId: string; subject: string; senderEmail: string; receivedAt: string }[]> {
    const headers = await imapHeaders();
    const res = await fetch("/api/imap/poll", {
      method: "POST",
      headers,
      body: JSON.stringify({ months }),
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
        const binary = atob(att.data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        output.push({
          file: new File([bytes], att.filename, { type: "application/pdf" }),
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
