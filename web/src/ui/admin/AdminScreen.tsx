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
  cloud_upload_enabled?: boolean;
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

type ProfileCloudUploadConfig = ProfileEnabledConfig;

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

type AdminTab = "users" | "pricing" | "limits" | "profiles" | "settings";
type AdminRole = "super_admin" | "admin" | null;

const ALL_TABS: { id: AdminTab; label: string; superOnly: boolean }[] = [
  { id: "users",    label: "Users",         superOnly: false },
  { id: "pricing",  label: "Pricing",        superOnly: true  },
  { id: "limits",   label: "Upload Limits",  superOnly: true  },
  { id: "profiles", label: "Profiles",       superOnly: true  },
  { id: "settings", label: "Plan Settings",  superOnly: true  },
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

  const handleToggleCloudUpload = async (email: string, enabled: boolean) => {
    setActionLoading(`${email}:cloud`);
    try {
      await fetch(`/api/admin/users/${encodeURIComponent(email)}/features`, {
        method: "PATCH", headers: authHeaders(),
        body: JSON.stringify({ cloud_upload_enabled: enabled }),
      });
      await loadUsers();
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
                  {["Email", "Plan", "Trial ends / Paid until", "Last updated", "Cloud Upload", "Actions"].map((h) => (
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
                        {(() => {
                          const enabled = u.cloud_upload_enabled !== false;
                          const loading = actionLoading === `${u.email}:cloud`;
                          return (
                            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: loading ? "wait" : "pointer" }}>
                              <input
                                type="checkbox"
                                checked={enabled}
                                disabled={loading}
                                onChange={() => handleToggleCloudUpload(u.email, !enabled)}
                                style={{ width: 14, height: 14, accentColor: "#4f46e5", cursor: "pointer" }}
                              />
                              <span style={{ fontSize: 11, color: enabled ? "#16a34a" : "#ef4444", fontWeight: 600 }}>
                                {loading ? "…" : enabled ? "On" : "Off"}
                              </span>
                            </label>
                          );
                        })()}
                      </td>
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
  const [cfg, setCfg]               = useState<ProfileEnabledConfig | null>(null);
  const [draft, setDraft]           = useState<ProfileEnabledConfig | null>(null);
  const [cloudCfg, setCloudCfg]     = useState<ProfileCloudUploadConfig | null>(null);
  const [cloudDraft, setCloudDraft] = useState<ProfileCloudUploadConfig | null>(null);
  const [saving, setSaving]         = useState(false);
  const [saved, setSaved]           = useState(false);
  const [error, setError]           = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/admin/config/profile_enabled",      { headers: authHeaders() }).then((r) => r.json()),
      fetch("/api/admin/config/profile_cloud_upload", { headers: authHeaders() }).then((r) => r.json()),
    ]).then(([pe, pcu]) => {
      setCfg(pe);      setDraft(pe);
      setCloudCfg(pcu); setCloudDraft(pcu);
    });
  }, []);

  const toggle = (key: keyof ProfileEnabledConfig) => {
    setDraft((prev) => prev ? { ...prev, [key]: !prev[key] } : prev);
    setSaved(false);
  };

  const toggleCloud = (key: keyof ProfileCloudUploadConfig) => {
    setCloudDraft((prev) => prev ? { ...prev, [key]: !prev[key] } : prev);
    setSaved(false);
  };

  const handleSave = async () => {
    if (!draft || !cloudDraft) return;
    setSaving(true); setError(null);
    try {
      const [r1, r2] = await Promise.all([
        fetch("/api/admin/config/profile_enabled",      { method: "PUT", headers: authHeaders(), body: JSON.stringify(draft) }),
        fetch("/api/admin/config/profile_cloud_upload", { method: "PUT", headers: authHeaders(), body: JSON.stringify(cloudDraft) }),
      ]);
      if (!r1.ok || !r2.ok) { setError("Save failed."); return; }
      setCfg(draft); setCloudCfg(cloudDraft); setSaved(true);
    } catch { setError("Network error."); }
    finally { setSaving(false); }
  };

  if (!draft || !cloudDraft) return <p style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>Loading…</p>;

  const enabledCount = Object.values(draft).filter(Boolean).length;
  const isDirty = JSON.stringify(draft) !== JSON.stringify(cfg) || JSON.stringify(cloudDraft) !== JSON.stringify(cloudCfg);

  const colHead: React.CSSProperties = {
    fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em",
    color: "var(--color-text-secondary)", textAlign: "center", padding: "0 10px",
  };

  return (
    <div style={{ maxWidth: 680 }}>
      <p style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 16 }}>
        Control which profile types users can select during onboarding. When Cloud Upload is disabled for a profile, all users of that type will have cloud upload blocked on their next sync.
      </p>

      {/* Column headers */}
      <div style={{ display: "flex", alignItems: "center", paddingLeft: 16, paddingRight: 16, marginBottom: 4 }}>
        <div style={{ flex: 1 }} />
        <div style={{ ...colHead, width: 80 }}>Visible</div>
        <div style={{ ...colHead, width: 100 }}>Cloud Upload</div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {PROFILE_META.map(({ key, label, desc }) => {
          const on       = draft[key];
          const cloudOn  = cloudDraft[key];
          return (
            <div key={key} style={{
              display: "flex", alignItems: "center", gap: 0,
              padding: "12px 16px", border: "1px solid var(--color-border)",
              borderRadius: 10,
              background: on ? "rgba(79,70,229,0.04)" : "var(--color-surface)",
              borderColor: on ? "#4f46e540" : "var(--color-border)",
              transition: "background 0.15s, border-color 0.15s",
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: on ? "var(--color-text)" : "var(--color-text-secondary)" }}>{label}</div>
                <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: 1 }}>{desc}</div>
              </div>

              {/* Visible checkbox */}
              <div style={{ width: 80, display: "flex", justifyContent: "center" }}>
                <label style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, cursor: "pointer" }}>
                  <input type="checkbox" checked={on} onChange={() => toggle(key)}
                    style={{ width: 16, height: 16, accentColor: "#4f46e5", cursor: "pointer" }} />
                  <span style={{ fontSize: 9, fontWeight: 700, color: on ? "#4f46e5" : "#6b7280" }}>
                    {on ? "ON" : "OFF"}
                  </span>
                </label>
              </div>

              {/* Cloud Upload checkbox */}
              <div style={{ width: 100, display: "flex", justifyContent: "center" }}>
                <label style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, cursor: "pointer" }}>
                  <input type="checkbox" checked={cloudOn} onChange={() => toggleCloud(key)}
                    style={{ width: 16, height: 16, accentColor: "#16a34a", cursor: "pointer" }} />
                  <span style={{ fontSize: 9, fontWeight: 700, color: cloudOn ? "#16a34a" : "#ef4444" }}>
                    {cloudOn ? "ALLOWED" : "BLOCKED"}
                  </span>
                </label>
              </div>
            </div>
          );
        })}
      </div>
      <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 10 }}>
        {enabledCount} of {PROFILE_META.length} profiles enabled
      </p>
      <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 12 }}>
        <button className="btn-primary" onClick={handleSave} disabled={saving || !isDirty}>
          {saving ? "Saving…" : "Save Profiles"}
        </button>
        {saved  && <span style={{ fontSize: 13, color: "#16a34a" }}>✓ Saved</span>}
        {error  && <span style={{ fontSize: 13, color: "#ef4444" }}>{error}</span>}
      </div>
    </div>
  );
}

