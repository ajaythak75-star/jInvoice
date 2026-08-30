import { useEffect, useRef, useState, useCallback } from "react";
import { auth } from "../../data/AuthStore";
import { prefs } from "../../data/AutoImportPreferences";
import { useAutoImportViewModel } from "../autoimport/useAutoImportViewModel";
import { DesktopFolderSettings } from "../autoimport/DesktopFolderSettings";
import { GmailConnector } from "../../autoimport/GmailConnector";
import { OutlookConnector } from "../../autoimport/OutlookConnector";
import { ImapConnector, isImapAvailable } from "../../autoimport/ImapConnector";
import { desktopConnector, schedulePolling } from "../../service/AutoImportService";
import { startMobileSync, stopMobileSync, syncMobileNow } from "../../service/MobileSyncService";
import { processFile } from "../../extraction/ExtractionPipeline";
import { DOC_TYPE_SUBFOLDER, detectDocType } from "../../extraction/DocTypeDetector";
import { isFsAccessSupported } from "../../autoimport/DesktopFolderConnector";
import type { ExtractionResult } from "../../core/extraction/models";

const SYNC_OPTIONS: { months: number; label: string; pro: boolean }[] = [
  { months: 1,  label: "1 month",  pro: false },
  { months: 3,  label: "3 months", pro: false },
  { months: 6,  label: "6 months", pro: true  },
  { months: 12, label: "1 year",   pro: true  },
];

function uploadResultMessage(r: ExtractionResult): string {
  if (r.kind === "success")            return `Saved — ${r.invoice.merchantName ?? "Invoice"}`;
  if (r.kind === "lowConfidence")      return `Saved for review (${Math.round(r.invoice.confidenceScore * 100)}% confidence)`;
  if (r.kind === "duplicate")          return `Duplicate — ${r.invoice.merchantName ?? "Invoice"} already saved`;
  if (r.kind === "encryptedPdf")       return "Encrypted PDF — cannot read";
  if (r.kind === "dailyLimitReached")  return `Daily limit reached (${r.limit}/day on Free plan). Upgrade to Pro for unlimited.`;
  if (r.kind === "failure")            return `Failed: ${r.reason}`;
  return "Unknown result";
}

