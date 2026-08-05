package com.jinvoice.autoimport

import android.content.Context
import com.microsoft.identity.client.IPublicClientApplication
import com.microsoft.identity.client.ISingleAccountPublicClientApplication
import com.microsoft.identity.client.PublicClientApplication
import com.microsoft.identity.client.SilentAuthenticationCallback
import com.microsoft.identity.client.exception.MsalException
import com.jinvoice.R
import com.jinvoice.data.db.dao.ImportRecordDao
import com.jinvoice.data.db.entity.ImportRecord
import com.jinvoice.data.prefs.AutoImportPreferences
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.time.Instant
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Polls Microsoft Graph for emails with PDF invoice attachments.
 *
 * OAuth scope: Mail.Read — narrowest read-only scope.
 * Never requests full mailbox scope.
 * PDFs are downloaded directly to the device; nothing routes through jInvoice servers.
 */
class OutlookConnector(
    private val context: Context,
    private val prefs: AutoImportPreferences,
    private val importRecordDao: ImportRecordDao,
    private val pdfDownloadManager: PdfDownloadManager,
) : EmailConnector {

    override val source = "outlook"

    private val httpClient = OkHttpClient()

    override fun isConnected(): Boolean =
        prefs.outlookEnabled && prefs.outlookConsentGiven && prefs.outlookAccountId != null

    override suspend fun pollAndDownload(): List<DownloadedPdf> =
        withContext(Dispatchers.IO) {
            if (!isConnected()) return@withContext emptyList()

            val token = acquireTokenSilently() ?: return@withContext emptyList()
            val results = mutableListOf<DownloadedPdf>()

            // Microsoft Graph: messages with PDF attachments in inbox
            val messages = fetchInvoiceMessages(token)

            for (msg in messages) {
                val messageId = msg.optString("id") ?: continue
                if (importRecordDao.isAlreadyImported(messageId)) continue

                val subject = msg.optString("subject")
                val sender = msg.optJSONObject("sender")
                    ?.optJSONObject("emailAddress")
                    ?.optString("address")

                try {
                    processOutlookMessage(token, messageId, subject, sender, results)
                } catch (e: Exception) {
                    importRecordDao.insert(ImportRecord(
                        messageId = messageId,
                        source = source,
                        subject = subject,
                        sender = sender,
                        localPdfUri = null,
                        status = "failed",
                        createdAt = Instant.now().toString(),
                    ))
                }
            }

            results
        }

    private suspend fun fetchInvoiceMessages(token: String): List<JSONObject> {
        val filterKeywords = listOf("invoice", "receipt", "bill", "order", "payment")
            .joinToString(" OR ") { "\"$it\"" }

        val url = "https://graph.microsoft.com/v1.0/me/messages" +
            "?\$filter=hasAttachments eq true" +
            "&\$search=$filterKeywords" +
            "&\$select=id,subject,sender,hasAttachments" +
            "&\$top=50"

        val request = Request.Builder()
            .url(url)
            .addHeader("Authorization", "Bearer $token")
            .addHeader("Accept", "application/json")
            .build()

        val response = httpClient.newCall(request).execute()
        if (!response.isSuccessful) return emptyList()

        val body = response.body?.string() ?: return emptyList()
        val json = JSONObject(body)
        val value = json.optJSONArray("value") ?: return emptyList()

        return (0 until value.length()).map { value.getJSONObject(it) }
    }

    private suspend fun processOutlookMessage(
        token: String,
        messageId: String,
        subject: String?,
        sender: String?,
        results: MutableList<DownloadedPdf>,
    ) {
        if (!EmailInvoiceHeuristics.isInvoiceCandidate(subject, sender)) {
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

        importRecordDao.insert(ImportRecord(
            messageId = messageId,
            source = source,
            subject = subject,
            sender = sender,
            localPdfUri = null,
            status = "pending",
            createdAt = Instant.now().toString(),
        ))

        val attachments = fetchPdfAttachments(token, messageId)

        for ((fileName, attachmentId) in attachments) {
            if (!EmailInvoiceHeuristics.isPdfAttachment(fileName)) continue

            val bytes = downloadAttachment(token, messageId, attachmentId)
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

    private fun fetchPdfAttachments(token: String, messageId: String): List<Pair<String, String>> {
        val url = "https://graph.microsoft.com/v1.0/me/messages/$messageId/attachments" +
            "?\$select=id,name,contentType"

        val request = Request.Builder()
            .url(url)
            .addHeader("Authorization", "Bearer $token")
            .build()

        val response = httpClient.newCall(request).execute()
        if (!response.isSuccessful) return emptyList()

        val body = response.body?.string() ?: return emptyList()
        val value = JSONObject(body).optJSONArray("value") ?: return emptyList()

        val results = mutableListOf<Pair<String, String>>()
        for (i in 0 until value.length()) {
            val att = value.getJSONObject(i)
            val contentType = att.optString("contentType")
            val name = att.optString("name")
            val id = att.optString("id")
            if (contentType == "application/pdf" && name.isNotBlank()) {
                results.add(name to id)
            }
        }
        return results
    }

    private fun downloadAttachment(token: String, messageId: String, attachmentId: String): ByteArray {
        val url = "https://graph.microsoft.com/v1.0/me/messages/$messageId/attachments/$attachmentId/\$value"
        val request = Request.Builder()
            .url(url)
            .addHeader("Authorization", "Bearer $token")
            .build()

        val response = httpClient.newCall(request).execute()
        check(response.isSuccessful) { "Attachment download failed: ${response.code}" }
        return response.body?.bytes() ?: error("Empty attachment body")
    }

    /** Acquires an access token silently from the MSAL token cache. */
    private suspend fun acquireTokenSilently(): String? {
        val accountId = prefs.outlookAccountId ?: return null
        return suspendCancellableCoroutine { cont ->
            PublicClientApplication.createSingleAccountPublicClientApplication(
                context,
                R.raw.msal_auth_config,
                object : IPublicClientApplication.ISingleAccountApplicationCreatedListener {
                    override fun onCreated(app: ISingleAccountPublicClientApplication) {
                        app.acquireTokenSilentAsync(
                            arrayOf("Mail.Read"),
                            app.currentAccount.currentAccount ?: run {
                                cont.resume(null)
                                return
                            },
                            object : SilentAuthenticationCallback {
                                override fun onSuccess(
                                    authenticationResult: com.microsoft.identity.client.IAuthenticationResult
                                ) {
                                    cont.resume(authenticationResult.accessToken)
                                }

                                override fun onError(exception: MsalException) {
                                    cont.resumeWithException(exception)
                                }
                            },
                        )
                    }

                    override fun onError(exception: MsalException) {
                        cont.resumeWithException(exception)
                    }
                }
            )
        }
    }

    override suspend fun revoke() {
        prefs.revokeOutlook()
    }
}
