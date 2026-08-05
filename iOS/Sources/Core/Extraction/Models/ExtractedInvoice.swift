import Foundation

enum PaymentMode: String, Codable {
    case cash, upi, card, bnpl, credit, unknown
}

enum PdfSourceType: String, Codable {
    case nativePdf = "NATIVE_PDF"
    case scannedPdf = "SCANNED_PDF"
    case mixedPdf = "MIXED_PDF"
}

struct ExtractedInvoice: Equatable {
    let merchantName: String?
    let merchantAddress: String?
    let merchantGstin: String?
    let invoiceDate: String?        // ISO 8601
    let lineItems: [LineItem]
    let subtotalPaise: Int64?
    let discountPaise: Int64
    let taxPaise: Int64?
    let grandTotalPaise: Int64?
    let paymentMode: PaymentMode?
    let sourceType: PdfSourceType
    let rawText: String?            // never transmitted or persisted
    let confidenceScore: Float
}
