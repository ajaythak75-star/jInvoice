import { useEffect, useState, useMemo, useCallback } from "react";
import { supabase, isSupabaseEnabled } from "../../data/supabase";

interface Offer {
  id: string;
  itemName: string;
  merchantName: string | null;
  merchantPincode: string | null;
  unitPricePaise: number;
  invoiceDate: string | null;
}

function pincodeDistance(a: string, b: string): number {
  const na = parseInt(a, 10);
  const nb = parseInt(b, 10);
  if (isNaN(na) || isNaN(nb)) return Infinity;
  return Math.abs(na - nb);
}

function distanceLabel(diff: number): { text: string; color: string } {
  if (diff === 0)        return { text: "Same area",    color: "#16A34A" };
  if (diff <= 1000)      return { text: "Very near",    color: "#22C55E" };
  if (diff <= 5000)      return { text: "Nearby",       color: "#84CC16" };
  if (diff <= 20000)     return { text: "Same region",  color: "#EAB308" };
  return                        { text: "Far",          color: "#94A3B8" };
}

function formatPrice(paise: number): string {
  if (!paise) return "—";
  return "₹" + (paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

const CartIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
  </svg>
);

export function BuyScreen() {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [myPincode, setMyPincode] = useState(() => {
    try { return localStorage.getItem("buy_my_pincode") ?? ""; } catch { return ""; }
  });

  const load = useCallback(async () => {
    if (!supabase) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from("invoice_items")
        .select(`
          id,
          name,
          unit_price_paise,
          invoices (
            invoice_date,
            vendors ( name, pincode )
          )
        `)
        .order("unit_price_paise", { ascending: true })
        .limit(500);

      if (err) throw err;

      const result: Offer[] = (data ?? [])
        .filter((row: any) => row.name?.trim())
        .map((row: any) => {
          const inv = Array.isArray(row.invoices) ? row.invoices[0] : row.invoices;
          const vendor = inv ? (Array.isArray(inv.vendors) ? inv.vendors[0] : inv.vendors) : null;
          return {
            id: String(row.id),
            itemName: row.name.trim(),
            merchantName: vendor?.name ?? null,
            merchantPincode: vendor?.pincode ?? null,
            unitPricePaise: row.unit_price_paise ?? 0,
            invoiceDate: inv?.invoice_date ?? null,
          };
        });

      setOffers(result);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load from Supabase");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handlePincodeChange = (val: string) => {
    const clean = val.replace(/\D/g, "").slice(0, 6);
    setMyPincode(clean);
    try { localStorage.setItem("buy_my_pincode", clean); } catch {}
  };

  const lowestPriceMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of offers) {
      if (!o.unitPricePaise) continue;
      const key = o.itemName.toLowerCase();
      const cur = m.get(key);
      if (cur === undefined || o.unitPricePaise < cur) m.set(key, o.unitPricePaise);
    }
    return m;
  }, [offers]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    const base = q ? offers.filter((o) => o.itemName.toLowerCase().includes(q)) : offers;
    const pinValid = myPincode.length === 6;
    return [...base].sort((a, b) => {
      if (pinValid) {
        const da = pincodeDistance(myPincode, a.merchantPincode ?? "");
        const db2 = pincodeDistance(myPincode, b.merchantPincode ?? "");
        if (da !== db2) return da - db2;
      }
      return a.unitPricePaise - b.unitPricePaise;
    });
  }, [offers, search, myPincode]);

  const pinValid = myPincode.length === 6;

  const headerStyle: React.CSSProperties = {
    padding: "20px 24px 0",
    borderBottom: "1px solid var(--color-border)",
    background: "var(--color-surface)",
  };
  const toolbarStyle: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: 10, paddingBottom: 14, flexWrap: "wrap",
  };
  const inputStyle: React.CSSProperties = {
    padding: "7px 11px", borderRadius: 8, border: "1px solid var(--color-border)",
    background: "var(--color-surface-2)", color: "var(--color-text)", fontSize: 13,
    outline: "none",
  };
  const listStyle: React.CSSProperties = {
    flex: 1, overflowY: "auto", padding: "12px 24px 24px",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--color-surface-2)" }}>
      <div style={headerStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <span style={{ color: "var(--color-primary)" }}><CartIcon /></span>
          <h1 style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text)" }}>Buy / Order</h1>
          {!loading && (
            <span style={{ fontSize: 12, color: "var(--color-text-tertiary)", marginLeft: 4 }}>
              {filtered.length} offer{filtered.length !== 1 ? "s" : ""}
            </span>
          )}
          <button
            onClick={load}
            disabled={loading}
            style={{ marginLeft: "auto", fontSize: 12, padding: "4px 10px", borderRadius: 6, border: "1px solid var(--color-border)", background: "transparent", color: "var(--color-text-secondary)", cursor: "pointer" }}
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
        <div style={toolbarStyle}>
          <input
            style={{ ...inputStyle, width: 240 }}
            placeholder="Search items…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 12, color: "var(--color-text-secondary)", whiteSpace: "nowrap" }}>My pincode</span>
            <input
              style={{ ...inputStyle, width: 100, fontVariantNumeric: "tabular-nums" }}
              placeholder="110001"
              value={myPincode}
              maxLength={6}
              onChange={(e) => handlePincodeChange(e.target.value)}
            />
            {pinValid && (
              <span style={{ fontSize: 11, color: "#16A34A", fontWeight: 600 }}>✓ Distance on</span>
            )}
          </div>
          <span style={{ fontSize: 11.5, color: "var(--color-text-tertiary)", marginLeft: "auto" }}>
            Sorted by {pinValid ? "distance ↑ · price ↑" : "price ↑"} · Cloud
          </span>
        </div>
      </div>

      <div style={listStyle}>
        {!isSupabaseEnabled() && (
          <div style={{ textAlign: "center", color: "var(--color-text-tertiary)", paddingTop: 48, fontSize: 14 }}>
            Supabase not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env.
          </div>
        )}

        {isSupabaseEnabled() && loading && (
          <div style={{ textAlign: "center", color: "var(--color-text-tertiary)", paddingTop: 48, fontSize: 14 }}>
            Loading from cloud…
          </div>
        )}

        {isSupabaseEnabled() && !loading && error && (
          <div style={{ textAlign: "center", color: "#ef4444", paddingTop: 48, fontSize: 14 }}>
            {error}
          </div>
        )}

        {isSupabaseEnabled() && !loading && !error && offers.length === 0 && (
          <div style={{ textAlign: "center", color: "var(--color-text-tertiary)", paddingTop: 48, fontSize: 14 }}>
            No items in cloud yet. Save invoices to cloud first.
          </div>
        )}

        {isSupabaseEnabled() && !loading && !error && offers.length > 0 && filtered.length === 0 && (
          <div style={{ textAlign: "center", color: "var(--color-text-tertiary)", paddingTop: 48, fontSize: 14 }}>
            No items match "{search}".
          </div>
        )}

        {isSupabaseEnabled() && !loading && !error && filtered.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {filtered.map((offer) => {
              const isLowest = offer.unitPricePaise > 0 && offer.unitPricePaise === lowestPriceMap.get(offer.itemName.toLowerCase());
              const diff = pinValid && offer.merchantPincode
                ? pincodeDistance(myPincode, offer.merchantPincode)
                : null;
              const dist = diff !== null ? distanceLabel(diff) : null;

              return (
                <div
                  key={offer.id}
                  style={{
                    background: "var(--color-surface)",
                    border: `1px solid ${isLowest ? "var(--color-primary)" : "var(--color-border)"}`,
                    borderRadius: 10,
                    padding: "10px 14px",
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    boxShadow: "var(--shadow-card)",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                      <span style={{
                        fontSize: 13.5, fontWeight: 600, color: "var(--color-text)",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>
                        {offer.itemName}
                      </span>
                      {isLowest && (
                        <span style={{
                          fontSize: 10, fontWeight: 700, color: "#fff",
                          background: "var(--color-primary)", borderRadius: 4,
                          padding: "1px 5px", flexShrink: 0, letterSpacing: "0.03em",
                        }}>
                          BEST PRICE
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <span>{offer.merchantName ?? "Unknown merchant"}</span>
                      {offer.merchantPincode && (
                        <span style={{ color: "var(--color-text-tertiary)" }}>📍 {offer.merchantPincode}</span>
                      )}
                      <span style={{ color: "var(--color-text-tertiary)" }}>{formatDate(offer.invoiceDate)}</span>
                    </div>
                  </div>

                  {dist && (
                    <span style={{
                      fontSize: 11, fontWeight: 600, color: dist.color,
                      background: dist.color + "18",
                      borderRadius: 6, padding: "3px 8px", flexShrink: 0, whiteSpace: "nowrap",
                    }}>
                      {dist.text}
                    </span>
                  )}

                  <span style={{
                    fontSize: 15, fontWeight: 700, color: "var(--color-text)",
                    fontVariantNumeric: "tabular-nums", flexShrink: 0, minWidth: 80, textAlign: "right",
                  }}>
                    {formatPrice(offer.unitPricePaise)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
