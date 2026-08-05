package com.jinvoice.extraction

import android.content.Context
import android.net.Uri
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.text.PDFTextStripper
import com.jinvoice.core.extraction.InvoiceFieldParser
import com.jinvoice.core.extraction.InvoiceExtractor
import com.jinvoice.core.extraction.models.ExtractedInvoice
import com.jinvoice.core.extraction.models.ExtractionResult
import com.jinvoice.core.extraction.models.PdfSourceType
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.InputStream

/**
 * Extracts invoice fields from a native PDF (text layer present).
 * Uses pdfbox-android for text extraction — no OCR call needed.
 * Faster and more accurate than ML Kit for machine-generated PDFs.
 */
class AndroidNativePdfExtractor(private val context: Context) : InvoiceExtractor {

    override suspend fun extract(pdfStream: InputStream, fileName: String): ExtractionResult =
        withContext(Dispatchers.IO) {
            try {
                val document = PDDocument.load(pdfStream)

                if (document.isEncrypted) {
                    document.close()
                    return@withContext ExtractionResult.EncryptedPdf
                }

                val stripper = PDFTextStripper()
                val fullText = stripper.getText(document)
                document.close()

                buildResult(fullText, PdfSourceType.NATIVE_PDF)
            } catch (e: Exception) {
                ExtractionResult.Failure("Native PDF extraction failed: ${e.message}", e)
            }
        }

    fun extractFromText(text: String): ExtractionResult = buildResult(text, PdfSourceType.NATIVE_PDF)

    private fun buildResult(text: String, sourceType: PdfSourceType): ExtractionResult {
        val merchantName = InvoiceFieldParser.extractMerchantName(text)
        val date = InvoiceFieldParser.extractDate(text)
        val grandTotal = InvoiceFieldParser.extractGrandTotalPaise(text)
        val paymentMode = InvoiceFieldParser.extractPaymentMode(text)
        val lineItems = InvoiceFieldParser.extractLineItems(text)
        val gstin = InvoiceFieldParser.extractGstin(text)
        val confidence = InvoiceFieldParser.computeConfidence(merchantName, date, grandTotal, lineItems)

        val invoice = ExtractedInvoice(
            merchantName = merchantName,
            merchantAddress = null,
            merchantGstin = gstin,
            invoiceDate = date,
            lineItems = lineItems,
            subtotalPaise = null,
            discountPaise = 0L,
            taxPaise = null,
            grandTotalPaise = grandTotal,
            paymentMode = paymentMode,
            sourceType = sourceType,
            rawText = text,
            confidenceScore = confidence,
        )

        return if (confidence >= CONFIDENCE_THRESHOLD) {
            ExtractionResult.Success(invoice)
        } else {
            ExtractionResult.LowConfidence(invoice, "confidence=$confidence < $CONFIDENCE_THRESHOLD")
        }
    }

    companion object {
        const val CONFIDENCE_THRESHOLD = 0.7f
    }
}
