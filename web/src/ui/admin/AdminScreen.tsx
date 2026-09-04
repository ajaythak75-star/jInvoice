import { useState, useEffect, useCallback } from "react";
import { auth } from "../../data/AuthStore";

interface UserPlan {
  email: string;
  plan: "free" | "pro_trial" | "pro_paid";
  status: string;
  trial_used: boolean;
  trial_ends_at: string | null;
  paid_until: string | null;
  cancelled_at: string | null;
  updated_at: string;
}

interface PlanEvent {
  id: number;
  email: string;
  event: string;
  meta: Record<string, string>;
  created_at: string;
}

interface PricingConfig {
  shared: { monthly: number; yearly: number };
  own:    { monthly: number; yearly: number };
}

interface UploadLimitsConfig {
  free: number;
  pro_trial: number;
  pro_paid: number;
}

interface ProfileEnabledConfig {
  personal: boolean; society: boolean; shopkeeper: boolean;
  tax_consultant: boolean; ca: boolean; real_estate: boolean;
  advocate: boolean; bookkeeper: boolean; freelancer: boolean; ngo: boolean;
}

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (auth.token) h["Authorization"] = `Bearer ${auth.token}`;
  return h;
}

function PlanBadge({ plan, status }: { plan: string; status: string }) {
  const cfg =
    plan === "pro_paid" ? { label: "Pro Paid", bg: "#4f46e520", color: "#4f46e5" } :
    plan === "pro_trial" ? { label: "Trial",    bg: "#f59e0b20", color: "#d97706" } :
    status === "cancelled" ? { label: "Cancelled", bg: "#ef444420", color: "#ef4444" } :
    { label: "Free", bg: "var(--color-border)", color: "var(--color-text-secondary)" };
  return (
    <span style={{ background: cfg.bg, color: cfg.color, borderRadius: 4, padding: "2px 7px", fontWeight: 600, fontSize: 11 }}>
      {cfg.label}
    </span>
  );
}

function ActionBtn({ label, color, onClick }: { label: string; color: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      fontSize: 11, padding: "3px 8px", borderRadius: 4,
      border: `1px solid ${color}`, color, background: "transparent", cursor: "pointer",
      whiteSpace: "nowrap",
    }}>{label}</button>
  );
}

type AdminTab = "users" | "pricing" | "limits" | "profiles";

const TAB_LABELS: { id: AdminTab; label: string }[] = [
  { id: "users",    label: "Users" },
  { id: "pricing",  label: "Pricing" },
  { id: "limits",   label: "Upload Limits" },
  { id: "profiles", label: "Profiles" },
];

// ── Users tab ────────────────────────────────────────────────────────────────

