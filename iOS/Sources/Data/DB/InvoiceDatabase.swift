import Foundation
import GRDB

final class InvoiceDatabase {
    static let shared: InvoiceDatabase = {
        let url = try! FileManager.default
            .url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            .appendingPathComponent("jInvoice.sqlite")
        return try! InvoiceDatabase(path: url.path)
    }()

    let dbPool: DatabasePool

    init(path: String) throws {
        dbPool = try DatabasePool(path: path)
        try migrator.migrate(dbPool)
    }

    private var migrator: DatabaseMigrator {
        var m = DatabaseMigrator()
        m.registerMigration("v1") { db in
            try db.execute(sql: """
                CREATE TABLE IF NOT EXISTS invoice_meta (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    merchant_name TEXT,
                    merchant_address TEXT,
                    merchant_gstin TEXT,
                    invoice_date TEXT,
                    grand_total_paise INTEGER,
                    discount_paise INTEGER NOT NULL DEFAULT 0,
                    tax_paise INTEGER,
                    payment_mode TEXT,
                    import_source TEXT NOT NULL,
                    pdf_source_type TEXT NOT NULL,
                    import_record_id INTEGER REFERENCES import_records(id),
                    status TEXT NOT NULL DEFAULT 'imported',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
            """)
            try db.execute(sql: """
                CREATE TABLE IF NOT EXISTS line_items (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    invoice_id INTEGER NOT NULL REFERENCES invoice_meta(id) ON DELETE CASCADE,
                    name TEXT NOT NULL,
                    quantity REAL NOT NULL,
                    unit_price_paise INTEGER NOT NULL,
                    total_price_paise INTEGER NOT NULL,
                    discount_paise INTEGER NOT NULL DEFAULT 0
                )
            """)
            try db.execute(sql: """
                CREATE TABLE IF NOT EXISTS import_records (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    message_id TEXT NOT NULL UNIQUE,
                    source TEXT NOT NULL,
                    status TEXT NOT NULL,
                    imported_at TEXT NOT NULL
                )
            """)
            try db.execute(sql: """
                CREATE VIRTUAL TABLE invoice_fts USING fts5(
                    merchant_name,
                    merchant_address,
                    invoice_date,
                    content=invoice_meta,
                    content_rowid=id
                )
            """)
            try db.execute(sql: """
                CREATE TRIGGER invoice_meta_ai AFTER INSERT ON invoice_meta BEGIN
                    INSERT INTO invoice_fts(rowid, merchant_name, merchant_address, invoice_date)
                    VALUES (new.id, new.merchant_name, new.merchant_address, new.invoice_date);
                END
            """)
            try db.execute(sql: """
                CREATE TRIGGER invoice_meta_ad AFTER DELETE ON invoice_meta BEGIN
                    INSERT INTO invoice_fts(invoice_fts, rowid, merchant_name, merchant_address, invoice_date)
                    VALUES ('delete', old.id, old.merchant_name, old.merchant_address, old.invoice_date);
                END
            """)
            try db.execute(sql: """
                CREATE TRIGGER invoice_meta_au AFTER UPDATE ON invoice_meta BEGIN
                    INSERT INTO invoice_fts(invoice_fts, rowid, merchant_name, merchant_address, invoice_date)
                    VALUES ('delete', old.id, old.merchant_name, old.merchant_address, old.invoice_date);
                    INSERT INTO invoice_fts(rowid, merchant_name, merchant_address, invoice_date)
                    VALUES (new.id, new.merchant_name, new.merchant_address, new.invoice_date);
                END
            """)
        }
        return m
    }
}
