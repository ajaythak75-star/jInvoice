package com.jinvoice.extraction

import android.content.Context
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.text.PDFTextStripper
import com.jinvoice.core.extraction.NATIVE_TEXT_THRESHOLD
import com.jinvoice.core.extraction.PdfClassification
import com.jinvoice.core.extraction.PdfClassification.PageType
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Android implementation of PDF page classification.
 * Uses pdfbox-android to attempt text extraction on each page.
 * Falls back to PdfRenderer if pdfbox cannot open the file.
 *
 * Lives in app/ because it has Android imports — cannot move to core/.
 */
class AndroidPdfClassifier(private val context: Context) {

    suspend fun classify(uri: Uri): PdfClassification = withContext(Dispatchers.IO) {
        val stream = context.contentResolver.openInputStream(uri)
            ?: return@withContext PdfClassification.Scanned

        try {
            val document = PDDocument.load(stream)
            if (document.isEncrypted) {
                document.close()
                return@withContext PdfClassification.Encrypted
            }

            val stripper = PDFTextStripper()
            val pageCount = document.numberOfPages
            val pageTypes = mutableMapOf<Int, PageType>()

            for (pageIndex in 1..pageCount) {
                stripper.startPage = pageIndex
                stripper.endPage = pageIndex
                val text = stripper.getText(document)
                val printableChars = text.count { it.isLetterOrDigit() || it.isWhitespace() }
                pageTypes[pageIndex] = if (printableChars >= NATIVE_TEXT_THRESHOLD) {
                    PageType.NATIVE
                } else {
                    PageType.SCANNED
                }
            }

            document.close()

            when {
                pageTypes.values.all { it == PageType.NATIVE } -> PdfClassification.Native
                pageTypes.values.all { it == PageType.SCANNED } -> PdfClassification.Scanned
                else -> PdfClassification.Mixed(pageTypes)
            }
        } catch (e: Exception) {
            // pdfbox couldn't parse it — treat as scanned
            PdfClassification.Scanned
        }
    }
}
