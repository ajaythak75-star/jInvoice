const VERSION = "1.0.0";

const TECH_STACK = [
  { name: "Electron",      role: "Desktop runtime"         },
  { name: "React + Vite",  role: "UI framework"            },
  { name: "Dexie / IndexedDB", role: "Local invoice store" },
  { name: "Supabase",      role: "Cloud sync & auth"       },
  { name: "Google Gemini", role: "AI invoice extraction"   },
];

export function AboutScreen() {
  return (
    <div style={{ padding: "32px 28px", maxWidth: 620, margin: "0 auto" }}>
      {/* App identity */}
      <div style={{ display: "flex", alignItems: "center", gap: 18, marginBottom: 32 }}>
        <div style={{
          width: 64, height: 64, borderRadius: 16,
          background: "linear-gradient(135deg, #7c3aed, #5b21b6)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 32, fontWeight: 900, color: "#fff", letterSpacing: "-2px",
          flexShrink: 0,
        }}>
          j
        </div>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: "var(--color-text)", margin: 0, letterSpacing: "-0.5px" }}>
            jInvoice
          </h1>
          <div style={{ fontSize: 13, color: "var(--color-text-secondary)", marginTop: 3 }}>
            Version {VERSION} · Desktop
          </div>
        </div>
      </div>

      {/* Tagline */}
      <div
        style={{
          padding: "20px 22px", borderRadius: 12,
          border: "1px solid var(--color-border)", background: "var(--color-surface)",
          marginBottom: 24,
        }}
      >
        <p style={{ margin: 0, fontSize: 14.5, color: "var(--color-text)", lineHeight: 1.7, fontWeight: 500 }}>
          jInvoice is a private, AI-powered invoice manager for individuals and small businesses in India.
          Import invoices from email, camera, or file — jInvoice extracts the details automatically and
          keeps everything organised locally on your device.
        </p>
      </div>

      {/* What we believe */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--color-text)", marginBottom: 14, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          What we believe
        </h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[
            ["🔒 Privacy first",    "Your invoices are stored on your device. Cloud sync is opt-in and you control the key."],
            ["⚡ Fast by default",  "Extraction runs locally where possible. No round-trips for simple text PDFs."],
            ["🇮🇳 Built for India", "GST extraction, INR amounts, and Indian tax categories handled natively."],
          ].map(([title, desc]) => (
            <div
              key={String(title)}
              style={{
                display: "flex", gap: 14, padding: "14px 16px", borderRadius: 10,
                border: "1px solid var(--color-border)", background: "var(--color-surface)",
              }}
            >
              <div style={{ fontSize: 18, lineHeight: 1, flexShrink: 0, marginTop: 1 }}>{String(title).split(" ")[0]}</div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text)", marginBottom: 3 }}>
                  {String(title).split(" ").slice(1).join(" ")}
                </div>
                <div style={{ fontSize: 12.5, color: "var(--color-text-secondary)", lineHeight: 1.55 }}>{desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Tech stack */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--color-text)", marginBottom: 14, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Built with
        </h2>
        <div
          style={{
            border: "1px solid var(--color-border)", borderRadius: 10, overflow: "hidden",
          }}
        >
          {TECH_STACK.map((t, i) => (
            <div
              key={t.name}
              style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "10px 16px",
                borderTop: i === 0 ? "none" : "1px solid var(--color-border)",
                background: i % 2 === 0 ? "var(--color-surface)" : "var(--color-surface-2)",
                fontSize: 13,
              }}
            >
              <span style={{ fontWeight: 600, color: "var(--color-text)" }}>{t.name}</span>
              <span style={{ color: "var(--color-text-secondary)" }}>{t.role}</span>
            </div>
          ))}
        </div>
      </div>

      <p style={{ fontSize: 11.5, color: "var(--color-text-tertiary)", lineHeight: 1.6, margin: 0 }}>
        © {new Date().getFullYear()} jInvoice. All rights reserved.
        Built with care in India.
      </p>
    </div>
  );
}
