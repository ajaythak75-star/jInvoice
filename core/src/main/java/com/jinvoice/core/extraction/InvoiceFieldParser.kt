package com.jinvoice.core.extraction

import com.jinvoice.core.extraction.models.LineItem
import com.jinvoice.core.extraction.models.PaymentMode

/**
 * Pure-Kotlin heuristic parser that operates on raw text extracted from a PDF page.
 * No Android or platform imports — fully unit-testable without a device.
 */
object InvoiceFieldParser {

    private val DATE_PATTERNS = listOf(
        Regex("""(\d{2})[/\-.](\d{2})[/\-.](\d{4})"""),   // DD/MM/YYYY or DD-MM-YYYY
        Regex("""(\d{4})[/\-.](\d{2})[/\-.](\d{2})"""),   // YYYY-MM-DD
        Regex("""(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})""", RegexOption.IGNORE_CASE),
    )

    private val GSTIN_PATTERN = Regex("""[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}""")

    private val TOTAL_PATTERNS = listOf(
        Regex("""(?:grand\s*total|total\s*amount|net\s*payable|amount\s*payable)[^\d]*?([\d,]+\.?\d*)""", RegexOption.IGNORE_CASE),
        Regex("""(?:total)[^\d]*?([\d,]+\.?\d*)""", RegexOption.IGNORE_CASE),
    )

    private val PAYMENT_MODE_PATTERNS = mapOf(
        PaymentMode.UPI to Regex("""(?:upi|gpay|phonepe|paytm|bhim)""", RegexOption.IGNORE_CASE),
        PaymentMode.CARD to Regex("""(?:credit\s*card|debit\s*card|visa|mastercard|rupay)""", RegexOption.IGNORE_CASE),
        PaymentMode.CASH to Regex("""\bcash\b""", RegexOption.IGNORE_CASE),
        PaymentMode.BNPL to Regex("""(?:bnpl|buy\s*now\s*pay\s*later|simpl|lazypay|zest)""", RegexOption.IGNORE_CASE),
        PaymentMode.CREDIT to Regex("""(?:credit|store\s*credit|account)""", RegexOption.IGNORE_CASE),
    )

    private val LINE_ITEM_PATTERN = Regex(
        """^(.+?)\s{2,}(\d+(?:\.\d+)?)\s{1,}(?:nos?|pcs?|units?|kgs?|ltrs?|gms?)?\s{1,}([\d,]+\.?\d*)""",
        setOf(RegexOption.MULTILINE, RegexOption.IGNORE_CASE)
    )

    fun extractDate(text: String): String? {
        for (pattern in DATE_PATTERNS) {
            val match = pattern.find(text) ?: continue
            val groups = match.groupValues
            return when {
                // YYYY-MM-DD already
                groups[1].length == 4 -> "${groups[1]}-${groups[2]}-${groups[3]}"
                // DD/MM/YYYY → YYYY-MM-DD
                groups[3].length == 4 -> "${groups[3]}-${groups[2].padStart(2, '0')}-${groups[1].padStart(2, '0')}"
                // DD Mon YYYY → approximate ISO
                else -> parseMonthName(groups[1], groups[2], groups[3])
            }
        }
        return null
    }

    fun extractGstin(text: String): String? = GSTIN_PATTERN.find(text)?.value

    fun extractMerchantName(text: String): String? {
        // First non-empty line is typically the merchant/store header
        return text.lines()
            .map { it.trim() }
            .firstOrNull { it.length in 3..80 && it.none { ch -> ch.isDigit() } }
    }

    fun extractGrandTotalPaise(text: String): Long? {
        for (pattern in TOTAL_PATTERNS) {
            val match = pattern.find(text) ?: continue
            val raw = match.groupValues[1].replace(",", "").trim()
            val rupees = raw.toDoubleOrNull() ?: continue
            return (rupees * 100).toLong()
        }
        return null
    }

    fun extractPaymentMode(text: String): PaymentMode {
        for ((mode, pattern) in PAYMENT_MODE_PATTERNS) {
            if (pattern.containsMatchIn(text)) return mode
        }
        return PaymentMode.UNKNOWN
    }

    fun extractLineItems(text: String): List<LineItem> {
        return LINE_ITEM_PATTERN.findAll(text).map { match ->
            val name = match.groupValues[1].trim()
            val qty = match.groupValues[2].toDoubleOrNull() ?: 1.0
            val unitPrice = match.groupValues[3].replace(",", "").toDoubleOrNull() ?: 0.0
            LineItem(
                name = name,
                quantity = qty,
                unitPricePaise = (unitPrice * 100).toLong(),
            )
        }.filter { it.name.isNotBlank() && it.unitPricePaise > 0 }.toList()
    }

    /**
     * Confidence score: fraction of key fields successfully extracted.
     * Below 0.7 → mark record pending_review.
     */
    fun computeConfidence(
        merchantName: String?,
        date: String?,
        grandTotal: Long?,
        lineItems: List<LineItem>,
    ): Float {
        var hits = 0
        if (!merchantName.isNullOrBlank()) hits++
        if (!date.isNullOrBlank()) hits++
        if (grandTotal != null && grandTotal > 0) hits++
        if (lineItems.isNotEmpty()) hits++
        return hits / 4f
    }

    private fun parseMonthName(day: String, month: String, year: String): String {
        val monthMap = mapOf(
            "jan" to "01", "feb" to "02", "mar" to "03", "apr" to "04",
            "may" to "05", "jun" to "06", "jul" to "07", "aug" to "08",
            "sep" to "09", "oct" to "10", "nov" to "11", "dec" to "12",
        )
        val m = monthMap[month.lowercase().take(3)] ?: return ""
        return "$year-$m-${day.padStart(2, '0')}"
    }
}
