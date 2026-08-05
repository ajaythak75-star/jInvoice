package com.jinvoice.data.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import com.jinvoice.data.db.dao.ImportRecordDao
import com.jinvoice.data.db.dao.InvoiceDao
import com.jinvoice.data.db.entity.ImportRecord
import com.jinvoice.data.db.entity.InvoiceFtsEntity
import com.jinvoice.data.db.entity.InvoiceMetaEntity
import com.jinvoice.data.db.entity.LineItemEntity

@Database(
    entities = [
        InvoiceMetaEntity::class,
        InvoiceFtsEntity::class,
        LineItemEntity::class,
        ImportRecord::class,
    ],
    version = 1,
    exportSchema = true,
)
abstract class InvoiceDatabase : RoomDatabase() {

    abstract fun invoiceDao(): InvoiceDao
    abstract fun importRecordDao(): ImportRecordDao

    companion object {

        @Volatile
        private var INSTANCE: InvoiceDatabase? = null

        fun getInstance(context: Context): InvoiceDatabase {
            return INSTANCE ?: synchronized(this) {
                Room.databaseBuilder(
                    context.applicationContext,
                    InvoiceDatabase::class.java,
                    "jinvoice.db",
                )
                    .addCallback(FtsSetupCallback)
                    .build()
                    .also { INSTANCE = it }
            }
        }

        /**
         * Creates the FTS5 virtual table and keeps it in sync with invoice_meta
         * via content= mode so Room's regular table is the authoritative source.
         */
        private val FtsSetupCallback = object : RoomDatabase.Callback() {
            override fun onCreate(db: SupportSQLiteDatabase) {
                // Drop the Fts4 shadow table Room may have created; replace with FTS5 content table
                db.execSQL("DROP TABLE IF EXISTS invoice_fts")
                db.execSQL("""
                    CREATE VIRTUAL TABLE IF NOT EXISTS invoice_fts
                    USING fts5(
                        merchant_name,
                        merchant_address,
                        invoice_date,
                        content=invoice_meta,
                        content_rowid=id
                    )
                """.trimIndent())

                // Triggers to keep FTS5 index in sync with invoice_meta
                db.execSQL("""
                    CREATE TRIGGER IF NOT EXISTS invoice_meta_ai
                    AFTER INSERT ON invoice_meta BEGIN
                        INSERT INTO invoice_fts(rowid, merchant_name, merchant_address, invoice_date)
                        VALUES (new.id, new.merchant_name, new.merchant_address, new.invoice_date);
                    END
                """.trimIndent())

                db.execSQL("""
                    CREATE TRIGGER IF NOT EXISTS invoice_meta_ad
                    AFTER DELETE ON invoice_meta BEGIN
                        INSERT INTO invoice_fts(invoice_fts, rowid, merchant_name, merchant_address, invoice_date)
                        VALUES ('delete', old.id, old.merchant_name, old.merchant_address, old.invoice_date);
                    END
                """.trimIndent())

                db.execSQL("""
                    CREATE TRIGGER IF NOT EXISTS invoice_meta_au
                    AFTER UPDATE ON invoice_meta BEGIN
                        INSERT INTO invoice_fts(invoice_fts, rowid, merchant_name, merchant_address, invoice_date)
                        VALUES ('delete', old.id, old.merchant_name, old.merchant_address, old.invoice_date);
                        INSERT INTO invoice_fts(rowid, merchant_name, merchant_address, invoice_date)
                        VALUES (new.id, new.merchant_name, new.merchant_address, new.invoice_date);
                    END
                """.trimIndent())
            }
        }
    }
}