function FolderPicker({
  options,
  selected,
  onChange,
  fallbackId,
}: {
  options: { id: string; label: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
  fallbackId: string;
}) {
  const [open, setOpen] = useState(false);
  const [dropPos, setDropPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);

  const selectedSet = new Set(selected);
  const allSelected = options.length > 0 && options.every((o) => selectedSet.has(o.id));

  const toggle = (id: string) => {
    if (selectedSet.has(id)) {
      const next = selected.filter((s) => s !== id);
      onChange(next.length ? next : [fallbackId]);
    } else {
      onChange([...selected, id]);
    }
  };

  const handleOpen = () => {
    if (open) { setOpen(false); return; }
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setDropPos({ top: r.bottom + 4, left: r.left });
    }
    setOpen(true);
  };

  const label = allSelected
    ? "All folders"
    : selected.length === 0
    ? "No folders"
    : `${selected.length} of ${options.length} folders`;

  return (
    <div style={{ display: "inline-block" }}>
      {open && <div style={{ position: "fixed", inset: 0, zIndex: 99 }} onClick={() => setOpen(false)} />}
      <button
        ref={btnRef}
        onClick={handleOpen}
        style={{ fontSize: 13, padding: "4px 10px", borderRadius: 6, border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--color-text)", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5 }}
      >
        {label}
        <span style={{ fontSize: 10, opacity: 0.55 }}>▾</span>
      </button>
      {open && (
        <div style={{ position: "fixed", top: dropPos.top, left: dropPos.left, zIndex: 100, background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,.14)", minWidth: 210, maxHeight: 260, display: "flex", flexDirection: "column" }}>
          <div style={{ overflowY: "auto", flex: 1 }}>
            {options.map((o) => (
              <label
                key={o.id}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", fontSize: 12.5, cursor: "pointer", color: "var(--color-text)" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--color-surface-2)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ""; }}
              >
                <input
                  type="checkbox"
                  checked={selectedSet.has(o.id)}
                  onChange={() => toggle(o.id)}
                  style={{ accentColor: "var(--color-primary)" }}
                />
                {o.label}
              </label>
            ))}
          </div>
          <div style={{ display: "flex", gap: 6, padding: "7px 10px", borderTop: "1px solid var(--color-border)" }}>
            <button
              onClick={() => onChange(options.map((o) => o.id))}
              style={{ flex: 1, fontSize: 11.5, padding: "3px 6px", borderRadius: 4, border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--color-primary)", cursor: "pointer", fontWeight: 600 }}
            >
              All
            </button>
            <button
              onClick={() => onChange([fallbackId])}
              style={{ flex: 1, fontSize: 11.5, padding: "3px 6px", borderRadius: 4, border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--color-text-secondary)", cursor: "pointer" }}
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface Props {
  onSignOut: () => void;
}

export function SettingsScreen({ onSignOut }: Props) {
  const vm = useAutoImportViewModel();

  const [syncMonths, setSyncMonths]     = useState(() => prefs.syncMonths);
  const [syncSchedule, setSyncSchedule] = useState(() => prefs.syncSchedule);
  const [syncTime, setSyncTime]         = useState(() => prefs.syncTime);
  const [showProBanner, setShowProBanner] = useState(false);
  const [showProModal, setShowProModal]   = useState(false);
  const [proName,     setProName]     = useState(() => prefs.customerName);
  const [proEmail,    setProEmail]    = useState(() => prefs.customerEmail);
  const [proLocation, setProLocation] = useState(() => prefs.customerLocation);
  const [proPin,      setProPin]      = useState(() => prefs.customerPin);
  const [proCountry,  setProCountry]  = useState(() => prefs.customerCountry);
  const [proFormErr,  setProFormErr]  = useState<string | null>(null);

  const [gmailLabels, setGmailLabels]               = useState<{ id: string; name: string }[]>([]);
  const [gmailLabelIds, setGmailLabelIds]           = useState<string[]>(() => prefs.gmailLabelIds);
  const [gmailLabelsLoading, setGmailLabelsLoading] = useState(false);
  const [gmailLabelsError, setGmailLabelsError]     = useState<string | null>(null);

  const [outlookFolders, setOutlookFolders]               = useState<{ id: string; displayName: string }[]>([]);
  const [outlookFolderIds, setOutlookFolderIds]           = useState<string[]>(() => prefs.outlookFolderIds);
  const [outlookFoldersLoading, setOutlookFoldersLoading] = useState(false);
  const [outlookFoldersError, setOutlookFoldersError]     = useState<string | null>(null);

  const [notificationsEnabled, setNotificationsEnabled] = useState(() => prefs.notificationsEnabled);
  const [allowedSenders, setAllowedSenders] = useState<string[]>(() => prefs.allowedSenders);
  const [newSender, setNewSender] = useState("");

  const [fsSupported, setFsSupported] = useState(false);

  const [imapConfigured, setImapConfigured] = useState(false);
  const [imapConnectedEmail, setImapConnectedEmail] = useState<string | null>(null);
  const [imapInputEmail, setImapInputEmail] = useState(() => prefs.imapEmail ?? "");
  const [imapInputPassword, setImapInputPassword] = useState("");
  const [imapBusy, setImapBusy] = useState(false);
  const [imapMsg, setImapMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [geminiApiKey, setGeminiApiKey] = useState(() => prefs.geminiApiKey);
  const [geminiKeySaved, setGeminiKeySaved] = useState(false);

  const [jInvoiceSecret, setJInvoiceSecret] = useState(() => prefs.jInvoiceSecret);
  const [jSecretSaved, setJSecretSaved] = useState(false);
  const [jSecretVisible, setJSecretVisible] = useState(false);
  const [jSecretError, setJSecretError] = useState<string | null>(null);

  const [gmailAccounts,   setGmailAccounts]   = useState(() => prefs.gmailAccounts);
  const [outlookAccounts, setOutlookAccounts] = useState(() => prefs.outlookAccounts);

  // Merge the primary Import-page email with the multi-account list so Settings
  // always reflects whatever is connected in the Import page.
  const primaryGmailEmail = vm.state.gmail.email;
  const primaryGmailConnected = vm.state.gmail.isAuthenticated;
  const effectiveGmailAccounts = [
    ...(primaryGmailEmail && primaryGmailConnected && !gmailAccounts.find((a) => a.email === primaryGmailEmail)
      ? [{ email: primaryGmailEmail, accessToken: prefs.gmailAccessToken ?? "", refreshToken: prefs.gmailRefreshToken, enabled: prefs.gmailEnabled }]
      : []),
    ...gmailAccounts,
  ];

  const primaryOutlookEmail = vm.state.outlook.email;
  const primaryOutlookConnected = vm.state.outlook.isAuthenticated;
  const effectiveOutlookAccounts = [
    ...(primaryOutlookEmail && primaryOutlookConnected && !outlookAccounts.find((a) => a.email === primaryOutlookEmail)
      ? [{ email: primaryOutlookEmail, accessToken: prefs.outlookAccessToken ?? "", enabled: prefs.outlookEnabled }]
      : []),
    ...outlookAccounts,
  ];

  const MAX_ACCOUNTS = prefs.isSubscribed ? 5 : 1;
  const totalAccounts = effectiveGmailAccounts.length + effectiveOutlookAccounts.length;

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

  useEffect(() => {
    if (!isImapAvailable()) return;
    ImapConnector.status().then(({ configured, email }) => {
      setImapConfigured(configured);
      setImapConnectedEmail(email);
      if (configured && email) { prefs.imapEnabled = true; prefs.imapEmail = email; }
    }).catch(() => {});
  }, []);

  useEffect(() => { isFsAccessSupported().then(setFsSupported); }, []);

  useEffect(() => {
    if (vm.state.gmail.isAuthenticated) refreshGmailLabels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vm.state.gmail.isAuthenticated]);

  useEffect(() => {
    if (vm.state.outlook.isAuthenticated) refreshOutlookFolders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vm.state.outlook.isAuthenticated]);

  const handleSignOut = () => {
    auth.signOut();
    onSignOut();
  };

  const handleSyncSelect = (months: number, pro: boolean) => {
    if (pro && !prefs.isSubscribed) { setShowProBanner(true); return; }
    setShowProBanner(false);
    setSyncMonths(months);
    prefs.syncMonths = months;
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
    setShowProBanner(false);
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

  const handleImapConnect = async () => {
    if (!imapInputEmail.trim() || !imapInputPassword.trim()) {
      setImapMsg({ ok: false, text: "Enter your Gmail address and App Password." });
      return;
    }
    setImapBusy(true);
    setImapMsg(null);
    try {
      await ImapConnector.testConnection(imapInputEmail.trim(), imapInputPassword.trim());
      await ImapConnector.saveCredentials(imapInputEmail.trim(), imapInputPassword.trim());
      prefs.imapEnabled = true;
      prefs.imapEmail = imapInputEmail.trim();
      setImapConfigured(true);
      setImapConnectedEmail(imapInputEmail.trim());
      setImapInputPassword("");
      setImapMsg({ ok: true, text: "Connected successfully." });
    } catch (e) {
      setImapMsg({ ok: false, text: e instanceof Error ? e.message : "Connection failed. Check your App Password." });
    } finally {
      setImapBusy(false);
    }
  };

  const handleImapDisconnect = async () => {
    await ImapConnector.disconnect();
    prefs.imapEnabled = false;
    prefs.imapEmail = null;
    setImapConfigured(false);
    setImapConnectedEmail(null);
    setImapInputEmail("");
    setImapInputPassword("");
    setImapMsg(null);
  };

  const selectStyle: React.CSSProperties = {
    fontSize: 13, padding: "4px 8px", borderRadius: 6,
    border: "1px solid var(--color-border)",
    background: "var(--color-surface)", color: "var(--color-text)",
  };

  const refreshGmailLabels = () => {
    const GMAIL_EXCLUDE = new Set(["TRASH", "SPAM", "DRAFT", "SENT", "UNREAD", "STARRED", "IMPORTANT"]);
    setGmailLabelsLoading(true);
    setGmailLabelsError(null);
    new GmailConnector().fetchLabels()
      .then((labels) => {
        const filtered = labels.filter((l) => !GMAIL_EXCLUDE.has(l.id.toUpperCase()));
        setGmailLabels(filtered);
        const allIds = filtered.map((l) => l.id);
        prefs.gmailLabelIds = allIds;
        setGmailLabelIds(allIds);
      })
      .catch((err: unknown) => {
        console.error("[Settings] Gmail label fetch failed:", err);
        setGmailLabelsError(err instanceof Error ? err.message : "Failed to load folders");
      })
      .finally(() => setGmailLabelsLoading(false));
  };

  const refreshOutlookFolders = () => {
    const OUTLOOK_EXCLUDE = new Set(["Deleted Items", "Junk Email", "Drafts", "Sent Items", "Outbox", "Trash"]);
    setOutlookFoldersLoading(true);
    setOutlookFoldersError(null);
    new OutlookConnector().fetchFolders()
      .then((folders) => {
        const filtered = folders.filter((f) => !OUTLOOK_EXCLUDE.has(f.displayName));
        setOutlookFolders(filtered);
        const allIds = filtered.map((f) => f.id);
        prefs.outlookFolderIds = allIds;
        setOutlookFolderIds(allIds);
      })
      .catch((err: unknown) => {
        console.error("[Settings] Outlook folder fetch failed:", err);
        setOutlookFoldersError(err instanceof Error ? err.message : "Failed to load folders");
      })
      .finally(() => setOutlookFoldersLoading(false));
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

      {/* Sync — range + schedule combined */}
      <section className="settings-section">
        <div className="settings-section-title">Sync</div>
        <div className="settings-row">
          <span className="settings-row-label">Look back</span>
          <select
            style={selectStyle}
            value={syncMonths}
            onChange={(e) => {
              const opt = SYNC_OPTIONS.find((o) => o.months === Number(e.target.value));
              if (opt) handleSyncSelect(opt.months, opt.pro);
            }}
          >
            {SYNC_OPTIONS.map((opt) => (
              <option key={opt.months} value={opt.months}>
                {opt.label}{opt.pro ? " — Pro" : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="settings-row">
          <span className="settings-row-label">Frequency</span>
          <select
            style={selectStyle}
            value={syncSchedule}
            onChange={(e) => {
              const v = e.target.value as typeof syncSchedule;
              prefs.syncSchedule = v;
              setSyncSchedule(v);
              schedulePolling();
            }}
          >
            <option value="manual">Manual only</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>
        {syncSchedule !== "manual" && (
          <div className="settings-row">
            <span className="settings-row-label">Sync at</span>
            <input
              type="time"
              className="settings-input"
              style={{ maxWidth: 120 }}
              value={syncTime}
              onChange={(e) => {
                prefs.syncTime = e.target.value;
                setSyncTime(e.target.value);
                schedulePolling();
              }}
            />
          </div>
        )}
        {showProBanner && (
          <div className="settings-pro-banner">
            <strong>Subscription required</strong>
            <p>Syncing beyond 3 months requires a Pro subscription. Upgrade to unlock 6-month and 1-year sync history.</p>
            <button className="settings-pro-cta" onClick={openProModal}>Upgrade to Pro</button>
          </div>
        )}
      </section>

      {/* Mail Folders — dropdown per provider */}
      {(gmailAuthenticated || outlookAuthenticated) && (
        <section className="settings-section">
          <div className="settings-section-title">Mail Folders</div>
          <p style={{ fontSize: 12.5, color: "var(--color-text-secondary)", marginBottom: 10 }}>
            Choose which folders to scan for PDF attachments during sync.
          </p>

          {gmailAuthenticated && (
            <div className="settings-row" style={{ alignItems: "flex-start", gap: 8 }}>
              <span className="settings-row-label" style={{ paddingTop: 4 }}>Gmail</span>
              <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
                {gmailLabels.length === 0 ? (
                  <span style={{ fontSize: 12.5, color: gmailLabelsError ? "#ef4444" : "var(--color-text-secondary)", paddingTop: 4 }}>
                    {gmailLabelsLoading ? "Loading…" : gmailLabelsError ?? "No folders found"}
                  </span>
                ) : (
                  <FolderPicker
                    options={gmailLabels.map((l) => ({ id: l.id, label: l.name }))}
                    selected={gmailLabelIds}
                    fallbackId="INBOX"
                    onChange={(ids: string[]) => { prefs.gmailLabelIds = ids; setGmailLabelIds(ids); }}
                  />
                )}
                <button className="btn-sm" disabled={gmailLabelsLoading} onClick={refreshGmailLabels}>
                  {gmailLabelsLoading ? "…" : "Refresh"}
                </button>
              </div>
            </div>
          )}

          {outlookAuthenticated && (
            <div className="settings-row" style={{ alignItems: "flex-start", gap: 8, marginTop: gmailAuthenticated ? 10 : 0 }}>
              <span className="settings-row-label" style={{ paddingTop: 4 }}>Outlook</span>
              <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
                {outlookFolders.length === 0 ? (
                  <span style={{ fontSize: 12.5, color: outlookFoldersError ? "#ef4444" : "var(--color-text-secondary)", paddingTop: 4 }}>
                    {outlookFoldersLoading ? "Loading…" : outlookFoldersError ?? "No folders found"}
                  </span>
                ) : (
                  <FolderPicker
                    options={outlookFolders.map((f) => ({ id: f.id, label: f.displayName }))}
                    selected={outlookFolderIds}
                    fallbackId="inbox"
                    onChange={(ids: string[]) => { prefs.outlookFolderIds = ids; setOutlookFolderIds(ids); }}
                  />
                )}
                <button className="btn-sm" disabled={outlookFoldersLoading} onClick={refreshOutlookFolders}>
                  {outlookFoldersLoading ? "…" : "Refresh"}
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      <section className="settings-section">
        <div className="settings-section-title">Desktop Folder</div>
        <DesktopFolderSettings
          folderName={vm.state.desktopFolderName}
          onFolderSet={vm.setDesktopFolder}
          onScanFiles={handleFolderScan}
        />
      </section>

      {isImapAvailable() && (
        <section className="settings-section">
          <div className="settings-section-title">
            Gmail via App Password
            <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, color: imapConfigured ? "#22c55e" : "var(--color-text-secondary)", background: imapConfigured ? "color-mix(in srgb, #22c55e 12%, transparent)" : "var(--color-surface-2, #f4f4f8)", padding: "2px 7px", borderRadius: 10 }}>
              {imapConfigured ? "Connected" : "Not connected"}
            </span>
          </div>
          <p style={{ fontSize: 12.5, color: "var(--color-text-secondary)", marginBottom: 12 }}>
            Connect Gmail using an App Password instead of OAuth — no 100-user limit.{" "}
            <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer"
              style={{ color: "var(--color-primary)" }}>
              Generate App Password ↗
            </a>
          </p>
          {imapConfigured ? (
            <div>
              <div className="settings-row" style={{ marginBottom: 10 }}>
                <span className="settings-row-label" style={{ fontWeight: 500 }}>{imapConnectedEmail}</span>
                <button className="btn-sm" style={{ color: "#ef4444", borderColor: "#ef4444" }}
                  onClick={handleImapDisconnect}>
                  Disconnect
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <input
                className="settings-input"
                type="email"
                placeholder="your@gmail.com"
                value={imapInputEmail}
                onChange={(e) => setImapInputEmail(e.target.value)}
                autoComplete="email"
              />
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  className="settings-input"
                  type="password"
                  placeholder="App Password (16 chars)"
                  value={imapInputPassword}
                  onChange={(e) => setImapInputPassword(e.target.value)}
                  style={{ flex: 1 }}
                />
                <button className="btn-sm" onClick={handleImapConnect} disabled={imapBusy}>
                  {imapBusy ? "Testing…" : "Connect"}
                </button>
              </div>
            </div>
          )}
          {imapMsg && (
            <p className={`settings-msg ${imapMsg.ok ? "settings-msg--ok" : "settings-msg--err"}`} style={{ marginTop: 8 }}>
              {imapMsg.text}
            </p>
          )}
        </section>
      )}

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
                placeholder="AIza…"
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

      {/* Connected Email Accounts (Pro: up to 5) */}
      <section className="settings-section">
        <div className="settings-section-title">
          Email Accounts
          {!prefs.isSubscribed && (
            <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, color: "var(--color-primary)", background: "color-mix(in srgb, var(--color-primary) 12%, transparent)", padding: "2px 7px", borderRadius: 10 }}>
              Pro
            </span>
          )}
        </div>

        {prefs.isSubscribed ? (
          <>
            {/* Pro — show all connected accounts */}
            {effectiveGmailAccounts.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>Gmail</div>
                {effectiveGmailAccounts.map((acct) => {
                  const isPrimary = acct.email === primaryGmailEmail;
                  return (
                  <div key={acct.email} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", background: "var(--color-surface-2)", border: "1px solid var(--color-border)", borderRadius: 8, marginBottom: 4 }}>
                    <span style={{ flex: 1, fontSize: 13, color: "var(--color-text)" }}>{acct.email}</span>
                    <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, cursor: "pointer", color: "var(--color-text-secondary)" }}>
                      <input
                        type="checkbox"
                        checked={acct.enabled}
                        style={{ accentColor: "var(--color-primary)" }}
                        onChange={(e) => {
                          if (isPrimary) {
                            vm.toggleGmail(e.target.checked);
                          } else {
                            const updated = gmailAccounts.map((a) => a.email === acct.email ? { ...a, enabled: e.target.checked } : a);
                            prefs.gmailAccounts = updated;
                            setGmailAccounts(updated);
                          }
                        }}
                      />
                      Active
                    </label>
                    <button
                      className="btn-ghost-sm"
                      style={{ fontSize: 11, color: "#ef4444" }}
                      onClick={() => {
                        if (isPrimary) {
                          vm.revokeGmail();
                        } else {
                          const updated = gmailAccounts.filter((a) => a.email !== acct.email);
                          prefs.gmailAccounts = updated;
                          setGmailAccounts(updated);
                        }
                      }}
                    >
                      Remove
                    </button>
                  </div>
                  );
                })}
              </div>
            )}

            {effectiveOutlookAccounts.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>Outlook</div>
                {effectiveOutlookAccounts.map((acct) => {
                  const isPrimary = acct.email === primaryOutlookEmail;
                  return (
                  <div key={acct.email} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", background: "var(--color-surface-2)", border: "1px solid var(--color-border)", borderRadius: 8, marginBottom: 4 }}>
                    <span style={{ flex: 1, fontSize: 13, color: "var(--color-text)" }}>{acct.email}</span>
                    <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, cursor: "pointer", color: "var(--color-text-secondary)" }}>
                      <input
                        type="checkbox"
                        checked={acct.enabled}
                        style={{ accentColor: "var(--color-primary)" }}
                        onChange={(e) => {
                          if (isPrimary) {
                            vm.toggleOutlook(e.target.checked);
                          } else {
                            const updated = outlookAccounts.map((a) => a.email === acct.email ? { ...a, enabled: e.target.checked } : a);
                            prefs.outlookAccounts = updated;
                            setOutlookAccounts(updated);
                          }
                        }}
                      />
                      Active
                    </label>
                    <button
                      className="btn-ghost-sm"
                      style={{ fontSize: 11, color: "#ef4444" }}
                      onClick={() => {
                        if (isPrimary) {
                          vm.revokeOutlook();
                        } else {
                          const updated = outlookAccounts.filter((a) => a.email !== acct.email);
                          prefs.outlookAccounts = updated;
                          setOutlookAccounts(updated);
                        }
                      }}
                    >
                      Remove
                    </button>
                  </div>
                  );
                })}
              </div>
            )}

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                className="btn-sm"
                disabled={totalAccounts >= MAX_ACCOUNTS}
                onClick={() => new GmailConnector().startSignIn(auth.email ?? undefined)}
                title="Connect a Gmail account"
              >
                + Add Gmail
              </button>
              <button
                className="btn-sm"
                disabled={totalAccounts >= MAX_ACCOUNTS}
                onClick={() => new OutlookConnector().startSignIn(auth.email ?? undefined)}
                title="Connect an Outlook account"
              >
                + Add Outlook
              </button>
              {totalAccounts >= MAX_ACCOUNTS && (
                <span style={{ fontSize: 12, color: "var(--color-text-tertiary)", alignSelf: "center" }}>
                  Up to 5 accounts on Pro
                </span>
              )}
            </div>
          </>
        ) : (
          <>
            {/* Free — show only the single connected account (if any) */}
            {totalAccounts > 0 && (
              <div style={{ marginBottom: 10 }}>
                {effectiveGmailAccounts[0] && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", background: "var(--color-surface-2)", border: "1px solid var(--color-border)", borderRadius: 8, marginBottom: 4 }}>
                    <span style={{ flex: 1, fontSize: 13, color: "var(--color-text)" }}>{effectiveGmailAccounts[0].email}</span>
                    <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, cursor: "pointer", color: "var(--color-text-secondary)" }}>
                      <input
                        type="checkbox"
                        checked={effectiveGmailAccounts[0].enabled}
                        style={{ accentColor: "var(--color-primary)" }}
                        onChange={(e) => vm.toggleGmail(e.target.checked)}
                      />
                      Active
                    </label>
                    <button className="btn-ghost-sm" style={{ fontSize: 11, color: "#ef4444" }} onClick={() => vm.revokeGmail()}>Remove</button>
                  </div>
                )}
                {!effectiveGmailAccounts[0] && effectiveOutlookAccounts[0] && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", background: "var(--color-surface-2)", border: "1px solid var(--color-border)", borderRadius: 8, marginBottom: 4 }}>
                    <span style={{ flex: 1, fontSize: 13, color: "var(--color-text)" }}>{effectiveOutlookAccounts[0].email}</span>
                    <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, cursor: "pointer", color: "var(--color-text-secondary)" }}>
                      <input
                        type="checkbox"
                        checked={effectiveOutlookAccounts[0].enabled}
                        style={{ accentColor: "var(--color-primary)" }}
                        onChange={(e) => vm.toggleOutlook(e.target.checked)}
                      />
                      Active
                    </label>
                    <button className="btn-ghost-sm" style={{ fontSize: 11, color: "#ef4444" }} onClick={() => vm.revokeOutlook()}>Remove</button>
                  </div>
                )}
              </div>
            )}

            {/* Pro upgrade teaser */}
            <div className="settings-pro-banner">
              <strong>Multiple accounts — Pro only</strong>
              <p>Connect up to 5 Gmail and Outlook accounts for automatic invoice import. Upgrade to Pro to unlock all accounts.</p>
              <button className="settings-pro-cta" onClick={openProModal}>Upgrade to Pro</button>
            </div>

            {totalAccounts === 0 && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                <button
                  className="btn-sm"
                  onClick={() => new GmailConnector().startSignIn(auth.email ?? undefined)}
                >
                  + Add Gmail
                </button>
                <button
                  className="btn-sm"
                  onClick={() => new OutlookConnector().startSignIn(auth.email ?? undefined)}
                >
                  + Add Outlook
                </button>
              </div>
            )}
          </>
        )}
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
