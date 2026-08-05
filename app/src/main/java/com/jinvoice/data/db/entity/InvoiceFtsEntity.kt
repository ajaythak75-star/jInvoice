package com.jinvoice.data.db.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Fts4

/**
 * FTS5 is declared via raw SQL in InvoiceDatabase.
 * This companion entity stores the rowid mapping and metadata that
 * Room can manage as a regular table.
 */
@Entity(tableName = "invoice_meta")
data class InvoiceMetaEntity(
    @androidx.room.PrimaryKey(autoGenerate = true)
    @ColumnInfo(name = "id") val id: Long = 0,

    // Searchable fields — mirrored into FTS5 via trigger
    @ColumnInfo(name = "merchant_name") val merchantName: String?,
    @ColumnInfo(name = "merchant_address") val merchantAddress: String?,

    // ISO 8601 date string
    @ColumnInfo(name = "invoice_date") val invoiceDate: String?,

    // All monetary values in paise
    @ColumnInfo(name = "grand_total_paise") val grandTotalPaise: Long?,
    @ColumnInfo(name = "discount_paise") val discountPaise: Long = 0L,
    @ColumnInfo(name = "tax_paise") val taxPaise: Long?,

    @ColumnInfo(name = "payment_mode") val paymentMode: String?,

    // "auto_import_gmail" | "auto_import_outlook" | "manual_upload"
    @ColumnInfo(name = "import_source") val importSource: String,

    // "native_pdf" | "scanned_pdf" | "mixed_pdf"
    @ColumnInfo(name = "pdf_source_type") val pdfSourceType: String,

    // Import record that triggered this invoice
    @ColumnInfo(name = "import_record_id") val importRecordId: Long?,

    // "ok" | "pending_review" | "import_blocked_encrypted"
    @ColumnInfo(name = "status") val status: String = "ok",

    @ColumnInfo(name = "created_at") val createdAt: String,   // ISO 8601
    @ColumnInfo(name = "updated_at") val updatedAt: String,
)

/** FTS5 virtual table entity — declared in raw SQL, surfaced here for query return type. */
@Fts4(contentEntity = InvoiceMetaEntity::class)
@Entity(tableName = "invoice_fts")
data class InvoiceFtsEntity(
    @ColumnInfo(name = "merchant_name") val merchantName: String?,
    @ColumnInfo(name = "merchant_address") val merchantAddress: String?,
    @ColumnInfo(name = "invoice_date") val invoiceDate: String?,
)