// ── Plan Settings Tab ─────────────────────────────────────────────────────────

interface PlanSettingsConfig {
  trial_days: number;
  support_response: { free: string; pro_trial: string; pro: string };
}

const PLAN_SETTINGS_DEFAULT: PlanSettingsConfig = {
  trial_days: 14,
  support_response: { free: "7 days", pro_trial: "7 days", pro: "48 hours" },
};

function PlanSettingsTab() {
  const [cfg, setCfg]       = useState<PlanSettingsConfig | null>(null);
  const [draft, setDraft]   = useState<PlanSettingsConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);
  const [error, setError]   = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/config/plan_settings", { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => {
        const merged = { ...PLAN_SETTINGS_DEFAULT, ...d, support_response: { ...PLAN_SETTINGS_DEFAULT.support_response, ...(d.support_response ?? {}) } };
        setCfg(merged); setDraft(merged);
      });
  }, []);

  const setTrialDays = (v: string) => {
    const n = Math.max(1, parseInt(v, 10) || 1);
    setDraft((prev) => prev ? { ...prev, trial_days: n } : prev);
    setSaved(false);
  };

  const setSupport = (tier: keyof PlanSettingsConfig["support_response"], v: string) => {
    setDraft((prev) => prev ? { ...prev, support_response: { ...prev.support_response, [tier]: v } } : prev);
    setSaved(false);
  };

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true); setError(null);
    try {
      const r = await fetch("/api/admin/config/plan_settings", {
        method: "PUT", headers: authHeaders(), body: JSON.stringify(draft),
      });
      if (!r.ok) { setError("Save failed."); return; }
      setCfg(draft); setSaved(true);
    } catch { setError("Network error."); }
    finally { setSaving(false); }
  };

  if (!draft) return <p style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>Loading…</p>;

  const inp: React.CSSProperties = {
    padding: "7px 10px", borderRadius: 6, border: "1px solid var(--color-border)",
    background: "var(--color-bg)", color: "var(--color-text)", fontSize: 13, outline: "none",
  };
  const label: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em",
    color: "var(--color-text-secondary)", marginBottom: 5, display: "block",
  };

  return (
    <div style={{ maxWidth: 540 }}>
      <p style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 24 }}>
        Configure the free trial period length and support response time shown on the Pricing screen.
      </p>

      {/* Trial days */}
      <div style={{
        padding: "18px 20px", border: "1px solid var(--color-border)",
        borderRadius: 10, marginBottom: 20, background: "var(--color-surface)",
      }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--color-text)", marginBottom: 14 }}>
          Trial Period
        </div>
        <label style={label}>Number of trial days</label>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <input style={{ ...inp, width: 90 }} type="number" min={1} max={365}
            value={draft.trial_days} onChange={(e) => setTrialDays(e.target.value)} />
          <span style={{ fontSize: 12.5, color: "var(--color-text-secondary)" }}>days free trial for new Pro users</span>
        </div>
      </div>

      {/* Support response times */}
      <div style={{
        padding: "18px 20px", border: "1px solid var(--color-border)",
        borderRadius: 10, background: "var(--color-surface)",
      }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--color-text)", marginBottom: 14 }}>
          Support Response Time
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {([
            { tier: "free",      tierLabel: "Free plan" },
            { tier: "pro_trial", tierLabel: "Free Trial" },
            { tier: "pro",       tierLabel: "Pro (Shared & Own API)" },
          ] as { tier: keyof PlanSettingsConfig["support_response"]; tierLabel: string }[]).map(({ tier, tierLabel }) => (
            <div key={tier}>
              <label style={label}>{tierLabel}</label>
              <input style={{ ...inp, width: "100%" }}
                type="text" value={draft.support_response[tier]}
                placeholder="e.g. 48 hours"
                onChange={(e) => setSupport(tier, e.target.value)} />
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 12 }}>
        <button className="btn-primary" onClick={handleSave} disabled={saving || JSON.stringify(draft) === JSON.stringify(cfg)}>
          {saving ? "Saving…" : "Save Settings"}
        </button>
        {saved && <span style={{ fontSize: 13, color: "#16a34a" }}>✓ Saved</span>}
        {error && <span style={{ fontSize: 13, color: "#ef4444" }}>{error}</span>}
      </div>
    </div>
  );
}

