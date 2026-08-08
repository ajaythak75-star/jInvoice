import { prefs } from "../data/AutoImportPreferences";
import { isAlreadyImported } from "../data/InvoiceDatabase";
import { AUTH_BASE } from "../config";

function gmailAfterDate(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

function buildGmailQuery(): string {
  const base = "has:attachment filename:pdf";
  if (prefs.syncMonths === 0) return base; // 0 = all time, no date filter
  return `${base} after:${gmailAfterDate(prefs.syncMonths)}`;
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
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=200`
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

        let data: ArrayBuffer | null = null;

        if (part.body?.attachmentId) {
          console.log("[Gmail] Downloading attachment:", part.filename);
          data = await this.downloadAttachment(id, part.body.attachmentId);
        } else if (part.body?.data) {
          // Small PDFs (< ~25 KB) are inlined in the message payload instead
          // of being referenced by attachmentId — decode them directly.
          console.log("[Gmail] Decoding inline PDF:", part.filename);
          const b64 = (part.body.data as string).replace(/-/g, "+").replace(/_/g, "/");
          const binary = atob(b64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          data = bytes.buffer;
        } else {
          console.log("[Gmail] Part has no body data — skipping:", part.filename);
          continue;
        }

        if (!data) { console.log("[Gmail] Download returned null for:", part.filename); continue; }

        results.push({ file: new File([data], part.filename, { type: "application/pdf" }), messageId: `${id}:gmail`, subject, senderEmail, receivedAt });
        console.log("[Gmail] Ready:", part.filename, `(${data.byteLength} bytes)`);
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
