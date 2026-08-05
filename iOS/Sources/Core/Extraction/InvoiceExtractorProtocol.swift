import Foundation

protocol InvoiceExtractor {
    func extract(fileURL: URL, fileName: String) async -> ExtractionResult
}