// ── Main AdminScreen ──────────────────────────────────────────────────────────

export function AdminScreen() {
  const [tab,  setTab]  = useState<AdminTab>("users");
  const [role, setRole] = useState<AdminRole>(null);

  useEffect(() => {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (auth.token) h["Authorization"] = `Bearer ${auth.token}`;
    fetch("/api/admin/role", { headers: h })
      .then((r) => r.json())
      .then((d) => setRole(d.role ?? null))
      .catch(() => setRole(null));
  }, []);

  const visibleTabs = ALL_TABS.filter((t) => !t.superOnly || role === "super_admin");

  const tabBtn = (id: AdminTab): React.CSSProperties => ({
    padding: "7px 16px", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600,
    borderRadius: 6,
    background: tab === id ? "#4f46e5" : "transparent",
    color: tab === id ? "#fff" : "var(--color-text-secondary)",
    transition: "background 0.15s, color 0.15s",
  });

  const roleBadge = role === "super_admin"
    ? { label: "Super Admin", bg: "#4f46e520", color: "#4f46e5" }
    : role === "admin"
    ? { label: "Admin",       bg: "#f59e0b20", color: "#d97706" }
    : null;

  return (
    <div style={{ padding: "24px 20px", maxWidth: 1000, margin: "0 auto" }}>
      <div style={{ marginBottom: 20, display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Admin Panel</h2>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--color-text-secondary)" }}>
            {role === "super_admin"
              ? "Manage users, pricing, upload limits, profiles, and plan settings."
              : "Manage user access and plan assignments."}
          </p>
        </div>
        {roleBadge && (
          <span style={{
            fontSize: 11.5, fontWeight: 700, padding: "4px 10px", borderRadius: 20,
            background: roleBadge.bg, color: roleBadge.color,
            letterSpacing: "0.04em", textTransform: "uppercase", alignSelf: "center",
          }}>
            {roleBadge.label}
          </span>
        )}
      </div>

      {/* Tab bar */}
      <div style={{ display: "flex", gap: 4, marginBottom: 24, padding: "4px", background: "var(--color-surface-2)", borderRadius: 8, width: "fit-content" }}>
        {visibleTabs.map(({ id, label }) => (
          <button key={id} style={tabBtn(id)} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {tab === "users"    && <UsersTab />}
      {tab === "pricing"  && role === "super_admin" && <PricingTab />}
      {tab === "limits"   && role === "super_admin" && <UploadLimitsTab />}
      {tab === "profiles" && role === "super_admin" && <ProfilesTab />}
      {tab === "settings" && role === "super_admin" && <PlanSettingsTab />}
    </div>
  );
}
