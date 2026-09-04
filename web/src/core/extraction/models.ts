export type PaymentMode = "cash" | "upi" | "card" | "bnpl" | "credit" | "unknown";
export type PdfSourceType = "NATIVE_PDF" | "SCANNED_PDF" | "MIXED_PDF" | "CAMERA_OCR" | "HTML_EMAIL";
export type InvoiceStatus =
  | "imported"
  | "pending_review"
  | "pending_extraction"
  | "import_blocked_encrypted"
  | "extraction_failed"
  | "duplicate"
  | "skipped"
  | "downloaded";

export interface LineItem {
  name: string;
  quantity: number;
  unitPricePaise: number;
  totalPricePaise: number;
  discountPaise: number;
}

export interface ExtractedInvoice {
  merchantName: string | null;
  merchantAddress: string | null;
  merchantGstin: string | null;
  merchantPhone: string | null;
  merchantPincode: string | null;
  platform?: string | null;          // marketplace / channel, e.g. "Amazon.in"
  invoiceNumber: string | null;
  invoiceDate: string | null;      // ISO 8601
  lineItems: LineItem[];
  subtotalPaise: number | null;
  discountPaise: number;
  taxPaise: number | null;
  grandTotalPaise: number | null;
  paymentMode: PaymentMode | null;
  sourceType: PdfSourceType;
  rawText: string | null;          // never persisted or transmitted
  confidenceScore: number;
  docMetadata?: Record<string, string> | null;
}

export type ExtractionResult =
  | { kind: "success"; invoice: ExtractedInvoice }
  | { kind: "lowConfidence"; invoice: ExtractedInvoice; reason: string }
  | { kind: "duplicate"; invoice: ExtractedInvoice }
  | { kind: "encryptedPdf" }
  | { kind: "dailyLimitReached"; limit: number }
  | { kind: "pendingExtraction" }
  | { kind: "failure"; reason: string; error?: unknown };
