import { useState } from "react";

const FEEDBACK_EMAIL = "feedback@jinvoice.app";
const CATEGORIES = ["Bug report", "Feature request", "Suggestion", "Compliment", "Other"];

export function FeedbackScreen() {
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
      <div style={{ padding: "32px 28px", maxWidth: 560, margin: "0 auto" }}>
        <div style={{ textAlign: "center", padding: "56px 0" }}>
          <div style={{ fontSize: 52, marginBottom: 18 }}>🙏</div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: "var(--color-text)", margin: "0 0 10px" }}>Thank you!</h1>
          <p style={{ fontSize: 14, color: "var(--color-text-secondary)", lineHeight: 1.65, maxWidth: 340, margin: "0 auto" }}>
            Your feedback helps make jInvoice better for everyone. We read every message.
          </p>
          <button
            onClick={() => setSent(false)}
            style={{ marginTop: 28, padding: "10px 24px", borderRadius: 8, border: "none", background: "#7c3aed", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
          >
            Send another
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "32px 28px", maxWidth: 560, margin: "0 auto" }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, color: "var(--color-text)", margin: 0 }}>Share Feedback</h1>
        <p style={{ fontSize: 14, color: "var(--color-text-secondary)", marginTop: 6 }}>
          Your thoughts help us improve jInvoice. We read every message.
        </p>
      </div>

      <div style={{ border: "1px solid var(--color-border)", borderRadius: 12, background: "var(--color-surface)", padding: "24px 22px", display: "flex", flexDirection: "column", gap: 20 }}>

        {/* Star rating */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 10 }}>
            Overall Rating
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => setRating(n)}
                onMouseEnter={() => setHovered(n)}
                onMouseLeave={() => setHovered(0)}
                style={{
                  fontSize: 30, border: "none", background: "none", cursor: "pointer", padding: "0 2px",
                  color: n <= (hovered || rating) ? "#f59e0b" : "var(--color-border)",
                  transform: hovered === n ? "scale(1.2)" : "scale(1)",
                  transition: "color 0.12s, transform 0.12s",
                }}
              >
                ★
              </button>
            ))}
          </div>
        </div>

        {/* Category chips */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 10 }}>
            Category
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {CATEGORIES.map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                style={{
                  padding: "6px 14px", borderRadius: 20,
                  border: `1.5px solid ${category === c ? "#7c3aed" : "var(--color-border)"}`,
                  background: category === c ? "#ede9fe" : "transparent",
                  color: category === c ? "#7c3aed" : "var(--color-text-secondary)",
                  fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                  transition: "all 0.15s",
                }}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        {/* Message */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>
            Message
          </div>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Tell us what you think, what could be better, or what you love about jInvoice…"
            rows={5}
            style={{
              width: "100%", padding: "9px 12px", borderRadius: 7,
              border: "1px solid var(--color-border)", background: "var(--color-bg)",
              color: "var(--color-text)", fontSize: 13, resize: "vertical",
              boxSizing: "border-box", fontFamily: "inherit", outline: "none", lineHeight: 1.55,
            }}
          />
        </div>

        <button
          onClick={handleSubmit}
          disabled={!message.trim()}
          style={{
            alignSelf: "flex-start", padding: "10px 24px", borderRadius: 8,
            border: "none", background: "#7c3aed", color: "#fff",
            fontSize: 13, fontWeight: 700,
            cursor: message.trim() ? "pointer" : "not-allowed",
            opacity: message.trim() ? 1 : 0.5,
          }}
        >
          Send Feedback
        </button>
      </div>

      <p style={{ marginTop: 14, fontSize: 11.5, color: "var(--color-text-tertiary)", lineHeight: 1.6 }}>
        Clicking "Send Feedback" opens your email client with the message pre-filled. No data is sent from within jInvoice.
      </p>
    </div>
  );
}
