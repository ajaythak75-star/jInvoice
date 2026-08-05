import Foundation
import PDFKit
import Vision

private let confidenceThreshold: Float = 0.7
private let renderDpi: CGFloat = 300
private let pointsPerInch: CGFloat = 72

final class iOSScannedPdfExtractor: InvoiceExtractor {
    func extract(fileURL: URL, fileName: String) async -> ExtractionResult {
        guard let doc = PDFDocument(url: fileURL) else {
            return .failure(reason: "Cannot open PDF", underlying: nil)
        }
        var combinedText = ""
        for i in 0..<doc.pageCount {
            guard let page = doc.page(at: i) else { continue }
            if let text = try? await recognizeText(on: page) {
                combinedText += text + "\n"
            }
        }
        guard !combinedText.trimmingCharacters(in: .whitespaces).isEmpty else {
            return .failure(reason: "OCR produced no text", underlying: nil)
        }
        let invoice = InvoiceFieldParser.parse(text: combinedText, sourceType: .scannedPdf)
        if invoice.confidenceScore < confidenceThreshold {
            return .lowConfidence(invoice: invoice, reason: "Confidence \(Int(invoice.confidenceScore * 100))% < 70%")
        }
        return .success(invoice)
    }

    private func recognizeText(on page: PDFPage) async throws -> String {
        let scale = renderDpi / pointsPerInch
        let bounds = page.bounds(for: .mediaBox)
        let size = CGSize(width: bounds.width * scale, height: bounds.height * scale)

        let renderer = UIGraphicsImageRenderer(size: size)
        let image = renderer.image { ctx in
            UIColor.white.setFill()
            ctx.fill(CGRect(origin: .zero, size: size))
            ctx.cgContext.scaleBy(x: scale, y: scale)
            page.draw(with: .mediaBox, to: ctx.cgContext)
        }

        guard let cgImage = image.cgImage else { throw ExtractionError.renderFailed }

        return try await withCheckedThrowingContinuation { cont in
            let request = VNRecognizeTextRequest { request, error in
                if let error { cont.resume(throwing: error); return }
                let observations = request.results as? [VNRecognizedTextObservation] ?? []
                let text = observations.compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
                cont.resume(returning: text)
            }
            request.recognitionLevel = .accurate
            request.usesLanguageCorrection = true
            request.recognitionLanguages = ["en-IN", "hi"]

            let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
            do { try handler.perform([request]) }
            catch { cont.resume(throwing: error) }
        }
    }
}

enum ExtractionError: Error {
    case renderFailed
}
