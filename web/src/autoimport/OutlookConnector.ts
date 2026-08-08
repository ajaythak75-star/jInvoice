import { prefs } from "../data/AutoImportPreferences";
import { isAlreadyImported } from "../data/InvoiceDatabase";
import { AUTH_BASE } from "../config";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

export class OutlookConnector {
  async startSignIn(): Promise<void> {
    window.location.href = `${AUTH_BASE}/auth/outlook/start`;
  }

  async pollAndDownload(): Promise<{ file: File; messageId: string; subject: string; senderEmail: string; receivedAt: string }[]> {
    const token = prefs.outlookAccessToken;
    if (!token) throw new Error("Not authenticated");

    const messages = await this.fetchMessages(token);
    const results: { file: File; messageId: string; subject: string; senderEmail: string; receivedAt: string }[] = [];

    for (const msg of messages) {
      const id: string = msg.id;
      if (await isAlreadyImported(`${id}:outlook`)) continue;

      const subject     = msg.subject ?? "";
      const senderEmail = msg.sender?.emailAddress?.address ?? msg.sender?.emailAddress?.name ?? "";
      const receivedAt  = msg.receivedDateTime ?? "";

      const attachments = await this.fetchAttachments(id, token);
      for (const att of attachments) {
        if (!att.name?.toLowerCase().endsWith(".pdf")) continue;
        if (!att.contentBytes) continue;
        const bytes = Uint8Array.from(atob(att.contentBytes), (c) => c.charCodeAt(0));
        results.push({ file: new File([bytes], att.name, { type: "application/pdf" }), messageId: `${id}:outlook`, subject, senderEmail, receivedAt });
      }
    }
    return results;
  }

  private async fetchMessages(token: string): Promise<any[]> {
    let filter = `hasAttachments eq true`;
    if (prefs.syncMonths > 0) {
      const since = new Date();
      since.setMonth(since.getMonth() - prefs.syncMonths);
      filter += ` and receivedDateTime ge ${since.toISOString()}`;
    }
    const res = await fetch(
      `${GRAPH_BASE}/me/messages?$filter=${encodeURIComponent(filter)}&$select=id,subject,sender,receivedDateTime,hasAttachments&$top=200`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const json = await res.json();
    return json.value ?? [];
  }

  private async fetchAttachments(messageId: string, token: string): Promise<any[]> {
    const res = await fetch(
      `${GRAPH_BASE}/me/messages/${messageId}/attachments?$select=id,name,contentType,contentBytes`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const json = await res.json();
    // Filter by filename only — some senders use application/octet-stream
    // instead of application/pdf, which would cause contentType check to miss them.
    return (json.value ?? []).filter((a: any) => a.name?.toLowerCase().endsWith(".pdf"));
  }
}
