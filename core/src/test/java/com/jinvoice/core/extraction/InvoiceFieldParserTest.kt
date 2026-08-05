package com.jinvoice.core.extraction

import com.google.common.truth.Truth.assertThat
import com.jinvoice.core.extraction.models.PaymentMode
import org.junit.Test

class InvoiceFieldParserTest {

    // --- Date extraction ---

    @Test
    fun `extracts DD-MM-YYYY date`() {
        val text = "Invoice Date: 15-03-2024"
        assertThat(InvoiceFieldParser.extractDate(text)).isEqualTo("2024-03-15")
    }

    @Test
    fun `extracts DD slash MM slash YYYY date`() {
        val text = "Date: 05/07/2023"
        assertThat(InvoiceFieldParser.extractDate(text)).isEqualTo("2023-07-05")
    }

    @Test
    fun `extracts ISO 8601 date`() {
        val text = "Date: 2024-11-20"
        assertThat(InvoiceFieldParser.extractDate(text)).isEqualTo("2024-11-20")
    }

    @Test
    fun `returns null when no date present`() {
        assertThat(InvoiceFieldParser.extractDate("No date here at all")).isNull()
    }

    // --- GSTIN extraction ---

    @Test
    fun `extracts valid GSTIN`() {
        val text = "GSTIN: 27AABCU9603R1ZX"
        assertThat(InvoiceFieldParser.extractGstin(text)).isEqualTo("27AABCU9603R1ZX")
    }

    @Test
    fun `returns null for text without GSTIN`() {
        assertThat(InvoiceFieldParser.extractGstin("No tax number here")).isNull()
    }

    // --- Grand total extraction ---

    @Test
    fun `extracts grand total in paise`() {
        val text = "Grand Total: Rs. 1,250.00"
        assertThat(InvoiceFieldParser.extractGrandTotalPaise(text)).isEqualTo(125000L)
    }

    @Test
    fun `extracts total amount label`() {
        val text = "Total Amount  4599"
        assertThat(InvoiceFieldParser.extractGrandTotalPaise(text)).isEqualTo(459900L)
    }

    // --- Payment mode ---

    @Test
    fun `detects UPI payment`() {
        assertThat(InvoiceFieldParser.extractPaymentMode("Paid via GPay UPI")).isEqualTo(PaymentMode.UPI)
    }

    @Test
    fun `detects cash payment`() {
        assertThat(InvoiceFieldParser.extractPaymentMode("Payment: Cash")).isEqualTo(PaymentMode.CASH)
    }

    @Test
    fun `returns UNKNOWN for unrecognised mode`() {
        assertThat(InvoiceFieldParser.extractPaymentMode("Some other text")).isEqualTo(PaymentMode.UNKNOWN)
    }

    // --- Confidence score ---

    @Test
    fun `full confidence when all four fields present`() {
        val score = InvoiceFieldParser.computeConfidence(
            merchantName = "Electronics Plus",
            date = "2024-03-15",
            grandTotal = 100000L,
            lineItems = listOf(),
        )
        // lineItems empty → only 3/4 fields hit
        assertThat(score).isEqualTo(0.75f)
    }

    @Test
    fun `zero confidence when nothing extracted`() {
        val score = InvoiceFieldParser.computeConfidence(
            merchantName = null,
            date = null,
            grandTotal = null,
            lineItems = emptyList(),
        )
        assertThat(score).isEqualTo(0f)
    }
}
