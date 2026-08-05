package com.jinvoice.data.db.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "line_item",
    foreignKeys = [ForeignKey(
        entity = InvoiceMetaEntity::class,
        parentColumns = ["id"],
        childColumns = ["invoice_id"],
        onDelete = ForeignKey.CASCADE,
    )],
    indices = [Index("invoice_id")],
)
data class LineItemEntity(
    @PrimaryKey(autoGenerate = true)
    @ColumnInfo(name = "id") val id: Long = 0,

    @ColumnInfo(name = "invoice_id") val invoiceId: Long,
    @ColumnInfo(name = "name") val name: String,
    @ColumnInfo(name = "quantity") val quantity: Double,
    @ColumnInfo(name = "unit_price_paise") val unitPricePaise: Long,
    @ColumnInfo(name = "total_price_paise") val totalPricePaise: Long,
    @ColumnInfo(name = "discount_paise") val discountPaise: Long = 0L,
)
