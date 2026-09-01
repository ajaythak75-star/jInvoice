import { useEffect, useState, useCallback } from "react";
import { auth } from "../../data/AuthStore";
import { prefs } from "../../data/AutoImportPreferences";
import { useAutoImportViewModel } from "../autoimport/useAutoImportViewModel";
import { DesktopFolderSettings } from "../autoimport/DesktopFolderSettings";
import { desktopConnector } from "../../service/AutoImportService";
import { startMobileSync, stopMobileSync, syncMobileNow } from "../../service/MobileSyncService";
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

  const [showProModal, setShowProModal]   = useState(false);
  const [proName,     setProName]     = useState(() => prefs.customerName);
  const [proEmail,    setProEmail]    = useState(() => prefs.customerEmail);
  const [proLocation, setProLocation] = useState(() => prefs.customerLocation);
  const [proPin,      setProPin]      = useState(() => prefs.customerPin);
  const [proCountry,  setProCountry]  = useState(() => prefs.customerCountry);
  const [proFormErr,  setProFormErr]  = useState<string | null>(null);

  const [notificationsEnabled, setNotificationsEnabled] = useState(() => prefs.notificationsEnabled);
  const [allowedSenders, setAllowedSenders] = useState<string[]>(() => prefs.allowedSenders);
  const [newSender, setNewSender] = useState("");

  const [fsSupported, setFsSupported] = useState(false);

  const [geminiApiKey, setGeminiApiKey] = useState(() => prefs.geminiApiKey);
  const [geminiKeySaved, setGeminiKeySaved] = useState(false);

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

  const openProModal = () => {
    setProName(prefs.customerName);
    setProEmail(prefs.customerEmail);
    setProLocation(prefs.customerLocation);
    setProPin(prefs.customerPin);
    setProCountry(prefs.customerCountry);
    setProFormErr(null);
    setShowProModal(true);
  };

  const submitProUpgrade = () => {
    if (!proName.trim())  { setProFormErr("Name is required."); return; }
    if (!proEmail.trim()) { setProFormErr("Email is required."); return; }
    prefs.customerName     = proName.trim();
    prefs.customerEmail    = proEmail.trim();
    prefs.customerLocation = proLocation.trim();
    prefs.customerPin      = proPin.trim();
    prefs.customerCountry  = proCountry.trim();
    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setFullYear(endDate.getFullYear() + 1);
    prefs.customerAccountCreatedAt = startDate.toISOString();
    prefs.proEndDate = endDate.toISOString();
    prefs.customerPlan   = "Pro";
    prefs.customerStatus = "Active";
    prefs.isSubscribed   = true;
    setShowProModal(false);
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

      {/* API Keys */}
      <section className="settings-section">
        <div className="settings-section-title">
          API Keys
          {!prefs.isProActive && (
            <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, color: "var(--color-primary)", background: "color-mix(in srgb, var(--color-primary) 12%, transparent)", padding: "2px 7px", borderRadius: 10 }}>
              Pro
            </span>
          )}
        </div>
        <div className="settings-field">
          <label className="settings-field-label">Gemini API Key</label>
          <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 6 }}>
            {prefs.isProActive
              ? "Use your own Gemini API key instead of the shared server key."
              : "Upgrade to Pro to use your own Gemini API key and avoid shared quota limits."}
          </p>
          {prefs.isProActive ? (
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
          ) : (
            <button className="settings-pro-cta" onClick={openProModal}>Upgrade to Pro</button>
          )}
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

    {/* Pro upgrade modal */}

    {showProModal && (
      <div
        className="modal-overlay"
        onClick={() => setShowProModal(false)}
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
      >
        <div
          className="modal"
          onClick={(e) => e.stopPropagation()}
          style={{ maxWidth: 420, width: "90%", padding: 28, borderRadius: 12, background: "var(--color-surface)", boxShadow: "0 8px 32px rgba(0,0,0,0.2)" }}
        >
          <h2 style={{ marginBottom: 4, fontSize: 18 }}>Upgrade to Pro</h2>
          <p style={{ fontSize: 12.5, color: "var(--color-text-secondary)", marginBottom: 18 }}>
            Enter your details to activate your Pro subscription.
          </p>

          {/* Auto-filled read-only info */}
          <div style={{ display: "flex", gap: 10, marginBottom: 16, fontSize: 12, color: "var(--color-text-secondary)" }}>
            <span style={{ background: "var(--color-primary)", color: "#fff", borderRadius: 4, padding: "2px 8px", fontWeight: 600 }}>Pro</span>
            <span>Active</span>
            <span style={{ marginLeft: "auto" }}>Since {new Date().toLocaleDateString()}</span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "block", marginBottom: 4 }}>Full Name *</label>
              <input
                className="settings-input"
                style={{ width: "100%" }}
                placeholder="Your name"
                value={proName}
                onChange={(e) => setProName(e.target.value)}
                autoFocus
              />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "block", marginBottom: 4 }}>Email *</label>
              <input
                className="settings-input"
                style={{ width: "100%" }}
                placeholder="you@example.com"
                type="email"
                value={proEmail}
                onChange={(e) => setProEmail(e.target.value)}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "block", marginBottom: 4 }}>Location / City</label>
              <input
                className="settings-input"
                style={{ width: "100%" }}
                placeholder="City or area"
                value={proLocation}
                onChange={(e) => setProLocation(e.target.value)}
              />
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "block", marginBottom: 4 }}>PIN / ZIP</label>
                <input
                  className="settings-input"
                  style={{ width: "100%" }}
                  placeholder="PIN code"
                  value={proPin}
                  onChange={(e) => setProPin(e.target.value)}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "block", marginBottom: 4 }}>Country</label>
                <input
                  className="settings-input"
                  style={{ width: "100%" }}
                  placeholder="Country"
                  value={proCountry}
                  onChange={(e) => setProCountry(e.target.value)}
                />
              </div>
            </div>
          </div>

          {proFormErr && (
            <p style={{ fontSize: 12, color: "#ef4444", marginTop: 10 }}>{proFormErr}</p>
          )}

          <div style={{ display: "flex", gap: 10, marginTop: 20, justifyContent: "flex-end" }}>
            <button className="btn-sm" onClick={() => setShowProModal(false)}>Cancel</button>
            <button className="settings-pro-cta" onClick={submitProUpgrade}>Activate Pro</button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
