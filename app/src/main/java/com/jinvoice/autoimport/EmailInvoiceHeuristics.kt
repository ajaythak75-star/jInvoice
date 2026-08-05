package com.jinvoice.autoimport

/**
 * Heuristics to decide whether an email is likely to contain an invoice PDF.
 * Applied before downloading any attachment — keeps the signal-to-noise ratio high
 * and avoids downloading irrelevant PDFs.
 */
object EmailInvoiceHeuristics {

    private val SUBJECT_KEYWORDS = setOf(
        "invoice", "receipt", "bill", "order confirmation", "purchase",
        "payment confirmation", "tax invoice", "gst invoice", "e-invoice",
        "your order", "order placed", "order details", "transaction",
        "बिल", "रसीद", "चालान",          // Hindi
        "बीजक",                            // Hindi (invoice)
    )

    private val SENDER_DOMAINS = setOf(
        // E-commerce
        "amazon.in", "flipkart.com", "myntra.com", "meesho.com", "nykaa.com",
        "ajio.com", "snapdeal.com", "tatacliq.com",
        // Food / delivery
        "swiggy.in", "zomato.com", "bigbasket.com", "blinkit.com",
        // Travel
        "irctc.co.in", "makemytrip.com", "goibibo.com", "airindia.in",
        "indigo.in", "spicejet.com",
        // Utilities / telecom
        "airtel.in", "jio.com", "vodafoneidea.com", "bsnl.co.in",
        // Fintech / payments
        "paytm.com", "phonepe.com", "razorpay.com",
        // General
        "noreply", "no-reply", "invoice", "billing", "receipts",
    )

    /**
     * Returns true if the email subject suggests it contains an invoice or receipt.
     * Case-insensitive substring match against known keywords.
     */
    fun isInvoiceSubject(subject: String?): Boolean {
        if (subject.isNullOrBlank()) return false
        val lower = subject.lowercase()
        return SUBJECT_KEYWORDS.any { lower.contains(it) }
    }

    /**
     * Returns true if the sender domain or address matches a known merchant pattern.
     * Accepts all senders whose domain contains any keyword — keeps recall high.
     */
    fun isKnownMerchantSender(senderEmail: String?): Boolean {
        if (senderEmail.isNullOrBlank()) return false
        val lower = senderEmail.lowercase()
        return SENDER_DOMAINS.any { lower.contains(it) }
    }

    /**
     * Combined signal: email is a candidate if it matches subject OR sender.
     * We err on the side of recall — the extraction pipeline will handle quality.
     */
    fun isInvoiceCandidate(subject: String?, senderEmail: String?): Boolean =
        isInvoiceSubject(subject) || isKnownMerchantSender(senderEmail)

    /** Returns true if the attachment filename looks like a PDF invoice. */
    fun isPdfAttachment(fileName: String?): Boolean {
        if (fileName.isNullOrBlank()) return false
        val lower = fileName.lowercase().trim()
        return lower.endsWith(".pdf")
    }
}
