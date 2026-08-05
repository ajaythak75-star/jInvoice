package com.jinvoice.extraction

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.ParcelFileDescriptor
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import com.jinvoice.core.extraction.InvoiceFieldParser
import com.jinvoice.core.extraction.InvoiceExtractor
import com.jinvoice.core.extraction.models.ExtractedInvoice
import com.jinvoice.core.extraction.models.ExtractionResult
import com.jinvoice.core.extraction.models.PdfSourceType
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import java.io.InputStream
import java.io.File
import java.io.FileOutputStream
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Extracts invoice fields from a scanned (image-only) PDF.
 * Rasterises each page to 300 dpi bitmap then runs ML Kit Text Recognition v2.
 * Records are flagged source=scanned_pdf in SQLite for quality tracking.
 */
class AndroidScannedPdfExtractor(private val context: Context) : InvoiceExtractor {

    private val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)

    override suspend fun extract(pdfStream: InputStream, fileName: String): ExtractionResult =
        withContext(Dispatchers.IO) {
            // PdfRenderer requires a seekable file descriptor — write stream to a temp file
            val tmpFile = File(context.cacheDir, "scan_${System.currentTimeMillis()}.pdf")
            try {
                FileOutputStream(tmpFile).use { pdfStream.copyTo(it) }
                extractFromFile(tmpFile)
            } finally {
                tmpFile.delete()
            }
        }

    suspend fun extractFromUri(uri: Uri): ExtractionResult = withContext(Dispatchers.IO) {
        val pfd = context.contentResolver.openFileDescriptor(uri, "r")
            ?: return@withContext ExtractionResult.Failure("Cannot open URI")
        extractFromPfd(pfd)
    }

    private suspend fun extractFromFile(file: File): ExtractionResult {
        val pfd = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
        return extractFromPfd(pfd)
    }

    private suspend fun extractFromPfd(pfd: ParcelFileDescriptor): ExtractionResult {
        val renderer = PdfRenderer(pfd)
        val pageTexts = mutableListOf<String>()

        try {
            for (pageIndex in 0 until renderer.pageCount) {
                val page = renderer.openPage(pageIndex)
                val bitmap = rasterisePage(page)
                page.close()

                val text = recognizeText(bitmap)
                pageTexts.add(text)
            }
        } finally {
            renderer.close()
            pfd.close()
        }

        val fullText = pageTexts.joinToString("\n")
        return buildResult(fullText)
    }

    private fun rasterisePage(page: PdfRenderer.Page): Bitmap {
        // 300 dpi: PDF points are 1/72 inch, so multiply by 300/72 ≈ 4.167
        val scale = 300f / 72f
        val width = (page.width * scale).toInt()
        val height = (page.height * scale).toInt()

        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        canvas.drawColor(Color.WHITE)

        page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
        return bitmap
    }

    private suspend fun recognizeText(bitmap: Bitmap): String =
        suspendCancellableCoroutine { cont ->
            val image = InputImage.fromBitmap(bitmap, 0)
            recognizer.process(image)
                .addOnSuccessListener { result -> cont.resume(result.text) }
                .addOnFailureListener { e -> cont.resumeWithException(e) }
        }

    private fun buildResult(text: String): ExtractionResult {
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
            sourceType = PdfSourceType.SCANNED_PDF,
            rawText = text,
            confidenceScore = confidence,
        )

        return if (confidence >= AndroidNativePdfExtractor.CONFIDENCE_THRESHOLD) {
            ExtractionResult.Success(invoice)
        } else {
            ExtractionResult.LowConfidence(invoice, "scanned_pdf confidence=$confidence")
        }
    }
}
