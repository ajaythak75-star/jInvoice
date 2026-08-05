package com.jinvoice

import android.app.Application
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader

class JInvoiceApp : Application() {

    override fun onCreate() {
        super.onCreate()
        // pdfbox-android requires this initialisation before any PDF operations
        PDFBoxResourceLoader.init(applicationContext)
    }
}
