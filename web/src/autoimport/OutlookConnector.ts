import { prefs } from "../data/AutoImportPreferences";
import { isAlreadyImported } from "../data/InvoiceDatabase";
import { AUTH_BASE } from "../config";
import { looksLikeInvoice } from "../extraction/HtmlExtractor";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

export class OutlookConnector {
  private acctToken?: string;

  constructor(acct?: { accessToken: string }) {
    this.acctToken = acct?.accessToken;
  }

  async startSignIn(loginHint?: string): Promise<void> {
    const qs = loginHint ? `?login_hint=${encodeURIComponent(loginHint)}` : "";
    window.location.href = `${AUTH_BASE}/auth/outlook/start${qs}`;
  }

  async pollAndDownload(
    onEmail?: (meta: { id: string; subject: string; senderEmail: string; receivedAt: string }) => Promise<"allow" | "block">
  ): Promise<{ file: File; messageId: string; subject: string; senderEmail: string; receivedAt: string }[]> {
    const token = this.acctToken ?? prefs.outlookAccessToken;
    if (!token) throw new Error("Not authenticated");

    const messages = await this.fetchMessages(token);
    const results: { file: File; messageId: string; subject: string; senderEmail: string; receivedAt: string }[] = [];

    for (const msg of messages) {
      const id: string = msg.id;
      if (await isAlreadyImported(`${id}:outlook`)) continue;

      const subject     = msg.subject ?? "";
      const senderEmail = msg.sender?.emailAddress?.address ?? msg.sender?.emailAddress?.name ?? "";
      const receivedAt  = msg.receivedDateTime ?? "";

      // Allow caller to inspect metadata before attachment download
      if (onEmail) {
        const decision = await onEmail({ id: `${id}:outlook`, subject, senderEmail, receivedAt });
        if (decision === "block") continue;
      }

      const attachments = await this.fetchAttachments(id, token);
      let addedForMsg = 0;
      for (const att of attachments) {
        if (!att.name?.toLowerCase().endsWith(".pdf")) continue;
        if (!att.contentBytes) continue;
        const bytes = Uint8Array.from(atob(att.contentBytes), (c) => c.charCodeAt(0));
        results.push({ file: new File([bytes], att.name, { type: "application/pdf" }), messageId: `${id}:outlook`, subject, senderEmail, receivedAt });
        addedForMsg++;
      }

      // No PDF attachment — try HTML email body as an inline invoice
      if (addedForMsg === 0 && msg.body?.contentType?.toLowerCase() === "html") {
        const html: string = msg.body.content ?? "";
        if (looksLikeInvoice(html)) {
          const bytes = new TextEncoder().encode(html);
          results.push({ file: new File([bytes], `${id}.html`, { type: "text/html" }), messageId: `${id}:outlook`, subject, senderEmail, receivedAt });
          console.log("[Outlook] HTML body queued as invoice:", id, subject);
        }
      }
    }
    return results;
  }

  async fetchFolders(): Promise<{ id: string; displayName: string }[]> {
    const token = prefs.outlookAccessToken;
    if (!token) return [];
    const res = await fetch(
      `${GRAPH_BASE}/me/mailFolders?$select=id,displayName&$top=100`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const json = await res.json();
    return (json.value ?? []).map((f: any) => ({ id: f.id as string, displayName: f.displayName as string }));
  }

  private async fetchMessages(token: string): Promise<any[]> {
    let filter = `hasAttachments eq true`;
    if (prefs.syncMonths > 0) {
      const since = new Date();
      since.setMonth(since.getMonth() - prefs.syncMonths);
      filter += ` and receivedDateTime ge ${since.toISOString()}`;
    }
    const folderIds = prefs.outlookFolderIds;
    const params = `$filter=${encodeURIComponent(filter)}&$select=id,subject,sender,receivedDateTime,hasAttachments,body&$top=200`;

    const seenIds = new Set<string>();
    const allMessages: any[] = [];
    for (const folderId of folderIds) {
      const url = `${GRAPH_BASE}/me/mailFolders/${encodeURIComponent(folderId)}/messages?${params}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const json = await res.json();
      for (const msg of (json.value ?? [])) {
        if (!seenIds.has(msg.id)) { seenIds.add(msg.id); allMessages.push(msg); }
      }
    }
    return allMessages;
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