function UsersTab() {
  const [users, setUsers]               = useState<UserPlan[]>([]);
  const [loading, setLoading]           = useState(true);
  const [addEmail, setAddEmail]         = useState("");
  const [addError, setAddError]         = useState<string | null>(null);
  const [addLoading, setAddLoading]     = useState(false);
  const [selectedEmail, setSelectedEmail] = useState<string | null>(null);
  const [events, setEvents]             = useState<PlanEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/users", { headers: authHeaders() });
      setUsers(await r.json());
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const loadEvents = async (email: string) => {
    setSelectedEmail(email);
    setEventsLoading(true);
    try {
      const r = await fetch(`/api/admin/users/${encodeURIComponent(email)}/events`, { headers: authHeaders() });
      setEvents(await r.json());
    } finally { setEventsLoading(false); }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddError(null);
    const trimmed = addEmail.trim();
    if (!trimmed || !trimmed.includes("@")) { setAddError("Enter a valid email address."); return; }
    setAddLoading(true);
    try {
      const r = await fetch("/api/admin/users/add", {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({ email: trimmed }),
      });
      if (!r.ok) { const d = await r.json(); setAddError(d.error ?? "Failed to add user."); return; }
      setAddEmail("");
      await loadUsers();
    } catch { setAddError("Network error. Try again."); }
    finally { setAddLoading(false); }
  };

  const handleSetPlan = async (email: string, plan: string) => {
    const key = `${email}:${plan}`;
    setActionLoading(key);
    try {
      await fetch(`/api/admin/users/${encodeURIComponent(email)}/plan`, {
        method: "PATCH", headers: authHeaders(),
        body: JSON.stringify({ plan }),
      });
      await loadUsers();
      if (selectedEmail === email) await loadEvents(email);
    } finally { setActionLoading(null); }
  };

  const handleRevoke = async (email: string) => {
    if (!window.confirm(`Remove ${email} from allowed users?\n\nThey will no longer be able to log in.`)) return;
    setActionLoading(`${email}:revoke`);
    try {
      await fetch(`/api/admin/users/${encodeURIComponent(email)}/access`, {
        method: "DELETE", headers: authHeaders(),
      });
      await loadUsers();
      if (selectedEmail === email) setSelectedEmail(null);
    } finally { setActionLoading(null); }
  };

  const fmtDate     = (d: string | null) => d ? new Date(d).toLocaleDateString("en-IN") : "—";
  const fmtDateTime = (d: string) => new Date(d).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });

  return (
    <>
      <form onSubmit={handleAdd} style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <input
          type="email" className="auth-input"
          placeholder="user@example.com"
          value={addEmail} onChange={(e) => setAddEmail(e.target.value)}
          style={{ flex: 1, minWidth: 220, maxWidth: 340 }}
          disabled={addLoading}
        />
        <button className="btn-primary" type="submit" disabled={addLoading} style={{ whiteSpace: "nowrap" }}>
          {addLoading ? "Adding…" : "+ Add User"}
        </button>
      </form>
      {addError && <p style={{ margin: "0 0 16px", fontSize: 13, color: "#ef4444" }}>{addError}</p>}

      <div style={{ display: "flex", gap: 20, alignItems: "flex-start", marginTop: 20 }}>
        <div style={{ flex: 1, minWidth: 0, overflowX: "auto" }}>
          {loading ? (
            <p style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>Loading…</p>
          ) : users.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>No users yet. Add one above.</p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "2px solid var(--color-border)" }}>
                  {["Email", "Plan", "Trial ends / Paid until", "Last updated", "Actions"].map((h) => (
                    <th key={h} style={{ padding: "8px 10px", textAlign: "left", fontWeight: 600, color: "var(--color-text-secondary)", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const isSelected = selectedEmail === u.email;
                  return (
                    <tr key={u.email}
                      style={{ borderBottom: "1px solid var(--color-border)", background: isSelected ? "rgba(79,70,229,0.05)" : "transparent", cursor: "pointer" }}
                      onClick={() => loadEvents(u.email)}
                    >
                      <td style={{ padding: "10px 10px", fontWeight: isSelected ? 600 : 400 }}>{u.email}</td>
                      <td style={{ padding: "10px 10px" }}><PlanBadge plan={u.plan} status={u.status} /></td>
                      <td style={{ padding: "10px 10px", color: "var(--color-text-secondary)" }}>
                        {u.plan === "pro_trial" ? fmtDate(u.trial_ends_at) : u.plan === "pro_paid" ? fmtDate(u.paid_until) : "—"}
                      </td>
                      <td style={{ padding: "10px 10px", color: "var(--color-text-secondary)" }}>{fmtDate(u.updated_at)}</td>
                      <td style={{ padding: "10px 10px" }} onClick={(e) => e.stopPropagation()}>
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                          {u.plan !== "pro_trial" && <ActionBtn label={actionLoading === `${u.email}:pro_trial` ? "…" : "Trial"} color="#d97706" onClick={() => handleSetPlan(u.email, "pro_trial")} />}
                          {u.plan !== "pro_paid"  && <ActionBtn label={actionLoading === `${u.email}:pro_paid`  ? "…" : "Pro"}   color="#4f46e5" onClick={() => handleSetPlan(u.email, "pro_paid")} />}
                          {u.plan !== "free"      && <ActionBtn label={actionLoading === `${u.email}:free`      ? "…" : "Free"}  color="#6b7280" onClick={() => handleSetPlan(u.email, "free")} />}
                          <ActionBtn label={actionLoading === `${u.email}:revoke` ? "…" : "Revoke"} color="#ef4444" onClick={() => handleRevoke(u.email)} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--color-text-secondary)" }}>
            {users.length} user{users.length !== 1 ? "s" : ""}
          </p>
        </div>

        {selectedEmail && (
          <div style={{ width: 280, flexShrink: 0, borderLeft: "1px solid var(--color-border)", paddingLeft: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700 }}>Plan History</h3>
              <button onClick={() => setSelectedEmail(null)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-secondary)", fontSize: 18, lineHeight: 1, padding: 0 }}>×</button>
            </div>
            <p style={{ fontSize: 12, color: "var(--color-text-secondary)", margin: "0 0 14px", wordBreak: "break-all" }}>{selectedEmail}</p>
            {eventsLoading ? (
              <p style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>Loading…</p>
            ) : events.length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>No events recorded yet.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {events.map((ev) => (
                  <div key={ev.id} style={{
                    fontSize: 12, padding: "8px 10px", borderRadius: 6,
                    background: "var(--color-bg-secondary, rgba(0,0,0,0.04))",
                    borderLeft: "3px solid " + (
                      ev.event === "pro_activated" ? "#4f46e5" :
                      ev.event === "trial_started" ? "#f59e0b" :
                      ev.event === "cancelled"     ? "#ef4444" : "#6b7280"
                    ),
                  }}>
                    <div style={{ fontWeight: 600, textTransform: "capitalize", marginBottom: 2 }}>{ev.event.replace(/_/g, " ")}</div>
                    <div style={{ color: "var(--color-text-secondary)" }}>{fmtDateTime(ev.created_at)}</div>
                    {Object.keys(ev.meta).length > 0 && (
                      <div style={{ marginTop: 4, color: "var(--color-text-secondary)" }}>
                        {Object.entries(ev.meta).map(([k, v]) => (
                          <div key={k}><span style={{ fontWeight: 500 }}>{k.replace(/_/g, " ")}:</span> {String(v)}</div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

// ── Pricing tab ───────────────────────────────────────────────────────────────

function PricingTab() {
  const [cfg, setCfg]       = useState<PricingConfig | null>(null);
  const [draft, setDraft]   = useState<PricingConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);
  const [error, setError]   = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/config/plan_pricing", { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => { setCfg(d); setDraft(d); });
  }, []);

  // Yearly = monthly × 10 (2 months free). Only monthly is editable.
  const setMonthly = (tier: "shared" | "own", val: string) => {
    const monthly = Number(val) || 0;
    const yearly  = Math.round(monthly * 10);
    setDraft((prev) => prev ? { ...prev, [tier]: { monthly, yearly } } : prev);
    setSaved(false);
  };

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true); setError(null);
    try {
      const r = await fetch("/api/admin/config/plan_pricing", {
        method: "PUT", headers: authHeaders(), body: JSON.stringify(draft),
      });
      if (!r.ok) { setError("Save failed."); return; }
      setCfg(draft); setSaved(true);
    } catch { setError("Network error."); }
    finally { setSaving(false); }
  };

  const inp: React.CSSProperties = {
    padding: "8px 10px", borderRadius: 6, border: "1px solid var(--color-border)",
    background: "var(--color-surface-2)", color: "var(--color-text)",
    fontSize: 14, width: "100%", boxSizing: "border-box",
  };
  const label: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4, display: "block" };
  const card: React.CSSProperties = { border: "1px solid var(--color-border)", borderRadius: 10, padding: "18px 20px", background: "var(--color-surface)" };

  if (!draft) return <p style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>Loading…</p>;

  const rows: { tier: "shared" | "own"; title: string; desc: string }[] = [
    { tier: "shared", title: "Shared API Plan", desc: "jInvoice provides the Gemini API key" },
    { tier: "own",    title: "Own API Key Plan", desc: "User brings their own Gemini API key" },
  ];

  return (
    <div style={{ maxWidth: 560 }}>
      <p style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 20 }}>
        Prices shown to users on the Pricing screen (in ₹, paisa omitted). Changes take effect immediately.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {rows.map(({ tier, title, desc }) => (
          <div key={tier} style={card}>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{title}</div>
              <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 2 }}>{desc}</div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div>
                <label style={label}>Monthly price (₹)</label>
                <input style={inp} type="number" min={0} value={draft[tier].monthly}
                  onChange={(e) => setMonthly(tier, e.target.value)} />
              </div>
              <div>
                <label style={{ ...label, color: "var(--color-text-secondary)" }}>
                  Yearly price (₹) <span style={{ fontWeight: 400, textTransform: "none", fontSize: 10 }}>— auto (10 months)</span>
                </label>
                <input style={{ ...inp, opacity: 0.55, cursor: "not-allowed" }} type="number" value={draft[tier].yearly} disabled />
              </div>
            </div>
            {draft[tier].monthly > 0 && (
              <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: 10 }}>
                Yearly saves ₹{(draft[tier].monthly * 12) - draft[tier].yearly}/yr · effective ₹{Math.round(draft[tier].yearly / 12)}/month
              </div>
            )}
          </div>
        ))}
      </div>
      <div style={{ marginTop: 20, display: "flex", alignItems: "center", gap: 12 }}>
        <button className="btn-primary" onClick={handleSave} disabled={saving || JSON.stringify(draft) === JSON.stringify(cfg)}>
          {saving ? "Saving…" : "Save Pricing"}
        </button>
        {saved  && <span style={{ fontSize: 13, color: "#16a34a" }}>✓ Saved</span>}
        {error  && <span style={{ fontSize: 13, color: "#ef4444" }}>{error}</span>}
      </div>
    </div>
  );
}

// ── Upload Limits tab ─────────────────────────────────────────────────────────

function UploadLimitsTab() {
  const [cfg, setCfg]       = useState<UploadLimitsConfig | null>(null);
  const [draft, setDraft]   = useState<UploadLimitsConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);
  const [error, setError]   = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/config/upload_limits", { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => { setCfg(d); setDraft(d); });
  }, []);

  const set = (key: keyof UploadLimitsConfig, val: string) => {
    setDraft((prev) => prev ? { ...prev, [key]: Number(val) } : prev);
    setSaved(false);
  };

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true); setError(null);
    try {
      const r = await fetch("/api/admin/config/upload_limits", {
        method: "PUT", headers: authHeaders(), body: JSON.stringify(draft),
      });
      if (!r.ok) { setError("Save failed."); return; }
      setCfg(draft); setSaved(true);
    } catch { setError("Network error."); }
    finally { setSaving(false); }
  };

  const inp: React.CSSProperties = {
    padding: "8px 10px", borderRadius: 6, border: "1px solid var(--color-border)",
    background: "var(--color-surface-2)", color: "var(--color-text)",
    fontSize: 14, width: "100%", boxSizing: "border-box",
  };
  const label: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4, display: "block" };

  if (!draft) return <p style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>Loading…</p>;

  const rows: { key: keyof UploadLimitsConfig; label: string; badge: string; badgeColor: string }[] = [
    { key: "free",      label: "Free plan",       badge: "Free",    badgeColor: "#6b7280" },
    { key: "pro_trial", label: "Pro Trial plan",  badge: "Trial",   badgeColor: "#d97706" },
    { key: "pro_paid",  label: "Pro Paid plan",   badge: "Pro",     badgeColor: "#4f46e5" },
  ];

  return (
    <div style={{ maxWidth: 480 }}>
      <p style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 20 }}>
        Max invoices a user can upload per day per plan. Set to <strong>-1</strong> for unlimited.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {rows.map(({ key, label: rowLabel, badge, badgeColor }) => (
          <div key={key} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", border: "1px solid var(--color-border)", borderRadius: 10, background: "var(--color-surface)" }}>
            <div style={{ flex: 1 }}>
              <span style={{ background: `${badgeColor}20`, color: badgeColor, borderRadius: 4, padding: "2px 8px", fontWeight: 600, fontSize: 11, marginRight: 8 }}>{badge}</span>
              <span style={{ fontSize: 13, color: "var(--color-text)" }}>{rowLabel}</span>
            </div>
            <div style={{ width: 110 }}>
              <label style={label}>Uploads/day</label>
              <input style={inp} type="number" min={-1} value={draft[key]}
                onChange={(e) => set(key, e.target.value)} />
            </div>
            <div style={{ fontSize: 12, color: "var(--color-text-secondary)", width: 70 }}>
              {draft[key] === -1 ? "Unlimited" : `${draft[key]}/day`}
            </div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 20, display: "flex", alignItems: "center", gap: 12 }}>
        <button className="btn-primary" onClick={handleSave} disabled={saving || JSON.stringify(draft) === JSON.stringify(cfg)}>
          {saving ? "Saving…" : "Save Limits"}
        </button>
        {saved  && <span style={{ fontSize: 13, color: "#16a34a" }}>✓ Saved</span>}
        {error  && <span style={{ fontSize: 13, color: "#ef4444" }}>{error}</span>}
      </div>
    </div>
  );
}

