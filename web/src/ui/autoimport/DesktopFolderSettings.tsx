import { useState, useEffect } from "react";
import { desktopConnector } from "../../service/AutoImportService";

interface Props {
  folderName: string | null;
  onFolderSet: (name: string | null) => void;
  onScanFiles?: (files: File[]) => Promise<string>;
}

export function DesktopFolderSettings({ folderName, onFolderSet }: Props) {
  // Electron (127.0.0.1) uses /api/pick-folder-local for a native OS dialog.
  // Desktop browsers use showDirectoryPicker. Everything else → text input.
  const [supported] = useState<boolean>(() =>
    typeof window !== "undefined" &&
    (window.location.hostname === "127.0.0.1" || "showDirectoryPicker" in window)
  );
  const [safariInput, setSafariInput] = useState(folderName ?? "");

  useEffect(() => {
    setSafariInput(folderName ?? "");
  }, [folderName]);

  const handlePick = async () => {
    const name = await desktopConnector.requestFolder();
    if (name) onFolderSet(name);
  };

  const handleSafariSet = () => {
    const name = safariInput.trim();
    if (name) onFolderSet(name);
  };

  const handleRemove = () => { onFolderSet(null); setSafariInput(""); };

  return (
    <div className="folder-row">
      <span className="folder-icon">📁</span>
      <div className="folder-info">
        <div className="folder-label">Desktop folder</div>
        {folderName ? (
          <>
            <div className="folder-sub">Save folder: <strong>{folderName}</strong></div>
            <div className="folder-sub">
              {supported
                ? "PDFs from email sync are saved here, sorted by document type. New PDFs dropped in are also auto-imported."
                : "PDFs from email sync are saved here, sorted by document type."}
            </div>
          </>
        ) : (
          <div className="folder-sub">Pick a folder where synced PDFs will be saved and auto-imported.</div>
        )}
      </div>
      <div className="folder-actions">
        {supported ? (
          <>
            <button className="btn-sm" onClick={handlePick}>
              {folderName ? "Change" : "Set folder"}
            </button>
            {folderName && (
              <button className="btn-sm btn-danger" onClick={handleRemove}>Remove</button>
            )}
          </>
        ) : (
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <input
              type="text"
              value={safariInput}
              onChange={(e) => setSafariInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSafariSet()}
              placeholder="Folder name"
              style={{ fontSize: 13, padding: "4px 8px", borderRadius: 6, border: "1px solid var(--color-border)", background: "var(--color-bg)", color: "var(--color-text)", width: 160 }}
            />
            <button className="btn-sm" onClick={handleSafariSet} disabled={!safariInput.trim()}>Set</button>
            {folderName && <button className="btn-sm btn-danger" onClick={handleRemove}>Remove</button>}
          </div>
        )}
      </div>
    </div>
  );
}
