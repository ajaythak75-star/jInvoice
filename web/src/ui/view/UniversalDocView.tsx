import React from "react";
import type { InvoiceMeta, LineItemRow } from "../../data/InvoiceDatabase";
import { SOCIETY_CATEGORY_LABEL, type SocietyExpenseCategory } from "../../core/extraction/SocietyExpenseDetector";
import { getProfessionalCategoryLabel, type ProfessionalProfile } from "../../core/extraction/ProfessionalCategoryDetector";

type DocClass = "invoice" | "tax" | "financial" | "payroll" | "legal" | "society_vendor"
  | "utility" | "medical" | "insurance" | "education" | "rent" | "shopping" | "travel" | "other";
type ItemLayout = "invoice" | "simple" | "financial" | "payroll" | "none";

// Professional profile categories → DocClass mappings
const CAT_TAX      = new Set(["itr_filing","gst_return","tds_tcs","advance_tax","gst_tax","tax_filing","gst_compliance"]);
const CAT_PAYROLL  = new Set(["staff_payroll"]);
const CAT_LEGAL    = new Set(["court_fees","stamp_duty","legal_notice","documentation_charges","roc_mca","property_registration","legal_documentation","legal_document","agreement","rent_agreement","share_certificate","identity_document"]);
const CAT_FINANCE  = new Set(["bank_charges","financial_document"]);
const CAT_UTILITY  = new Set(["rent_utilities","office_expenses","office_software"]);
const CAT_TRAVEL   = new Set(["site_visit"]);

function classifyDoc(docTypes: string[], activeMode: string, category: string): DocClass {
  // DocType-based (covers personal + pro extraction results for all profiles)
  if (docTypes.includes("tax"))                                        return "tax";
  if (docTypes.includes("financial") || docTypes.includes("finance"))  return "financial";
  if (docTypes.includes("insurance"))                                  return "insurance";
  if (docTypes.includes("payroll"))                                    return "payroll";
  if (docTypes.includes("legal"))                                      return "legal";
  if (docTypes.includes("utility"))                                    return "utility";
  if (docTypes.includes("medical"))                                    return "medical";
  if (docTypes.includes("education"))                                  return "education";
  if (docTypes.includes("rent"))                                       return "rent";
  if (docTypes.includes("shopping"))                                   return "shopping";
  if (docTypes.includes("travel"))                                     return "travel";
  if (docTypes.includes("society"))                                    return "society_vendor";

  // Society profile — map society-specific categories
  if (activeMode === "society") {
    if (CAT_LEGAL.has(category) || category === "meeting_record" || category === "cheque") return "legal";
    if (CAT_FINANCE.has(category)) return "financial";
    return "society_vendor";
  }

  // Professional profiles — map their per-profile categories to DocClass
  if (CAT_TAX.has(category))     return "tax";
  if (CAT_PAYROLL.has(category)) return "payroll";
  if (CAT_LEGAL.has(category))   return "legal";
  if (CAT_FINANCE.has(category)) return "financial";
  if (CAT_UTILITY.has(category)) return "utility";
  if (CAT_TRAVEL.has(category))  return "travel";

  if (docTypes.includes("invoice")) return "invoice";
  return "other";
}

interface DocConfig {
  primaryLabel: string;
  nameLabel: string;
  refLabel: string;
  dateLabel: string;
  totalLabel: string;
  itemLayout: ItemLayout;
  itemsLabel: string;
  accent: string;
  badge: string;
}

