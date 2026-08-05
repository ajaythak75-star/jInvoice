package com.jinvoice.data.db.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * Tracks each email that was polled during Auto-Import.
 * Persisting processed message IDs prevents re-downloading on subsequent polls.
 */
@Entity(
    tableName = "import_record",
    indices = [Index("message_id", unique = true)],
)
data class ImportRecord(
    @PrimaryKey(autoGenerate = true)
    @ColumnInfo(name = "id") val id: Long = 0,

    // Gmail message ID or Microsoft Graph message ID
    @ColumnInfo(name = "message_id") val messageId: String,

    // "gmail" | "outlook"
    @ColumnInfo(name = "source") val source: String,

    @ColumnInfo(name = "subject") val subject: String?,
    @ColumnInfo(name = "sender") val sender: String?,

    // Local path where the PDF was saved (Downloads/jInvoice/)
    @ColumnInfo(name = "local_pdf_uri") val localPdfUri: String?,

    // "downloaded" | "extracted" | "pending_review" | "failed" | "import_blocked_encrypted"
    @ColumnInfo(name = "status") val status: String,

    @ColumnInfo(name = "created_at") val createdAt: String,   // ISO 8601
)
