package com.jinvoice.autoimport

import android.net.Uri

/** Common contract for email connectors (Gmail, Outlook). */
interface EmailConnector {

    val source: String   // "gmail" | "outlook"

    /** Returns true if the user is authenticated and the connector is enabled. */
    fun isConnected(): Boolean

    /**
     * Polls for new invoice PDF attachments since [sinceMessageId] (exclusive).
     * Downloads each PDF to the local jInvoice folder and returns the list of results.
     */
    suspend fun pollAndDownload(): List<DownloadedPdf>

    /** Revoke OAuth access and clear stored tokens. */
    suspend fun revoke()
}

data class DownloadedPdf(
    val messageId: String,
    val subject: String?,
    val sender: String?,
    val localUri: Uri,
    val fileName: String,
)
