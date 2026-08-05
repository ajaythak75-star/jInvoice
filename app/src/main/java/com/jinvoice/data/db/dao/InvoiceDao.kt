package com.jinvoice.data.db.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import com.jinvoice.data.db.entity.InvoiceFtsEntity
import com.jinvoice.data.db.entity.InvoiceMetaEntity
import com.jinvoice.data.db.entity.LineItemEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface InvoiceDao {

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertInvoice(invoice: InvoiceMetaEntity): Long

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertLineItems(items: List<LineItemEntity>)

    @Transaction
    suspend fun insertInvoiceWithItems(invoice: InvoiceMetaEntity, items: List<LineItemEntity>) {
        val id = insertInvoice(invoice)
        if (items.isNotEmpty()) {
            insertLineItems(items.map { it.copy(invoiceId = id) })
        }
    }

    /**
     * FTS5 MATCH search — always column-scoped to avoid unscoped full-table FTS.
     * Never use LIKE '%query%' for search.
     */
    @Query("""
        SELECT m.* FROM invoice_meta m
        INNER JOIN invoice_fts f ON m.id = f.rowid
        WHERE invoice_fts MATCH 'merchant_name:' || :query || ' OR merchant_address:' || :query
        ORDER BY m.invoice_date DESC
        LIMIT 50
    """)
    fun searchByMerchant(query: String): Flow<List<InvoiceMetaEntity>>

    @Query("""
        SELECT m.* FROM invoice_meta m
        INNER JOIN invoice_fts f ON m.id = f.rowid
        WHERE invoice_fts MATCH 'merchant_name:' || :query
        ORDER BY m.invoice_date DESC
        LIMIT 50
    """)
    fun searchByMerchantName(query: String): Flow<List<InvoiceMetaEntity>>

    @Query("SELECT * FROM invoice_meta ORDER BY invoice_date DESC LIMIT :limit OFFSET :offset")
    fun getRecentInvoices(limit: Int = 50, offset: Int = 0): Flow<List<InvoiceMetaEntity>>

    @Query("SELECT * FROM invoice_meta WHERE status = 'pending_review' ORDER BY created_at DESC")
    fun getPendingReviewInvoices(): Flow<List<InvoiceMetaEntity>>

    @Query("SELECT * FROM line_item WHERE invoice_id = :invoiceId")
    suspend fun getLineItems(invoiceId: Long): List<LineItemEntity>

    @Query("UPDATE invoice_meta SET status = :status, updated_at = :updatedAt WHERE id = :id")
    suspend fun updateStatus(id: Long, status: String, updatedAt: String)

    @Query("DELETE FROM invoice_meta WHERE id = :id")
    suspend fun deleteInvoice(id: Long)

    /** Rebuild FTS content — called by the repair script after manual index corruption. */
    @Query("INSERT INTO invoice_fts(invoice_fts) VALUES('rebuild')")
    suspend fun rebuildFtsIndex()
}
