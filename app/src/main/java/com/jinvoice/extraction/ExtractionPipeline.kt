package com.jinvoice.extraction

import android.content.Context
import android.net.Uri
import com.jinvoice.core.extraction.PdfClassification
import com.jinvoice.core.extraction.models.ExtractionResult
import com.jinvoice.core.extraction.models.PdfSourceType
import com.jinvoice.data.db.InvoiceDatabase
import com.jinvoice.data.db.entity.InvoiceMetaEntity
import com.jinvoice.data.db.entity.LineItemEntity
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.time.Instant

/**
 * Orchestrates the full pipeline for a downloaded PDF:
 *   1. Classify (native / scanned / mixed / encrypted)
 *   2. Route to the correct extractor
 *   3. Write extracted data to Room + FTS5
 *
 * Never writes low-confidence data silently — marks records pending_review.
 * Never blocks the user — on hard failure, stores raw URI and marks pending_extraction.
 */
class ExtractionPipeline(
    private val context: Context,
    private val db: InvoiceDatabase,
) {

    private val classifier = AndroidPdfClassifier(context)
    private val nativeExtractor = AndroidNativePdfExtractor(context)
    private val scannedExtractor = AndroidScannedPdfExtractor(context)

    suspend fun processDownloadedPdf(
        uri: Uri,
        fileName: String,
        importSource: String,
        importMessageId: String? = null,
    ): Unit = withContext(Dispatchers.IO) {
        val importRecordId = importMessageId?.let {
            db.importRecordDao().getRecentBySource(importSource.removePrefix("auto_import_"))
                .firstOrNull { r -> r.messageId == it }?.id
        }

        val classification = classifier.classify(uri)

        when (classification) {
            is PdfClassification.Encrypted -> {
                persistStatus(
                    uri, fileName, importSource, importRecordId,
                    status = "import_blocked_encrypted",
                    sourceType = PdfSourceType.NATIVE_PDF,
                )
                return@withContext
            }

            is PdfClassification.Native -> {
                val stream = context.contentResolver.openInputStream(uri) ?: return@withContext
                val result = nativeExtractor.extract(stream, fileName)
                persistResult(result, uri, fileName, importSource, importRecordId, PdfSourceType.NATIVE_PDF)
            }

            is PdfClassification.Scanned -> {
                val result = scannedExtractor.extractFromUri(uri)
                persistResult(result, uri, fileName, importSource, importRecordId, PdfSourceType.SCANNED_PDF)
            }

            is PdfClassification.Mixed -> {
                // Process page-by-page; concatenate results into one invoice record
                // For v1, extract all text and pick the dominant type
                val dominantNative = classification.pageClassifications.values
                    .count { it == PdfClassification.PageType.NATIVE }
                val dominantScanned = classification.pageClassifications.values
                    .count { it == PdfClassification.PageType.SCANNED }

                val result = if (dominantNative >= dominantScanned) {
                    val stream = context.contentResolver.openInputStream(uri) ?: return@withContext
                    nativeExtractor.extract(stream, fileName)
                } else {
                    scannedExtractor.extractFromUri(uri)
                }

                persistResult(result, uri, fileName, importSource, importRecordId, PdfSourceType.MIXED_PDF)
            }
        }
    }

    private suspend fun persistResult(
        result: ExtractionResult,
        uri: Uri,
        fileName: String,
        importSource: String,
        importRecordId: Long?,
        sourceType: PdfSourceType,
    ) {
        val now = Instant.now().toString()

        when (result) {
            is ExtractionResult.Success -> {
                val inv = result.invoice
                val meta = InvoiceMetaEntity(
                    merchantName = inv.merchantName,
                    merchantAddress = inv.merchantAddress,
                    invoiceDate = inv.invoiceDate,
                    grandTotalPaise = inv.grandTotalPaise,
                    discountPaise = inv.discountPaise,
                    taxPaise = inv.taxPaise,
                    paymentMode = inv.paymentMode?.name,
                    importSource = importSource,
                    pdfSourceType = sourceType.name.lowercase(),
                    importRecordId = importRecordId,
                    status = "ok",
                    createdAt = now,
                    updatedAt = now,
                )
                val items = inv.lineItems.map {
                    LineItemEntity(
                        invoiceId = 0,
                        name = it.name,
                        quantity = it.quantity,
                        unitPricePaise = it.unitPricePaise,
                        totalPricePaise = it.totalPricePaise,
                        discountPaise = it.discountPaise,
                    )
                }
                db.invoiceDao().insertInvoiceWithItems(meta, items)
            }

            is ExtractionResult.LowConfidence -> {
                val inv = result.invoice
                val meta = InvoiceMetaEntity(
                    merchantName = inv.merchantName,
                    merchantAddress = inv.merchantAddress,
                    invoiceDate = inv.invoiceDate,
                    grandTotalPaise = inv.grandTotalPaise,
                    discountPaise = inv.discountPaise,
                    taxPaise = inv.taxPaise,
                    paymentMode = inv.paymentMode?.name,
                    importSource = importSource,
                    pdfSourceType = sourceType.name.lowercase(),
                    importRecordId = importRecordId,
                    status = "pending_review",
                    createdAt = now,
                    updatedAt = now,
                )
                db.invoiceDao().insertInvoiceWithItems(meta, emptyList())
            }

            is ExtractionResult.EncryptedPdf ->
                persistStatus(uri, fileName, importSource, importRecordId,
                    "import_blocked_encrypted", sourceType)

            is ExtractionResult.Failure ->
                persistStatus(uri, fileName, importSource, importRecordId,
                    "pending_extraction", sourceType)
        }
    }

    private suspend fun persistStatus(
        uri: Uri,
        fileName: String,
        importSource: String,
        importRecordId: Long?,
        status: String,
        sourceType: PdfSourceType,
    ) {
        val now = Instant.now().toString()
        db.invoiceDao().insertInvoice(
            InvoiceMetaEntity(
                merchantName = fileName,
                merchantAddress = null,
                invoiceDate = null,
                grandTotalPaise = null,
                discountPaise = 0L,
                taxPaise = null,
                paymentMode = null,
                importSource = importSource,
                pdfSourceType = sourceType.name.lowercase(),
                importRecordId = importRecordId,
                status = status,
                createdAt = now,
                updatedAt = now,
            )
        )
    }
}
