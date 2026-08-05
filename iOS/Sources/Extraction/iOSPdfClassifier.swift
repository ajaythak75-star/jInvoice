import Foundation
import PDFKit

final class iOSPdfClassifier {
    func classify(url: URL) -> PdfClassification {
        guard let doc = PDFDocument(url: url) else { return .scanned }
        if doc.isEncrypted && !doc.isUnlocked { return .encrypted }

        let pageCount = doc.pageCount
        guard pageCount > 0 else { return .scanned }

        var pageTypes: [Int: PageType] = [:]
        for i in 0..<pageCount {
            guard let page = doc.page(at: i) else { continue }
            let text = page.string ?? ""
            let printable = text.filter { $0.isLetter || $0.isNumber || $0.isWhitespace }.count
            pageTypes[i] = printable >= nativeTextThreshold ? .native : .scanned
        }

        let nativeCount = pageTypes.values.filter { $0 == .native }.count
        if nativeCount == pageCount { return .native }
        if nativeCount == 0 { return .scanned }
        return .mixed(pageTypes)
    }
}
