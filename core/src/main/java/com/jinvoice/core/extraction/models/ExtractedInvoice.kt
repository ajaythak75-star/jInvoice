package com.jinvoice.core.extraction.models

/**
 * Structured data extracted from a PDF invoice.
 * All monetary values in paise (integer minor units) — no floats.
 * Dates in ISO 8601 format (YYYY-MM-DD).
 */
data class ExtractedInvoice(
    val merchantName: String?,
    val merchantAddress: String?,
    val merchantGstin: String?,
    val invoiceDate: String?,           // ISO 8601: "2024-03-15"
    val lineItems: List<LineItem>,
    val subtotalPaise: Long?,
    val discountPaise: Long = 0L,
    val taxPaise: Long?,
    val grandTotalPaise: Long?,
    val paymentMode: PaymentMode?,
    val sourceType: PdfSourceType,
    val rawText: String?,               // retained for quality fallback; never transmitted
    val confidenceScore: Float,         // 0.0–1.0; below 0.7 → pending_review
)

enum class PaymentMode {
    CASH, UPI, CARD, BNPL, CREDIT, UNKNOWN
}

enum class PdfSourceType {
    NATIVE_PDF,     // text layer present — extracted without OCR
    SCANNED_PDF,    // image-only — extracted via OCR
    MIXED_PDF,      // page-by-page hybrid
}
