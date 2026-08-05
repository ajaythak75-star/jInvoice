package com.jinvoice.data.prefs

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Stores OAuth tokens and Auto-Import consent/enabled state.
 * Backed by EncryptedSharedPreferences — tokens encrypted via Android Keystore.
 * Never stores tokens in plaintext SharedPreferences or on disk unencrypted.
 */
class AutoImportPreferences(context: Context) {

    private val masterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()

    private val prefs = EncryptedSharedPreferences.create(
        context,
        "auto_import_prefs",
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    // --- Consent ---

    var gmailConsentGiven: Boolean
        get() = prefs.getBoolean(KEY_GMAIL_CONSENT, false)
        set(value) = prefs.edit().putBoolean(KEY_GMAIL_CONSENT, value).apply()

    var outlookConsentGiven: Boolean
        get() = prefs.getBoolean(KEY_OUTLOOK_CONSENT, false)
        set(value) = prefs.edit().putBoolean(KEY_OUTLOOK_CONSENT, value).apply()

    // --- Enabled flags (opt-in only; off by default) ---

    var gmailEnabled: Boolean
        get() = prefs.getBoolean(KEY_GMAIL_ENABLED, false)
        set(value) = prefs.edit().putBoolean(KEY_GMAIL_ENABLED, value).apply()

    var outlookEnabled: Boolean
        get() = prefs.getBoolean(KEY_OUTLOOK_ENABLED, false)
        set(value) = prefs.edit().putBoolean(KEY_OUTLOOK_ENABLED, value).apply()

    // --- OAuth tokens (encrypted at rest via Android Keystore) ---

    var gmailAccountEmail: String?
        get() = prefs.getString(KEY_GMAIL_EMAIL, null)
        set(value) = prefs.edit().putString(KEY_GMAIL_EMAIL, value).apply()

    /** Stores the OAuth refresh token; access tokens are obtained at runtime. */
    var gmailRefreshToken: String?
        get() = prefs.getString(KEY_GMAIL_REFRESH_TOKEN, null)
        set(value) = prefs.edit().putString(KEY_GMAIL_REFRESH_TOKEN, value).apply()

    var outlookAccountEmail: String?
        get() = prefs.getString(KEY_OUTLOOK_EMAIL, null)
        set(value) = prefs.edit().putString(KEY_OUTLOOK_EMAIL, value).apply()

    // MSAL manages its own token cache internally; we only store the logged-in account UPN here
    var outlookAccountId: String?
        get() = prefs.getString(KEY_OUTLOOK_ACCOUNT_ID, null)
        set(value) = prefs.edit().putString(KEY_OUTLOOK_ACCOUNT_ID, value).apply()

    // --- Revocation ---

    fun revokeGmail() {
        prefs.edit()
            .remove(KEY_GMAIL_EMAIL)
            .remove(KEY_GMAIL_REFRESH_TOKEN)
            .putBoolean(KEY_GMAIL_ENABLED, false)
            .putBoolean(KEY_GMAIL_CONSENT, false)
            .apply()
    }

    fun revokeOutlook() {
        prefs.edit()
            .remove(KEY_OUTLOOK_EMAIL)
            .remove(KEY_OUTLOOK_ACCOUNT_ID)
            .putBoolean(KEY_OUTLOOK_ENABLED, false)
            .putBoolean(KEY_OUTLOOK_CONSENT, false)
            .apply()
    }

    companion object {
        private const val KEY_GMAIL_CONSENT = "gmail_consent"
        private const val KEY_OUTLOOK_CONSENT = "outlook_consent"
        private const val KEY_GMAIL_ENABLED = "gmail_enabled"
        private const val KEY_OUTLOOK_ENABLED = "outlook_enabled"
        private const val KEY_GMAIL_EMAIL = "gmail_email"
        private const val KEY_GMAIL_REFRESH_TOKEN = "gmail_refresh_token"
        private const val KEY_OUTLOOK_EMAIL = "outlook_email"
        private const val KEY_OUTLOOK_ACCOUNT_ID = "outlook_account_id"
    }
}
