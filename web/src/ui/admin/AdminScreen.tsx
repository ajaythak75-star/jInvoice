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

export function AdminScreen() {
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
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const loadEvents = async (email: string) => {
    setSelectedEmail(email);
    setEventsLoading(true);
    try {
      const r = await fetch(`/api/admin/users/${encodeURIComponent(email)}/events`, { headers: authHeaders() });
      setEvents(await r.json());
    } finally {
      setEventsLoading(false);
    }
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

  const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString("en-IN") : "—";
  const fmtDateTime = (d: string) => new Date(d).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });

  return (
    <div style={{ padding: "24px 20px", maxWidth: 1000, margin: "0 auto" }}>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Admin Panel</h2>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--color-text-secondary)" }}>
          Manage user access and plan overrides.
        </p>
      </div>

      {/* Add user */}
      <form onSubmit={handleAdd} style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <input
          type="email"
          className="auth-input"
          placeholder="user@example.com"
          value={addEmail}
          onChange={(e) => setAddEmail(e.target.value)}
          style={{ flex: 1, minWidth: 220, maxWidth: 340 }}
          disabled={addLoading}
        />
        <button className="btn-primary" type="submit" disabled={addLoading} style={{ whiteSpace: "nowrap" }}>
          {addLoading ? "Adding…" : "+ Add User"}
        </button>
      </form>
      {addError && (
        <p style={{ margin: "0 0 16px", fontSize: 13, color: "#ef4444" }}>{addError}</p>
      )}

      <div style={{ display: "flex", gap: 20, alignItems: "flex-start", marginTop: 20 }}>

        {/* Users table */}
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
                    <th key={h} style={{ padding: "8px 10px", textAlign: "left", fontWeight: 600, color: "var(--color-text-secondary)", whiteSpace: "nowrap" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const isSelected = selectedEmail === u.email;
                  return (
                    <tr
                      key={u.email}
                      style={{
                        borderBottom: "1px solid var(--color-border)",
                        background: isSelected ? "rgba(79,70,229,0.05)" : "transparent",
                        cursor: "pointer",
                      }}
                      onClick={() => loadEvents(u.email)}
                    >
                      <td style={{ padding: "10px 10px", fontWeight: isSelected ? 600 : 400 }}>{u.email}</td>
                      <td style={{ padding: "10px 10px" }}>
                        <PlanBadge plan={u.plan} status={u.status} />
                      </td>
                      <td style={{ padding: "10px 10px", color: "var(--color-text-secondary)" }}>
                        {u.plan === "pro_trial" ? fmtDate(u.trial_ends_at) :
                         u.plan === "pro_paid"  ? fmtDate(u.paid_until) : "—"}
                      </td>
                      <td style={{ padding: "10px 10px", color: "var(--color-text-secondary)" }}>
                        {fmtDate(u.updated_at)}
                      </td>
                      <td style={{ padding: "10px 10px" }} onClick={(e) => e.stopPropagation()}>
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                          {u.plan !== "pro_trial" && (
                            <ActionBtn label={actionLoading === `${u.email}:pro_trial` ? "…" : "Trial"}
                              color="#d97706"
                              onClick={() => handleSetPlan(u.email, "pro_trial")} />
                          )}
                          {u.plan !== "pro_paid" && (
                            <ActionBtn label={actionLoading === `${u.email}:pro_paid` ? "…" : "Pro"}
                              color="#4f46e5"
                              onClick={() => handleSetPlan(u.email, "pro_paid")} />
                          )}
                          {u.plan !== "free" && (
                            <ActionBtn label={actionLoading === `${u.email}:free` ? "…" : "Free"}
                              color="#6b7280"
                              onClick={() => handleSetPlan(u.email, "free")} />
                          )}
                          <ActionBtn label={actionLoading === `${u.email}:revoke` ? "…" : "Revoke"}
                            color="#ef4444"
                            onClick={() => handleRevoke(u.email)} />
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

        {/* Plan history panel */}
        {selectedEmail && (
          <div style={{
            width: 280, flexShrink: 0,
            borderLeft: "1px solid var(--color-border)",
            paddingLeft: 20,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700 }}>Plan History</h3>
              <button onClick={() => setSelectedEmail(null)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-secondary)", fontSize: 18, lineHeight: 1, padding: 0 }}>
                ×
              </button>
            </div>
            <p style={{ fontSize: 12, color: "var(--color-text-secondary)", margin: "0 0 14px", wordBreak: "break-all" }}>
              {selectedEmail}
            </p>
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
                    <div style={{ fontWeight: 600, textTransform: "capitalize", marginBottom: 2 }}>
                      {ev.event.replace(/_/g, " ")}
                    </div>
                    <div style={{ color: "var(--color-text-secondary)" }}>{fmtDateTime(ev.created_at)}</div>
                    {Object.keys(ev.meta).length > 0 && (
                      <div style={{ marginTop: 4, color: "var(--color-text-secondary)" }}>
                        {Object.entries(ev.meta).map(([k, v]) => (
                          <div key={k}>
                            <span style={{ fontWeight: 500 }}>{k.replace(/_/g, " ")}:</span> {String(v)}
                          </div>
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
    </div>
  );
}