// ── Profiles tab ──────────────────────────────────────────────────────────────

const PROFILE_META: { key: keyof ProfileEnabledConfig; label: string; desc: string }[] = [
  { key: "personal",     label: "Personal",           desc: "Individual expense tracking" },
  { key: "society",      label: "Housing Society",    desc: "Society maintenance & common expenses" },
  { key: "shopkeeper",   label: "Shopkeeper",         desc: "Purchase & inventory bills" },
  { key: "tax_consultant", label: "Tax Consultant",   desc: "Client filing & compliance" },
  { key: "ca",           label: "CA / Accountant",    desc: "Audit, GST, TDS work" },
  { key: "real_estate",  label: "Real Estate Agent",  desc: "Property deals & commissions" },
  { key: "advocate",     label: "Advocate / Lawyer",  desc: "Court & professional expenses" },
  { key: "bookkeeper",   label: "Bookkeeper",         desc: "Multi-client ledger management" },
  { key: "freelancer",   label: "Freelancer",         desc: "Project & software expenses" },
  { key: "ngo",          label: "NGO / Trust / Society", desc: "Charitable & grant expenses" },
];

function ProfilesTab() {
  const [cfg, setCfg]       = useState<ProfileEnabledConfig | null>(null);
  const [draft, setDraft]   = useState<ProfileEnabledConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);
  const [error, setError]   = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/config/profile_enabled", { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => { setCfg(d); setDraft(d); });
  }, []);

  const toggle = (key: keyof ProfileEnabledConfig) => {
    setDraft((prev) => prev ? { ...prev, [key]: !prev[key] } : prev);
    setSaved(false);
  };

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true); setError(null);
    try {
      const r = await fetch("/api/admin/config/profile_enabled", {
        method: "PUT", headers: authHeaders(), body: JSON.stringify(draft),
      });
      if (!r.ok) { setError("Save failed."); return; }
      setCfg(draft); setSaved(true);
    } catch { setError("Network error."); }
    finally { setSaving(false); }
  };

  if (!draft) return <p style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>Loading…</p>;

  const enabledCount = Object.values(draft).filter(Boolean).length;

  return (
    <div style={{ maxWidth: 560 }}>
      <p style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 20 }}>
        Control which profile types users can select during onboarding. Disabled profiles are hidden from the profile picker.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {PROFILE_META.map(({ key, label, desc }) => {
          const on = draft[key];
          return (
            <label key={key} style={{
              display: "flex", alignItems: "center", gap: 14,
              padding: "12px 16px", border: "1px solid var(--color-border)",
              borderRadius: 10, cursor: "pointer",
              background: on ? "rgba(79,70,229,0.04)" : "var(--color-surface)",
              borderColor: on ? "#4f46e540" : "var(--color-border)",
              transition: "background 0.15s, border-color 0.15s",
            }}>
              <input type="checkbox" checked={on} onChange={() => toggle(key)}
                style={{ width: 16, height: 16, accentColor: "#4f46e5", cursor: "pointer", flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: on ? "var(--color-text)" : "var(--color-text-secondary)" }}>{label}</div>
                <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: 1 }}>{desc}</div>
              </div>
              <span style={{
                fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 4,
                background: on ? "#4f46e520" : "#6b728020",
                color: on ? "#4f46e5" : "#6b7280",
              }}>{on ? "ENABLED" : "DISABLED"}</span>
            </label>
          );
        })}
      </div>
      <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 10 }}>
        {enabledCount} of {PROFILE_META.length} profiles enabled
      </p>
      <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 12 }}>
        <button className="btn-primary" onClick={handleSave} disabled={saving || JSON.stringify(draft) === JSON.stringify(cfg)}>
          {saving ? "Saving…" : "Save Profiles"}
        </button>
        {saved  && <span style={{ fontSize: 13, color: "#16a34a" }}>✓ Saved</span>}
        {error  && <span style={{ fontSize: 13, color: "#ef4444" }}>{error}</span>}
      </div>
    </div>
  );
}

