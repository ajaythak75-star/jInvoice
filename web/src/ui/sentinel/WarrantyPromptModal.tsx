import { useState } from "react";
import { updateSentinelExpiry, addManualSentinel } from "../../service/ExpirySentinel";

export interface WarrantyPromptItem {
  sentinelId: number | null;   // null = no sentinel yet, we'll create one
  invoiceId: number;
  productName: string;
  merchantName: string | null;
  expiresAt: string;           // pre-filled from auto-detection, or estimated from today+12mo
}

interface Props {
  items: WarrantyPromptItem[];
  onDone: () => void;
}

function formatDateDisplay(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function WarrantyPromptModal({ items, onDone }: Props) {
  const [dates, setDates] = useState<Record<number, string>>(() => {
    const init: Record<number, string> = {};
    items.forEach((it) => { init[it.invoiceId] = it.expiresAt; });
    return init;
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      for (const it of items) {
        const newDate = dates[it.invoiceId];
        if (!newDate) continue;
        if (it.sentinelId != null) {
          await updateSentinelExpiry(it.sentinelId, newDate);
        } else {
          await addManualSentinel(it.invoiceId, newDate, it.merchantName);
        }
      }
    } finally {
      setSaving(false);
      onDone();
    }
  };

  const overlayStyle: React.CSSProperties = {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 9999,
    display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
  };
  const panelStyle: React.CSSProperties = {
    background: "var(--color-surface)", borderRadius: 12,
    boxShadow: "0 8px 32px rgba(0,0,0,0.22)", width: "100%", maxWidth: 420,
    maxHeight: "80vh", display: "flex", flexDirection: "column", overflow: "hidden",
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 10.5, fontWeight: 600, color: "var(--color-text-tertiary)",
    textTransform: "uppercase", letterSpacing: "0.04em",
  };

  return (
    <div style={overlayStyle} onClick={(e) => e.target === e.currentTarget && onDone()}>
      <div style={panelStyle}>
        {/* Header */}
        <div style={{ padding: "16px 20px 12px", borderBottom: "1px solid var(--color-border)", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "var(--color-text)" }}>Warranty Check</div>
              <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 2 }}>
                Check your warranty card and correct the expiry date if needed.
              </div>
            </div>
            <button
              onClick={onDone}
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "var(--color-text-secondary)", padding: "2px 6px" }}
              aria-label="Skip"
            >✕</button>
          </div>
        </div>

        {/* Items */}
        <div style={{ overflowY: "auto", flex: 1, padding: "12px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
          {items.map((it) => (
            <div key={it.invoiceId} style={{ background: "var(--color-surface-2)", borderRadius: 8, padding: "10px 12px" }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text)", marginBottom: 4,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={it.productName}>
                {it.productName}
              </div>
              {it.merchantName && (
                <div style={{ fontSize: 11.5, color: "var(--color-text-secondary)", marginBottom: 8 }}>
                  {it.merchantName}
                </div>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={labelStyle}>Expiry</span>
                <input
                  type="date"
                  value={dates[it.invoiceId] ?? it.expiresAt}
                  onChange={(e) => setDates((prev) => ({ ...prev, [it.invoiceId]: e.target.value }))}
                  style={{
                    fontSize: 12, padding: "4px 8px", borderRadius: 5, flex: 1,
                    border: "1px solid var(--color-border)",
                    background: "var(--color-surface)", color: "var(--color-text)",
                  }}
                />
                <span style={{ fontSize: 11.5, color: "var(--color-text-secondary)", whiteSpace: "nowrap" }}>
                  {formatDateDisplay(dates[it.invoiceId] ?? it.expiresAt)}
                </span>
              </div>
              {it.sentinelId == null && (
                <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 4 }}>
                  No warranty was auto-detected — set date to track it.
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{ padding: "12px 20px", borderTop: "1px solid var(--color-border)", display: "flex", justifyContent: "flex-end", gap: 8, flexShrink: 0 }}>
          <button
            onClick={onDone}
            style={{
              padding: "7px 16px", borderRadius: 6, border: "1px solid var(--color-border)",
              background: "var(--color-surface)", color: "var(--color-text-secondary)",
              fontSize: 13, fontWeight: 600, cursor: "pointer",
            }}
          >Skip</button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: "7px 18px", borderRadius: 6, border: "none",
              background: "var(--color-primary)", color: "#fff",
              fontSize: 13, fontWeight: 700, cursor: saving ? "wait" : "pointer", opacity: saving ? 0.7 : 1,
            }}
          >{saving ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}
