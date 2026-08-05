import { prefs } from "../data/AutoImportPreferences";
import { isAlreadyImported } from "../data/InvoiceDatabase";
import { AUTH_BASE } from "../config";

function gmailAfterDate(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

function buildGmailQuery(): string {
  const after = gmailAfterDate(prefs.syncMonths);
  // Search all mail (not just inbox) for any PDF attachment.
  // Keyword hints improve relevance but are not required — the doc type
  // detector classifies content after download.
  return `has:attachment filename:pdf after:${after}`;
}

export class GmailConnector {
  async startSignIn(): Promise<void> {
    window.location.href = `${AUTH_BASE}/auth/gmail/start`;
  }

  async pollAndDownload(): Promise<{ file: File; messageId: string; subject: string; senderEmail: string; receivedAt: string }[]> {
    if (!prefs.gmailAccessToken) throw new Error("Not authenticated");

    const query = buildGmailQuery();
    console.log("[Gmail] Query:", query);

    const messages = await this.get<{ messages?: any[] }>(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=50`
    );
    const list = messages.messages ?? [];
    console.log("[Gmail] Messages found:", list.length);

    const results: { file: File; messageId: string; subject: string; senderEmail: string; receivedAt: string }[] = [];

    for (const msg of list) {
      const id: string = msg.id;
      if (await isAlreadyImported(`${id}:gmail`)) {
        console.log("[Gmail] Skipping already imported:", id);
        continue;
      }

      const detail = await this.get<any>(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`
      );
      const headers: { name: string; value: string }[] = detail?.payload?.headers ?? [];
      const hdr = (name: string) => headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
      const subject     = hdr("Subject");
      const senderEmail = hdr("From");
      const receivedAt  = hdr("Date");

      const parts: any[] = this.flattenParts(detail?.payload);
      console.log("[Gmail]", id, "subject:", subject, "| parts with pdf:", parts.filter((p) => p.filename?.toLowerCase().endsWith(".pdf")).length);

      for (const part of parts) {
        if (!part.filename?.toLowerCase().endsWith(".pdf")) continue;
        const attachmentId: string = part.body?.attachmentId;
        if (!attachmentId) {
          console.log("[Gmail] Part has no attachmentId — skipping:", part.filename);
          continue;
        }

        console.log("[Gmail] Downloading:", part.filename);
        const data = await this.downloadAttachment(id, attachmentId);
        if (!data) { console.log("[Gmail] Download returned null for:", part.filename); continue; }

        results.push({ file: new File([data], part.filename, { type: "application/pdf" }), messageId: `${id}:gmail`, subject, senderEmail, receivedAt });
        console.log("[Gmail] Downloaded:", part.filename, `(${data.byteLength} bytes)`);
      }
    }
    console.log("[Gmail] Total PDFs ready to process:", results.length);
    return results;
  }

  private async get<T>(url: string, retried = false): Promise<T> {
    const token = prefs.gmailAccessToken;
    if (!token) throw new Error("Not authenticated");

    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

    if (res.status === 401 && !retried) {
      const refreshed = await this.refreshToken();
      if (!refreshed) throw new Error("Gmail session expired — please reconnect.");
      return this.get<T>(url, true);
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as any;
      const reason = body?.error?.message ?? body?.error ?? "";
      throw new Error(`Gmail API error ${res.status}${reason ? ": " + reason : ""}`);
    }
    return res.json() as Promise<T>;
  }

  private async refreshToken(): Promise<boolean> {
    const refreshToken = prefs.gmailRefreshToken;
    if (!refreshToken) return false;
    try {
      const res = await fetch(`${AUTH_BASE}/auth/gmail/refresh?refresh_token=${encodeURIComponent(refreshToken)}`);
      if (!res.ok) return false;
      const { access_token } = await res.json() as { access_token?: string };
      if (!access_token) return false;
      prefs.gmailAccessToken = access_token;
      return true;
    } catch {
      return false;
    }
  }

  private async downloadAttachment(messageId: string, attachmentId: string): Promise<ArrayBuffer | null> {
    const json = await this.get<{ data?: string }>(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${attachmentId}`
    );
    if (!json.data) return null;
    const b64    = json.data.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(b64);
    const bytes  = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  private flattenParts(payload: any): any[] {
    if (!payload) return [];
    const result: any[] = [];
    const parts: any[] = payload.parts ?? [];
    for (const part of parts) {
      if (part.parts) result.push(...this.flattenParts(part));
      else result.push(part);
    }
    if (parts.length === 0 && payload.filename) result.push(payload);
    return result;
  }
}