// ── Main AdminScreen ──────────────────────────────────────────────────────────

export function AdminScreen() {
  const [tab, setTab] = useState<AdminTab>("users");

  const tabBtn = (id: AdminTab): React.CSSProperties => ({
    padding: "7px 16px", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600,
    borderRadius: 6,
    background: tab === id ? "#4f46e5" : "transparent",
    color: tab === id ? "#fff" : "var(--color-text-secondary)",
    transition: "background 0.15s, color 0.15s",
  });

  return (
    <div style={{ padding: "24px 20px", maxWidth: 1000, margin: "0 auto" }}>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Admin Panel</h2>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--color-text-secondary)" }}>
          Manage users, pricing, upload limits, and available profiles.
        </p>
      </div>

      {/* Tab bar */}
      <div style={{ display: "flex", gap: 4, marginBottom: 24, padding: "4px", background: "var(--color-surface-2)", borderRadius: 8, width: "fit-content" }}>
        {TAB_LABELS.map(({ id, label }) => (
          <button key={id} style={tabBtn(id)} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {tab === "users"    && <UsersTab />}
      {tab === "pricing"  && <PricingTab />}
      {tab === "limits"   && <UploadLimitsTab />}
      {tab === "profiles" && <ProfilesTab />}
    </div>
  );
}
