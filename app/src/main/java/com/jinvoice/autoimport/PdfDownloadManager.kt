package com.jinvoice.autoimport

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Environment
import android.provider.MediaStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.InputStream

/**
 * Saves a PDF to Downloads/jInvoice/ via MediaStore scoped storage.
 * Never writes outside the jInvoice folder; never requests broad storage permission.
 * The saved file is visible to the user in the Files app and is not deleted by jInvoice.
 */
class PdfDownloadManager(private val context: Context) {

    companion object {
        const val JINVOICE_SUBFOLDER = "jInvoice"
        const val MIME_PDF = "application/pdf"
    }

    /**
     * Saves [inputStream] as [fileName] in Downloads/jInvoice/ via MediaStore.
     * Returns the content URI of the saved file.
     * Throws if the write fails — callers should catch and mark the import record as failed.
     */
    suspend fun savePdf(inputStream: InputStream, fileName: String): Uri =
        withContext(Dispatchers.IO) {
            val sanitizedName = sanitizeFileName(fileName)

            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, sanitizedName)
                put(MediaStore.Downloads.MIME_TYPE, MIME_PDF)
                put(MediaStore.Downloads.RELATIVE_PATH,
                    "${Environment.DIRECTORY_DOWNLOADS}/$JINVOICE_SUBFOLDER")
                put(MediaStore.Downloads.IS_PENDING, 1)
            }

            val resolver = context.contentResolver
            val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                ?: error("MediaStore insert returned null for $sanitizedName")

            try {
                resolver.openOutputStream(uri)?.use { out ->
                    inputStream.copyTo(out)
                } ?: error("Cannot open output stream for $uri")

                values.clear()
                values.put(MediaStore.Downloads.IS_PENDING, 0)
                resolver.update(uri, values, null, null)

                uri
            } catch (e: Exception) {
                resolver.delete(uri, null, null)
                throw e
            }
        }

    /** Checks if a file with this name already exists in Downloads/jInvoice/. */
    suspend fun exists(fileName: String): Boolean = withContext(Dispatchers.IO) {
        val sanitized = sanitizeFileName(fileName)
        val cursor = context.contentResolver.query(
            MediaStore.Downloads.EXTERNAL_CONTENT_URI,
            arrayOf(MediaStore.Downloads._ID),
            "${MediaStore.Downloads.DISPLAY_NAME} = ? AND ${MediaStore.Downloads.RELATIVE_PATH} LIKE ?",
            arrayOf(sanitized, "%$JINVOICE_SUBFOLDER%"),
            null,
        )
        val found = (cursor?.count ?: 0) > 0
        cursor?.close()
        found
    }

    private fun sanitizeFileName(name: String): String {
        // Strip path traversal characters; keep extension
        return name.replace(Regex("[^a-zA-Z0-9._\\-]"), "_").take(200)
    }
}
