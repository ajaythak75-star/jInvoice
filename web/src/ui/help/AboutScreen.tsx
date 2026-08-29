import { useState } from "react";

const VERSION = "1.0.0";
const FEEDBACK_EMAIL = "feedback@jinvoice.app";
const CATEGORIES = ["Bug report", "Feature request", "Suggestion", "Compliment", "Other"];

const TECH_STACK = [
  { name: "Electron",           role: "Desktop runtime"      },
  { name: "React + Vite",       role: "UI framework"         },
  { name: "Dexie / IndexedDB",  role: "Local invoice store"  },
  { name: "Supabase",           role: "Cloud sync & auth"    },
  { name: "Google Gemini",      role: "AI invoice extraction"},
];

function FeedbackSection() {
  const [rating,   setRating]   = useState(0);
  const [hovered,  setHovered]  = useState(0);
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [message,  setMessage]  = useState("");
  const [sent,     setSent]     = useState(false);

  const handleSubmit = () => {
    if (!message.trim()) return;
    const ratingStr = rating ? `${rating}/5 stars` : "Not rated";
    const body = encodeURIComponent(`Rating: ${ratingStr}\nCategory: ${category}\n\n${message.trim()}`);
    const sub  = encodeURIComponent(`jInvoice Feedback — ${category}`);
    window.open(`mailto:${FEEDBACK_EMAIL}?subject=${sub}&body=${body}`, "_blank");
    setSent(true);
    setRating(0);
    setCategory(CATEGORIES[0]);
    setMessage("");
  };

  if (sent) {
    return (
      <div style={{ textAlign: "center", padding: "36px 0" }}>
        <div style={{ fontSize: 44, marginBottom: 14 }}>🙏</div>
        <h3 style={{ fontSize: 18, fontWeight: 800, color: "var(--color-text)", margin: "0 0 8px" }}>Thank you!</h3>
        <p style={{ fontSize: 13.5, color: "var(--color-text-secondary)", lineHeight: 1.65, maxWidth: 320, margin: "0 auto" }}>
          Your feedback helps make jInvoice better for everyone. We read every message.
        </p>
        <button
          onClick={() => setSent(false)}
          style={{ marginTop: 22, padding: "9px 22px", borderRadius: 8, border: "none", background: "#7c3aed", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
        >
          Send another
        </button>
      </div>
    );
  }

  return (
    <div style={{ border: "1px solid var(--color-border)", borderRadius: 12, background: "var(--color-surface)", padding: "20px 20px", display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Star rating */}
      <div>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>Overall Rating</div>
        <div style={{ display: "flex", gap: 4 }}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              onClick={() => setRating(n)}
              onMouseEnter={() => setHovered(n)}
              onMouseLeave={() => setHovered(0)}
              style={{ fontSize: 28, border: "none", background: "none", cursor: "pointer", padding: "0 2px", color: n <= (hovered || rating) ? "#f59e0b" : "var(--color-border)", transform: hovered === n ? "scale(1.2)" : "scale(1)", transition: "color 0.12s, transform 0.12s" }}
            >★</button>
          ))}
        </div>
      </div>

      {/* Category chips */}
      <div>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>Category</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              style={{ padding: "5px 13px", borderRadius: 20, border: `1.5px solid ${category === c ? "#7c3aed" : "var(--color-border)"}`, background: category === c ? "#ede9fe" : "transparent", color: category === c ? "#7c3aed" : "var(--color-text-secondary)", fontSize: 12.5, fontWeight: 600, cursor: "pointer", transition: "all 0.15s" }}
            >{c}</button>
          ))}
        </div>
      </div>

      {/* Message */}
      <div>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 5 }}>Message</div>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Tell us what you think, what could be better, or what you love about jInvoice…"
          rows={4}
          style={{ width: "100%", padding: "9px 12px", borderRadius: 7, border: "1px solid var(--color-border)", background: "var(--color-bg)", color: "var(--color-text)", fontSize: 13, resize: "vertical", boxSizing: "border-box", fontFamily: "inherit", outline: "none", lineHeight: 1.55 }}
        />
      </div>

      <button
        onClick={handleSubmit}
        disabled={!message.trim()}
        style={{ alignSelf: "flex-start", padding: "9px 22px", borderRadius: 8, border: "none", background: "#7c3aed", color: "#fff", fontSize: 13, fontWeight: 700, cursor: message.trim() ? "pointer" : "not-allowed", opacity: message.trim() ? 1 : 0.5 }}
      >
        Send Feedback
      </button>
    </div>
  );
}

