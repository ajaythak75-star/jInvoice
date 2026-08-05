package com.jinvoice.autoimport

import android.content.Context
import android.net.Uri
import android.util.Base64
import com.google.api.client.googleapis.extensions.android.gms.auth.GoogleAccountCredential
import com.google.api.client.http.javanet.NetHttpTransport
import com.google.api.client.json.gson.GsonFactory
import com.google.api.services.gmail.Gmail
import com.google.api.services.gmail.GmailScopes
import com.google.api.services.gmail.model.Message
import com.jinvoice.data.db.dao.ImportRecordDao
import com.jinvoice.data.db.entity.ImportRecord
import com.jinvoice.data.prefs.AutoImportPreferences
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayInputStream
import java.time.Instant

/**
 * Polls Gmail for emails with PDF invoice attachments.
 *
 * OAuth scope: [GmailScopes.GMAIL_READONLY] — narrowest read-only scope.
 * Never requests full inbox scope. Never routes email content or attachments through
 * jInvoice servers — all processing is on-device.
 */
class GmailConnector(
    private val context: Context,
    private val prefs: AutoImportPreferences,
    private val importRecordDao: ImportRecordDao,
    private val pdfDownloadManager: PdfDownloadManager,
) : EmailConnector {

    override val source = "gmail"

    override fun isConnected(): Boolean =
        prefs.gmailEnabled && prefs.gmailConsentGiven && prefs.gmailAccountEmail != null

    private fun buildGmailService(): Gmail {
        val accountEmail = prefs.gmailAccountEmail
            ?: error("Gmail account email not set")

        val credential = GoogleAccountCredential.usingOAuth2(
            context,
            listOf(GmailScopes.GMAIL_READONLY),
        ).also { it.selectedAccountName = accountEmail }

        return Gmail.Builder(
            NetHttpTransport(),
            GsonFactory.getDefaultInstance(),
            credential,
        )
            .setApplicationName("jInvoice")
            .build()
    }

    override suspend fun pollAndDownload(): List<DownloadedPdf> =
        withContext(Dispatchers.IO) {
            if (!isConnected()) return@withContext emptyList()

            val service = buildGmailService()
            val results = mutableListOf<DownloadedPdf>()

            // Query: emails with PDF attachments matching invoice heuristics
            val query = buildGmailQuery()
            val listResponse = service.users().messages()
                .list("me")
                .setQ(query)
                .setMaxResults(50L)
                .execute()

            val messageIds = listResponse.messages?.map { it.id } ?: return@withContext emptyList()

            for (messageId in messageIds) {
                if (importRecordDao.isAlreadyImported(messageId)) continue

                try {
                    processMessage(service, messageId, results)
                } catch (e: Exception) {
                    importRecordDao.insert(
                        ImportRecord(
                            messageId = messageId,
                            source = source,
                            subject = null,
                            sender = null,
                            localPdfUri = null,
                            status = "failed",
                            createdAt = Instant.now().toString(),
                        )
                    )
                }
            }

            results
        }

    private suspend fun processMessage(
        service: Gmail,
        messageId: String,
        results: MutableList<DownloadedPdf>,
    ) {
        val message = service.users().messages()
            .get("me", messageId)
            .setFormat("full")
            .execute()

        val headers = message.payload?.headers ?: return
        val subject = headers.firstOrNull { it.name == "Subject" }?.value
        val sender = headers.firstOrNull { it.name == "From" }?.value

        if (!EmailInvoiceHeuristics.isInvoiceCandidate(subject, sender)) {
            // Not an invoice email — record as skipped so we don't re-check it
            importRecordDao.insert(ImportRecord(
                messageId = messageId,
                source = source,
                subject = subject,
                sender = sender,
                localPdfUri = null,
                status = "skipped",
                createdAt = Instant.now().toString(),
            ))
            return
        }

        val pdfParts = findPdfAttachments(message)
        if (pdfParts.isEmpty()) return

        // Insert a pending record before downloading
        importRecordDao.insert(ImportRecord(
            messageId = messageId,
            source = source,
            subject = subject,
            sender = sender,
            localPdfUri = null,
            status = "pending",
            createdAt = Instant.now().toString(),
        ))

        for ((fileName, attachmentId) in pdfParts) {
            if (!EmailInvoiceHeuristics.isPdfAttachment(fileName)) continue

            val attachment = service.users().messages().attachments()
                .get("me", messageId, attachmentId)
                .execute()

            val bytes = Base64.decode(
                attachment.data.replace('-', '+').replace('_', '/'),
                Base64.DEFAULT,
            )

            val localUri = pdfDownloadManager.savePdf(
                ByteArrayInputStream(bytes),
                "${messageId}_$fileName",
            )

            importRecordDao.markDownloaded(messageId, localUri.toString())

            results.add(DownloadedPdf(
                messageId = messageId,
                subject = subject,
                sender = sender,
                localUri = localUri,
                fileName = fileName,
            ))
        }
    }

    private fun findPdfAttachments(message: Message): List<Pair<String, String>> {
        val parts = mutableListOf<Pair<String, String>>()
        collectParts(message.payload, parts)
        return parts
    }

    private fun collectParts(
        part: com.google.api.services.gmail.model.MessagePart?,
        out: MutableList<Pair<String, String>>,
    ) {
        if (part == null) return
        val mimeType = part.mimeType ?: ""
        val filename = part.filename ?: ""
        val attachmentId = part.body?.attachmentId

        if (mimeType == "application/pdf" && filename.isNotBlank() && attachmentId != null) {
            out.add(filename to attachmentId)
        }

        part.parts?.forEach { collectParts(it, out) }
    }

    override suspend fun revoke() {
        prefs.revokeGmail()
    }

    private fun buildGmailQuery(): String {
        val keywords = listOf(
            "invoice", "receipt", "bill", "order", "payment"
        ).joinToString(" OR ") { "subject:$it" }
        return "has:attachment filename:pdf ($keywords) in:inbox"
    }
}
