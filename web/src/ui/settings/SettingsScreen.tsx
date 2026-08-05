import { useState } from "react";
import { auth } from "../../data/AuthStore";
import { prefs } from "../../data/AutoImportPreferences";
import { clearAllData } from "../../data/InvoiceDatabase";

const LANGUAGE_OPTIONS = [
  { value: "en", label: "English" },
  { value: "hi", label: "Hindi" },
  { value: "ta", label: "Tamil" },
  { value: "te", label: "Telugu" },
  { value: "kn", label: "Kannada" },
  { value: "mr", label: "Marathi" },
  { value: "bn", label: "Bengali" },
  { value: "gu", label: "Gujarati" },
];

const SYNC_OPTIONS: { months: number; label: string; pro: boolean }[] = [
  { months: 1,  label: "1 month",  pro: false },
  { months: 3,  label: "3 months", pro: false },
  { months: 6,  label: "6 months", pro: true  },
  { months: 12, label: "1 year",   pro: true  },
];

const LANG_KEY = "jinvoice_language";

function getStoredLang(): string {
  return localStorage.getItem(LANG_KEY) ?? "en";
}

interface Props {
  onSignOut: () => void;
}

export function SettingsScreen({ onSignOut }: Props) {
  const [lang, setLang] = useState(getStoredLang);
  const [syncMonths, setSyncMonths] = useState(() => prefs.syncMonths);
  const [showProBanner, setShowProBanner] = useState(false);

  const [oldPwd,  setOldPwd]  = useState("");
  const [newPwd,  setNewPwd]  = useState("");
  const [confPwd, setConfPwd] = useState("");
  const [pwdMsg,  setPwdMsg]  = useState<{ ok: boolean; text: string } | null>(null);
  const [pwdBusy, setPwdBusy] = useState(false);

  const [resetConfirm, setResetConfirm] = useState(false);
  const [resetBusy,    setResetBusy]    = useState(false);
  const [resetMsg,     setResetMsg]     = useState<string | null>(null);

  const handleLang = (v: string) => {
    setLang(v);
    localStorage.setItem(LANG_KEY, v);
  };

  const handleSignOut = () => {
    auth.signOut();
    onSignOut();
  };

  const handleSyncSelect = (months: number, pro: boolean) => {
    if (pro && !prefs.isSubscribed) {
      setShowProBanner(true);
      return;
    }
    setShowProBanner(false);
    setSyncMonths(months);
    prefs.syncMonths = months;
  };

  const handleChangePwd = async () => {
    if (!newPwd || newPwd !== confPwd) {
      setPwdMsg({ ok: false, text: "New passwords do not match." });
      return;
    }
    if (newPwd.length < 8) {
      setPwdMsg({ ok: false, text: "Password must be at least 8 characters." });
      return;
    }
    setPwdBusy(true);
    const ok = await auth.changePassword(oldPwd, newPwd);
    setPwdBusy(false);
    if (ok) {
      setOldPwd(""); setNewPwd(""); setConfPwd("");
      setPwdMsg({ ok: true, text: "Password updated." });
    } else {
      setPwdMsg({ ok: false, text: "Current password is incorrect." });
    }
  };

  const handleReset = async () => {
    setResetBusy(true);
    setResetMsg(null);
    try {
      await clearAllData();
      setResetMsg("All data cleared.");
      setResetConfirm(false);
    } catch {
      setResetMsg("Reset failed. Please try again.");
    } finally {
      setResetBusy(false);
    }
  };

  return (
    <div className="settings-screen">

      <section className="settings-section">
        <div className="settings-section-title">Account</div>

        <div className="settings-row">
          <span className="settings-row-label">Email</span>
          <span className="settings-row-value">{auth.email ?? "—"}</span>
        </div>

        {auth.displayName && (
          <div className="settings-row">
            <span className="settings-row-label">Name</span>
            <span className="settings-row-value">{auth.displayName}</span>
          </div>
        )}

        <div className="settings-row">
          <span className="settings-row-label">Login via</span>
          <span className="settings-row-value">{auth.isGoogleAccount ? "Google" : "Email & password"}</span>
        </div>

        <div className="settings-row settings-row--action">
          <button className="btn-ghost settings-signout" onClick={handleSignOut}>Sign out</button>
        </div>
      </section>

      {!auth.isGoogleAccount && (
        <section className="settings-section">
          <div className="settings-section-title">Change Password</div>

          <div className="settings-field">
            <label className="settings-field-label">Current password</label>
            <input type="password" className="settings-input" value={oldPwd}
              onChange={(e) => setOldPwd(e.target.value)} autoComplete="current-password" />
          </div>
          <div className="settings-field">
            <label className="settings-field-label">New password</label>
            <input type="password" className="settings-input" value={newPwd}
              onChange={(e) => setNewPwd(e.target.value)} autoComplete="new-password" />
          </div>
          <div className="settings-field">
            <label className="settings-field-label">Confirm new password</label>
            <input type="password" className="settings-input" value={confPwd}
              onChange={(e) => setConfPwd(e.target.value)} autoComplete="new-password" />
          </div>

          {pwdMsg && (
            <p className={`settings-msg ${pwdMsg.ok ? "settings-msg--ok" : "settings-msg--err"}`}>
              {pwdMsg.text}
            </p>
          )}

          <button className="btn-primary settings-save-btn" onClick={handleChangePwd}
            disabled={pwdBusy || !oldPwd || !newPwd || !confPwd}>
            {pwdBusy ? "Saving…" : "Update password"}
          </button>
        </section>
      )}

      <section className="settings-section">
        <div className="settings-section-title">Sync Range</div>
        <div className="settings-sync-grid">
          {SYNC_OPTIONS.map((opt) => (
            <button
              key={opt.months}
              className={`settings-sync-btn${syncMonths === opt.months ? " settings-sync-btn--active" : ""}${opt.pro ? " settings-sync-btn--pro" : ""}`}
              onClick={() => handleSyncSelect(opt.months, opt.pro)}
            >
              <span className="settings-sync-label">{opt.label}</span>
              {opt.pro && <span className="settings-sync-badge">Pro</span>}
            </button>
          ))}
        </div>
        {showProBanner && (
          <div className="settings-pro-banner">
            <strong>Subscription required</strong>
            <p>Syncing beyond 3 months requires a Pro subscription. Upgrade to unlock 6-month and 1-year sync history.</p>
            <button className="settings-pro-cta">Upgrade to Pro</button>
          </div>
        )}
      </section>

      <section className="settings-section">
        <div className="settings-section-title">Language</div>
        <div className="settings-row">
          <span className="settings-row-label">Preferred language</span>
          <select className="settings-select" value={lang} onChange={(e) => handleLang(e.target.value)}>
            {LANGUAGE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-title">Data</div>
        <div className="settings-row settings-row--action" style={{ flexDirection: "column", alignItems: "flex-start", gap: 8 }}>
          {!resetConfirm ? (
            <button className="btn-ghost settings-danger-btn" onClick={() => { setResetMsg(null); setResetConfirm(true); }}>
              Reset sync history
            </button>
          ) : (
            <div className="settings-confirm-row">
              <span className="settings-confirm-text">This will clear all View and Alert data. Cannot be undone.</span>
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button className="btn-danger-sm" onClick={handleReset} disabled={resetBusy}>
                  {resetBusy ? "Clearing…" : "Yes, clear all"}
                </button>
                <button className="btn-ghost-sm" onClick={() => setResetConfirm(false)}>Cancel</button>
              </div>
            </div>
          )}
          {resetMsg && <p className="settings-msg settings-msg--ok">{resetMsg}</p>}
        </div>
      </section>

    </div>
  );
}
