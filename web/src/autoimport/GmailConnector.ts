import { prefs } from "../data/AutoImportPreferences";
import { isAlreadyImported } from "../data/InvoiceDatabase";
import { AUTH_BASE } from "../config";
import { looksLikeInvoice } from "../extraction/HtmlExtractor";

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
  private acct?: { email: string; accessToken: string; refreshToken: string | null };

  constructor(acct?: { email: string; accessToken: string; refreshToken: string | null }) {
    this.acct = acct;
  }

  private getToken(): string {
    return this.acct?.accessToken ?? prefs.gmailAccessToken ?? "";
  }

  private storeToken(newToken: string): void {
    if (this.acct) {
      this.acct.accessToken = newToken;
      const accounts = prefs.gmailAccounts;
      const idx = accounts.findIndex((a) => a.email === this.acct!.email);
      if (idx >= 0) { accounts[idx].accessToken = newToken; prefs.gmailAccounts = accounts; }
    } else {
      prefs.gmailAccessToken = newToken;
    }
  }

  async startSignIn(loginHint?: string): Promise<void> {
    const params = new URLSearchParams({ return_to: window.location.origin });
    if (loginHint) params.set("login_hint", loginHint);
    window.location.href = `${AUTH_BASE}/auth/gmail/start?${params}`;
  }

  async pollAndDownload(
    onEmail?: (meta: { id: string; subject: string; senderEmail: string; receivedAt: string }) => Promise<"allow" | "block">
  ): Promise<{ file: File; messageId: string; subject: string; senderEmail: string; receivedAt: string }[]> {
    if (!this.getToken()) throw new Error("Not authenticated");

    const query = buildGmailQuery();
    const labelIds = prefs.gmailLabelIds;
    console.log("[Gmail] Query:", query, "| Labels:", labelIds);

    // Fetch per label and deduplicate — multiple labelIds in one call is AND, not OR
    const seenIds = new Set<string>();
    const list: any[] = [];
    for (const labelId of labelIds) {
      const res = await this.get<{ messages?: any[] }>(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&labelIds=${encodeURIComponent(labelId)}&maxResults=200`
      );
      for (const msg of res.messages ?? []) {
        if (!seenIds.has(msg.id)) { seenIds.add(msg.id); list.push(msg); }
      }
    }
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

      // Allow caller to inspect metadata before attachment download
      if (onEmail) {
        const decision = await onEmail({ id: `${id}:gmail`, subject, senderEmail, receivedAt });
        if (decision === "block") {
          console.log("[Gmail] Blocked by caller:", id, subject);
          continue;
        }
      }

      const parts: any[] = this.flattenParts(detail?.payload);
      console.log("[Gmail]", id, "subject:", subject, "| parts with pdf:", parts.filter((p) => p.filename?.toLowerCase().endsWith(".pdf")).length);

      let addedForMsg = 0;
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
        addedForMsg++;
      }

      // No PDF attachment — try HTML email body as an inline invoice
      if (addedForMsg === 0) {
        const htmlPart = parts.find((p) => p.mimeType === "text/html" && !p.filename && p.body?.data);
        if (htmlPart) {
          const b64 = (htmlPart.body.data as string).replace(/-/g, "+").replace(/_/g, "/");
          const html = atob(b64);
          if (looksLikeInvoice(html)) {
            const bytes = new TextEncoder().encode(html);
            results.push({ file: new File([bytes], `${id}.html`, { type: "text/html" }), messageId: `${id}:gmail`, subject, senderEmail, receivedAt });
            console.log("[Gmail] HTML body queued as invoice:", id, subject);
          }
        }
      }
    }
    console.log("[Gmail] Total files ready to process:", results.length);
    return results;
  }

  async fetchLabels(): Promise<{ id: string; name: string }[]> {
    const data = await this.get<{ labels?: any[] }>(
      "https://gmail.googleapis.com/gmail/v1/users/me/labels"
    );
    return (data.labels ?? [])
      .filter((l: any) => l.type === "system" || l.type === "user")
      .map((l: any) => ({ id: l.id as string, name: l.name as string }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private async get<T>(url: string, retried = false): Promise<T> {
    const token = this.getToken();
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
    const refreshToken = this.acct?.refreshToken ?? prefs.gmailRefreshToken;
    if (!refreshToken) return false;
    try {
      const res = await fetch(`${AUTH_BASE}/auth/gmail/refresh?refresh_token=${encodeURIComponent(refreshToken)}`);
      if (!res.ok) return false;
      const { access_token } = await res.json() as { access_token?: string };
      if (!access_token) return false;
      this.storeToken(access_token);
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
