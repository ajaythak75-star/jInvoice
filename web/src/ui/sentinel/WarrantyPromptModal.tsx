import { useState } from "react";
import { updateSentinelExpiry, addManualSentinel } from "../../service/ExpirySentinel";

export interface WarrantyPromptItem {
  sentinelId: number | null;   // null = no sentinel yet, we'll create one
  invoiceId: number;
  productName: string;
  merchantName: string | null;
  expiresAt: string;           // pre-filled from auto-detection, or estimated from today+12mo
  invoiceDate: string | null;  // purchase date used as the warranty start
}

interface Props {
  items: WarrantyPromptItem[];
  onDone: () => void;
}

const MONTH_OPTIONS = [3, 6, 12, 24, 36, 60];

function addMonths(baseIso: string, months: number): string {
  const d = new Date(baseIso);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

function formatDateDisplay(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function monthsLabel(m: number): string {
  return m < 12 ? `${m}m` : `${m / 12}y`;
}

function initialMonths(expiresAt: string, invoiceDate: string | null): number {
  const base = invoiceDate ?? new Date().toISOString().slice(0, 10);
  const start = new Date(base).getTime();
  const end   = new Date(expiresAt).getTime();
  if (isNaN(start) || isNaN(end)) return 12;
  const diff = Math.round((end - start) / (1000 * 60 * 60 * 24 * 30.44));
  return diff > 0 ? diff : 12;
}

export function WarrantyPromptModal({ items, onDone }: Props) {
  const [months, setMonths] = useState<Record<number, number | null>>(() => {
    const init: Record<number, number | null> = {};
    items.forEach((it) => { init[it.invoiceId] = initialMonths(it.expiresAt, it.invoiceDate); });
    return init;
  });
  const [saving, setSaving] = useState(false);

  const computeExpiry = (it: WarrantyPromptItem, m: number | null): string | null => {
    if (m == null || m <= 0) return null;
    const base = it.invoiceDate ?? new Date().toISOString().slice(0, 10);
    return addMonths(base, m);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      for (const it of items) {
        const m = months[it.invoiceId];
        const newDate = computeExpiry(it, m);
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
    boxShadow: "0 8px 32px rgba(0,0,0,0.22)", width: "100%", maxWidth: 440,
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
                Select the warranty period from your warranty card.
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
        <div style={{ overflowY: "auto", flex: 1, padding: "12px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
          {items.map((it) => {
            const m = months[it.invoiceId] ?? null;
            const expiry = computeExpiry(it, m);
            const base = it.invoiceDate ?? new Date().toISOString().slice(0, 10);
            return (
              <div key={it.invoiceId} style={{ background: "var(--color-surface-2)", borderRadius: 8, padding: "12px 14px" }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text)", marginBottom: 2,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={it.productName}>
                  {it.productName}
                </div>
                {it.merchantName && (
                  <div style={{ fontSize: 11.5, color: "var(--color-text-secondary)", marginBottom: 10 }}>
                    {it.merchantName}
                  </div>
                )}

                {/* Start date info */}
                <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginBottom: 8 }}>
                  From: <strong style={{ color: "var(--color-text-secondary)" }}>{formatDateDisplay(base)}</strong>
                </div>

                {/* Pill buttons */}
                <div style={{ marginBottom: 8 }}>
                  <div style={{ ...labelStyle, marginBottom: 6 }}>Warranty period</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {MONTH_OPTIONS.map((opt) => {
                      const selected = m === opt;
                      return (
                        <button
                          key={opt}
                          onClick={() => setMonths((prev) => ({ ...prev, [it.invoiceId]: opt }))}
                          style={{
                            padding: "5px 13px", borderRadius: 20, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                            border: selected ? "2px solid var(--color-primary)" : "1px solid var(--color-border)",
                            background: selected ? "var(--accent-subtle)" : "var(--color-surface)",
                            color: selected ? "var(--color-primary)" : "var(--color-text-secondary)",
                            transition: "all 0.12s",
                          }}
                        >
                          {monthsLabel(opt)}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Custom months input */}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={labelStyle}>Custom (months)</span>
                  <input
                    type="number"
                    min={1}
                    max={360}
                    value={m ?? ""}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      setMonths((prev) => ({ ...prev, [it.invoiceId]: isNaN(val) || val <= 0 ? null : val }));
                    }}
                    style={{
                      width: 68, fontSize: 12, padding: "4px 8px", borderRadius: 5,
                      border: "1px solid var(--color-border)",
                      background: "var(--color-surface)", color: "var(--color-text)",
                    }}
                    placeholder="e.g. 18"
                  />
                </div>

                {/* Expiry preview */}
                {expiry && (
                  <div style={{ marginTop: 10, fontSize: 12, color: "var(--color-text-secondary)" }}>
                    Expires on: <strong style={{ color: "var(--color-text)" }}>{formatDateDisplay(expiry)}</strong>
                  </div>
                )}

                {it.sentinelId == null && (
                  <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 4 }}>
                    No warranty was auto-detected — set period to track it.
                  </div>
                )}
              </div>
            );
          })}
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
