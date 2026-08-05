package com.jinvoice.core.extraction.models

sealed class ExtractionResult {
    data class Success(val invoice: ExtractedInvoice) : ExtractionResult()

    /** Extraction completed but confidence below threshold — needs user review. */
    data class LowConfidence(val invoice: ExtractedInvoice, val reason: String) : ExtractionResult()

    /** PDF is password-protected; user must supply password. */
    data object EncryptedPdf : ExtractionResult()

    data class Failure(val reason: String, val cause: Throwable? = null) : ExtractionResult()
}
