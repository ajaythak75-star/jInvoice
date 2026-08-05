package com.jinvoice.core.extraction.models

/**
 * A single line item from an invoice.
 * All monetary values in paise (integer minor units) — no floats.
 */
data class LineItem(
    val name: String,
    val quantity: Double,
    val unitPricePaise: Long,
    val totalPricePaise: Long = (quantity * unitPricePaise).toLong(),
    val discountPaise: Long = 0L,
)
