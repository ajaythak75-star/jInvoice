import { useEffect, useState, useCallback } from "react";
import { auth } from "../../data/AuthStore";
import { prefs, type UserProfile } from "../../data/AutoImportPreferences";
import { PROFESSIONAL_PROFILE_LABEL, type ProfessionalProfile } from "../../core/extraction/ProfessionalCategoryDetector";
import { useAutoImportViewModel } from "../autoimport/useAutoImportViewModel";
import { DesktopFolderSettings } from "../autoimport/DesktopFolderSettings";
import { desktopConnector } from "../../service/AutoImportService";
import { startMobileSync, stopMobileSync, syncMobileNow } from "../../service/MobileSyncService";
import { cancelPlan } from "../../service/UserPlanService";
import { processFile } from "../../extraction/ExtractionPipeline";
import { DOC_TYPE_SUBFOLDER, detectDocType } from "../../extraction/DocTypeDetector";
import { isFsAccessSupported } from "../../autoimport/DesktopFolderConnector";
import type { ExtractionResult } from "../../core/extraction/models";


function uploadResultMessage(r: ExtractionResult): string {
  if (r.kind === "success")            return `Saved — ${r.invoice.merchantName ?? "Invoice"}`;
  if (r.kind === "lowConfidence")      return `Saved for review (${Math.round(r.invoice.confidenceScore * 100)}% confidence)`;
  if (r.kind === "duplicate")          return `Duplicate — ${r.invoice.merchantName ?? "Invoice"} already saved`;
  if (r.kind === "encryptedPdf")       return "Encrypted PDF — cannot read";
  if (r.kind === "dailyLimitReached")  return `Daily limit reached (${r.limit}/day on Free plan). Upgrade to Pro for unlimited.`;
  if (r.kind === "failure")            return `Failed: ${r.reason}`;
  return "Unknown result";
}

interface Props {
  onSignOut: () => void;
}

