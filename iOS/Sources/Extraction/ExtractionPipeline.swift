import Foundation

final class ExtractionPipeline {
    private let classifier = iOSPdfClassifier()
    private let nativeExtractor = iOSNativePdfExtractor()
    private let scannedExtractor = iOSScannedPdfExtractor()
    private let dao = InvoiceDAO()

    func processDownloadedPdf(at url: URL, importSource: String = "email") async {
        let classification = classifier.classify(url: url)
        let result: ExtractionResult

        switch classification {
        case .encrypted:
            result = .encryptedPdf
        case .native:
            result = await nativeExtractor.extract(fileURL: url, fileName: url.lastPathComponent)
        case .scanned:
            result = await scannedExtractor.extract(fileURL: url, fileName: url.lastPathComponent)
        case .mixed(let pageTypes):
            let nativeCount = pageTypes.values.filter { $0 == .native }.count
            let dominant: ExtractionResult = nativeCount >= pageTypes.count / 2
                ? await nativeExtractor.extract(fileURL: url, fileName: url.lastPathComponent)
                : await scannedExtractor.extract(fileURL: url, fileName: url.lastPathComponent)
            result = dominant
        }

        persistResult(result, importSource: importSource)
    }

    private func persistResult(_ result: ExtractionResult, importSource: String) {
        let now = ISO8601DateFormatter().string(from: Date())
        switch result {
        case .success(let invoice):
            persist(invoice: invoice, status: "imported", importSource: importSource, now: now)
        case .lowConfidence(let invoice, _):
            persist(invoice: invoice, status: "pending_review", importSource: importSource, now: now)
        case .encryptedPdf:
            persistStatus("import_blocked_encrypted", importSource: importSource, now: now)
        case .failure:
            persistStatus("extraction_failed", importSource: importSource, now: now)
        }
    }

    private func persist(invoice: ExtractedInvoice, status: String, importSource: String, now: String) {
        var record = InvoiceMetaRecord(
            id: nil,
            merchantName: invoice.merchantName,
            merchantAddress: invoice.merchantAddress,
            merchantGstin: invoice.merchantGstin,
            invoiceDate: invoice.invoiceDate,
            grandTotalPaise: invoice.grandTotalPaise,
            discountPaise: invoice.discountPaise,
            taxPaise: invoice.taxPaise,
            paymentMode: invoice.paymentMode?.rawValue,
            importSource: importSource,
            pdfSourceType: invoice.sourceType.rawValue,
            importRecordId: nil,
            status: status,
            createdAt: now,
            updatedAt: now
        )
        let items = invoice.lineItems.map { item in
            LineItemRecord(
                id: nil, invoiceId: 0, name: item.name,
                quantity: item.quantity, unitPricePaise: item.unitPricePaise,
                totalPricePaise: item.totalPricePaise, discountPaise: item.discountPaise
            )
        }
        try? dao.insertInvoiceWithItems(invoice: record, items: items)
    }

    private func persistStatus(_ status: String, importSource: String, now: String) {
        let record = InvoiceMetaRecord(
            id: nil, merchantName: nil, merchantAddress: nil, merchantGstin: nil,
            invoiceDate: nil, grandTotalPaise: nil, discountPaise: 0, taxPaise: nil,
            paymentMode: nil, importSource: importSource, pdfSourceType: "NATIVE_PDF",
            importRecordId: nil, status: status, createdAt: now, updatedAt: now
        )
        try? dao.insertInvoiceWithItems(invoice: record, items: [])
    }
}
