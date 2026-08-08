import React, { useEffect, useRef, useState } from "react";
import { useAutoImportViewModel } from "./useAutoImportViewModel";
import { ConsentModal } from "./ConsentModal";
import { DesktopFolderSettings } from "./DesktopFolderSettings";
import { GmailConnector } from "../../autoimport/GmailConnector";
import { OutlookConnector } from "../../autoimport/OutlookConnector";
import { poll, desktopConnector } from "../../service/AutoImportService";
import { clearAllData } from "../../data/InvoiceDatabase";
import { processFile } from "../../extraction/ExtractionPipeline";
import type { ExtractionResult } from "../../core/extraction/models";
import { prefs } from "../../data/AutoImportPreferences";
import { DOC_TYPE_LABELS, DOC_TYPE_SUBFOLDER, detectDocType, type DocType } from "../../extraction/DocTypeDetector";
import { isFsAccessSupported } from "../../autoimport/DesktopFolderConnector";

const ALL_DOC_TYPES = Object.keys(DOC_TYPE_LABELS) as DocType[];

type PendingConsent = "gmail" | "outlook" | null;

function uploadResultMessage(r: ExtractionResult): string {
  if (r.kind === "success")       return `Saved — ${r.invoice.merchantName ?? "Invoice"}`;
  if (r.kind === "lowConfidence") return `Saved for review (${Math.round(r.invoice.confidenceScore * 100)}% confidence)`;
  if (r.kind === "encryptedPdf")  return "Encrypted PDF — cannot read";
  return `Failed: ${r.reason}`;
}

