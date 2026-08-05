package com.jinvoice.core.extraction

/** Result of classifying a PDF before routing it to the extraction pipeline. */
sealed class PdfClassification {
    /** PDF has a readable text layer — route to NativePdfExtractor. */
    data object Native : PdfClassification()

    /** PDF is image-only — rasterise and route to ScannedPdfExtractor. */
    data object Scanned : PdfClassification()

    /**
     * Some pages have text, others do not.
     * The page-level classifier provides per-page routing decisions.
     */
    data class Mixed(val pageClassifications: Map<Int, PageType>) : PdfClassification()

    /** PDF is password-protected; cannot classify until decrypted. */
    data object Encrypted : PdfClassification()

    enum class PageType { NATIVE, SCANNED }
}

/** Minimum printable character count to treat a page as native (not scanned). */
const val NATIVE_TEXT_THRESHOLD = 50
