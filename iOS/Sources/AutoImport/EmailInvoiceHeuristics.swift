import Foundation

enum EmailInvoiceHeuristics {
    private static let subjectKeywords: [String] = [
        "invoice", "receipt", "bill", "order confirmation", "payment confirmation",
        "purchase", "transaction", "e-invoice", "tax invoice",
        "बिल", "रसीद", "चालान", "बीजक",
    ]

    private static let senderDomains: [String] = [
        "amazon.in", "flipkart.com", "myntra.com", "ajio.com",
        "swiggy.in", "zomato.com", "blinkit.com", "zepto.co",
        "irctc.co.in", "makemytrip.com", "goibibo.com",
        "airtel.in", "jio.com", "vodafone.in",
        "paytm.com", "phonepe.com", "razorpay.com",
        "bigbasket.com", "dunzo.in", "nykaa.com",
    ]

    static func isInvoiceCandidate(subject: String, senderEmail: String) -> Bool {
        let lowerSubject = subject.lowercased()
        let lowerSender = senderEmail.lowercased()

        let subjectMatch = subjectKeywords.contains { lowerSubject.contains($0) }
        let senderMatch = senderDomains.contains { lowerSender.contains($0) }
        return subjectMatch || senderMatch
    }
}
