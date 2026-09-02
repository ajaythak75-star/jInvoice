import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type InvoiceMeta, type LineItemRow } from "../../data/InvoiceDatabase";
import { desktopConnector } from "../../service/AutoImportService";
import { prefs } from "../../data/AutoImportPreferences";
import { generateInvoicePdf, invoicePdfFilename } from "../../service/InvoicePdfGenerator";
import { DOC_TYPE_SUBFOLDER, type DocType } from "../../extraction/DocTypeDetector";
import { SOCIETY_CATEGORY_LABEL, type SocietyExpenseCategory } from "../../core/extraction/SocietyExpenseDetector";

async function downloadInvoicePdf(
  inv: InvoiceMeta,
  lineItems: LineItemRow[],
  folderReady: boolean,
): Promise<"folder" | "browser"> {
  const buf      = generateInvoicePdf(inv, lineItems);   // ArrayBuffer
  const filename = invoicePdfFilename(inv);

  if (folderReady) {
    const detectedType = (inv.docType as DocType | undefined) ?? "invoice";
    const subfolder = DOC_TYPE_SUBFOLDER[detectedType] ?? DOC_TYPE_SUBFOLDER["invoice"];
    const ok = await desktopConnector.saveInvoiceToFolder(new Uint8Array(buf), filename, subfolder);
    if (ok) return "folder";
  }

  const blob = new Blob([buf], { type: "application/pdf" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return "browser";
}

function formatAmount(paise: number | null): string {
  if (paise == null) return "—";
  return `₹${(paise / 100).toFixed(2)}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function statusLabel(status: string): { text: string; color: string } {
  switch (status) {
    case "imported":           return { text: "Imported",     color: "#22c55e" };
    case "pending_review":     return { text: "Needs Review", color: "#f59e0b" };
    case "encryptedPdf":
    case "import_blocked_encrypted": return { text: "Encrypted", color: "#ef4444" };
    case "extraction_failed":  return { text: "Failed",       color: "#ef4444" };
    default:                   return { text: status,         color: "#6b7280" };
  }
}

function FieldRow({ label, value, found }: { label: string; value: string; found: boolean }) {
  return (
    <div className="review-field-row">
      <span className="review-field-icon">{found ? "✅" : "❌"}</span>
      <span className="review-field-label">{label}</span>
      <span className={`review-field-value ${found ? "" : "review-field-value--missing"}`}>
        {found ? value : "Not found"}
      </span>
    </div>
  );
}

function ReviewPanel({ inv, lineItems, onClose }: { inv: InvoiceMeta; lineItems: LineItemRow[]; onClose: () => void }) {
  const isSociety = prefs.userType === "society";
  const [category, setCategory] = useState(inv.category ?? "");
  const [customCategories, setCustomCategories] = useState<string[]>(() => prefs.customSocietyCategories);
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCatInput, setNewCatInput] = useState("");

  const handleCategoryChange = async (val: string) => {
    setCategory(val);
    if (inv.id != null) await db.invoices.update(inv.id, { category: val });
  };

  const handleAddCategory = async () => {
    const val = newCatInput.trim();
    setAddingCategory(false);
    setNewCatInput("");
    if (!val) return;
    const updated = [...customCategories, val];
    prefs.customSocietyCategories = updated;
    setCustomCategories(updated);
    await handleCategoryChange(val);
  };

  const isPending = inv.status === "pending_review";
  const flags = [
    inv.merchantName != null,
    inv.invoiceDate != null,
    inv.grandTotalPaise != null,
    inv.paymentMode != null && inv.paymentMode !== "unknown",
  ];
  const foundCount = flags.filter(Boolean).length;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="review-header">
          <div>
            <h2 style={{ fontSize: 18 }}>{inv.merchantName ?? "Unknown merchant"}</h2>
            <p style={{ fontSize: 13, color: "var(--color-text-secondary)", marginTop: 2 }}>
              {formatDate(inv.invoiceDate)} · {inv.importSource}
            </p>
          </div>
          <button className="review-close-btn" onClick={onClose}>✕</button>
        </div>

        {isPending && (
          <div className="review-confidence-banner">
            <span className="review-confidence-score">{foundCount}/4 fields found</span>
            <span className="review-confidence-hint">
              {foundCount < 4 ? "Extraction was partial — check fields below" : "All fields found"}
            </span>
          </div>
        )}

        <div className="review-section-label">Extracted fields</div>
        <div className="review-fields">
          <FieldRow label="Merchant" value={inv.merchantName ?? ""}         found={inv.merchantName != null} />
          <FieldRow label="Date"     value={formatDate(inv.invoiceDate)}    found={inv.invoiceDate != null} />
          <FieldRow label="Total"    value={formatAmount(inv.grandTotalPaise)} found={inv.grandTotalPaise != null} />
          <FieldRow label="Payment"  value={inv.paymentMode ?? ""}          found={inv.paymentMode != null && inv.paymentMode !== "unknown"} />
        </div>

        {(inv.merchantAddress || inv.merchantGstin || inv.discountPaise > 0 || inv.taxPaise != null || category || isSociety) && (
          <>
            <div className="review-section-label">Additional details</div>
            <div className="review-details">
              {inv.merchantAddress   && <div className="review-detail-row"><span>Address</span><span>{inv.merchantAddress}</span></div>}
              {inv.merchantGstin     && <div className="review-detail-row"><span>GSTIN</span><span>{inv.merchantGstin}</span></div>}
              {inv.taxPaise != null  && <div className="review-detail-row"><span>Tax</span><span>{formatAmount(inv.taxPaise)}</span></div>}
              {inv.discountPaise > 0 && <div className="review-detail-row"><span>Discount</span><span>{formatAmount(inv.discountPaise)}</span></div>}
              <div className="review-detail-row" style={{ alignItems: "flex-start" }}>
                <span>Category</span>
                {isSociety ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                    <select
                      value={addingCategory ? "__add_custom__" : category}
                      onChange={(e) => {
                        if (e.target.value === "__add_custom__") {
                          setAddingCategory(true);
                        } else {
                          setAddingCategory(false);
                          handleCategoryChange(e.target.value);
                        }
                      }}
                      style={{
                        fontSize: 12, padding: "2px 6px", borderRadius: 4,
                        border: "1px solid var(--color-border)",
                        background: "var(--color-surface)", color: "var(--color-text)",
                        cursor: "pointer",
                      }}
                    >
                      <option value="">— Pick category —</option>
                      {(Object.keys(SOCIETY_CATEGORY_LABEL) as SocietyExpenseCategory[]).map((k) => (
                        <option key={k} value={k}>{SOCIETY_CATEGORY_LABEL[k]}</option>
                      ))}
                      {customCategories.map((cat) => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                      <option value="__add_custom__">＋ Add category…</option>
                    </select>
                    {addingCategory && (
                      <div style={{ display: "flex", gap: 4 }}>
                        <input
                          autoFocus
                          value={newCatInput}
                          onChange={(e) => setNewCatInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleAddCategory();
                            if (e.key === "Escape") { setAddingCategory(false); setNewCatInput(""); }
                          }}
                          placeholder="Category name"
                          style={{
                            fontSize: 12, padding: "2px 6px", borderRadius: 4,
                            border: "1px solid var(--color-border)",
                            background: "var(--color-surface)", color: "var(--color-text)",
                            width: 130,
                          }}
                        />
                        <button
                          onClick={handleAddCategory}
                          style={{
                            fontSize: 12, padding: "2px 8px", borderRadius: 4,
                            border: "1px solid var(--color-border)",
                            background: "var(--color-surface)", color: "var(--color-text)",
                            cursor: "pointer",
                          }}
                        >Add</button>
                      </div>
                    )}
                  </div>
                ) : (
                  <span>{category ? category.replace(/_/g, " ") : "—"}</span>
                )}
              </div>
            </div>
          </>
        )}

        {lineItems.length > 0 && (
          <>
            <div className="review-section-label">Line items ({lineItems.length})</div>
            <div className="review-items">
              {lineItems.map((item, i) => (
                <div key={i} className="review-item-row">
                  <span className="review-item-name">{item.name}</span>
                  <span className="review-item-price">{formatAmount(item.totalPricePaise)}</span>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="review-meta">
          {inv.sourceFilename && <span>File: {inv.sourceFilename}</span>}
          <span>Source type: {inv.pdfSourceType}</span>
          <span>Saved: {formatDate(inv.createdAt)}</span>
        </div>
      </div>
    </div>
  );
}

function cardHeading(inv: InvoiceMeta): string {
  const f = inv.sourceFilename;
  // Real filenames are short; anything >100 chars is extracted PDF text, not a name.
  if (f && f.length <= 100) return f;
  if (inv.subject) return inv.subject;
  return "Unknown file";
}

function formatSource(src: string): string {
  switch (src) {
    case "gmail":          return "Gmail";
    case "outlook":        return "Outlook";
    case "manual_upload":  return "Manual Upload";
    case "desktop_folder": return "Desktop Folder";
    default:               return src;
  }
}

function SourceTooltip({ inv }: { inv: InvoiceMeta }) {
  const rows: { label: string; value: string }[] = [
    { label: "Source",    value: formatSource(inv.importSource) },
    ...(inv.senderEmail ? [{ label: "Sender",   value: inv.senderEmail }] : []),
    ...(inv.receivedAt  ? [{ label: "Received", value: formatDate(inv.receivedAt) }] : []),
    { label: "Imported",  value: formatDate(inv.createdAt) },
  ];
  return (
    <div className="invoice-tooltip">
      {rows.map((r) => (
        <div key={r.label} className="invoice-tooltip-row">
          <span className="invoice-tooltip-label">{r.label}</span>
          <span className="invoice-tooltip-value">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

export function InvoiceList() {
  const invoices = useLiveQuery(
    () => db.invoices.orderBy("id").reverse().limit(100).toArray().then((rows) => rows.filter((r) => r.status !== "downloaded")),
    [],
    [] as InvoiceMeta[],
  );
  const loading = invoices === undefined;
  const [selected, setSelected]   = useState<{ inv: InvoiceMeta; items: LineItemRow[] } | null>(null);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [saveResult, setSaveResult] = useState<{ id: number; msg: string; ok: boolean } | null>(null);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<number | null>(null);

  const openDetail = async (inv: InvoiceMeta) => {
    const items = inv.id != null
      ? await db.lineItems.where("invoiceId").equals(inv.id).toArray()
      : [];
    setSelected({ inv, items });
  };

  const handleDownload = async (e: React.MouseEvent, inv: InvoiceMeta) => {
    e.stopPropagation();
    if (inv.id == null || downloadingId != null) return;
    const id = inv.id;
    setDownloadingId(id);
    setSaveResult(null);
    try {
      // restoreFolder must be first await so the user-activation token is intact
      const folderReady = prefs.desktopFolderName
        ? await desktopConnector.restoreFolder()
        : false;
      const items  = await db.lineItems.where("invoiceId").equals(id).toArray();
      const result = await downloadInvoicePdf(inv, items, folderReady);
      await db.invoices.update(id, { status: "downloaded", updatedAt: new Date().toISOString() });
      const msg = result === "folder"
        ? `Saved to ${prefs.desktopFolderName}`
        : "Downloaded to browser";
      setBulkMsg(msg);
      setTimeout(() => setBulkMsg(null), 2500);
    } catch (err) {
      console.error("[jInvoice] download failed:", err);
      setSaveResult({ id, msg: "Save failed", ok: false });
      setTimeout(() => setSaveResult(null), 3500);
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDownloadAll = async () => {
    const saveables = invoices.filter(
      (inv) => (inv.status === "imported" || inv.status === "pending_review") && inv.id != null,
    );
    if (saveables.length === 0 || downloadingAll || downloadingId != null) return;

    setDownloadingAll(true);
    setBulkMsg(null);

    // restoreFolder must be first await — user activation from this button click
    const folderReady = prefs.desktopFolderName
      ? await desktopConnector.restoreFolder()
      : false;

    let successCount = 0;
    for (const inv of saveables) {
      const id = inv.id!;
      setDownloadingId(id);
      try {
        const items = await db.lineItems.where("invoiceId").equals(id).toArray();
        await downloadInvoicePdf(inv, items, folderReady);
        await db.invoices.update(id, { status: "downloaded", updatedAt: new Date().toISOString() });
        successCount++;
      } catch (err) {
        console.error("[jInvoice] bulk download failed for id", id, err);
      }
    }

    setDownloadingId(null);
    setDownloadingAll(false);

    if (successCount > 0) {
      const dest = folderReady ? prefs.desktopFolderName : "browser";
      setBulkMsg(`${successCount} invoice${successCount !== 1 ? "s" : ""} saved to ${dest}`);
      setTimeout(() => setBulkMsg(null), 3500);
    }
  };

  useEffect(() => {
    if (prefs.desktopFolderName) desktopConnector.preloadHandle();
  }, []);

  if (loading) return <div className="placeholder-screen"><p>Loading…</p></div>;

  if (invoices.length === 0) {
    return (
      <div className="placeholder-screen">
        <span>🧾</span>
        <p>No invoices yet. Connect Gmail or set a folder and tap Sync Now.</p>
      </div>
    );
  }

  return (
    <>
      <div className="invoice-list">
        <div className="invoice-list-header">
          <h2>Invoices</h2>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {bulkMsg && <span className="invoice-dl-msg invoice-dl-msg--ok" style={{ maxWidth: "none", fontSize: 12 }}>{bulkMsg}</span>}
            {invoices.some((inv) => inv.status === "imported" || inv.status === "pending_review") && (
              <button
                className="btn-sm"
                disabled={downloadingAll || downloadingId != null}
                onClick={handleDownloadAll}
              >
                {downloadingAll ? "Downloading…" : "↓ Download All"}
              </button>
            )}
          </div>
        </div>
        {invoices.map((inv) => {
          const badge      = statusLabel(inv.status);
          const saveable   = inv.status === "imported" || inv.status === "pending_review";
          const isLoading  = downloadingId === inv.id;
          return (
            <div key={inv.id} className="invoice-card" role="button" tabIndex={0}
              onClick={() => openDetail(inv)}
              onKeyDown={(e) => e.key === "Enter" && openDetail(inv)}
              onMouseEnter={() => setHoveredId(inv.id ?? null)}
              onMouseLeave={() => setHoveredId(null)}
            >
              {hoveredId === inv.id && <SourceTooltip inv={inv} />}
              <div className="invoice-card-main">
                <div className="invoice-merchant">
                  {cardHeading(inv)}
                </div>
              </div>
              <div className="invoice-card-right">
                <div className="invoice-amount">{formatAmount(inv.grandTotalPaise)}</div>
                <span className="invoice-badge" style={{ color: badge.color }}>{badge.text}</span>
                {saveable && (
                  <>
                    <button
                      className="invoice-dl-btn"
                      title={prefs.desktopFolderName ? `Save to ${prefs.desktopFolderName}` : "Download PDF"}
                      disabled={isLoading}
                      onClick={(e) => handleDownload(e, inv)}
                      aria-label="Download PDF"
                    >
                      {isLoading ? "…" : "↓"}
                    </button>
                    {saveResult?.id === inv.id && (
                      <span className={`invoice-dl-msg ${saveResult!.ok ? "invoice-dl-msg--ok" : "invoice-dl-msg--err"}`}>
                        {saveResult!.msg}
                      </span>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {selected && (
        <ReviewPanel
          inv={selected.inv}
          lineItems={selected.items}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}
