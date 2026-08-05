import Foundation
import GRDB

struct InvoiceMetaRecord: Codable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "invoice_meta"

    var id: Int64?
    var merchantName: String?
    var merchantAddress: String?
    var merchantGstin: String?
    var invoiceDate: String?
    var grandTotalPaise: Int64?
    var discountPaise: Int64
    var taxPaise: Int64?
    var paymentMode: String?
    var importSource: String
    var pdfSourceType: String
    var importRecordId: Int64?
    var status: String
    var createdAt: String
    var updatedAt: String

    enum Columns: String, ColumnExpression {
        case id, merchantName = "merchant_name", merchantAddress = "merchant_address",
             merchantGstin = "merchant_gstin", invoiceDate = "invoice_date",
             grandTotalPaise = "grand_total_paise", discountPaise = "discount_paise",
             taxPaise = "tax_paise", paymentMode = "payment_mode",
             importSource = "import_source", pdfSourceType = "pdf_source_type",
             importRecordId = "import_record_id", status, createdAt = "created_at",
             updatedAt = "updated_at"
    }

    mutating func didInsert(_ inserted: InsertionSuccess) {
        id = inserted.rowID
    }
}

struct LineItemRecord: Codable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "line_items"

    var id: Int64?
    var invoiceId: Int64
    var name: String
    var quantity: Double
    var unitPricePaise: Int64
    var totalPricePaise: Int64
    var discountPaise: Int64

    enum Columns: String, ColumnExpression {
        case id, invoiceId = "invoice_id", name, quantity,
             unitPricePaise = "unit_price_paise", totalPricePaise = "total_price_paise",
             discountPaise = "discount_paise"
    }

    mutating func didInsert(_ inserted: InsertionSuccess) {
        id = inserted.rowID
    }
}

struct ImportRecord: Codable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "import_records"

    var id: Int64?
    var messageId: String
    var source: String
    var status: String
    var importedAt: String

    enum Columns: String, ColumnExpression {
        case id, messageId = "message_id", source, status, importedAt = "imported_at"
    }

    mutating func didInsert(_ inserted: InsertionSuccess) {
        id = inserted.rowID
    }
}
