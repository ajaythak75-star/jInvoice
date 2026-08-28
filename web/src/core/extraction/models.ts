export type PaymentMode = "cash" | "upi" | "card" | "bnpl" | "credit" | "unknown";
export type PdfSourceType = "NATIVE_PDF" | "SCANNED_PDF" | "MIXED_PDF" | "CAMERA_OCR" | "HTML_EMAIL";
export type InvoiceStatus =
  | "imported"
  | "pending_review"
  | "import_blocked_encrypted"
  | "extraction_failed"
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
}

export type ExtractionResult =
  | { kind: "success"; invoice: ExtractedInvoice }
  | { kind: "lowConfidence"; invoice: ExtractedInvoice; reason: string }
  | { kind: "encryptedPdf" }
  | { kind: "dailyLimitReached"; limit: number }
  | { kind: "failure"; reason: string; error?: unknown };
