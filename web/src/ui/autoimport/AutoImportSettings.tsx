import React, { useEffect, useRef, useState } from "react";
import { useAutoImportViewModel } from "./useAutoImportViewModel";
import { ConsentModal } from "./ConsentModal";
import { GmailConnector } from "../../autoimport/GmailConnector";
import { OutlookConnector } from "../../autoimport/OutlookConnector";
import { ImapConnector, isImapAvailable, type ImapAccount } from "../../autoimport/ImapConnector";
import { poll, cancelSync, isSyncing, desktopConnector, schedulePolling, pollHistory, batchExtractPending, cancelBulk } from "../../service/AutoImportService";
import { clearAllData, db } from "../../data/InvoiceDatabase";
import { processFile } from "../../extraction/ExtractionPipeline";
import { syncNewInvoice, saveCustomerPlan, saveCustomerBusinessProfile } from "../../service/SupabaseSync";
import { isSupabaseEnabled } from "../../data/supabase";
import { auth } from "../../data/AuthStore";
import { BusinessProfileModal } from "../shared/BusinessProfileModal";
import type { ExtractionResult, ExtractedInvoice } from "../../core/extraction/models";
import { prefs, getCachedTrialDays } from "../../data/AutoImportPreferences";
import { PROFESSIONAL_PROFILE_LABEL, type ProfessionalProfile } from "../../core/extraction/ProfessionalCategoryDetector";
import { DummyPaymentModal } from "../payment/DummyPaymentModal";