export function SettingsScreen({ onSignOut }: Props) {
  const vm = useAutoImportViewModel();

  const [userType, setUserType] = useState<UserProfile>(() => prefs.userType);
  const [activeMode, setActiveMode] = useState<UserProfile>(() => prefs.activeMode);
  const [societyName, setSocietyName] = useState(() => prefs.societyName);
  const [showProfileConfirm, setShowProfileConfirm] = useState<Exclude<UserProfile, "personal"> | null>(null);

  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const [notificationsEnabled, setNotificationsEnabled] = useState(() => prefs.notificationsEnabled);
  const [allowedSenders, setAllowedSenders] = useState<string[]>(() => prefs.allowedSenders);
  const [newSender, setNewSender] = useState("");

  const [fsSupported, setFsSupported] = useState(false);

  const [isProActive, setIsProActive] = useState<boolean>(() => prefs.isProActive);

  const [geminiApiKey, setGeminiApiKey] = useState(() => prefs.geminiApiKey);
  const [geminiKeySaved, setGeminiKeySaved] = useState(false);
  const [openaiApiKey, setOpenaiApiKey] = useState(() => prefs.openaiApiKey);
  const [openaiKeySaved, setOpenaiKeySaved] = useState(false);
  const [sarvamApiKey, setSarvamApiKey] = useState(() => prefs.sarvamApiKey);
  const [sarvamKeySaved, setSarvamKeySaved] = useState(false);

  const [jInvoiceSecret, setJInvoiceSecret] = useState(() => prefs.jInvoiceSecret);
  const [jSecretSaved, setJSecretSaved] = useState(false);
  const [jSecretVisible, setJSecretVisible] = useState(false);
  const [jSecretError, setJSecretError] = useState<string | null>(null);

  const [mobileSyncEnabled, setMobileSyncEnabled] = useState(() => prefs.mobileSyncEnabled);
  const [mobileInfo, setMobileInfo] = useState<{ url: string; mobileUrl: string; secret: string; renderUrl?: string; renderMobileUrl?: string; desktopFolder?: { configured: boolean; name?: string } } | null>(null);
  const [mobileSyncing, setMobileSyncing] = useState(false);
  const [mobileCopied, setMobileCopied] = useState(false);
  const [mobileRenderCopied, setMobileRenderCopied] = useState(false);
  const [lanUrlCopied, setLanUrlCopied] = useState(false);

  const loadMobileInfo = useCallback(async () => {
    try {
      const r = await fetch("/api/local-info");
      if (r.ok) setMobileInfo(await r.json());
    } catch {}
  }, []);

  useEffect(() => { loadMobileInfo(); }, [loadMobileInfo]);

  useEffect(() => { isFsAccessSupported().then(setFsSupported); }, []);

  const handleSignOut = () => {
    auth.signOut();
    onSignOut();
  };

  const handleFolderScan = async (files: File[]): Promise<string> => {
    const msgs: string[] = [];
    for (const file of files) {
      const r = await processFile(file, "manual_upload");
      if (fsSupported && prefs.desktopFolderName && (r.kind === "success" || r.kind === "lowConfidence")) {
        const lineItemNames = r.invoice.lineItems.map((li) => li.name);
        const dts = detectDocType(r.invoice.merchantName, lineItemNames, file.name);
        const bytes = new Uint8Array(await file.arrayBuffer());
        for (const dt of dts) await desktopConnector.saveInvoiceToFolder(bytes, file.name, DOC_TYPE_SUBFOLDER[dt]);
        msgs.push(`${file.name}: Saved to ${prefs.desktopFolderName}/${dts.map((dt) => DOC_TYPE_SUBFOLDER[dt]).join(" + ")}`);
      } else {
        msgs.push(`${file.name}: ${uploadResultMessage(r)}`);
      }
    }
    return msgs.join("\n");
  };

  const gmailAuthenticated   = vm.state.gmail.isAuthenticated;
  const outlookAuthenticated = vm.state.outlook.isAuthenticated;

  // Cancellation is allowed after 1 month from subscription start OR at plan end — whichever is sooner.
  function getCancelEligibleDate(): Date | null {
    const startStr = prefs.customerAccountCreatedAt;
    const endStr   = prefs.proEndDate;
    if (!startStr && !endStr) return null;
    const candidates: Date[] = [];
    if (startStr) {
      const d = new Date(startStr);
      d.setDate(d.getDate() + 30);
      candidates.push(d);
    }
    if (endStr) candidates.push(new Date(endStr));
    return candidates.reduce((a, b) => (a < b ? a : b));
  }

  const handleCancelSubscription = async () => {
    try {
      await cancelPlan();
    } catch {
      // Still update UI even if server fails
      prefs.isSubscribed = false;
      prefs.customerStatus = "Cancelled";
      prefs.trialStartedAt = null;
    }
    setIsProActive(false);
    setShowCancelConfirm(false);
  };



  return (
    <>
    <div className="settings-screen">

      {/* Account — compact: line 1 name+email, line 2 login+signout */}
      <section className="settings-section">
        <div className="settings-section-title">Account</div>
        <div className="settings-row">
          <span className="settings-row-label" style={{ fontWeight: 500 }}>
            {auth.email}
          </span>
          <span className="settings-row-value" style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
            Magic link
          </span>
        </div>
        <div className="settings-row">
          <span className="settings-row-value" style={{ fontSize: 12, color: "var(--color-text-secondary)" }} />
          <button className="btn-ghost settings-signout" onClick={handleSignOut}>Sign out</button>
        </div>
      </section>

      {/* Profile Type */}
      <section className="settings-section">
        <div className="settings-section-title">
          Profile
          {userType !== "personal" && (
            <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, color: "var(--color-primary)", background: "color-mix(in srgb, var(--color-primary) 12%, transparent)", padding: "2px 7px", borderRadius: 10 }}>
              Pro
            </span>
          )}
        </div>

        {userType === "personal" && !isProActive && (
          <p style={{ fontSize: 12.5, color: "var(--color-text-secondary)", fontStyle: "italic", marginBottom: 14 }}>
            Upgrade to Pro from the <strong>Pricing</strong> tab to unlock professional profiles.
          </p>
        )}

        {/* Locked type display */}
        <div className="settings-row">
          <div>
            <span className="settings-row-label">Account type</span>
            <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 2 }}>
              {userType === "personal"
                ? "Personal — your invoices, warranties and expense tracking."
                : userType === "society"
                  ? "Housing Society — society-specific categories enabled. Type cannot be changed."
                  : `${PROFESSIONAL_PROFILE_LABEL[userType as ProfessionalProfile]} — professional categories enabled. Type cannot be changed.`}
            </p>
          </div>
          <span style={{
            padding: "4px 12px", borderRadius: 6, fontSize: 12, fontWeight: 600,
            border: "1px solid var(--color-border)",
            background: "var(--color-surface-2)", color: "var(--color-text)",
            flexShrink: 0,
          }}>
            {userType === "personal" ? "Personal" : userType === "society" ? "Housing Society" : PROFESSIONAL_PROFILE_LABEL[userType as ProfessionalProfile]}
          </span>
        </div>

        {/* Society name (society users only) */}
        {userType === "society" && (
          <div className="settings-field" style={{ marginTop: 10 }}>
            <label className="settings-field-label">Society Name</label>
            <input
              className="settings-input"
              style={{ width: "100%" }}
              placeholder="e.g. Sunshine CHS"
              value={societyName}
              onChange={(e) => setSocietyName(e.target.value)}
              onBlur={() => { prefs.societyName = societyName.trim(); }}
            />
          </div>
        )}

        {/* Mode switcher — non-personal users can toggle between personal and their profile */}
        {userType !== "personal" && (
          <div className="settings-row" style={{ marginTop: 12 }}>
            <div>
              <span className="settings-row-label">Active mode</span>
              <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 2 }}>
                Switch context. Categories and detection follow the active mode.
              </p>
            </div>
            <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
              {(["personal", userType] as UserProfile[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => { prefs.activeMode = mode; setActiveMode(mode); }}
                  style={{
                    padding: "5px 14px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer",
                    border: "1px solid var(--color-border)",
                    background: activeMode === mode ? "var(--color-primary)" : "var(--color-surface)",
                    color: activeMode === mode ? "#fff" : "var(--color-text-secondary)",
                  }}
                >
                  {mode === "personal" ? "Personal" : mode === "society" ? "Society" : PROFESSIONAL_PROFILE_LABEL[mode as ProfessionalProfile]}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Profile upgrade options — personal users only, all Pro-gated */}
        {userType === "personal" && (
          <>
            {isProActive ? (
              <>
                <p style={{ fontSize: 12, color: "var(--color-text-secondary)", margin: "12px 0 4px" }}>
                  Choose a professional profile to enable category auto-detection. This cannot be changed later.
                </p>
                {(["society", "shopkeeper", "tax_consultant", "ca", "real_estate", "advocate", "bookkeeper"] as Exclude<UserProfile, "personal">[]).map((profile) => (
                  <div key={profile} className="settings-row" style={{ marginTop: 8 }}>
                    <span className="settings-row-label">
                      {profile === "society" ? "Housing Society" : PROFESSIONAL_PROFILE_LABEL[profile as ProfessionalProfile]}
                    </span>
                    <button
                      onClick={() => setShowProfileConfirm(profile)}
                      style={{
                        padding: "5px 14px", borderRadius: 6, fontSize: 12, fontWeight: 600, flexShrink: 0,
                        cursor: "pointer",
                        border: "1px solid var(--color-border)",
                        background: "var(--color-surface)",
                        color: "var(--color-text)",
                      }}
                    >
                      Set up
                    </button>
                  </div>
                ))}
              </>
            ) : null}
          </>
        )}
      </section>

      {/* Profile setup confirmation modal */}
      {showProfileConfirm && (
        <div className="modal-overlay" onClick={() => setShowProfileConfirm(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 360, padding: 24 }}>
            <h2 style={{ fontSize: 17, marginBottom: 8 }}>
              Set up {showProfileConfirm === "society" ? "Housing Society" : PROFESSIONAL_PROFILE_LABEL[showProfileConfirm as ProfessionalProfile]} profile?
            </h2>
            <p style={{ fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.5, marginBottom: 20 }}>
              This will enable <strong>{showProfileConfirm === "society" ? "Housing Society" : PROFESSIONAL_PROFILE_LABEL[showProfileConfirm as ProfessionalProfile]}</strong>-specific document categories and auto-detection.
              <br /><br />
              <strong>This cannot be changed later.</strong>
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button className="btn-ghost" onClick={() => setShowProfileConfirm(null)} style={{ fontSize: 13 }}>
                Cancel
              </button>
              <button
                className="btn-sm"
                onClick={() => {
                  prefs.userType = showProfileConfirm;
                  prefs.activeMode = showProfileConfirm;
                  setUserType(showProfileConfirm);
                  setActiveMode(showProfileConfirm);
                  setShowProfileConfirm(null);
                }}
                style={{ fontSize: 13 }}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      <section className="settings-section">
        <div className="settings-section-title">Desktop Folder</div>
        <DesktopFolderSettings
          folderName={vm.state.desktopFolderName}
          onFolderSet={vm.setDesktopFolder}
          onScanFiles={handleFolderScan}
        />
      </section>

      {(gmailAuthenticated || outlookAuthenticated) && (
        <section className="settings-section">
          <div className="settings-section-title">Sender Filter</div>
          <p style={{ fontSize: 12.5, color: "var(--color-text-secondary)", marginBottom: 10 }}>
            When set, only emails from listed senders will be imported. Leave empty to import from all senders.
          </p>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <input
              className="settings-input"
              style={{ flex: 1 }}
              type="email"
              placeholder="e.g. orders@amazon.in"
              value={newSender}
              onChange={(e) => setNewSender(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newSender.trim()) {
                  const next = [...allowedSenders, newSender.trim().toLowerCase()].filter((v, i, a) => a.indexOf(v) === i);
                  prefs.allowedSenders = next;
                  setAllowedSenders(next);
                  setNewSender("");
                }
              }}
            />
            <button
              className="btn-sm"
              disabled={!newSender.trim()}
              onClick={() => {
                const next = [...allowedSenders, newSender.trim().toLowerCase()].filter((v, i, a) => a.indexOf(v) === i);
                prefs.allowedSenders = next;
                setAllowedSenders(next);
                setNewSender("");
              }}
            >
              Add
            </button>
          </div>
          {allowedSenders.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {allowedSenders.map((s) => (
                <div key={s} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 13, padding: "5px 8px", background: "var(--color-surface-2)", borderRadius: 6, border: "1px solid var(--color-border)" }}>
                  <span>{s}</span>
                  <button
                    className="btn-ghost-sm"
                    onClick={() => {
                      const next = allowedSenders.filter((x) => x !== s);
                      prefs.allowedSenders = next;
                      setAllowedSenders(next);
                    }}
                    style={{ fontSize: 11 }}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <section className="settings-section">
        <div className="settings-section-title">Notifications</div>
        <div className="settings-row">
          <div>
            <span className="settings-row-label">Expiry alerts</span>
            <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 2 }}>
              Show a system notification when warranties or policies expire within 30 days. Fires once per day on app launch or after a sync.
            </p>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", flexShrink: 0 }}>
            <input
              type="checkbox"
              checked={notificationsEnabled}
              style={{ accentColor: "var(--color-primary)", width: 15, height: 15 }}
              onChange={(e) => {
                prefs.notificationsEnabled = e.target.checked;
                setNotificationsEnabled(e.target.checked);
              }}
            />
            <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
              {notificationsEnabled ? "On" : "Off"}
            </span>
          </label>
        </div>
      </section>

      {/* Subscription management — Pro users only */}
      {isProActive && (
        <section className="settings-section">
          <div className="settings-section-title">Subscription</div>
          {(() => {
            const eligibleDate = getCancelEligibleDate();
            const canCancel    = eligibleDate ? new Date() >= eligibleDate : false;
            const fmtDate = (iso: string | null | undefined) =>
              iso
                ? new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
                : "—";
            return (
              <>
                <div className="settings-row">
                  <span className="settings-row-label">Plan</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-primary)" }}>Pro</span>
                </div>
                <div className="settings-row">
                  <span className="settings-row-label">Active since</span>
                  <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
                    {fmtDate(prefs.customerAccountCreatedAt)}
                  </span>
                </div>
                {prefs.proEndDate && (
                  <div className="settings-row">
                    <span className="settings-row-label">Plan ends</span>
                    <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
                      {fmtDate(prefs.proEndDate)}
                    </span>
                  </div>
                )}
                <div className="settings-row" style={{ marginTop: 8 }}>
                  <div>
                    <span className="settings-row-label">Cancel subscription</span>
                    {!canCancel && eligibleDate && (
                      <p style={{ fontSize: 12, color: "var(--color-text-tertiary)", marginTop: 2 }}>
                        Available from {fmtDate(eligibleDate.toISOString())}
                      </p>
                    )}
                    {canCancel && (
                      <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 2 }}>
                        Pro access ends immediately on cancellation.
                      </p>
                    )}
                  </div>
                  <button
                    disabled={!canCancel}
                    onClick={() => setShowCancelConfirm(true)}
                    style={{
                      padding: "5px 14px", borderRadius: 6, fontSize: 12, fontWeight: 600, flexShrink: 0,
                      cursor: canCancel ? "pointer" : "not-allowed",
                      border: "1px solid",
                      borderColor: canCancel ? "#ef4444" : "var(--color-border)",
                      background: "transparent",
                      color: canCancel ? "#ef4444" : "var(--color-text-tertiary)",
                      opacity: canCancel ? 1 : 0.6,
                    }}
                  >
                    Cancel plan
                  </button>
                </div>
              </>
            );
          })()}
        </section>
      )}

      {/* Cancel confirmation modal */}
      {showCancelConfirm && (
        <div
          className="modal-overlay"
          onClick={() => setShowCancelConfirm(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
        >
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 360, width: "90%", padding: 24, borderRadius: 12, background: "var(--color-surface)", boxShadow: "0 8px 32px rgba(0,0,0,0.2)" }}
          >
            <h2 style={{ marginBottom: 8, fontSize: 17 }}>Cancel Pro subscription?</h2>
            <p style={{ fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.5, marginBottom: 20 }}>
              Your Pro access will end immediately. You will revert to the Free plan and lose access to Pro features including professional profiles, unlimited imports, and multi-account sync.
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button className="btn-ghost" onClick={() => setShowCancelConfirm(false)} style={{ fontSize: 13 }}>
                Keep Pro
              </button>
              <button
                onClick={handleCancelSubscription}
                style={{
                  padding: "6px 16px", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer",
                  border: "none", background: "#ef4444", color: "#fff",
                }}
              >
                Cancel subscription
              </button>
            </div>
          </div>
        </div>
      )}

      {/* API Keys */}
      <section className="settings-section">
        <div className="settings-section-title">
          API Keys
          {!isProActive && (
            <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, color: "var(--color-primary)", background: "color-mix(in srgb, var(--color-primary) 12%, transparent)", padding: "2px 7px", borderRadius: 10 }}>
              Pro
            </span>
          )}
        </div>

        {!isProActive && (
          <p style={{ fontSize: 12.5, color: "var(--color-text-secondary)", fontStyle: "italic", marginBottom: 14 }}>
            Activate Pro from the <strong>Pricing</strong> tab to use your own API keys.
          </p>
        )}

        <div className="settings-field">
          <label className="settings-field-label">Gemini API Key</label>
          <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 6 }}>
            Use your own Gemini API key instead of the shared server key.
          </p>
          {isProActive && (
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="password"
                className="settings-input"
                style={{ flex: 1, fontFamily: "monospace", fontSize: 12 }}
                placeholder="Paste your Gemini API key"
                value={geminiApiKey}
                onChange={(e) => setGeminiApiKey(e.target.value)}
              />
              <button
                className="btn-sm"
                onClick={() => {
                  prefs.geminiApiKey = geminiApiKey.trim();
                  setGeminiKeySaved(true);
                  setTimeout(() => setGeminiKeySaved(false), 2000);
                }}
              >
                {geminiKeySaved ? "✓ Saved" : "Save"}
              </button>
              {geminiApiKey && (
                <button
                  className="btn-sm"
                  style={{ color: "#ef4444", borderColor: "#ef4444" }}
                  onClick={() => { prefs.geminiApiKey = ""; setGeminiApiKey(""); }}
                >
                  Clear
                </button>
              )}
            </div>
          )}
        </div>

        <div className="settings-field" style={{ marginTop: 16 }}>
          <label className="settings-field-label">OpenAI API Key</label>
          <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 6 }}>
            Use your own OpenAI API key for GPT-4o-mini invoice extraction.
          </p>
          {isProActive && (
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="password"
                className="settings-input"
                style={{ flex: 1, fontFamily: "monospace", fontSize: 12 }}
                placeholder="Paste your OpenAI API key (sk-…)"
                value={openaiApiKey}
                onChange={(e) => setOpenaiApiKey(e.target.value)}
              />
              <button
                className="btn-sm"
                onClick={() => {
                  prefs.openaiApiKey = openaiApiKey.trim();
                  setOpenaiKeySaved(true);
                  setTimeout(() => setOpenaiKeySaved(false), 2000);
                }}
              >
                {openaiKeySaved ? "✓ Saved" : "Save"}
              </button>
              {openaiApiKey && (
                <button
                  className="btn-sm"
                  style={{ color: "#ef4444", borderColor: "#ef4444" }}
                  onClick={() => { prefs.openaiApiKey = ""; setOpenaiApiKey(""); }}
                >
                  Clear
                </button>
              )}
            </div>
          )}
        </div>

        <div className="settings-field" style={{ marginTop: 16 }}>
          <label className="settings-field-label">Sarvam AI API Key</label>
          <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 6 }}>
            Enables automatic translation of Hindi, Tamil, Telugu, Kannada, and other Indian-language invoices before AI extraction. Get a free key at{" "}
            <a href="https://dashboard.sarvam.ai" target="_blank" rel="noreferrer" style={{ color: "var(--color-primary)" }}>dashboard.sarvam.ai</a>.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="password"
              className="settings-input"
              style={{ flex: 1, fontFamily: "monospace", fontSize: 12 }}
              placeholder="Paste your Sarvam API key"
              value={sarvamApiKey}
              onChange={(e) => setSarvamApiKey(e.target.value)}
            />
            <button
              className="btn-sm"
              onClick={() => {
                prefs.sarvamApiKey = sarvamApiKey.trim();
                setSarvamKeySaved(true);
                setTimeout(() => setSarvamKeySaved(false), 2000);
              }}
            >
              {sarvamKeySaved ? "✓ Saved" : "Save"}
            </button>
            {sarvamApiKey && (
              <button
                className="btn-sm"
                style={{ color: "#ef4444", borderColor: "#ef4444" }}
                onClick={() => { prefs.sarvamApiKey = ""; setSarvamApiKey(""); }}
              >
                Clear
              </button>
            )}
          </div>
        </div>

        <div className="settings-field" style={{ marginTop: 16 }}>
          <label className="settings-field-label">jInvoice Secret</label>
          <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 6 }}>
            Secret key used for mobile sync and API authentication. Keep this private.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type={jSecretVisible ? "text" : "password"}
              className="settings-input"
              style={{ flex: 1, fontFamily: "monospace", fontSize: 12 }}
              placeholder="Enter secret key…"
              value={jInvoiceSecret}
              onChange={(e) => setJInvoiceSecret(e.target.value)}
            />
            <button
              className="btn-sm"
              title={jSecretVisible ? "Hide" : "Show"}
              onClick={() => setJSecretVisible((v) => !v)}
              style={{ padding: "4px 10px" }}
            >
              {jSecretVisible ? "Hide" : "Show"}
            </button>
            <button
              className="btn-sm"
              onClick={async () => {
                const trimmed = jInvoiceSecret.trim();
                setJSecretError(null);
                // Always save locally first so the key is never lost
                prefs.jInvoiceSecret = trimmed;
                try {
                  const r = await fetch("/api/set-secret", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ secret: trimmed }),
                  });
                  if (!r.ok && r.status !== 404) {
                    const { error } = await r.json().catch(() => ({}));
                    setJSecretError(error ?? "Failed to update secret on server.");
                  }
                } catch {
                  // Not running in Electron — local save is sufficient
                }
                setJSecretSaved(true);
                setTimeout(() => setJSecretSaved(false), 2000);
                loadMobileInfo();
              }}
            >
              {jSecretSaved ? "✓ Saved" : "Save"}
            </button>
            {jInvoiceSecret && (
              <button
                className="btn-sm"
                style={{ color: "#ef4444", borderColor: "#ef4444" }}
                onClick={() => { prefs.jInvoiceSecret = ""; setJInvoiceSecret(""); setJSecretError(null); }}
              >
                Clear
              </button>
            )}
          </div>
          {jSecretError && (
            <p className="settings-msg settings-msg--err" style={{ marginTop: 6 }}>{jSecretError}</p>
          )}
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-title">Mobile Sync</div>

        {/* Enable toggle */}
        <div className="settings-row">
          <div>
            <span className="settings-row-label">Auto-sync from mobile</span>
            <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 2 }}>
              Desktop polls for invoices captured on your phone every 30 seconds.
            </p>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", flexShrink: 0 }}>
            <input
              type="checkbox"
              checked={mobileSyncEnabled}
              style={{ accentColor: "var(--color-primary)", width: 15, height: 15 }}
              onChange={(e) => {
                prefs.mobileSyncEnabled = e.target.checked;
                setMobileSyncEnabled(e.target.checked);
                e.target.checked ? startMobileSync() : stopMobileSync();
              }}
            />
            <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
              {mobileSyncEnabled ? "On" : "Off"}
            </span>
          </label>
        </div>

        {/* Mobile URLs — compact copy row */}
        {mobileInfo ? (
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {mobileInfo.renderMobileUrl && (
                <button
                  className="btn-sm"
                  onClick={() => {
                    navigator.clipboard.writeText(mobileInfo!.renderMobileUrl!).then(() => {
                      setMobileRenderCopied(true);
                      setTimeout(() => setMobileRenderCopied(false), 2000);
                    });
                  }}
                >
                  {mobileRenderCopied ? "✓ Cloud URL Copied" : "Copy Cloud URL"}
                </button>
              )}
              <button
                className="btn-sm"
                onClick={() => {
                  navigator.clipboard.writeText(mobileInfo!.mobileUrl).then(() => {
                    setMobileCopied(true);
                    setTimeout(() => setMobileCopied(false), 2000);
                  });
                }}
              >
                {mobileCopied ? "✓ Local URL Copied" : "Copy Local URL"}
              </button>
              {mobileInfo.renderMobileUrl && (
                <button
                  className="btn-sm"
                  disabled={mobileSyncing}
                  onClick={async () => {
                    setMobileSyncing(true);
                    await syncMobileNow();
                    setMobileSyncing(false);
                  }}
                >
                  {mobileSyncing ? "Syncing…" : "Sync Now"}
                </button>
              )}
            </div>

            {/* Desktop Folder for LAN push from mobile */}
            <div style={{ padding: "12px 14px", background: "var(--color-surface-2)", borderRadius: 10, border: "1px solid var(--color-border)" }}>
              <p style={{ fontSize: 11.5, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>
                Desktop Folder — receive from mobile
              </p>
              <p style={{ fontSize: 12.5, color: "var(--color-text-secondary)", marginBottom: 8 }}>
                Pick a folder once. Invoices you capture on mobile (same Wi-Fi) will be saved here automatically.
              </p>
              <DesktopFolderSettings
                folderName={vm.state.desktopFolderName}
                onFolderSet={vm.setDesktopFolder}
                onScanFiles={handleFolderScan}
              />
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
                <button
                  className="btn-sm"
                  title="Copy LAN base URL for mobile Settings"
                  onClick={() => {
                    navigator.clipboard.writeText(mobileInfo!.url).then(() => {
                      setLanUrlCopied(true);
                      setTimeout(() => setLanUrlCopied(false), 2000);
                    });
                  }}
                >
                  {lanUrlCopied ? "✓ Copied" : "Copy LAN URL for mobile"}
                </button>
              </div>
              <p style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 8 }}>
                On mobile: More → Settings → paste the LAN URL above.
              </p>
            </div>

            <p style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>
              Secret: <span style={{ fontFamily: "monospace" }}>{mobileInfo.secret}</span>
            </p>
          </div>
        ) : (
          <p style={{ fontSize: 12.5, color: "var(--color-text-tertiary)", marginTop: 8 }}>
            Mobile sync is available when running the desktop app.
          </p>
        )}
      </section>

    </div>

    </>
  );
}
