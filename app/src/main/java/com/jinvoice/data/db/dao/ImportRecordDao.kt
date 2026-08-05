package com.jinvoice.data.db.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.jinvoice.data.db.entity.ImportRecord

@Dao
interface ImportRecordDao {

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insert(record: ImportRecord): Long

    /** Returns true if the message has already been processed — skip re-download. */
    @Query("SELECT COUNT(*) > 0 FROM import_record WHERE message_id = :messageId")
    suspend fun isAlreadyImported(messageId: String): Boolean

    @Query("UPDATE import_record SET status = :status WHERE message_id = :messageId")
    suspend fun updateStatus(messageId: String, status: String)

    @Query("UPDATE import_record SET local_pdf_uri = :uri, status = 'downloaded' WHERE message_id = :messageId")
    suspend fun markDownloaded(messageId: String, uri: String)

    @Query("SELECT * FROM import_record WHERE source = :source ORDER BY created_at DESC LIMIT 100")
    suspend fun getRecentBySource(source: String): List<ImportRecord>
}
