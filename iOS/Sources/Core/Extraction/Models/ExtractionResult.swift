import Foundation

enum ExtractionResult {
    case success(ExtractedInvoice)
    case lowConfidence(invoice: ExtractedInvoice, reason: String)
    case encryptedPdf
    case failure(reason: String, underlying: Error?)
}
