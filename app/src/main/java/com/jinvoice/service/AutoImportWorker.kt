package com.jinvoice.service

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.jinvoice.autoimport.GmailConnector
import com.jinvoice.autoimport.OutlookConnector
import com.jinvoice.data.db.InvoiceDatabase
import com.jinvoice.data.prefs.AutoImportPreferences
import com.jinvoice.autoimport.PdfDownloadManager
import com.jinvoice.extraction.ExtractionPipeline
import java.util.concurrent.TimeUnit

/**
 * Periodic WorkManager task that polls connected email accounts and triggers
 * the on-device extraction pipeline for any newly downloaded invoice PDFs.
 *
 * Runs every hour when the device has network. All PDF processing is on-device —
 * no receipt text, no attachments, no email metadata leave the device.
 */
class AutoImportWorker(
    context: Context,
    workerParams: WorkerParameters,
) : CoroutineWorker(context, workerParams) {

    override suspend fun doWork(): Result {
        val ctx = applicationContext
        val db = InvoiceDatabase.getInstance(ctx)
        val prefs = AutoImportPreferences(ctx)
        val downloadManager = PdfDownloadManager(ctx)
        val pipeline = ExtractionPipeline(ctx, db)

        val connectors = buildList {
            if (prefs.gmailEnabled && prefs.gmailConsentGiven) {
                add(GmailConnector(ctx, prefs, db.importRecordDao(), downloadManager))
            }
            if (prefs.outlookEnabled && prefs.outlookConsentGiven) {
                add(OutlookConnector(ctx, prefs, db.importRecordDao(), downloadManager))
            }
        }

        if (connectors.isEmpty()) return Result.success()

        var anyFailure = false

        for (connector in connectors) {
            try {
                val downloads = connector.pollAndDownload()
                for (pdf in downloads) {
                    try {
                        pipeline.processDownloadedPdf(
                            uri = pdf.localUri,
                            fileName = pdf.fileName,
                            importSource = "auto_import_${connector.source}",
                            importMessageId = pdf.messageId,
                        )
                    } catch (e: Exception) {
                        anyFailure = true
                        db.importRecordDao().updateStatus(pdf.messageId, "extraction_failed")
                    }
                }
            } catch (e: Exception) {
                anyFailure = true
            }
        }

        return if (anyFailure) Result.retry() else Result.success()
    }

    companion object {
        private const val WORK_NAME = "auto_import_polling"

        fun schedule(context: Context) {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()

            val request = PeriodicWorkRequestBuilder<AutoImportWorker>(
                repeatInterval = 1,
                repeatIntervalTimeUnit = TimeUnit.HOURS,
            )
                .setConstraints(constraints)
                .build()

            WorkManager.getInstance(context)
                .enqueueUniquePeriodicWork(
                    WORK_NAME,
                    ExistingPeriodicWorkPolicy.KEEP,
                    request,
                )
        }

        fun cancel(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME)
        }
    }
}
