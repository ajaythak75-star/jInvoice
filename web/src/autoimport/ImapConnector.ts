import { isAlreadyImported } from "../data/InvoiceDatabase";

export function isImapAvailable(): boolean {
  return typeof window !== "undefined" && window.location.hostname === "127.0.0.1";
}

export class ImapConnector {
  static async status(): Promise<{ configured: boolean; email: string | null }> {
    const res = await fetch("/api/imap/status");
    return res.json();
  }

  static async saveCredentials(email: string, appPassword: string): Promise<void> {
    const res = await fetch("/api/imap/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, appPassword }),
    });
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: "Save failed" }));
      throw new Error(error);
    }
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
    await fetch("/api/imap/disconnect", { method: "POST" });
  }

  static async pollAndDownload(
    months: number,
    onEmail?: (meta: { id: string; subject: string; senderEmail: string; receivedAt: string }) => Promise<"allow" | "block">
  ): Promise<{ file: File; messageId: string; subject: string; senderEmail: string; receivedAt: string }[]> {
    const res = await fetch("/api/imap/poll", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
