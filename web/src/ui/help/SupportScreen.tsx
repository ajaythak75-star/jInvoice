import { useState } from "react";

const SUPPORT_EMAIL = "support@jinvoice.app";

export function SupportScreen() {
  const [subject, setSubject]   = useState("");
  const [message, setMessage]   = useState("");
  const [sent, setSent]         = useState(false);

  const handleSend = () => {
    if (!subject.trim() || !message.trim()) return;
    const body = encodeURIComponent(message.trim());
    const sub  = encodeURIComponent(subject.trim());
    window.open(`mailto:${SUPPORT_EMAIL}?subject=${sub}&body=${body}`, "_blank");
    setSent(true);
    setSubject("");
    setMessage("");
  };

  return (
    <div style={{ padding: "32px 28px", maxWidth: 620, margin: "0 auto" }}>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, color: "var(--color-text)", margin: 0 }}>
          Support
        </h1>
        <p style={{ fontSize: 14, color: "var(--color-text-secondary)", marginTop: 6 }}>
          We're here to help. Reach us any time and we'll get back to you within 2 business days.
        </p>
      </div>

      {/* Contact cards */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 32 }}>
        <a
          href={`mailto:${SUPPORT_EMAIL}`}
          style={{
            display: "flex", alignItems: "center", gap: 12,
            padding: "16px 18px", borderRadius: 10,
            border: "1px solid var(--color-border)", background: "var(--color-surface)",
            textDecoration: "none", color: "var(--color-text)",
          }}
        >
          <span style={{ fontSize: 20 }}>✉️</span>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Email</div>
            <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>{SUPPORT_EMAIL}</div>
          </div>
        </a>

        <div
          style={{
            display: "flex", alignItems: "center", gap: 12,
            padding: "16px 18px", borderRadius: 10,
            border: "1px solid var(--color-border)", background: "var(--color-surface)",
          }}
        >
          <span style={{ fontSize: 20 }}>🕐</span>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Response time</div>
            <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>Within 2 business days</div>
          </div>
        </div>
      </div>

      {/* Message form */}
      <div
        style={{
          border: "1px solid var(--color-border)", borderRadius: 12,
          background: "var(--color-surface)", padding: "24px 22px",
        }}
      >
        <h2 style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text)", margin: "0 0 18px" }}>
          Send a message
        </h2>

        {sent && (
          <div style={{
            marginBottom: 16, padding: "10px 14px", borderRadius: 8,
            background: "#f0fdf4", border: "1px solid #86efac",
            color: "#166534", fontSize: 13, fontWeight: 600,
          }}>
            ✓ Your email client opened. We look forward to hearing from you!
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Subject
            </label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g. Invoice extraction not working"
              style={{
                width: "100%", padding: "9px 12px", borderRadius: 7,
                border: "1px solid var(--color-border)", background: "var(--color-bg)",
                color: "var(--color-text)", fontSize: 13, boxSizing: "border-box",
                outline: "none",
              }}
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Message
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Describe your issue or question in as much detail as possible…"
              rows={5}
              style={{
                width: "100%", padding: "9px 12px", borderRadius: 7,
                border: "1px solid var(--color-border)", background: "var(--color-bg)",
                color: "var(--color-text)", fontSize: 13, resize: "vertical",
                boxSizing: "border-box", fontFamily: "inherit", outline: "none",
              }}
            />
          </div>

          <button
            onClick={handleSend}
            disabled={!subject.trim() || !message.trim()}
            style={{
              alignSelf: "flex-start", padding: "9px 22px", borderRadius: 7,
              border: "none", background: "#7c3aed", color: "#fff",
              fontSize: 13, fontWeight: 700, cursor: subject.trim() && message.trim() ? "pointer" : "not-allowed",
              opacity: subject.trim() && message.trim() ? 1 : 0.5,
            }}
          >
            Open email client
          </button>
        </div>
      </div>

      <p style={{ marginTop: 18, fontSize: 11.5, color: "var(--color-text-tertiary)", lineHeight: 1.6 }}>
        Clicking "Open email client" will open your default mail app with the message pre-filled. No data is sent from within jInvoice.
      </p>
    </div>
  );
}
