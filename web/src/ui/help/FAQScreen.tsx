import { useState } from "react";

const SUPPORT_EMAIL = "support@jinvoice.app";

const FAQS: { q: string; a: string }[] = [
  {
    q: "What file types can I import?",
    a: "jInvoice supports PDF invoices (both text-based and scanned) and images captured via the camera. Gmail and Outlook attachments are picked up automatically when email sync is enabled.",
  },
  {
    q: "What is the daily invoice limit?",
    a: "Free plan users can import up to 5 invoices per day. The count resets automatically at midnight. Pro users have no daily limit.",
  },
  {
    q: "How does the 14-day Pro trial work?",
    a: "Start the trial from the Pricing screen — no credit card required. You get full Pro access for 14 days. After the trial ends you stay on the Free plan until a Pro subscription is activated.",
  },
  {
    q: "What is the difference between Free and Pro?",
    a: "Free includes mobile capture, cloud sync, 3 months of data history, and 5 invoices per day. Pro adds unlimited daily imports, 6+ months of history, up to 5 email accounts, and your own Gemini API key.",
  },
  {
    q: "How do I connect my Gmail or Outlook account?",
    a: "Go to Settings → Email Sync and click Connect next to Gmail or Outlook. You will be redirected to sign in with your account. jInvoice only reads emails to extract invoice attachments — it never sends emails on your behalf.",
  },
  {
    q: "Is my data stored on the cloud?",
    a: "Invoices are stored locally on your device using IndexedDB. Cloud sync (Supabase) is available on both Free and Pro plans to back up your data and enable mobile access.",
  },
  {
    q: "What is the jInvoice Secret?",
    a: "The jInvoice Secret is a password you set in Settings → API Keys. It secures the mobile sync endpoint so only your devices can push invoices to jInvoice.",
  },
  {
    q: "Can I use my own AI API key?",
    a: "Yes — Pro users can add their own Gemini API key in Settings → API Keys. This removes the shared quota limit and lets you extract as many invoices as your key allows.",
  },
  {
    q: "How does GST extraction work?",
    a: "jInvoice reads the GSTIN printed on the invoice automatically using AI extraction. You can view and manage GST records in the GST tab.",
  },
  {
    q: "What is the Cloud URL for mobile sync?",
    a: "The Cloud URL lets your phone send invoices to jInvoice from anywhere — on mobile data or any Wi-Fi network. Find it in Settings → Mobile Sync → Copy Cloud URL. Open that URL on your phone and enter your jInvoice Secret to start uploading invoices.",
  },
  {
    q: "What is the Local URL for mobile sync?",
    a: "The Local URL works only when your phone and desktop are on the same Wi-Fi network. It is faster than the Cloud URL because it transfers files directly without going through the internet. Find it in Settings → Mobile Sync → Copy Local URL. Use it for faster local transfers; switch to the Cloud URL when away from home.",
  },
];

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
      style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s ease", flexShrink: 0 }}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function SupportSection() {
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sent, setSent]       = useState(false);

  const handleSend = () => {
    if (!subject.trim() || !message.trim()) return;
    window.open(
      `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject.trim())}&body=${encodeURIComponent(message.trim())}`,
      "_blank",
    );
    setSent(true);
    setSubject("");
    setMessage("");
  };

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 20 }}>
        <a
          href={`mailto:${SUPPORT_EMAIL}`}
          style={{
            display: "flex", alignItems: "center", gap: 12,
            padding: "14px 16px", borderRadius: 10,
            border: "1px solid var(--color-border)", background: "var(--color-surface)",
            textDecoration: "none", color: "var(--color-text)",
          }}
        >
          <span style={{ fontSize: 18 }}>✉️</span>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Email</div>
            <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>{SUPPORT_EMAIL}</div>
          </div>
        </a>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderRadius: 10, border: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
          <span style={{ fontSize: 18 }}>🕐</span>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Response time</div>
            <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>2 business days</div>
          </div>
        </div>
      </div>

      <div style={{ border: "1px solid var(--color-border)", borderRadius: 12, background: "var(--color-surface)", padding: "20px 20px" }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--color-text)", margin: "0 0 16px" }}>Send a message</h3>

        {sent && (
          <div style={{ marginBottom: 14, padding: "10px 14px", borderRadius: 8, background: "#f0fdf4", border: "1px solid #86efac", color: "#166534", fontSize: 13, fontWeight: 600 }}>
            ✓ Email client opened. We look forward to hearing from you!
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: "var(--color-text-secondary)", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.04em" }}>Subject</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g. Invoice extraction not working"
              style={{ width: "100%", padding: "9px 12px", borderRadius: 7, border: "1px solid var(--color-border)", background: "var(--color-bg)", color: "var(--color-text)", fontSize: 13, boxSizing: "border-box", outline: "none" }}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: "var(--color-text-secondary)", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.04em" }}>Message</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Describe your issue or question in as much detail as possible…"
              rows={4}
              style={{ width: "100%", padding: "9px 12px", borderRadius: 7, border: "1px solid var(--color-border)", background: "var(--color-bg)", color: "var(--color-text)", fontSize: 13, resize: "vertical", boxSizing: "border-box", fontFamily: "inherit", outline: "none" }}
            />
          </div>
          <button
            onClick={handleSend}
            disabled={!subject.trim() || !message.trim()}
            style={{ alignSelf: "flex-start", padding: "9px 22px", borderRadius: 7, border: "none", background: "#7c3aed", color: "#fff", fontSize: 13, fontWeight: 700, cursor: subject.trim() && message.trim() ? "pointer" : "not-allowed", opacity: subject.trim() && message.trim() ? 1 : 0.5 }}
          >
            Open email client
          </button>
        </div>
      </div>

      <p style={{ marginTop: 12, fontSize: 11.5, color: "var(--color-text-tertiary)", lineHeight: 1.6 }}>
        Clicking "Open email client" opens your default mail app with the message pre-filled. No data is sent from within jInvoice.
      </p>
    </>
  );
}

export function FAQScreen() {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <div style={{ padding: "32px 28px", maxWidth: 680, margin: "0 auto" }}>

      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, color: "var(--color-text)", margin: 0 }}>
          FAQ &amp; Support
        </h1>
        <p style={{ fontSize: 14, color: "var(--color-text-secondary)", marginTop: 6 }}>
          Quick answers to common questions, and a direct line to our team.
        </p>
      </div>

      {/* FAQ accordion */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 36 }}>
        {FAQS.map((item, i) => {
          const isOpen = open === i;
          return (
            <div key={i} style={{ border: "1px solid var(--color-border)", borderRadius: 10, background: "var(--color-surface)", overflow: "hidden" }}>
              <button
                onClick={() => setOpen(isOpen ? null : i)}
                style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "14px 16px", background: "none", border: "none", cursor: "pointer", color: "var(--color-text)", fontSize: 13.5, fontWeight: 600, textAlign: "left" }}
              >
                <span>{item.q}</span>
                <ChevronIcon open={isOpen} />
              </button>
              {isOpen && (
                <div style={{ padding: "12px 16px 14px", fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.65, borderTop: "1px solid var(--color-border)" }}>
                  {item.a}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Support divider */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <div style={{ flex: 1, height: 1, background: "var(--color-border)" }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.07em" }}>Support</span>
        <div style={{ flex: 1, height: 1, background: "var(--color-border)" }} />
      </div>

      <SupportSection />
    </div>
  );
}
