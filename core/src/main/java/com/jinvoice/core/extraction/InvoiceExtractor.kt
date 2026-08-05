package com.jinvoice.core.extraction

import com.jinvoice.core.extraction.models.ExtractionResult
import java.io.InputStream

/** Platform-agnostic contract for extracting structured data from a PDF input stream. */
interface InvoiceExtractor {
    suspend fun extract(pdfStream: InputStream, fileName: String): ExtractionResult
}