export function AboutScreen() {
  return (
    <div style={{ padding: "32px 28px", maxWidth: 620, margin: "0 auto" }}>

      {/* App identity */}
      <div style={{ display: "flex", alignItems: "center", gap: 18, marginBottom: 28 }}>
        <div style={{ width: 60, height: 60, borderRadius: 16, background: "linear-gradient(135deg, #7c3aed, #5b21b6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 30, fontWeight: 900, color: "#fff", letterSpacing: "-2px", flexShrink: 0 }}>
          j
        </div>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: "var(--color-text)", margin: 0, letterSpacing: "-0.5px" }}>jInvoice</h1>
          <div style={{ fontSize: 13, color: "var(--color-text-secondary)", marginTop: 3 }}>Version {VERSION} · Desktop</div>
        </div>
      </div>

      {/* Tagline */}
      <div style={{ padding: "18px 20px", borderRadius: 12, border: "1px solid var(--color-border)", background: "var(--color-surface)", marginBottom: 22 }}>
        <p style={{ margin: 0, fontSize: 14, color: "var(--color-text)", lineHeight: 1.7, fontWeight: 500 }}>
          jInvoice is a private, AI-powered invoice manager for individuals and small businesses in India.
          Import invoices from email, camera, or file — jInvoice extracts the details automatically and
          keeps everything organised locally on your device.
        </p>
      </div>

      {/* Beliefs */}
      <div style={{ marginBottom: 22 }}>
        <h2 style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text)", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.06em" }}>What we believe</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[
            ["🔒 Privacy first",    "Your invoices are stored on your device. Cloud sync is opt-in and you control the key."],
            ["⚡ Fast by default",  "Extraction runs locally where possible. No round-trips for simple text PDFs."],
            ["🇮🇳 Built for India", "GST extraction, INR amounts, and Indian tax categories handled natively."],
          ].map(([title, desc]) => (
            <div key={String(title)} style={{ display: "flex", gap: 12, padding: "12px 14px", borderRadius: 10, border: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
              <div style={{ fontSize: 16, lineHeight: 1, flexShrink: 0, marginTop: 1 }}>{String(title).split(" ")[0]}</div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text)", marginBottom: 2 }}>{String(title).split(" ").slice(1).join(" ")}</div>
                <div style={{ fontSize: 12.5, color: "var(--color-text-secondary)", lineHeight: 1.55 }}>{desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Tech stack */}
      <div style={{ marginBottom: 22 }}>
        <h2 style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text)", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.06em" }}>Built with</h2>
        <div style={{ border: "1px solid var(--color-border)", borderRadius: 10, overflow: "hidden" }}>
          {TECH_STACK.map((t, i) => (
            <div key={t.name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 14px", borderTop: i === 0 ? "none" : "1px solid var(--color-border)", background: i % 2 === 0 ? "var(--color-surface)" : "var(--color-surface-2)", fontSize: 13 }}>
              <span style={{ fontWeight: 600, color: "var(--color-text)" }}>{t.name}</span>
              <span style={{ color: "var(--color-text-secondary)" }}>{t.role}</span>
            </div>
          ))}
        </div>
      </div>

      <p style={{ fontSize: 11.5, color: "var(--color-text-tertiary)", lineHeight: 1.6, margin: "0 0 28px" }}>
        © {new Date().getFullYear()} jInvoice. All rights reserved. Built with care in India.
      </p>

      {/* Feedback divider */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <div style={{ flex: 1, height: 1, background: "var(--color-border)" }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.07em" }}>Feedback</span>
        <div style={{ flex: 1, height: 1, background: "var(--color-border)" }} />
      </div>

      <p style={{ fontSize: 13.5, color: "var(--color-text-secondary)", margin: "0 0 16px", lineHeight: 1.55 }}>
        Your thoughts help us improve jInvoice. We read every message.
      </p>

      <FeedbackSection />

      <p style={{ marginTop: 12, fontSize: 11.5, color: "var(--color-text-tertiary)", lineHeight: 1.6 }}>
        Clicking "Send Feedback" opens your email client. No data is sent from within jInvoice.
      </p>
    </div>
  );
}
