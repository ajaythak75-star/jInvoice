import Foundation
import PDFKit

private let confidenceThreshold: Float = 0.7

final class iOSNativePdfExtractor: InvoiceExtractor {
    func extract(fileURL: URL, fileName: String) async -> ExtractionResult {
        guard let doc = PDFDocument(url: fileURL) else {
            return .failure(reason: "Cannot open PDF", underlying: nil)
        }
        var fullText = ""
        for i in 0..<doc.pageCount {
            fullText += doc.page(at: i)?.string ?? ""
            fullText += "\n"
        }
        let invoice = InvoiceFieldParser.parse(text: fullText, sourceType: .nativePdf)
        if invoice.confidenceScore < confidenceThreshold {
            return .lowConfidence(
                invoice: invoice,
                reason: "Confidence \(Int(invoice.confidenceScore * 100))% < 70% — \(missingFields(invoice))"
            )
        }
        return .success(invoice)
    }

    private func missingFields(_ i: ExtractedInvoice) -> String {
        var missing: [String] = []
        if i.merchantName == nil { missing.append("merchant") }
        if i.invoiceDate == nil { missing.append("date") }
        if i.grandTotalPaise == nil { missing.append("total") }
        if i.paymentMode == nil || i.paymentMode == .unknown { missing.append("payment mode") }
        return "missing: \(missing.joined(separator: ", "))"
    }
}
