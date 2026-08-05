import Foundation

enum InvoiceFieldParser {

    private static let datePatterns: [(NSRegularExpression, String)] = {
        let specs: [(String, String)] = [
            (#"(\d{2})[\/\-](\d{2})[\/\-](\d{4})"#, "dmy"),
            (#"(\d{4})[\/\-](\d{2})[\/\-](\d{2})"#, "ymd"),
            (#"(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})"#, "dmy_mon"),
        ]
        return specs.compactMap { pattern, fmt -> (NSRegularExpression, String)? in
            guard let rx = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive) else { return nil }
            return (rx, fmt)
        }
    }()

    private static let gstinRegex = try! NSRegularExpression(
        pattern: #"\b(\d{2}[A-Z]{5}\d{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1})\b"#
    )

    private static let totalPatterns: [NSRegularExpression] = [
        try! NSRegularExpression(pattern: #"(?:grand\s*total|total\s*amount|net\s*payable|amount\s*due)\s*[:\-]?\s*(?:₹|Rs\.?|INR)?\s*([\d,]+\.?\d{0,2})"#, options: .caseInsensitive),
        try! NSRegularExpression(pattern: #"(?:₹|Rs\.?)\s*([\d,]+\.?\d{0,2})\s*$"#, options: [.caseInsensitive, .anchorsMatchLines]),
    ]

    private static let monthMap: [String: String] = [
        "jan": "01", "feb": "02", "mar": "03", "apr": "04", "may": "05", "jun": "06",
        "jul": "07", "aug": "08", "sep": "09", "oct": "10", "nov": "11", "dec": "12",
    ]

    static func extractDate(from text: String) -> String? {
        let range = NSRange(text.startIndex..., in: text)
        for (rx, fmt) in datePatterns {
            guard let match = rx.firstMatch(in: text, range: range) else { continue }
            let groups = (1...match.numberOfRanges - 1).map { i -> String in
                if let r = Range(match.range(at: i), in: text) { return String(text[r]) }
                return ""
            }
            switch fmt {
            case "dmy":
                let (d, m, y) = (groups[0], groups[1], groups[2])
                return "\(y)-\(m)-\(d)"
            case "ymd":
                let (y, m, d) = (groups[0], groups[1], groups[2])
                return "\(y)-\(m)-\(d)"
            case "dmy_mon":
                let d = String(format: "%02d", Int(groups[0]) ?? 1)
                let m = monthMap[groups[1].lowercased().prefix(3).description] ?? "01"
                let y = groups[2]
                return "\(y)-\(m)-\(d)"
            default: break
            }
        }
        return nil
    }

    static func extractGstin(from text: String) -> String? {
        let range = NSRange(text.startIndex..., in: text)
        guard let match = gstinRegex.firstMatch(in: text, range: range),
              let r = Range(match.range(at: 1), in: text) else { return nil }
        return String(text[r])
    }

    static func extractMerchantName(from text: String) -> String? {
        let lines = text.components(separatedBy: .newlines)
        return lines.first { line in
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            guard !trimmed.isEmpty else { return false }
            let digits = trimmed.filter { $0.isNumber }
            return Double(digits.count) / Double(trimmed.count) < 0.5
        }
    }

    static func extractGrandTotal(from text: String) -> Int64? {
        let range = NSRange(text.startIndex..., in: text)
        for rx in totalPatterns {
            guard let match = rx.firstMatch(in: text, range: range),
                  let r = Range(match.range(at: 1), in: text) else { continue }
            let raw = String(text[r]).replacingOccurrences(of: ",", with: "")
            if let amount = Double(raw) {
                return Int64((amount * 100).rounded())
            }
        }
        return nil
    }

    static func extractPaymentMode(from text: String) -> PaymentMode {
        let lower = text.lowercased()
        if lower.contains("cash") { return .cash }
        if lower.contains("upi") || lower.contains("gpay") || lower.contains("phonepe") { return .upi }
        if lower.contains("card") || lower.contains("credit") || lower.contains("debit") { return .card }
        if lower.contains("bnpl") || lower.contains("buy now") || lower.contains("emi") { return .bnpl }
        return .unknown
    }

    static func extractLineItems(from text: String) -> [LineItem] {
        let pattern = try! NSRegularExpression(
            pattern: #"^(.+?)\s+(\d+(?:\.\d+)?)\s+(?:₹|Rs\.?)?\s*([\d,]+\.?\d{0,2})"#,
            options: [.caseInsensitive, .anchorsMatchLines]
        )
        let range = NSRange(text.startIndex..., in: text)
        var items: [LineItem] = []
        pattern.enumerateMatches(in: text, range: range) { match, _, _ in
            guard let m = match,
                  let nameR = Range(m.range(at: 1), in: text),
                  let qtyR = Range(m.range(at: 2), in: text),
                  let priceR = Range(m.range(at: 3), in: text) else { return }
            let name = String(text[nameR]).trimmingCharacters(in: .whitespaces)
            let qty = Double(text[qtyR]) ?? 1.0
            let priceStr = String(text[priceR]).replacingOccurrences(of: ",", with: "")
            let unitPaise = Int64(((Double(priceStr) ?? 0) * 100).rounded())
            guard !name.isEmpty, unitPaise > 0 else { return }
            items.append(LineItem(name: name, quantity: qty, unitPricePaise: unitPaise))
        }
        return items
    }

    static func computeConfidence(invoice: ExtractedInvoice) -> Float {
        var hits = 0
        if invoice.merchantName != nil { hits += 1 }
        if invoice.invoiceDate != nil { hits += 1 }
        if invoice.grandTotalPaise != nil { hits += 1 }
        if invoice.paymentMode != nil && invoice.paymentMode != .unknown { hits += 1 }
        return Float(hits) / 4.0
    }

    static func parse(text: String, sourceType: PdfSourceType) -> ExtractedInvoice {
        let merchant = extractMerchantName(from: text)
        let date = extractDate(from: text)
        let gstin = extractGstin(from: text)
        let total = extractGrandTotal(from: text)
        let mode = extractPaymentMode(from: text)
        let items = extractLineItems(from: text)

        let partial = ExtractedInvoice(
            merchantName: merchant,
            merchantAddress: nil,
            merchantGstin: gstin,
            invoiceDate: date,
            lineItems: items,
            subtotalPaise: nil,
            discountPaise: 0,
            taxPaise: nil,
            grandTotalPaise: total,
            paymentMode: mode,
            sourceType: sourceType,
            rawText: text,
            confidenceScore: 0
        )
        let confidence = computeConfidence(invoice: partial)
        return ExtractedInvoice(
            merchantName: merchant,
            merchantAddress: nil,
            merchantGstin: gstin,
            invoiceDate: date,
            lineItems: items,
            subtotalPaise: nil,
            discountPaise: 0,
            taxPaise: nil,
            grandTotalPaise: total,
            paymentMode: mode,
            sourceType: sourceType,
            rawText: text,
            confidenceScore: confidence
        )
    }
}
