// Detects warranty / insurance / prescription / service-interval signals from
// raw invoice text and returns candidate sentinel records ready to insert.

import type { SentinelRecord } from "../data/InvoiceDatabase";

type SentinelCandidate = Omit<SentinelRecord, "id" | "status" | "createdAt">;

// ── Duration arithmetic ───────────────────────────────────────────────────────

function addDuration(fromIso: string, qty: number, unit: string): string | null {
  const d = new Date(fromIso);
  if (isNaN(d.getTime())) return null;
  const u = unit.toLowerCase();
  if (u.startsWith("yr") || u.startsWith("year")) d.setFullYear(d.getFullYear() + qty);
  else if (u.startsWith("mon")) d.setMonth(d.getMonth() + qty);
  else if (u.startsWith("day")) d.setDate(d.getDate() + qty);
  else return null;
  return d.toISOString().slice(0, 10);
}

// Parses "dd/mm/yyyy", "dd-mm-yyyy", "dd.mm.yyyy" → ISO date string
function parseDmy(raw: string): string | null {
  const m = /(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/.exec(raw);
  if (!m) return null;
  const [, d, mo, y] = m;
  const year = y.length === 2 ? (parseInt(y) < 50 ? 2000 + parseInt(y) : 1900 + parseInt(y)) : parseInt(y);
  const dt = new Date(year, parseInt(mo) - 1, parseInt(d));
  return isNaN(dt.getTime()) ? null : dt.toISOString().slice(0, 10);
}

// ── Shared patterns ───────────────────────────────────────────────────────────

const DURATION_RX = /(\d+)\s*(years?|yrs?|months?|mons?|days?)/i;

// ── Warranty ─────────────────────────────────────────────────────────────────

const WARRANTY_KW = ["warranty", "guarantee", "warranted", "warrantee", "after-sales"];

const WARRANTY_EXPLICIT_EXPIRY_RX =
  /(?:warranty\s+expir[ey]s?|warranty\s+valid\s+(?:till|until|through)|guarantee\s+(?:till|until|expires?))[:\s]*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i;

function detectWarrantyCandidate(
  text: string,
  merchantName: string | null,
  invoiceDate: string | null,
  invoiceId: number,
): SentinelCandidate | null {
  const l = text.toLowerCase();
  if (!WARRANTY_KW.some((k) => l.includes(k))) return null;

  // 1. Explicit expiry date in text
  const expiryM = WARRANTY_EXPLICIT_EXPIRY_RX.exec(text);
  if (expiryM) {
    const expiresAt = parseDmy(expiryM[1]);
    if (expiresAt) {
      return {
        invoiceId,
        type: "warranty",
        label: `${merchantName ?? "Item"} Warranty`,
        expiresAt,
      };
    }
  }

  // 2. Duration near warranty keyword, e.g. "1 year warranty" / "warranty: 2 years"
  // Find window around each keyword occurrence
  for (const kw of WARRANTY_KW) {
    let idx = l.indexOf(kw);
    while (idx !== -1) {
      const window = text.slice(Math.max(0, idx - 40), idx + kw.length + 60);
      const durM = DURATION_RX.exec(window);
      if (durM && invoiceDate) {
        const qty = parseInt(durM[1]);
        const unit = durM[2];
        const expiresAt = addDuration(invoiceDate, qty, unit);
        if (expiresAt) {
          const unitLabel = unit.startsWith("y") || unit.startsWith("Y") ? "yr" : unit.startsWith("m") || unit.startsWith("M") ? "mo" : "d";
          return {
            invoiceId,
            type: "warranty",
            label: `${merchantName ?? "Item"} Warranty (${qty} ${unitLabel})`,
            expiresAt,
          };
        }
      }
      idx = l.indexOf(kw, idx + 1);
    }
  }

  // 3. Keyword present but no duration/date found — skip (too noisy without a date)
  return null;
}

// ── Insurance ─────────────────────────────────────────────────────────────────

const INSURANCE_KW = ["insurance policy", "policy no", "sum insured", "insured till", "policy valid"];

const INSURANCE_EXPIRY_RX =
  /(?:policy\s+expiry|policy\s+(?:valid\s+)?(?:till|until|through)|cover(?:age)?\s+(?:till|until|ends?))[:\s]*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i;

function detectInsuranceCandidate(
  text: string,
  merchantName: string | null,
  invoiceId: number,
): SentinelCandidate | null {
  const l = text.toLowerCase();
  if (!INSURANCE_KW.some((k) => l.includes(k))) return null;

  const expiryM = INSURANCE_EXPIRY_RX.exec(text);
  if (!expiryM) return null;
  const expiresAt = parseDmy(expiryM[1]);
  if (!expiresAt) return null;

  return {
    invoiceId,
    type: "insurance",
    label: `${merchantName ?? "Insurance"} Policy`,
    expiresAt,
  };
}

// ── Prescription ──────────────────────────────────────────────────────────────

const PRESCRIPTION_KW = ["prescription", "valid till", "valid through", "validity:", "rx no", "dr.", "dispensed on"];

const PRESCRIPTION_VALIDITY_RX =
  /(?:valid(?:ity)?\s*(?:till|through|until)|prescription\s+expir[ey]s?|refill\s+(?:by|before))[:\s]*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i;

function detectPrescriptionCandidate(
  text: string,
  merchantName: string | null,
  invoiceDate: string | null,
  invoiceId: number,
): SentinelCandidate | null {
  const l = text.toLowerCase();
  // Need at least 2 prescription signals to avoid false positives on general docs
  const hits = PRESCRIPTION_KW.filter((k) => l.includes(k)).length;
  if (hits < 2) return null;

  // Explicit validity date
  const validM = PRESCRIPTION_VALIDITY_RX.exec(text);
  if (validM) {
    const expiresAt = parseDmy(validM[1]);
    if (expiresAt) {
      return {
        invoiceId,
        type: "prescription",
        label: `${merchantName ?? "Prescription"} Validity`,
        expiresAt,
      };
    }
  }

  // Fallback: prescriptions typically valid 6 months from issue date
  if (invoiceDate) {
    const expiresAt = addDuration(invoiceDate, 6, "months");
    if (expiresAt) {
      return {
        invoiceId,
        type: "prescription",
        label: `${merchantName ?? "Prescription"} (6-month validity)`,
        expiresAt,
      };
    }
  }

  return null;
}

// ── Service Interval ──────────────────────────────────────────────────────────

const SERVICE_KW = ["next service", "service due", "service interval", "maintenance due", "next maintenance", "km due", "next oil change"];

const SERVICE_DATE_RX =
  /(?:next\s+service|service\s+due|maintenance\s+due)[:\s]*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i;

function detectServiceCandidate(
  text: string,
  merchantName: string | null,
  invoiceDate: string | null,
  invoiceId: number,
): SentinelCandidate | null {
  const l = text.toLowerCase();
  if (!SERVICE_KW.some((k) => l.includes(k))) return null;

  // Explicit next service date
  const dateM = SERVICE_DATE_RX.exec(text);
  if (dateM) {
    const expiresAt = parseDmy(dateM[1]);
    if (expiresAt) {
      return {
        invoiceId,
        type: "service_interval",
        label: `${merchantName ?? "Vehicle"} Next Service`,
        expiresAt,
      };
    }
  }

  // Duration-based, e.g. "next service after 6 months"
  const durM = DURATION_RX.exec(text.slice(text.toLowerCase().search(/next.service|service.due/)));
  if (durM && invoiceDate) {
    const expiresAt = addDuration(invoiceDate, parseInt(durM[1]), durM[2]);
    if (expiresAt) {
      return {
        invoiceId,
        type: "service_interval",
        label: `${merchantName ?? "Vehicle"} Next Service`,
        expiresAt,
      };
    }
  }

  return null;
}

// ── Main entrypoint ───────────────────────────────────────────────────────────

export function detectSentinelCandidates(
  rawText: string,
  merchantName: string | null,
  invoiceDate: string | null,
  invoiceId: number,
): SentinelCandidate[] {
  const candidates: SentinelCandidate[] = [];

  const warranty = detectWarrantyCandidate(rawText, merchantName, invoiceDate, invoiceId);
  if (warranty) candidates.push(warranty);

  const insurance = detectInsuranceCandidate(rawText, merchantName, invoiceId);
  if (insurance) candidates.push(insurance);

  const prescription = detectPrescriptionCandidate(rawText, merchantName, invoiceDate, invoiceId);
  if (prescription) candidates.push(prescription);

  const service = detectServiceCandidate(rawText, merchantName, invoiceDate, invoiceId);
  if (service) candidates.push(service);

  return candidates;
}
