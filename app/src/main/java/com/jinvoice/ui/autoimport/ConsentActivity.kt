package com.jinvoice.ui.autoimport

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.view.View
import androidx.appcompat.app.AppCompatActivity
import com.jinvoice.R
import com.jinvoice.databinding.ActivityConsentBinding
import com.jinvoice.data.prefs.AutoImportPreferences

/**
 * Mandatory, standalone consent screen before any OAuth flow begins.
 * Per DPDP / GDPR requirements this cannot be bundled into Terms of Service.
 *
 * Start with [EXTRA_CONNECTOR_TYPE] = "gmail" | "outlook".
 * Returns RESULT_OK only if the user explicitly accepts all disclosures.
 */
class ConsentActivity : AppCompatActivity() {

    private lateinit var binding: ActivityConsentBinding
    private lateinit var prefs: AutoImportPreferences
    private var connectorType: String = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityConsentBinding.inflate(layoutInflater)
        setContentView(binding.root)

        connectorType = intent.getStringExtra(EXTRA_CONNECTOR_TYPE) ?: run {
            setResult(Activity.RESULT_CANCELED)
            finish()
            return
        }

        prefs = AutoImportPreferences(this)

        renderConsentText()
        setupButtons()
    }

    private fun renderConsentText() {
        val providerName = if (connectorType == "gmail") "Gmail" else "Outlook"
        binding.tvConsentTitle.text = getString(R.string.consent_title, providerName)

        binding.tvConsentBody.text = getString(
            R.string.consent_body,
            providerName,
        )
    }

    private fun setupButtons() {
        // Accept is enabled only when all four disclosure checkboxes are ticked
        val checkboxes = listOf(
            binding.cbDisclosure1,
            binding.cbDisclosure2,
            binding.cbDisclosure3,
            binding.cbDisclosure4,
        )
        val updateAcceptButton = {
            binding.btnAccept.isEnabled = checkboxes.all { it.isChecked }
        }
        checkboxes.forEach { cb -> cb.setOnCheckedChangeListener { _, _ -> updateAcceptButton() } }

        binding.btnAccept.setOnClickListener {
            when (connectorType) {
                "gmail" -> prefs.gmailConsentGiven = true
                "outlook" -> prefs.outlookConsentGiven = true
            }
            setResult(Activity.RESULT_OK)
            finish()
        }

        binding.btnDecline.setOnClickListener {
            setResult(Activity.RESULT_CANCELED)
            finish()
        }
    }

    companion object {
        const val EXTRA_CONNECTOR_TYPE = "connector_type"

        fun intentForGmail(activity: Activity) =
            Intent(activity, ConsentActivity::class.java)
                .putExtra(EXTRA_CONNECTOR_TYPE, "gmail")

        fun intentForOutlook(activity: Activity) =
            Intent(activity, ConsentActivity::class.java)
                .putExtra(EXTRA_CONNECTOR_TYPE, "outlook")
    }
}