export function AutoImportSettings() {
  const vm = useAutoImportViewModel();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingConsent, setPendingConsent] = useState<PendingConsent>(null);
  const [syncing, setSyncing]       = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [syncError, setSyncError]   = useState<string | null>(null);
  const [uploading, setUploading]   = useState(false);
  const [uploadMsg, setUploadMsg]   = useState<string | null>(null);
  const [docTypes, setDocTypes]     = useState<string[]>(() => prefs.importDocTypes);
  const [syncMonths, setSyncMonths] = useState(() => prefs.syncMonths);
  const [fsSupported, setFsSupported] = useState(false);

  useEffect(() => { isFsAccessSupported().then(setFsSupported); }, []);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    // Restore folder permission first while user-activation from file picker is still fresh
    const folderReady = prefs.desktopFolderName
      ? await desktopConnector.restoreFolder()
      : false;
    setUploading(true);
    setUploadMsg(null);
    const msgs: string[] = [];
    for (const file of files) {
      const r = await processFile(file, "manual_upload");
      if (folderReady && (r.kind === "success" || r.kind === "lowConfidence")) {
        const lineItemNames = r.invoice.lineItems.map((li) => li.name);
        const docTypes = detectDocType(r.invoice.merchantName, lineItemNames, file.name);
        const bytes = new Uint8Array(await file.arrayBuffer());
        for (const dt of docTypes) {
          await desktopConnector.saveInvoiceToFolder(bytes, file.name, DOC_TYPE_SUBFOLDER[dt]);
        }
        const subfolders = docTypes.map((dt) => DOC_TYPE_SUBFOLDER[dt]).join(" + ");
        msgs.push(`${file.name}: Saved to ${prefs.desktopFolderName}/${subfolders}`);
      } else {
        msgs.push(`${file.name}: ${uploadResultMessage(r)}`);
      }
    }
    setUploadMsg(msgs.join("\n"));
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDocTypeToggle = (type: DocType) => {
    const next = docTypes.includes(type)
      ? docTypes.filter((t) => t !== type)
      : [...docTypes, type];
    setDocTypes(next);
    prefs.importDocTypes = next;
  };

  const handleFolderScan = async (files: File[]): Promise<string> => {
    const msgs: string[] = [];
    for (const file of files) {
      const r = await processFile(file, "manual_upload");
      msgs.push(`${file.name}: ${uploadResultMessage(r)}`);
    }
    return msgs.join("\n");
  };

  const handleSyncNow = async () => {
    setSyncing(true);
    setSyncResult(null);
    setSyncError(null);
    // Re-grant folder permission while the user gesture is still active.
    // Skip on mobile where the File System Access API is unavailable.
    if (fsSupported) await desktopConnector.restoreFolder();
    try {
      const result = await poll();
      setSyncResult(result.found === 0
        ? "No new PDFs found. Make sure your email has a .pdf attachment."
        : `Found ${result.found} PDF(s). Processed ${result.processed}.`
      );
    } catch (e) {
      setSyncResult(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSyncing(false);
    }
  };

  const handleResetSync = async () => {
    await clearAllData();
    setSyncResult("Sync history cleared. Click Sync Now to re-import.");
  };

  const handleGmailToggle = (e: React.ChangeEvent<HTMLInputElement>) => {
    const enabled = e.target.checked;
    if (enabled && !vm.state.gmail.hasConsent) {
      setPendingConsent("gmail");
    } else if (enabled && !vm.state.gmail.isAuthenticated) {
      new GmailConnector().startSignIn();
    } else {
      vm.toggleGmail(enabled);
    }
  };

  const handleOutlookToggle = (e: React.ChangeEvent<HTMLInputElement>) => {
    const enabled = e.target.checked;
    if (enabled && !vm.state.outlook.hasConsent) {
      setPendingConsent("outlook");
    } else if (enabled && !vm.state.outlook.isAuthenticated) {
      new OutlookConnector().startSignIn();
    } else {
      vm.toggleOutlook(enabled);
    }
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
    }
  };

  return (
    <div className="settings-page">
      <section className="card">
        <h3>Manual Upload</h3>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf"
          multiple
          style={{ display: "none" }}
          onChange={handleFileUpload}
        />
        <button
          className="btn-sync"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? "Processing…" : "Choose PDF(s)"}
        </button>
        {uploadMsg && (
          <pre style={{ fontSize: 12, marginTop: 8, color: "var(--color-text-secondary)", whiteSpace: "pre-wrap" }}>
            {uploadMsg}
          </pre>
        )}
      </section>

      {pendingConsent && (
        <ConsentModal
          provider={pendingConsent === "gmail" ? "Gmail" : "Outlook"}
          onAccept={handleConsentAccept}
          onDecline={() => setPendingConsent(null)}
        />
      )}

      <div className="info-banner">
        <span>🔒</span>
        <span>
          Auto-Import is <strong>off by default</strong>. All processing happens on-device.
          Nothing is ever sent to jInvoice servers.
        </span>
      </div>

      <section className="card">
        <h3>Document Types</h3>
        <p style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 12 }}>
          Select which types to import. PDFs that don't match are skipped.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {ALL_DOC_TYPES.map((type) => (
            <label key={type} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={docTypes.includes(type)}
                onChange={() => handleDocTypeToggle(type)}
              />
              {DOC_TYPE_LABELS[type]}
            </label>
          ))}
        </div>
      </section>

      <section className="card">
        <h3>Email Connectors</h3>

        <div className="connector-row">
          <img src="/icons/gmail.svg" alt="" className="connector-logo" />
          <div className="connector-info">
            <div className="connector-name">Gmail</div>
            {vm.state.gmail.email && (
              <div className="connector-email">{vm.state.gmail.email}</div>
            )}
            {vm.state.gmail.isAuthenticated && (
              <button className="btn-link-danger" onClick={vm.revokeGmail}>
                Revoke access
              </button>
            )}
          </div>
          <label className="toggle">
            <input
              type="checkbox"
              checked={vm.state.gmail.enabled}
              onChange={handleGmailToggle}
            />
            <span className="toggle-slider" />
          </label>
        </div>

        <div className="connector-row">
          <img src="/icons/outlook.svg" alt="" className="connector-logo" />
          <div className="connector-info">
            <div className="connector-name">Outlook</div>
            {vm.state.outlook.email && (
              <div className="connector-email">{vm.state.outlook.email}</div>
            )}
            {vm.state.outlook.isAuthenticated && (
              <button className="btn-link-danger" onClick={vm.revokeOutlook}>
                Revoke access
              </button>
            )}
          </div>
          <label className="toggle">
            <input
              type="checkbox"
              checked={vm.state.outlook.enabled}
              onChange={handleOutlookToggle}
            />
            <span className="toggle-slider" />
          </label>
        </div>

        <div className="sync-actions">
          {(vm.state.gmail.enabled || vm.state.outlook.enabled) ? (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <label style={{ fontSize: 12.5, color: "var(--color-text-secondary)", whiteSpace: "nowrap" }}>
                  Sync window
                </label>
                <select
                  value={syncMonths}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    prefs.syncMonths = v;
                    setSyncMonths(v);
                  }}
                  style={{ fontSize: 12.5, padding: "2px 6px", borderRadius: 6, border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--color-text)", flex: 1 }}
                >
                  <option value={1}>Last 1 month</option>
                  <option value={3}>Last 3 months</option>
                  <option value={6}>Last 6 months</option>
                  <option value={12}>Last 1 year</option>
                  <option value={0}>All time</option>
                </select>
              </div>
              <button className="btn-sync-primary" onClick={handleSyncNow} disabled={syncing}>
                {syncing ? "Syncing…" : "Sync Now"}
              </button>
              {syncError && (
                <p style={{ fontSize: 12.5, color: "var(--color-danger)" }}>{syncError}</p>
              )}
              {syncResult && (
                <p style={{ fontSize: 12.5, color: "var(--color-text-secondary)" }}>{syncResult}</p>
              )}
              <button className="btn-sync" style={{ color: "var(--color-danger)" }} onClick={handleResetSync} disabled={syncing}>
                Reset sync history
              </button>
            </>
          ) : (
            <p style={{ fontSize: 12.5, color: "var(--color-text-tertiary)", textAlign: "center", padding: "4px 0" }}>
              Enable Gmail or Outlook above to sync emails automatically.
            </p>
          )}
        </div>
      </section>

      <section className="card">
        <h3>Desktop Folder</h3>
        <DesktopFolderSettings
          folderName={vm.state.desktopFolderName}
          onFolderSet={vm.setDesktopFolder}
          onScanFiles={handleFolderScan}
        />
      </section>
    </div>
  );
}
