import Foundation
import GRDB

final class InvoiceDAO {
    private let db: InvoiceDatabase

    init(db: InvoiceDatabase = .shared) {
        self.db = db
    }

    func insertInvoiceWithItems(invoice: InvoiceMetaRecord, items: [LineItemRecord]) throws {
        try db.dbPool.write { conn in
            var record = invoice
            try record.insert(conn)
            let invoiceId = record.id!
            for var item in items {
                item.invoiceId = invoiceId
                try item.insert(conn)
            }
        }
    }

    func isAlreadyImported(messageId: String) throws -> Bool {
        try db.dbPool.read { conn in
            try ImportRecord.filter(Column("message_id") == messageId).fetchCount(conn) > 0
        }
    }

    func recordImport(_ record: ImportRecord) throws {
        try db.dbPool.write { conn in
            var r = record
            try r.insert(conn)
        }
    }

    func updateStatus(invoiceId: Int64, status: String) throws {
        try db.dbPool.write { conn in
            try conn.execute(
                sql: "UPDATE invoice_meta SET status = ?, updated_at = ? WHERE id = ?",
                arguments: [status, ISO8601DateFormatter().string(from: Date()), invoiceId]
            )
        }
    }

    func searchByMerchant(query: String) throws -> [InvoiceMetaRecord] {
        try db.dbPool.read { conn in
            try InvoiceMetaRecord.fetchAll(conn, sql: """
                SELECT m.* FROM invoice_meta m
                INNER JOIN invoice_fts f ON m.id = f.rowid
                WHERE invoice_fts MATCH 'merchant_name:' || ? || ' OR merchant_address:' || ?
                ORDER BY m.invoice_date DESC LIMIT 50
            """, arguments: [query, query])
        }
    }

    func rebuildFtsIndex() throws {
        try db.dbPool.write { conn in
            try conn.execute(sql: "INSERT INTO invoice_fts(invoice_fts) VALUES ('rebuild')")
        }
    }

    func getPendingReview() throws -> [InvoiceMetaRecord] {
        try db.dbPool.read { conn in
            try InvoiceMetaRecord.filter(Column("status") == "pending_review").fetchAll(conn)
        }
    }
}