function fmt(paise: number | null | undefined): string {
  if (paise == null) return "—";
  return `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function InvoiceResultModal({ inv, filename, onClose }: { inv: ExtractedInvoice; filename: string; onClose: () => void }) {
  const labelStyle: React.CSSProperties = {
    fontSize: 10, fontWeight: 700, color: "var(--color-text-tertiary)",
    textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2,
  };
  const valStyle: React.CSSProperties = { fontSize: 13, color: "var(--color-text)", fontWeight: 500 };
  const Field = ({ label, value }: { label: string; value: string | null | undefined }) => (
    <div>
      <div style={labelStyle}>{label}</div>
      <div style={valStyle}>{value ?? "—"}</div>
    </div>
  );

  const confidence = Math.round(inv.confidenceScore * 100);
  const gstPct = inv.taxPaise && inv.grandTotalPaise
    ? ((inv.taxPaise / (inv.grandTotalPaise - inv.taxPaise + inv.discountPaise)) * 100).toFixed(1) + "%"
    : null;

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxHeight: "88dvh", maxWidth: 520 }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 4 }}>
          <div>
            <h2 style={{ fontSize: 16, marginBottom: 2 }}>{inv.merchantName ?? "Invoice Details"}</h2>
            <div style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>
              {filename} · AI confidence {confidence}%
            </div>
          </div>
          <button className="btn-sm" onClick={onClose} style={{ padding: "4px 10px", flexShrink: 0 }}>✕</button>
        </div>

        {/* Core fields */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 20px", margin: "14px 0 0" }}>
          <Field label="Invoice No"    value={inv.invoiceNumber} />
          <Field label="Date"          value={fmtDate(inv.invoiceDate)} />
          <div style={{ gridColumn: "1 / -1" }}>
            <Field label="Address"     value={inv.merchantAddress} />
          </div>
          <Field label="Pincode"       value={inv.merchantPincode} />
          <Field label="Phone"         value={inv.merchantPhone} />
          <div style={{ gridColumn: "1 / -1" }}>
            <Field label="GST Number"  value={inv.merchantGstin} />
          </div>
          <Field label="GST %"         value={gstPct} />
          <Field label="GST Amount"    value={fmt(inv.taxPaise)} />
          <Field label="Subtotal"      value={fmt(inv.subtotalPaise)} />
          <Field label="Discount"      value={inv.discountPaise ? fmt(inv.discountPaise) : "—"} />
        </div>

        {/* Final amount highlight */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          margin: "14px 0", padding: "10px 14px",
          background: "var(--accent-subtle)", borderRadius: "var(--radius-sm)",
          border: "1.5px solid var(--color-primary)",
        }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--color-primary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Final Payment</span>
          <span style={{ fontSize: 18, fontWeight: 800, color: "var(--color-primary)", fontVariantNumeric: "tabular-nums" }}>
            {fmt(inv.grandTotalPaise)}
          </span>
        </div>

        {/* Line items */}
        {inv.lineItems.length > 0 && (
          <>
            <div style={{ ...labelStyle, marginBottom: 6 }}>Items ({inv.lineItems.length})</div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                    {["Item", "Qty", "Unit Price", "Discount", "Amount"].map((h) => (
                      <th key={h} style={{ textAlign: h === "Item" ? "left" : "right", padding: "3px 4px 5px", color: "var(--color-text-tertiary)", fontWeight: 600, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {inv.lineItems.map((it, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid var(--color-border)" }}>
                      <td style={{ padding: "5px 4px", color: "var(--color-text)", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</td>
                      <td style={{ padding: "5px 4px", color: "var(--color-text-secondary)", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{it.quantity}</td>
                      <td style={{ padding: "5px 4px", color: "var(--color-text-secondary)", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt(it.unitPricePaise)}</td>
                      <td style={{ padding: "5px 4px", color: it.discountPaise ? "#f59e0b" : "var(--color-text-tertiary)", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                        {it.discountPaise ? fmt(it.discountPaise) : "—"}
                      </td>
                      <td style={{ padding: "5px 4px", color: "var(--color-text)", fontWeight: 600, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt(it.totalPricePaise)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end" }}>
          <button className="btn-sync-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

const SYNC_OPTIONS: { months: number; label: string; pro: boolean }[] = [
  { months: 1, label: "1 month",  pro: false },
  { months: 3, label: "3 months", pro: true  },
];

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
  const label = allSelected ? "All folders" : selected.length === 0 ? "No folders" : `${selected.length} of ${options.length} folders`;
  return (
    <div style={{ display: "inline-block" }}>
      {open && <div style={{ position: "fixed", inset: 0, zIndex: 99 }} onClick={() => setOpen(false)} />}
      <button ref={btnRef} onClick={handleOpen}
        style={{ fontSize: 12, padding: "2px 8px", borderRadius: 6, border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--color-text)", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5 }}>
        {label}<span style={{ fontSize: 10, opacity: 0.55 }}>▾</span>
      </button>
      {open && (
        <div style={{ position: "fixed", top: dropPos.top, left: dropPos.left, zIndex: 100, background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,.14)", minWidth: 210, maxHeight: 260, display: "flex", flexDirection: "column" }}>
          <div style={{ overflowY: "auto", flex: 1, minHeight: 0 }}>
            {options.map((o) => (
              <label key={o.id}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", fontSize: 12.5, cursor: "pointer", color: "var(--color-text)" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--color-surface-2)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ""; }}>
                <input type="checkbox" checked={selectedSet.has(o.id)} onChange={() => toggle(o.id)} style={{ accentColor: "var(--color-primary)" }} />
                {o.label}
              </label>
            ))}
          </div>
          <div style={{ display: "flex", gap: 6, padding: "7px 10px", borderTop: "1px solid var(--color-border)" }}>
            <button onClick={() => onChange(options.map((o) => o.id))}
              style={{ flex: 1, fontSize: 11.5, padding: "3px 6px", borderRadius: 4, border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--color-primary)", cursor: "pointer", fontWeight: 600 }}>All</button>
            <button onClick={() => onChange([fallbackId])}
              style={{ flex: 1, fontSize: 11.5, padding: "3px 6px", borderRadius: 4, border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--color-text-secondary)", cursor: "pointer" }}>Clear</button>
          </div>
        </div>
      )}
    </div>
  );
}

type PendingConsent = "gmail" | "outlook" | "imap" | null;

type FileEntry = { name: string; status: "waiting" | "processing" | "done"; result?: ExtractionResult; invoiceId?: number; cloudSaved?: boolean; cloudSaving?: boolean; savedAs?: string };
type DetailView = { inv: ExtractedInvoice; filename: string };

function buildDuplicateName(inv: ExtractedInvoice, fallback: string): string {
  const sanitize = (s: string) => s.replace(/[/\\:*?"<>|]/g, "_").replace(/\s+/g, "_").trim();
  const parts: string[] = [];
  if (inv.merchantName)  parts.push(sanitize(inv.merchantName).slice(0, 40));
  if (inv.invoiceDate)   parts.push(sanitize(inv.invoiceDate));
  if (inv.invoiceNumber) parts.push(sanitize(inv.invoiceNumber).slice(0, 20));
  return (parts.length ? parts.join("_") : fallback.replace(/\.pdf$/i, "")) + ".pdf";
}

function uploadResultMessage(r: ExtractionResult, savedAs?: string): string {
  if (r.kind === "success")            return `Saved — ${r.invoice.merchantName ?? "Invoice"}`;
  if (r.kind === "lowConfidence")      return `Saved for review (${Math.round(r.invoice.confidenceScore * 100)}% confidence)`;
  if (r.kind === "duplicate")          return savedAs ? `Duplicate saved as ${savedAs}` : `Duplicate — ${r.invoice.merchantName ?? "Invoice"} already saved`;
  if (r.kind === "encryptedPdf")       return "Encrypted PDF — cannot read";
  if (r.kind === "dailyLimitReached")  return `Daily limit reached (${r.limit}/day on Free plan). Upgrade to Pro.`;
  if (r.kind === "pendingExtraction")  return "Queued — open in View tab to extract with AI";
  return `Failed: ${r.reason}`;
}

export function AutoImportSettings() {
  const vm = useAutoImportViewModel();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingConsent, setPendingConsent] = useState<PendingConsent>(null);
  const [syncing, setSyncing]       = useState(() => isSyncing());
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [fileQueue, setFileQueue]   = useState<FileEntry[]>([]);
  const [dragging, setDragging]     = useState(false);
  const [syncMonths,   setSyncMonths]   = useState(() => prefs.syncMonths);
  const [syncSchedule, setSyncSchedule] = useState(() => prefs.syncSchedule);
  const [syncTime,     setSyncTime]     = useState(() => prefs.syncTime);
  const [showProBanner, setShowProBanner] = useState(false);
  const [editingProfileName, setEditingProfileName] = useState(false);
  const [profileNameInput, setProfileNameInput] = useState("");
  const [folderWarning, setFolderWarning] = useState<"sync" | "upload" | null>(null);
  const [manualUploadCount, setManualUploadCount] = useState(0);
  const [uploadLimitMsg, setUploadLimitMsg] = useState<string | null>(null);

  // Bulk history import state
  const [historyMonths, setHistoryMonths] = useState(6);
  const [historyPhase, setHistoryPhase] = useState<"idle" | "downloading" | "extracting" | "done">("idle");
  const [historyProgress, setHistoryProgress] = useState({ saved: 0, found: 0 });
  const [extractProgress, setExtractProgress] = useState({ done: 0, total: 0 });
  const [historyResult, setHistoryResult] = useState<string | null>(null);
  const [pendingAfterImport, setPendingAfterImport] = useState(0);

  const FREE_UPLOAD_LIMIT = 5;

  // Gmail label picker state
  const [gmailLabels,        setGmailLabels]        = useState<{ id: string; name: string }[]>([]);
  const [gmailLabelIds,      setGmailLabelIds]      = useState<string[]>(() => prefs.gmailLabelIds);
  const [gmailLabelsLoading, setGmailLabelsLoading] = useState(false);
  const [gmailLabelsError,   setGmailLabelsError]   = useState<string | null>(null);

  // Outlook folder picker state
  const [outlookFolders,        setOutlookFolders]        = useState<{ id: string; displayName: string }[]>([]);
  const [outlookFolderIds,      setOutlookFolderIds]      = useState<string[]>(() => prefs.outlookFolderIds);
  const [outlookFoldersLoading, setOutlookFoldersLoading] = useState(false);
  const [outlookFoldersError,   setOutlookFoldersError]   = useState<string | null>(null);

  // IMAP multi-account state
  const [imapAccounts,    setImapAccounts]    = useState<ImapAccount[]>(() => ImapConnector.getAccounts());
  const [imapShowForm,    setImapShowForm]    = useState(false);
  const [imapInputEmail,  setImapInputEmail]  = useState("");
  const [imapInputPass,   setImapInputPass]   = useState("");
  const [imapBusy,        setImapBusy]        = useState(false);
  const [imapMsg,         setImapMsg]         = useState<{ ok: boolean; text: string } | null>(null);
  // Per-account folder state keyed by email
  const [imapFolderState, setImapFolderState] = useState<Record<string, { folders: { path: string; name: string }[]; loading: boolean; error: string | null }>>({});

  const handleSyncSelect = (months: number, pro: boolean) => {
    if (pro && !prefs.isSubscribed) { setShowProBanner(true); return; }
    setShowProBanner(false);
    setSyncMonths(months);
    prefs.syncMonths = months;
  };
  const [detailView, setDetailView] = useState<DetailView | null>(null);

  // Plan state
  const [gmailAccounts,   setGmailAccounts]   = useState(() => prefs.gmailAccounts);
  const [outlookAccounts, setOutlookAccounts] = useState(() => prefs.outlookAccounts);

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

  const [showProModal, setShowProModal] = useState(false);
  const [showDummyPayment, setShowDummyPayment] = useState(false);
  const [proName,     setProName]     = useState(() => prefs.customerName);
  const [proEmail,    setProEmail]    = useState(() => prefs.customerEmail);
  const [proLocation, setProLocation] = useState(() => prefs.customerLocation);
  const [proPin,      setProPin]      = useState(() => prefs.customerPin);
  const [proCountry,  setProCountry]  = useState(() => prefs.customerCountry);
  const [proFormErr,  setProFormErr]  = useState<string | null>(null);
  const [trialStartedAt, setTrialStartedAt] = useState(() => prefs.trialStartedAt);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [proEndDate, setProEndDate]   = useState<string | null>(() => prefs.proEndDate);
  const _trialMs = getCachedTrialDays() * 86400000;
  const isInTrial = !!trialStartedAt && Date.now() - new Date(trialStartedAt).getTime() < _trialMs;
  const trialDaysLeft = trialStartedAt ? Math.max(0, Math.ceil((_trialMs - (Date.now() - new Date(trialStartedAt).getTime())) / 86400000)) : 0;
  const trialEndDate = trialStartedAt ? new Date(new Date(trialStartedAt).getTime() + _trialMs) : null;

  const handleStartTrial = () => {
    prefs.startTrial();
    setTrialStartedAt(prefs.trialStartedAt);
  };

  const openProModal = () => {
    setShowDummyPayment(true);
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
    setProEndDate(endDate.toISOString());
    prefs.customerPlan   = "Pro";
    prefs.customerStatus = "Active";
    prefs.isSubscribed   = true;
    setShowProModal(false);
  };


  useEffect(() => {
    if (!isImapAvailable()) return;
    for (const acct of ImapConnector.getAccounts()) {
      refreshImapFolders(acct.email, acct.appPassword);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshGmailLabels = () => {
    const GMAIL_EXCLUDE = new Set([
      "TRASH", "SPAM", "UNREAD", "STARRED", "IMPORTANT", "JUNK",
      "CATEGORY_PROMOTIONS", "CATEGORY_FORUMS", "CATEGORY_SOCIAL",
      "CATEGORY_UPDATES", "CATEGORY_PERSONAL",
    ]);
    const GMAIL_RENAME: Record<string, string> = { INBOX: "Inbox", SENT: "Sent", DRAFT: "Drafts" };
    setGmailLabelsLoading(true);
    setGmailLabelsError(null);
    new GmailConnector().fetchLabels()
      .then((labels) => {
        const filtered = labels
          .filter((l) => { const id = l.id.toUpperCase(); return !GMAIL_EXCLUDE.has(id) && !id.startsWith("CATEGORY_"); })
          .map((l) => ({ ...l, name: GMAIL_RENAME[l.id.toUpperCase()] ?? l.name }));
        setGmailLabels(filtered);
        const allIds = filtered.map((l) => l.id);
        prefs.gmailLabelIds = allIds;
        setGmailLabelIds(allIds);
      })
      .catch((err: unknown) => setGmailLabelsError(err instanceof Error ? err.message : "Failed to load labels"))
      .finally(() => setGmailLabelsLoading(false));
  };

  const refreshOutlookFolders = () => {
    const OUTLOOK_EXCLUDE = new Set([
      "Deleted Items", "Junk Email", "Junk",
      "Outbox", "Trash", "Spam", "Promotions", "Clutter", "Archive",
    ]);
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
      .catch((err: unknown) => setOutlookFoldersError(err instanceof Error ? err.message : "Failed to load folders"))
      .finally(() => setOutlookFoldersLoading(false));
  };

  const refreshImapFolders = (email: string, appPassword: string) => {
    setImapFolderState((prev) => ({ ...prev, [email]: { folders: prev[email]?.folders ?? [], loading: true, error: null } }));
    ImapConnector.fetchFolders(email, appPassword)
      .then((folders) => {
        setImapFolderState((prev) => ({ ...prev, [email]: { folders, loading: false, error: null } }));
        // Pre-select all folders on first connect
        const accounts = ImapConnector.getAccounts();
        const acct = accounts.find((a) => a.email === email);
        if (acct && !acct.folderPaths.length) {
          ImapConnector.setFolderPaths(email, folders.map((f) => f.path));
          setImapAccounts(ImapConnector.getAccounts());
        }
      })
      .catch((err: unknown) => {
        const error = err instanceof Error ? err.message : "Failed to load folders";
        setImapFolderState((prev) => ({ ...prev, [email]: { folders: [], loading: false, error } }));
      });
  };

  useEffect(() => {
    if (vm.state.gmail.isAuthenticated) refreshGmailLabels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vm.state.gmail.isAuthenticated]);

  useEffect(() => {
    if (vm.state.outlook.isAuthenticated) refreshOutlookFolders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vm.state.outlook.isAuthenticated]);

  // Track sync state via module-level events so progress survives tab switches
  useEffect(() => {
    const onStart = () => { setSyncing(true); setSyncResult(null); };
    const onDone  = (e: Event) => {
      const { found, cancelled } = (e as CustomEvent).detail as { found: number; processed: number; cancelled: boolean };
      setSyncing(false);
      if (cancelled) {
        setSyncResult("Sync cancelled.");
      } else {
        setSyncResult(found === 0
          ? "No new PDFs found. Make sure your email has a .pdf attachment."
          : `Found ${found} PDF(s). Saved as Pending AI — click Extract AI on each card to extract.`
        );
      }
    };
    const onError = (e: Event) => {
      setSyncing(false);
      setSyncResult(`Error: ${(e as CustomEvent).detail?.message ?? "Unknown error"}`);
    };
    const onAccountFailed = (e: Event) => {
      const { accounts } = (e as CustomEvent).detail as { accounts: string[] };
      setSyncResult((prev) => {
        const warning = `Session expired for: ${accounts.join(", ")} — reconnect to sync these accounts.`;
        return prev ? `${prev} ${warning}` : warning;
      });
    };
    window.addEventListener("jinvoice:sync-start", onStart);
    window.addEventListener("jinvoice:sync-done",  onDone);
    window.addEventListener("jinvoice:sync-error", onError);
    window.addEventListener("jinvoice:sync-account-failed", onAccountFailed);
    return () => {
      window.removeEventListener("jinvoice:sync-start", onStart);
      window.removeEventListener("jinvoice:sync-done",  onDone);
      window.removeEventListener("jinvoice:sync-error", onError);
      window.removeEventListener("jinvoice:sync-account-failed", onAccountFailed);
    };
  }, []);

  // History import events
  useEffect(() => {
    const onHistStart  = () => { setHistoryPhase("downloading"); setHistoryResult(null); setHistoryProgress({ saved: 0, found: 0 }); };
    const onHistProg   = (e: Event) => setHistoryProgress((e as CustomEvent).detail);
    const onHistDone   = () => { setHistoryPhase("idle"); };
    const onBatchStart = (e: Event) => {
      const { total } = (e as CustomEvent).detail as { total: number };
      setHistoryPhase("extracting");
      setExtractProgress({ done: 0, total });
    };
    const onBatchProg  = (e: Event) => setExtractProgress((e as CustomEvent).detail);
    const onBatchDone  = (e: Event) => {
      const { extracted, errors } = (e as CustomEvent).detail as { extracted: number; errors: number };
      setHistoryPhase("done");
      setHistoryResult(`Done — ${extracted} extracted${errors ? `, ${errors} failed` : ""}.`);
    };
    window.addEventListener("jinvoice:history-start",          onHistStart);
    window.addEventListener("jinvoice:history-progress",       onHistProg);
    window.addEventListener("jinvoice:history-done",           onHistDone);
    window.addEventListener("jinvoice:batch-extract-start",    onBatchStart);
    window.addEventListener("jinvoice:batch-extract-progress", onBatchProg);
    window.addEventListener("jinvoice:batch-extract-done",     onBatchDone);
    return () => {
      window.removeEventListener("jinvoice:history-start",          onHistStart);
      window.removeEventListener("jinvoice:history-progress",       onHistProg);
      window.removeEventListener("jinvoice:history-done",           onHistDone);
      window.removeEventListener("jinvoice:batch-extract-start",    onBatchStart);
      window.removeEventListener("jinvoice:batch-extract-progress", onBatchProg);
      window.removeEventListener("jinvoice:batch-extract-done",     onBatchDone);
    };
  }, []);

  const handleImportHistory = async () => {
    if (!historyMonths && historyMonths !== 0) return;
    setHistoryPhase("downloading");
    setHistoryResult(null);
    const { saved, cancelled } = await pollHistory(historyMonths);
    if (cancelled) {
      setHistoryResult("Import cancelled.");
      setHistoryPhase("idle");
      return;
    }
    const pending = await db.invoices.filter((inv) => inv.status === "pending_extraction").count();
    setPendingAfterImport(pending);
    if (saved === 0) {
      setHistoryResult("No new PDFs found in that period.");
      setHistoryPhase("idle");
    } else {
      setHistoryResult(`Saved ${saved} document${saved === 1 ? "" : "s"}. ${pending} pending AI extraction.`);
      setHistoryPhase("idle");
    }
  };

  const handleBatchExtract = async () => {
    await batchExtractPending();
  };

  const handleCancelBulk = () => {
    cancelBulk();
  };

  // Load manual upload count for free-tier limit tracking
  const refreshManualCount = async () => {
    const count = await db.invoices.where("importSource").equals("manual_upload").count();
    setManualUploadCount(count);
  };
  useEffect(() => { refreshManualCount(); }, []);

  // Auto-sync check on mount
  useEffect(() => {
    const schedule = prefs.syncSchedule;
    if (schedule === "manual") return;
    const hasAnyGmail = prefs.gmailEnabled || prefs.gmailAccounts.some((a) => a.enabled);
    const hasAnyOutlook = prefs.outlookEnabled || prefs.outlookAccounts.some((a) => a.enabled);
    if (!hasAnyGmail && !hasAnyOutlook) return;

    const [hh, mm] = prefs.syncTime.split(":").map(Number);
    const now = new Date();
    const last = prefs.lastAutoSync ? new Date(prefs.lastAutoSync) : null;
    const msInDay = 86400000;
    const threshold = msInDay;
    const scheduledToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm);
    const isDue = now >= scheduledToday && (!last || now.getTime() - last.getTime() >= threshold);
    if (!isDue) return;
    prefs.lastAutoSync = now.toISOString();
    poll().catch(console.error);
  }, []);

  const processFiles = async (filesArg: File[]) => {
    let files = filesArg;
    if (!files.length) return;
    setUploadLimitMsg(null);

    if (!prefs.isProActive) {
      const currentCount = await db.invoices.where("importSource").equals("manual_upload").count();
      const remaining = FREE_UPLOAD_LIMIT - currentCount;
      if (remaining <= 0) {
        setUploadLimitMsg(`Free plan limit reached (${FREE_UPLOAD_LIMIT} manual uploads). Upgrade to Pro for unlimited uploads.`);
        return;
      }
      if (files.length > remaining) {
        setUploadLimitMsg(`Free plan allows ${FREE_UPLOAD_LIMIT} manual uploads total. You can upload ${remaining} more file${remaining === 1 ? "" : "s"}.`);
        files = files.slice(0, remaining);
      }
    }

    const folderReady = prefs.desktopFolderName ? await desktopConnector.restoreFolder() : false;
    setFileQueue(files.map(f => ({ name: f.name, status: "waiting" })));
    for (let i = 0; i < files.length; i++) {
      setFileQueue(q => q.map((e, idx) => idx === i ? { ...e, status: "processing" } : e));
      const r = await processFile(files[i], "manual_upload", undefined, { skipAll: true });
      let invoiceId: number | undefined;
      let savedAs: string | undefined;
      if (r.kind === "success" || r.kind === "lowConfidence" || r.kind === "pendingExtraction") {
        if (folderReady) {
          const bytes = new Uint8Array(await files[i].arrayBuffer());
          await desktopConnector.saveInvoiceToFolder(bytes, files[i].name, "Manual");
        }
        const last = await db.invoices.orderBy("id").last();
        if (last?.id != null) invoiceId = last.id as number;
      } else if (r.kind === "duplicate" && folderReady) {
        const filename = buildDuplicateName(r.invoice, files[i].name);
        const bytes = new Uint8Array(await files[i].arrayBuffer());
        await desktopConnector.saveInvoiceToFolder(bytes, filename, "Duplicates");
        savedAs = filename;
      }
      setFileQueue(q => q.map((e, idx) => idx === i ? { ...e, status: "done", result: r, invoiceId, savedAs } : e));
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
    await refreshManualCount();
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    processFiles(Array.from(e.target.files ?? []));
  };

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setDragging(true); };
  const handleDragLeave = (e: React.DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files).filter(f => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
    processFiles(files);
  };

  const handleSyncNow = async () => {
    if (!prefs.desktopFolderName) { setFolderWarning("sync"); return; }
    if ("showDirectoryPicker" in window) await desktopConnector.restoreFolder();
    poll().catch(() => {});
  };

  const doSyncNow = async () => {
    setFolderWarning(null);
    if ("showDirectoryPicker" in window) await desktopConnector.restoreFolder();
    poll().catch(() => {});
  };

  const handleCancelSync = () => {
    cancelSync();
    setSyncing(false);
    setSyncResult("Sync cancelled.");
  };

  const handleResetSync = async () => {
    await clearAllData();
    setSyncResult("Sync history cleared. Click Sync Now to re-import.");
  };

  const handleImapConnect = async () => {
    if (!imapInputEmail.trim() || !imapInputPass.trim()) {
      setImapMsg({ ok: false, text: "Enter your Gmail username and App Password." });
      return;
    }
    const email = imapInputEmail.trim().replace(/@.*$/, "") + "@gmail.com";
    const pass  = imapInputPass.trim();
    // Duplicate check across all providers
    const allEmails = new Set([
      ...effectiveGmailAccounts.map((a) => a.email.toLowerCase()),
      ...effectiveOutlookAccounts.map((a) => a.email.toLowerCase()),
      ...imapAccounts.map((a) => a.email.toLowerCase()),
    ]);
    if (allEmails.has(email.toLowerCase())) {
      setImapMsg({ ok: false, text: `${email} is already connected.` });
      return;
    }
    setImapBusy(true);
    setImapMsg(null);
    try {
      await ImapConnector.testConnection(email, pass);
      await ImapConnector.addAccount(email, pass);
      setImapAccounts(ImapConnector.getAccounts());
      setImapInputEmail("");
      setImapInputPass("");
      setImapShowForm(false);
      setImapMsg({ ok: true, text: "Connected." });
      refreshImapFolders(email, pass);
    } catch (e) {
      setImapMsg({ ok: false, text: e instanceof Error ? e.message : "Connection failed. Check your App Password." });
    } finally {
      setImapBusy(false);
    }
  };

  const handleImapRemove = async (email: string) => {
    await ImapConnector.removeAccount(email);
    setImapAccounts(ImapConnector.getAccounts());
    setImapFolderState((prev) => { const next = { ...prev }; delete next[email]; return next; });
  };

  const handleConsentAccept = () => {
    if (pendingConsent === "gmail") {
      vm.acceptGmailConsent();
      setPendingConsent(null);
      new GmailConnector().startSignIn();
    } else if (pendingConsent === "outlook") {
      vm.acceptOutlookConsent();
      setPendingConsent(null);
      new OutlookConnector().startSignIn();
    } else if (pendingConsent === "imap") {
      prefs.imapConsentGiven = true;
      setPendingConsent(null);
      setImapShowForm(true);
      setImapMsg(null);
    }
  };

  return (
    <>
    <div className="settings-page">

      {/* Plan — full width */}
      <section className="card">
        {(() => {
          const mode      = prefs.activeMode;
          const planLabel = prefs.isSubscribed ? "Pro" : isInTrial ? "Trial" : "Free";
          const planColor = prefs.isSubscribed ? "#22c55e" : isInTrial ? "#f59e0b" : "var(--color-text-tertiary)";
          const profileLabel = mode === "personal"
            ? "Personal"
            : mode === "society"
              ? "Housing Society"
              : (PROFESSIONAL_PROFILE_LABEL[mode as ProfessionalProfile] ?? mode);
          const profileName = mode === "society" ? prefs.societyName : prefs.customerName;

          const dateNode = isInTrial && trialStartedAt && trialEndDate ? (
            <span style={{ fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.5 }}>
              {new Date(trialStartedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
              {" → "}
              {trialEndDate.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
              <span style={{ marginLeft: 6, color: "#f59e0b", fontWeight: 600 }}>({trialDaysLeft}d left)</span>
            </span>
          ) : prefs.isSubscribed && prefs.customerAccountCreatedAt && proEndDate ? (
            <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
              {new Date(prefs.customerAccountCreatedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
              {" → "}
              {new Date(proEndDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
            </span>
          ) : !prefs.isSubscribed && !isInTrial ? (
            <span style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>No active subscription</span>
          ) : null;

          const actionBtn = !prefs.isSubscribed && !isInTrial ? (
            <button className="btn-sm" style={{ fontWeight: 600 }} onClick={() => setShowProfileModal(true)}>
              Start free trial
            </button>
          ) : isInTrial && !prefs.isSubscribed ? (
            <button className="btn-sm" style={{ fontWeight: 600 }} onClick={openProModal}>
              Upgrade to Pro
            </button>
          ) : null;

          return (
            <div style={{
              display: "flex", alignItems: "stretch",
              background: "var(--color-surface-2)",
              border: "1px solid var(--color-border)",
              borderRadius: 10, overflow: "hidden",
            }}>
              {/* Left: Plan */}
              <div style={{ flex: 1, padding: "14px 16px" }}>
                {/* Row 1: PLAN label + ● Free on same line */}
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.07em", flexShrink: 0 }}>
                    Plan
                  </span>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: planColor, flexShrink: 0, boxShadow: `0 0 0 2px color-mix(in srgb, ${planColor === "var(--color-text-tertiary)" ? "#9898B8" : planColor} 22%, transparent)` }} />
                  <span style={{ fontSize: 14, fontWeight: 800, color: "var(--color-text)", letterSpacing: "-0.01em" }}>{planLabel}</span>
                </div>
                {/* Row 2: dates / "No active subscription" */}
                {dateNode && <div style={{ marginTop: 5, paddingLeft: 2 }}>{dateNode}</div>}
                {/* Row 3: action button */}
                {actionBtn && <div style={{ marginTop: 10, paddingLeft: 2 }}>{actionBtn}</div>}
              </div>

              {/* Divider */}
              <div style={{ width: 1, background: "var(--color-border)", flexShrink: 0 }} />

              {/* Right: Profile (type is locked; name is editable) */}
              <div style={{ padding: "14px 16px", minWidth: 140, display: "flex", flexDirection: "column", justifyContent: "flex-start" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--color-primary)" }}>{profileLabel}</span>
                  <span style={{ fontSize: 10, color: "var(--color-text-tertiary)", fontWeight: 500 }} title="Profile type cannot be changed">🔒</span>
                </div>
                {editingProfileName ? (
                  <div style={{ marginTop: 6, display: "flex", gap: 5, alignItems: "center" }}>
                    <input
                      autoFocus
                      value={profileNameInput}
                      onChange={(e) => setProfileNameInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          if (mode === "society") prefs.societyName = profileNameInput.trim();
                          else prefs.customerName = profileNameInput.trim();
                          setEditingProfileName(false);
                        }
                        if (e.key === "Escape") setEditingProfileName(false);
                      }}
                      placeholder={mode === "society" ? "Society name" : "Your name"}
                      style={{ fontSize: 12, padding: "3px 7px", borderRadius: 5, border: "1px solid var(--color-primary)", background: "var(--color-surface)", color: "var(--color-text)", width: "100%", outline: "none" }}
                    />
                    <button
                      onClick={() => {
                        if (mode === "society") prefs.societyName = profileNameInput.trim();
                        else prefs.customerName = profileNameInput.trim();
                        setEditingProfileName(false);
                      }}
                      style={{ fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 5, border: "none", background: "var(--color-primary)", color: "#fff", cursor: "pointer", flexShrink: 0 }}
                    >✓</button>
                    <button
                      onClick={() => setEditingProfileName(false)}
                      style={{ fontSize: 11, fontWeight: 700, padding: "3px 7px", borderRadius: 5, border: "1px solid var(--color-border)", background: "var(--color-surface-2)", color: "var(--color-text-secondary)", cursor: "pointer", flexShrink: 0 }}
                    >✕</button>
                  </div>
                ) : (
                  <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{ fontSize: 12, color: profileName ? "var(--color-text-secondary)" : "var(--color-text-tertiary)", fontWeight: 500, fontStyle: profileName ? "normal" : "italic" }}>
                      {profileName || (mode === "society" ? "Add society name" : "Add your name")}
                    </span>
                    <button
                      onClick={() => { setProfileNameInput(profileName); setEditingProfileName(true); }}
                      title="Edit name"
                      style={{ background: "none", border: "none", cursor: "pointer", padding: "1px 3px", color: "var(--color-text-tertiary)", fontSize: 11, lineHeight: 1, borderRadius: 3, flexShrink: 0 }}
                    >✎</button>
                  </div>
                )}
              </div>
            </div>
          );
        })()}
      </section>

      {/* Privacy notice — full width */}
      <div className="info-banner">
        <span>🔒</span>
        <span>
          Auto-Import is <strong>off by default</strong>. All processing happens on-device.
          Nothing is ever sent to jInvoice servers.
        </span>
      </div>

      {/* Single column — all cards stacked vertically */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <section className="card"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            style={dragging ? { borderColor: "var(--color-primary)", background: "var(--accent-subtle)", transition: "background 0.15s, border-color 0.15s" } : { transition: "background 0.15s, border-color 0.15s" }}
          >
            <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>
              Manual Upload
              {!prefs.isProActive && (
                <span style={{ fontSize: 11, fontWeight: 600, color: manualUploadCount >= FREE_UPLOAD_LIMIT ? "#ef4444" : "var(--color-text-tertiary)", background: "var(--color-surface-2)", borderRadius: 4, padding: "1px 6px" }}>
                  {manualUploadCount}/{FREE_UPLOAD_LIMIT} free uploads used
                </span>
              )}
            </h3>
            <input ref={fileInputRef} type="file" accept=".pdf" multiple style={{ display: "none" }} onChange={handleFileUpload} />
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <button className="btn-sync"
                onClick={() => {
                  if (!prefs.isProActive && manualUploadCount >= FREE_UPLOAD_LIMIT) {
                    setUploadLimitMsg(`Free plan limit reached (${FREE_UPLOAD_LIMIT} manual uploads). Upgrade to Pro for unlimited uploads.`);
                    return;
                  }
                  if (!prefs.desktopFolderName) { setFolderWarning("upload"); return; }
                  fileInputRef.current?.click();
                }}
                disabled={fileQueue.some(e => e.status !== "done")}
              >
                {fileQueue.some(e => e.status === "waiting" || e.status === "processing") ? "Processing…" : "Choose PDF(s)"}
              </button>
              <span style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>or drag &amp; drop PDFs here</span>
            </div>
            {uploadLimitMsg && (
              <div style={{ marginTop: 8, fontSize: 12, color: "#ef4444", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, padding: "8px 12px" }}>
                {uploadLimitMsg}
              </div>
            )}
            {fileQueue.length > 0 && (
              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 3 }}>
                {fileQueue.map((entry, i) => {
                  const r = entry.result;
                  const isOk  = r?.kind === "success";
                  const isWrn = r?.kind === "lowConfidence";
                  const isPending = r?.kind === "pendingExtraction";
                  const isDup = r?.kind === "duplicate" && !!entry.savedAs;
                  const color = entry.status !== "done" ? "var(--color-text-tertiary)"
                    : isOk      ? "#22c55e"
                    : isWrn     ? "#f59e0b"
                    : isPending ? "#8b5cf6"
                    : isDup     ? "#f97316"
                    : "#ef4444";
                  const icon = entry.status === "waiting"    ? "·"
                    : entry.status === "processing" ? "…"
                    : isOk      ? "✓"
                    : isWrn     ? "⚠"
                    : isPending ? "⏳"
                    : isDup     ? "⧉"
                    : "✗";
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, padding: "5px 8px", borderRadius: 6, background: "var(--color-surface-2)" }}>
                      <span style={{ width: 12, textAlign: "center", color, fontWeight: 700, flexShrink: 0 }}>{icon}</span>
                      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--color-text-secondary)" }}>{entry.name}</span>
                      {entry.status === "done" && r && (
                        <span style={{ fontSize: 11, color, whiteSpace: "nowrap", flexShrink: 0 }}>{uploadResultMessage(r, entry.savedAs)}</span>
                      )}
                      {entry.status === "done" && (r?.kind === "success" || r?.kind === "lowConfidence") && (
                        <>
                          <button
                            onClick={() => setDetailView({ inv: (r as { invoice: ExtractedInvoice }).invoice, filename: entry.name })}
                            style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, border: "1px solid var(--color-primary)", background: "var(--accent-subtle)", color: "var(--color-primary)", cursor: "pointer", flexShrink: 0, fontWeight: 600 }}
                          >
                            View Details
                          </button>
                          {isSupabaseEnabled() && entry.invoiceId != null && !entry.cloudSaved && (
                            <button
                              disabled={entry.cloudSaving}
                              onClick={async () => {
                                setFileQueue(q => q.map((e, idx) => idx === i ? { ...e, cloudSaving: true } : e));
                                try { await syncNewInvoice(entry.invoiceId!); } catch {}
                                setFileQueue(q => q.map((e, idx) => idx === i ? { ...e, cloudSaving: false, cloudSaved: true } : e));
                              }}
                              style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--color-text-secondary)", cursor: entry.cloudSaving ? "wait" : "pointer", flexShrink: 0, fontWeight: 600 }}
                            >
                              {entry.cloudSaving ? "Saving…" : "☁ Save to Cloud"}
                            </button>
                          )}
                          {entry.cloudSaved && (
                            <span style={{ fontSize: 11, color: "#22c55e", flexShrink: 0, fontWeight: 600 }}>☁ Saved</span>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="card">
            <h3>
              Email Accounts
              {!prefs.isSubscribed && (
                <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, color: "var(--color-primary)", background: "color-mix(in srgb, var(--color-primary) 12%, transparent)", padding: "2px 7px", borderRadius: 10 }}>Pro</span>
              )}
            </h3>

            {/* All accounts — one row each */}
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}>
              {effectiveGmailAccounts.map((acct) => {
                const isPrimary = acct.email === primaryGmailEmail;
                return (
                  <div key={acct.email} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: "var(--color-surface-2)", border: "1px solid var(--color-border)", borderRadius: 8 }}>
                    <img src="/icons/gmail.svg" alt="" style={{ width: 16, height: 16, flexShrink: 0 }} />
                    <span style={{ flex: 1, fontSize: 13, color: "var(--color-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{acct.email}</span>
                    <span style={{ fontSize: 11, color: "var(--color-text-tertiary)", flexShrink: 0 }}>Folders</span>
                    {gmailLabels.length === 0 ? (
                      <span style={{ fontSize: 11, color: gmailLabelsError ? "#ef4444" : "var(--color-text-tertiary)" }}>
                        {gmailLabelsLoading ? "Loading…" : gmailLabelsError ?? "—"}
                      </span>
                    ) : (
                      <FolderPicker
                        options={gmailLabels.map((l) => ({ id: l.id, label: l.name }))}
                        selected={gmailLabelIds}
                        fallbackId="INBOX"
                        onChange={(ids) => { prefs.gmailLabelIds = ids; setGmailLabelIds(ids); }}
                      />
                    )}
                    <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, cursor: "pointer", color: "var(--color-text-secondary)", flexShrink: 0 }}>
                      <input type="checkbox" checked={acct.enabled} style={{ accentColor: "var(--color-primary)" }}
                        onChange={(e) => {
                          if (isPrimary) { vm.toggleGmail(e.target.checked); }
                          else { const updated = gmailAccounts.map((a) => a.email === acct.email ? { ...a, enabled: e.target.checked } : a); prefs.gmailAccounts = updated; setGmailAccounts(updated); }
                        }}
                      />
                      Active
                    </label>
                    <button className="btn-ghost-sm" style={{ fontSize: 11, color: "#ef4444", flexShrink: 0 }}
                      onClick={() => { if (isPrimary) { vm.revokeGmail(); } else { const updated = gmailAccounts.filter((a) => a.email !== acct.email); prefs.gmailAccounts = updated; setGmailAccounts(updated); } }}>
                      Remove
                    </button>
                  </div>
                );
              })}

              {effectiveOutlookAccounts.map((acct) => {
                const isPrimary = acct.email === primaryOutlookEmail;
                return (
                  <div key={acct.email} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: "var(--color-surface-2)", border: "1px solid var(--color-border)", borderRadius: 8 }}>
                    <img src="/icons/outlook.svg" alt="" style={{ width: 16, height: 16, flexShrink: 0 }} />
                    <span style={{ flex: 1, fontSize: 13, color: "var(--color-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{acct.email}</span>
                    <span style={{ fontSize: 11, color: "var(--color-text-tertiary)", flexShrink: 0 }}>Folders</span>
                    {outlookFolders.length === 0 ? (
                      <span style={{ fontSize: 11, color: outlookFoldersError ? "#ef4444" : "var(--color-text-tertiary)" }}>
                        {outlookFoldersLoading ? "Loading…" : outlookFoldersError ?? "—"}
                      </span>
                    ) : (
                      <FolderPicker
                        options={outlookFolders.map((f) => ({ id: f.id, label: f.displayName }))}
                        selected={outlookFolderIds}
                        fallbackId="inbox"
                        onChange={(ids) => { prefs.outlookFolderIds = ids; setOutlookFolderIds(ids); }}
                      />
                    )}
                    <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, cursor: "pointer", color: "var(--color-text-secondary)", flexShrink: 0 }}>
                      <input type="checkbox" checked={acct.enabled} style={{ accentColor: "var(--color-primary)" }}
                        onChange={(e) => {
                          if (isPrimary) { vm.toggleOutlook(e.target.checked); }
                          else { const updated = outlookAccounts.map((a) => a.email === acct.email ? { ...a, enabled: e.target.checked } : a); prefs.outlookAccounts = updated; setOutlookAccounts(updated); }
                        }}
                      />
                      Active
                    </label>
                    <button className="btn-ghost-sm" style={{ fontSize: 11, color: "#ef4444", flexShrink: 0 }}
                      onClick={() => { if (isPrimary) { vm.revokeOutlook(); } else { const updated = outlookAccounts.filter((a) => a.email !== acct.email); prefs.outlookAccounts = updated; setOutlookAccounts(updated); } }}>
                      Remove
                    </button>
                  </div>
                );
              })}

              {imapAccounts.map((acct) => {
                const st = imapFolderState[acct.email] ?? { folders: [], loading: false, error: null };
                return (
                  <div key={acct.email} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: "var(--color-surface-2)", border: "1px solid var(--color-border)", borderRadius: 8 }}>
                    <img src="/icons/mail.svg" alt="" style={{ width: 16, height: 16, flexShrink: 0 }} />
                    <span style={{ fontSize: 10, fontWeight: 700, color: "#6366f1", background: "color-mix(in srgb, #6366f1 12%, transparent)", borderRadius: 4, padding: "1px 5px", flexShrink: 0, letterSpacing: "0.04em" }}>IMAP</span>
                    <span style={{ flex: 1, fontSize: 13, color: "var(--color-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{acct.email}</span>
                    <span style={{ fontSize: 11, color: "var(--color-text-tertiary)", flexShrink: 0 }}>Folders</span>
                    {st.folders.length === 0 ? (
                      <span style={{ fontSize: 11, color: st.error ? "#ef4444" : "var(--color-text-tertiary)" }}>
                        {st.loading ? "Loading…" : st.error ?? "—"}
                      </span>
                    ) : (
                      <FolderPicker
                        options={st.folders.map((f) => ({ id: f.path, label: f.name }))}
                        selected={acct.folderPaths}
                        fallbackId="INBOX"
                        onChange={(paths) => { ImapConnector.setFolderPaths(acct.email, paths); setImapAccounts(ImapConnector.getAccounts()); }}
                      />
                    )}
                    <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, cursor: "pointer", color: "var(--color-text-secondary)", flexShrink: 0 }}>
                      <input type="checkbox" checked={acct.enabled} style={{ accentColor: "var(--color-primary)" }}
                        onChange={(e) => { ImapConnector.setEnabled(acct.email, e.target.checked); setImapAccounts(ImapConnector.getAccounts()); }}
                      />
                      Active
                    </label>
                    <button className="btn-ghost-sm" style={{ fontSize: 11, color: "#ef4444", flexShrink: 0 }} onClick={() => handleImapRemove(acct.email)}>Remove</button>
                  </div>
                );
              })}

              {totalAccounts === 0 && imapAccounts.length === 0 && (
                <p style={{ fontSize: 12.5, color: "var(--color-text-tertiary)", padding: "4px 0 4px" }}>No accounts connected. Add one below.</p>
              )}
            </div>

            {/* Add account buttons */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              {isImapAvailable() && (
                <button className="btn-sm" onClick={() => {
                  if (!prefs.imapConsentGiven) { setPendingConsent("imap"); }
                  else { setImapShowForm((v) => !v); setImapMsg(null); }
                }}>
                  {imapShowForm ? "Cancel" : "+ Add via IMAP"}
                </button>
              )}
              {!prefs.isSubscribed && totalAccounts >= MAX_ACCOUNTS && (
                <span style={{ fontSize: 12, color: "var(--color-text-tertiary)", alignSelf: "center" }}>Upgrade to Pro for more accounts</span>
              )}
            </div>

            {/* IMAP inline form */}
            {isImapAvailable() && imapShowForm && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10, padding: "10px 12px", background: "var(--color-surface-2)", borderRadius: 8, border: "1px solid var(--color-border)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 0, border: "1px solid var(--color-border)", borderRadius: 6, overflow: "hidden", background: "var(--color-surface)" }}>
                  <input
                    className="settings-input"
                    type="text"
                    placeholder="username"
                    value={imapInputEmail}
                    onChange={(e) => setImapInputEmail(e.target.value.replace(/@.*$/, "").replace(/\s/g, ""))}
                    style={{ fontSize: 13, border: "none", borderRadius: 0, flex: 1, minWidth: 0 }}
                  />
                  <span style={{ fontSize: 13, color: "var(--color-text-secondary)", background: "var(--color-surface-2)", padding: "0 10px", borderLeft: "1px solid var(--color-border)", whiteSpace: "nowrap", lineHeight: "36px" }}>
                    @gmail.com
                  </span>
                </div>
                <input className="settings-input" type="password" placeholder="App Password (16 chars)" value={imapInputPass} onChange={(e) => setImapInputPass(e.target.value)} style={{ fontSize: 13 }} />
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button className="btn-sync-primary" onClick={handleImapConnect} disabled={imapBusy} style={{ fontSize: 13 }}>
                    {imapBusy ? "Connecting…" : "Connect"}
                  </button>
                  <a
                    href="https://myaccount.google.com/apppasswords"
                    target="_blank" rel="noopener noreferrer"
                    style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}
                  >
                    How to get an App Password ↗
                  </a>
                </div>
                {imapMsg && <div style={{ fontSize: 12, color: imapMsg.ok ? "#22c55e" : "#ef4444" }}>{imapMsg.text}</div>}
              </div>
            )}

            <div className="sync-actions">
              {(vm.state.gmail.enabled || vm.state.outlook.enabled || imapAccounts.some((a) => a.enabled)) ? (
                <>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <button className="btn-sync-primary" onClick={handleSyncNow} disabled={syncing}>
                      {syncing ? "Syncing…" : (() => {
                        const n = effectiveGmailAccounts.filter(a => a.enabled).length + effectiveOutlookAccounts.filter(a => a.enabled).length;
                        return n > 1 ? `Sync Now (${n})` : "Sync Now";
                      })()}
                    </button>
                    {syncing && (
                      <button className="btn-sync" style={{ color: "var(--color-danger)" }} onClick={handleCancelSync}>Cancel</button>
                    )}
                  </div>
                  {syncResult && (
                    <p style={{ fontSize: 12.5, color: "var(--color-text-secondary)" }}>{syncResult}</p>
                  )}
                  {!syncing && (
                    <button className="btn-sync" style={{ color: "var(--color-danger)" }} onClick={handleResetSync}>Reset sync history</button>
                  )}
                </>
              ) : (
                <p style={{ fontSize: 12.5, color: "var(--color-text-tertiary)", textAlign: "center", padding: "4px 0" }}>
                  Enable an account above to sync emails automatically.
                </p>
              )}
            </div>
          </section>

          {/* Sync schedule */}
          <section className="card">
            <h3>Sync Schedule</h3>
            <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 13, color: "var(--color-text-secondary)", whiteSpace: "nowrap" }}>Look back</span>
                <select
                  className="settings-input"
                  style={{ maxWidth: 120 }}
                  value={syncMonths}
                  onChange={(e) => {
                    const opt = SYNC_OPTIONS.find((o) => o.months === Number(e.target.value));
                    if (opt) handleSyncSelect(opt.months, opt.pro);
                  }}
                >
                  {SYNC_OPTIONS.map((opt) => (
                    <option key={opt.months} value={opt.months}>{opt.label}{opt.pro ? " — Pro" : ""}</option>
                  ))}
                </select>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 13, color: "var(--color-text-secondary)", whiteSpace: "nowrap" }}>Frequency</span>
                <select
                  className="settings-input"
                  style={{ maxWidth: 120 }}
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
                </select>
              </div>
              {syncSchedule !== "manual" && (
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 13, color: "var(--color-text-secondary)", whiteSpace: "nowrap" }}>Sync at</span>
                  <input
                    type="time"
                    className="settings-input"
                    style={{ maxWidth: 110 }}
                    value={syncTime}
                    onChange={(e) => {
                      prefs.syncTime = e.target.value;
                      setSyncTime(e.target.value);
                      schedulePolling();
                    }}
                  />
                </div>
              )}
            </div>
            {showProBanner && (
              <div className="settings-pro-banner" style={{ marginTop: 12 }}>
                <strong>Subscription required</strong>
                <p>Syncing beyond 3 months requires a Pro subscription.</p>
                <button className="settings-pro-cta" onClick={openProModal}>Upgrade to Pro</button>
              </div>
            )}
          </section>

          {/* ── Bulk history import ──────────────────────────────── */}
          {(vm.state.gmail.enabled || vm.state.outlook.enabled || ImapConnector.getAccounts().some((a) => a.enabled)) && (
            <section className="card" style={{ position: "relative" }}>
              <h3>Import History</h3>
              <p style={{ fontSize: 12.5, color: "var(--color-text-secondary)", marginBottom: 12 }}>
                Download all email attachments from the past N months and save them locally first.
                AI extraction runs separately so you can process in bulk without blocking the regular sync.
              </p>

              {/* Pro gate overlay — requires paid subscription (trial not included) */}
              {!prefs.isSubscribed && (
                <div style={{
                  position: "absolute", inset: 0, borderRadius: "inherit",
                  background: "color-mix(in srgb, var(--color-surface) 88%, transparent)",
                  backdropFilter: "blur(3px)",
                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                  gap: 10, zIndex: 2, padding: 24, textAlign: "center",
                }}>
                  <span style={{ fontSize: 22 }}>🔒</span>
                  <p style={{ fontSize: 13.5, fontWeight: 600, color: "var(--color-text)", margin: 0 }}>
                    Import History requires a paid Pro plan
                  </p>
                  <p style={{ fontSize: 12.5, color: "var(--color-text-secondary)", margin: 0, maxWidth: 280 }}>
                    Upgrade to Pro to bulk-import months of email history and extract invoices in one go.
                  </p>
                  <button className="settings-pro-cta" onClick={openProModal}>Upgrade to Pro</button>
                </div>
              )}

              <div style={{ opacity: prefs.isSubscribed ? 1 : 0.25, pointerEvents: prefs.isSubscribed ? "auto" : "none" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>Look back</span>
                  <select
                    className="settings-input"
                    style={{ maxWidth: 130 }}
                    value={historyMonths}
                    disabled={historyPhase === "downloading" || historyPhase === "extracting"}
                    onChange={(e) => setHistoryMonths(Number(e.target.value))}
                  >
                    <option value={1}>1 month</option>
                    <option value={3}>3 months</option>
                    <option value={6}>6 months</option>
                    <option value={12}>12 months</option>
                    <option value={24}>24 months</option>
                    <option value={0}>All time</option>
                  </select>
                </div>

                {historyPhase === "idle" && (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <button className="btn-sync-primary" onClick={handleImportHistory}>
                      Import History
                    </button>
                    {pendingAfterImport > 0 && (
                      <button className="btn-sync-primary" onClick={handleBatchExtract}>
                        Extract {pendingAfterImport} with AI
                      </button>
                    )}
                  </div>
                )}

                {historyPhase === "downloading" && (
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <div style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
                      Downloading… {historyProgress.saved}
                      {historyProgress.found > 0 ? ` of ${historyProgress.found}` : ""} PDFs saved
                    </div>
                    <button className="btn-sync" style={{ color: "var(--color-danger)" }} onClick={handleCancelBulk}>Cancel</button>
                  </div>
                )}

                {historyPhase === "extracting" && (
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <div style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
                      Extracting… {extractProgress.done} of {extractProgress.total}
                    </div>
                    <button className="btn-sync" style={{ color: "var(--color-danger)" }} onClick={handleCancelBulk}>Cancel</button>
                  </div>
                )}

                {historyPhase === "done" && historyResult && (
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>{historyResult}</span>
                    <button className="btn-sync" onClick={() => { setHistoryPhase("idle"); setHistoryResult(null); setPendingAfterImport(0); }}>
                      Done
                    </button>
                  </div>
                )}

                {historyPhase === "idle" && historyResult && (
                  <p style={{ fontSize: 12.5, color: "var(--color-text-secondary)", marginTop: 8 }}>{historyResult}</p>
                )}
              </div>
            </section>
          )}

      </div>{/* end single column */}

    </div>

    {folderWarning && (
      <div
        className="modal-overlay"
        onClick={() => setFolderWarning(null)}
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
      >
        <div
          className="modal"
          onClick={(e) => e.stopPropagation()}
          style={{ maxWidth: 380, width: "90%", padding: 24, borderRadius: 12, background: "var(--color-surface)", boxShadow: "0 8px 32px rgba(0,0,0,0.2)" }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
            <span style={{ fontSize: 22, lineHeight: 1 }}>📁</span>
            <div>
              <h3 style={{ fontSize: 15, marginBottom: 4 }}>No local folder selected</h3>
              <p style={{ fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.5, margin: 0 }}>
                PDFs will be saved inside the app only. To also copy them to a folder on your device, set a local folder in{" "}
                <strong>Settings → Desktop Folder</strong> first.
              </p>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button className="btn-sm" onClick={() => setFolderWarning(null)}>Cancel</button>
            <button
              className="btn-sync-primary"
              onClick={() => {
                if (folderWarning === "sync") { doSyncNow(); }
                else { setFolderWarning(null); setTimeout(() => fileInputRef.current?.click(), 50); }
              }}
            >
              Continue anyway
            </button>
          </div>
        </div>
      </div>
    )}

    {pendingConsent && (
      <ConsentModal
        provider={pendingConsent === "gmail" ? "Gmail" : pendingConsent === "outlook" ? "Outlook" : "IMAP"}
        onAccept={handleConsentAccept}
        onDecline={() => setPendingConsent(null)}
      />
    )}

    {detailView && (
      <InvoiceResultModal
        inv={detailView.inv}
        filename={detailView.filename}
        onClose={() => setDetailView(null)}
      />
    )}

    {/* Pro upgrade modal */}

    {showProfileModal && (
      <BusinessProfileModal
        onConfirm={() => {
          setShowProfileModal(false);
          prefs.businessProfileCompleted = true;
          if (auth.email) {
            try {
              const p = JSON.parse(localStorage.getItem("jinvoice:business_profile") ?? "null");
              if (p) {
                saveCustomerBusinessProfile(auth.email, {
                  business_type:        p.businessType,
                  business_address:     p.address,
                  business_pin:         p.pin,
                  business_state:       p.state,
                  business_country:     p.country,
                  license_count:        p.licenses || null,
                  profile_completed_at: new Date().toISOString(),
                });
                saveCustomerPlan(auth.email, {
                  plan: "pro_shared",
                  plan_status: "trial",
                  billing_cycle: "monthly",
                  trial_started_at: new Date().toISOString(),
                });
              }
            } catch {}
          }
          handleStartTrial();
        }}
        onClose={() => setShowProfileModal(false)}
      />
    )}
    {showDummyPayment && (
      <DummyPaymentModal
        apiOption="shared"
        billing="monthly"
        totalPaise={99900}
        onSuccess={(plan) => {
          setShowDummyPayment(false);
          setProEndDate(plan.paid_until ?? null);
        }}
        onClose={() => setShowDummyPayment(false)}
      />
    )}
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
          <div style={{ display: "flex", gap: 10, marginBottom: 16, fontSize: 12, color: "var(--color-text-secondary)" }}>
            <span style={{ background: "var(--color-primary)", color: "#fff", borderRadius: 4, padding: "2px 8px", fontWeight: 600 }}>Pro</span>
            <span>Active</span>
            <span style={{ marginLeft: "auto" }}>Since {new Date().toLocaleDateString()}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "block", marginBottom: 4 }}>Full Name *</label>
              <input className="settings-input" style={{ width: "100%" }} placeholder="Your name" value={proName} onChange={(e) => setProName(e.target.value)} autoFocus />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "block", marginBottom: 4 }}>Email *</label>
              <input className="settings-input" style={{ width: "100%" }} placeholder="you@example.com" type="email" value={proEmail} onChange={(e) => setProEmail(e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "block", marginBottom: 4 }}>Location / City</label>
              <input className="settings-input" style={{ width: "100%" }} placeholder="City or area" value={proLocation} onChange={(e) => setProLocation(e.target.value)} />
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "block", marginBottom: 4 }}>PIN / ZIP</label>
                <input className="settings-input" style={{ width: "100%" }} placeholder="PIN code" value={proPin} onChange={(e) => setProPin(e.target.value)} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "block", marginBottom: 4 }}>Country</label>
                <input className="settings-input" style={{ width: "100%" }} placeholder="Country" value={proCountry} onChange={(e) => setProCountry(e.target.value)} />
              </div>
            </div>
          </div>
          {proFormErr && <p style={{ fontSize: 12, color: "#ef4444", marginTop: 10 }}>{proFormErr}</p>}
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