const DOC_CONFIGS: Record<DocClass, DocConfig> = {
  invoice: {
    primaryLabel: "Merchant", nameLabel: "Shop Name", refLabel: "Invoice No.", dateLabel: "Date of Purchase",
    totalLabel: "Final Payment", itemLayout: "invoice", itemsLabel: "Line Items",
    accent: "#3b82f6", badge: "Invoice",
  },
  tax: {
    primaryLabel: "Taxpayer / Authority", nameLabel: "Issued By", refLabel: "Ref / Challan No.",
    dateLabel: "Date", totalLabel: "Tax Amount", itemLayout: "simple", itemsLabel: "Charges",
    accent: "#f59e0b", badge: "Tax Document",
  },
  financial: {
    primaryLabel: "Account / Institution", nameLabel: "Institution", refLabel: "Account / Doc No.",
    dateLabel: "Statement Date", totalLabel: "Closing Balance", itemLayout: "financial", itemsLabel: "Transactions",
    accent: "#22c55e", badge: "Financial",
  },
  payroll: {
    primaryLabel: "Employee", nameLabel: "Employer", refLabel: "Employee ID / Payslip No.",
    dateLabel: "Pay Period", totalLabel: "Net Pay", itemLayout: "payroll", itemsLabel: "Pay Components",
    accent: "#8b5cf6", badge: "Payroll",
  },
  legal: {
    primaryLabel: "Document", nameLabel: "Issuing Authority", refLabel: "Reference No.",
    dateLabel: "Date", totalLabel: "Amount (if any)", itemLayout: "none", itemsLabel: "Details",
    accent: "#6b7280", badge: "Legal",
  },
  society_vendor: {
    primaryLabel: "Vendor / Service", nameLabel: "Vendor Name", refLabel: "Bill / Invoice No.",
    dateLabel: "Date", totalLabel: "Total Amount", itemLayout: "simple", itemsLabel: "Charges",
    accent: "#0891b2", badge: "Society",
  },
  utility: {
    primaryLabel: "Service Provider", nameLabel: "Provider", refLabel: "Consumer / Account No.",
    dateLabel: "Bill Date", totalLabel: "Amount Due", itemLayout: "simple", itemsLabel: "Charges",
    accent: "#f97316", badge: "Utility",
  },
  medical: {
    primaryLabel: "Hospital / Clinic", nameLabel: "Provider", refLabel: "Patient / Bill No.",
    dateLabel: "Date", totalLabel: "Total Amount", itemLayout: "simple", itemsLabel: "Services",
    accent: "#ef4444", badge: "Medical",
  },
  insurance: {
    primaryLabel: "Insurer", nameLabel: "Insurance Company", refLabel: "Policy No.",
    dateLabel: "Due / Cover Date", totalLabel: "Premium Amount", itemLayout: "simple", itemsLabel: "Coverage",
    accent: "#10b981", badge: "Insurance",
  },
  education: {
    primaryLabel: "Institution", nameLabel: "School / College", refLabel: "Student / Receipt No.",
    dateLabel: "Date", totalLabel: "Fees Paid", itemLayout: "simple", itemsLabel: "Fee Components",
    accent: "#6366f1", badge: "Education",
  },
  rent: {
    primaryLabel: "Landlord", nameLabel: "Landlord / Owner", refLabel: "Receipt No.",
    dateLabel: "Rent Period", totalLabel: "Rent Amount", itemLayout: "none", itemsLabel: "Details",
    accent: "#a855f7", badge: "Rent",
  },
  shopping: {
    primaryLabel: "Store / Platform", nameLabel: "Store", refLabel: "Order / Bill No.",
    dateLabel: "Purchase Date", totalLabel: "Total Paid", itemLayout: "invoice", itemsLabel: "Items Purchased",
    accent: "#ec4899", badge: "Shopping",
  },
  travel: {
    primaryLabel: "Airline / Service", nameLabel: "Provider", refLabel: "PNR / Booking Ref.",
    dateLabel: "Travel Date", totalLabel: "Amount Paid", itemLayout: "simple", itemsLabel: "Travel Details",
    accent: "#0ea5e9", badge: "Travel",
  },
  other: {
    primaryLabel: "Entity", nameLabel: "Name", refLabel: "Reference No.",
    dateLabel: "Date", totalLabel: "Amount", itemLayout: "simple", itemsLabel: "Items",
    accent: "#6b7280", badge: "Document",
  },
};

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtInr(paise: number | null | undefined): string {
  if (paise == null) return "—";
  return `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

interface Props {
  rec: InvoiceMeta;
  items: LineItemRow[];
  category: string;
  activeMode: string;
  rawText?: string | null;
  onEditProjectTag?: (invoiceId: number, anchor: DOMRect) => void;
  onCategoryChange?: (cat: SocietyExpenseCategory) => void;
}

export function UniversalDocView({ rec, items, category, activeMode, rawText, onEditProjectTag, onCategoryChange }: Props) {
  const docTypes = rec.docTypes ?? (rec.docType ? [rec.docType] : []);
  const docClass = classifyDoc(docTypes, activeMode, category);
  const cfg = DOC_CONFIGS[docClass];

  const sectionLbl: React.CSSProperties = {
    fontSize: 10.5, fontWeight: 700, color: "var(--color-text-tertiary)",
    textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8,
  };
  const fieldCard: React.CSSProperties = {
    background: "var(--color-surface-2)", border: "1px solid var(--color-border)",
    borderRadius: 8, padding: "10px 12px",
  };
  const fieldLbl: React.CSSProperties = {
    fontSize: 10, fontWeight: 600, color: "var(--color-text-tertiary)",
    textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4,
  };
  const fieldVal: React.CSSProperties = {
    fontSize: 13.5, fontWeight: 600, color: "var(--color-text)", wordBreak: "break-all",
  };
  const fieldNull: React.CSSProperties = {
    ...fieldVal, color: "var(--color-text-tertiary)", fontWeight: 400, fontStyle: "italic",
  };
  const thSt: React.CSSProperties = {
    padding: "6px 8px", textAlign: "left", fontSize: 10, fontWeight: 700,
    color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em",
  };
  const tdSt: React.CSSProperties = { padding: "8px 8px", color: "var(--color-text-secondary)" };
  const summaryRow: React.CSSProperties = {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    fontSize: 13, color: "var(--color-text)",
  };

  // Fields list — only include populated optional ones
  const fields: Array<{ label: string; value: string | null; span?: boolean; editable?: boolean }> = [
    { label: cfg.nameLabel, value: rec.merchantName, span: true },
    { label: cfg.refLabel, value: rec.invoiceNumber ?? null },
    { label: cfg.dateLabel, value: fmtDate(rec.invoiceDate) },
    ...(rec.merchantGstin
      ? [{ label: docClass === "tax" ? "PAN / TAN / GSTIN" : "GSTIN", value: rec.merchantGstin }]
      : []),
    ...(rec.merchantAddress ? [{ label: "Address", value: rec.merchantAddress, span: true }] : []),
    ...(rec.merchantPincode ? [{ label: "Pincode", value: rec.merchantPincode }] : []),
    ...(rec.merchantPhone ? [{ label: "Phone", value: rec.merchantPhone }] : []),
    ...(rec.platform ? [{ label: "Platform", value: rec.platform }] : []),
    ...(rec.projectTag || onEditProjectTag
      ? [{ label: activeMode === "society" ? "Flat / Unit" : "Project Tag", value: rec.projectTag ?? null, editable: !!onEditProjectTag }]
      : []),
  ];

  // AI-extracted doc-specific metadata — exclude flatUnit (shown as "Flat / Unit" in fields grid above)
  const META_LABELS: Record<string, string> = {
    validUntil: "Valid Until",
    paymentTerms: "Payment Terms",
    warrantyPeriod: "Warranty Period",
    resolutionNo: "Resolution No.",
    attendeeCount: "Attendees",
    meetingType: "Meeting Type",
  };
  const metaEntries = rec.docMetadata
    ? Object.entries(rec.docMetadata).filter(([k]) => k !== "flatUnit")
    : [];

  // Category badge label
  const categoryLabel: string | null = category
    ? activeMode === "society"
      ? (SOCIETY_CATEGORY_LABEL[category as SocietyExpenseCategory] ?? category.replace(/_/g, " "))
      : activeMode !== "personal" && activeMode !== "society"
      ? getProfessionalCategoryLabel(activeMode as ProfessionalProfile, category)
      : null
    : null;

  const hasSubtotal = rec.subtotalPaise != null && rec.subtotalPaise !== rec.grandTotalPaise;
  const hasTax = rec.taxPaise != null && rec.taxPaise > 0;
  const hasDiscount = rec.discountPaise > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>

      {/* Doc type + category badges */}
      <div style={{ padding: "12px 20px 0", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{
          fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20,
          background: `${cfg.accent}1a`, color: cfg.accent, border: `1px solid ${cfg.accent}40`,
          letterSpacing: "0.03em",
        }}>
          {cfg.badge}
        </span>
        {activeMode === "society" && onCategoryChange ? (
          <select
            value={category || "other"}
            onChange={(e) => onCategoryChange(e.target.value as SocietyExpenseCategory)}
            style={{
              fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 20,
              background: "var(--color-surface-2)", color: "var(--color-text-secondary)",
              border: "1px solid var(--color-border)", cursor: "pointer",
              appearance: "auto",
            }}
          >
            {(Object.entries(SOCIETY_CATEGORY_LABEL) as [SocietyExpenseCategory, string][]).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        ) : categoryLabel ? (
          <span style={{
            fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 20,
            background: "var(--color-surface-2)", color: "var(--color-text-secondary)",
            border: "1px solid var(--color-border)",
          }}>
            {categoryLabel}
          </span>
        ) : null}
        <span style={{ fontSize: 10.5, color: "var(--color-text-tertiary)", marginLeft: "auto" }}>
          Universal View
        </span>
      </div>

      {/* Primary entity card */}
      <div style={{
        margin: "12px 20px 0",
        background: "var(--color-surface-2)",
        border: `1px solid ${cfg.accent}30`,
        borderLeft: `3px solid ${cfg.accent}`,
        borderRadius: 8, padding: "12px 16px",
      }}>
        <div style={{
          fontSize: 10.5, fontWeight: 700, color: cfg.accent,
          textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4,
        }}>
          {cfg.primaryLabel}
        </div>
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text)" }}>
          {rec.merchantName ?? "—"}
        </div>
        {rec.merchantAddress && (
          <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 2 }}>
            {rec.merchantAddress}
          </div>
        )}
      </div>

      {/* Fields grid */}
      <div style={{ padding: "16px 20px 0" }}>
        <div style={sectionLbl}>Document Fields</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {fields.map(({ label, value, span, editable }) => (
            <div key={label} style={{ ...fieldCard, gridColumn: span ? "1 / -1" : undefined }}>
              <div style={{ ...fieldLbl, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                {label}
                {editable && (
                  <button
                    onClick={(e) => onEditProjectTag!(rec.id!, e.currentTarget.getBoundingClientRect())}
                    style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--color-text-secondary)", cursor: "pointer", fontWeight: 600, lineHeight: 1.6 }}
                  >
                    Edit
                  </button>
                )}
              </div>
              <div style={value ? fieldVal : fieldNull}>{value ?? "Not set"}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Extra metadata from AI extraction (Assessment Year, Flat No., etc.) */}
      {metaEntries.length > 0 && (
        <div style={{ padding: "16px 20px 0" }}>
          <div style={sectionLbl}>Additional Details</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {metaEntries.map(([key, val]) => (
              <div key={key} style={fieldCard}>
                <div style={fieldLbl}>{META_LABELS[key] ?? key.replace(/([A-Z])/g, " $1").trim()}</div>
                <div style={fieldVal}>{val}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Line items — layout adapts to doc class */}
      {cfg.itemLayout !== "none" && items.length > 0 && (
        <div style={{ padding: "16px 20px 0" }}>
          <div style={sectionLbl}>{cfg.itemsLabel} ({items.length})</div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${cfg.accent}35` }}>
                  <th style={thSt}>#</th>
                  {cfg.itemLayout === "invoice" && (
                    <>
                      <th style={thSt}>Item Name</th>
                      <th style={{ ...thSt, textAlign: "right" }}>Qty</th>
                      <th style={{ ...thSt, textAlign: "right" }}>Amount (₹)</th>
                    </>
                  )}
                  {cfg.itemLayout === "simple" && (
                    <>
                      <th style={thSt}>Description</th>
                      <th style={{ ...thSt, textAlign: "right" }}>Amount (₹)</th>
                    </>
                  )}
                  {cfg.itemLayout === "financial" && (
                    <>
                      <th style={thSt}>Description</th>
                      <th style={{ ...thSt, textAlign: "right" }}>Debit (₹)</th>
                      <th style={{ ...thSt, textAlign: "right" }}>Credit (₹)</th>
                    </>
                  )}
                  {cfg.itemLayout === "payroll" && (
                    <>
                      <th style={thSt}>Component</th>
                      <th style={{ ...thSt, textAlign: "right" }}>Amount (₹)</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={it.id ?? i} style={{ borderBottom: "1px solid var(--color-border)" }}>
                    <td style={{ ...tdSt, fontVariantNumeric: "tabular-nums" }}>{i + 1}</td>
                    <td style={{ ...tdSt, color: "var(--color-text)", fontWeight: 500 }}>{it.name}</td>
                    {cfg.itemLayout === "invoice" && (
                      <>
                        <td style={{ ...tdSt, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                          {it.quantity}
                        </td>
                        <td style={{ ...tdSt, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600, color: "var(--color-text)" }}>
                          {(it.totalPricePaise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                        </td>
                      </>
                    )}
                    {cfg.itemLayout === "simple" && (
                      <td style={{ ...tdSt, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600, color: "var(--color-text)" }}>
                        {(it.totalPricePaise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>
                    )}
                    {cfg.itemLayout === "financial" && (
                      <>
                        <td style={{ ...tdSt, textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#ef4444" }}>
                          {it.unitPricePaise > 0
                            ? (it.unitPricePaise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })
                            : "—"}
                        </td>
                        <td style={{ ...tdSt, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600, color: "#22c55e" }}>
                          {it.totalPricePaise > 0
                            ? (it.totalPricePaise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })
                            : "—"}
                        </td>
                      </>
                    )}
                    {cfg.itemLayout === "payroll" && (
                      <td style={{ ...tdSt, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600, color: "var(--color-text)" }}>
                        {(it.totalPricePaise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {cfg.itemLayout !== "none" && items.length === 0 && !rawText && (
        <div style={{ padding: "12px 20px 0", fontSize: 13, color: "var(--color-text-secondary)" }}>
          {rec.grandTotalPaise != null ? "Single-amount document — no itemised breakdown." : "No items extracted."}
        </div>
      )}

      {/* Document text for non-financial text captures */}
      {rawText && rec.grandTotalPaise == null && (() => {
        const blocks = rawText
          .replace(/\r\n/g, "\n")
          .replace(/\n{3,}/g, "\n\n")
          .trim()
          .split(/\n\n+/)
          .map((b) => b.trim())
          .filter(Boolean);
        return (
          <div style={{ padding: "16px 20px 0" }}>
            <div style={sectionLbl}>Document Content</div>
            <div style={{
              fontSize: 13, color: "var(--color-text)", lineHeight: 1.8,
              maxHeight: 440, overflowY: "auto",
              padding: "14px 16px",
              background: `${cfg.accent}07`,
              border: `1px solid ${cfg.accent}28`,
              borderRadius: 10,
            }}>
              {blocks.map((block, i) => {
                const isHeading = block.length < 100 && block === block.toUpperCase() && /[A-Z]/.test(block);
                const isItem = /^\d+[.)]\s/.test(block) || /^[•\-–]\s/.test(block);
                if (isHeading) {
                  return (
                    <div key={i} style={{
                      fontWeight: 700, fontSize: 12.5, color: cfg.accent,
                      textTransform: "uppercase", letterSpacing: "0.04em",
                      marginTop: i > 0 ? 16 : 0, marginBottom: 6,
                    }}>
                      {block}
                    </div>
                  );
                }
                if (isItem) {
                  return (
                    <div key={i} style={{
                      marginBottom: 5, paddingLeft: 14,
                      borderLeft: `2px solid ${cfg.accent}30`,
                      color: "var(--color-text)",
                    }}>
                      {block.split("\n").join(" ")}
                    </div>
                  );
                }
                return (
                  <div key={i} style={{ marginBottom: 10, color: "var(--color-text)" }}>
                    {block.split("\n").join(" ")}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Amount summary — only for financial documents */}
      <div style={{
        margin: "16px 20px 24px",
        background: `${cfg.accent}09`,
        border: `1px solid ${cfg.accent}28`,
        borderRadius: 10, padding: "14px 16px",
        display: rawText && rec.grandTotalPaise == null ? "none" : undefined,
      }}>
        <div style={sectionLbl}>Amount Summary</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {hasSubtotal && (
            <div style={summaryRow}>
              <span style={{ color: "var(--color-text-secondary)" }}>Subtotal</span>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>{fmtInr(rec.subtotalPaise)}</span>
            </div>
          )}
          {hasTax && (
            <div style={summaryRow}>
              <span style={{ color: "var(--color-text-secondary)" }}>GST / Tax</span>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>{fmtInr(rec.taxPaise)}</span>
            </div>
          )}
          {hasDiscount && (
            <div style={summaryRow}>
              <span style={{ color: "var(--color-text-secondary)" }}>Discount</span>
              <span style={{ color: "#22c55e", fontVariantNumeric: "tabular-nums" }}>−{fmtInr(rec.discountPaise)}</span>
            </div>
          )}
          <div style={{ ...summaryRow, paddingTop: 8, marginTop: 2, borderTop: `1px solid ${cfg.accent}30` }}>
            <span style={{ fontWeight: 700, fontSize: 14, color: "var(--color-text)" }}>{cfg.totalLabel}</span>
            <span style={{ fontWeight: 800, fontSize: 17, color: cfg.accent, fontVariantNumeric: "tabular-nums" }}>
              {fmtInr(rec.grandTotalPaise)}
            </span>
          </div>
        </div>
      </div>

    </div>
  );
}
