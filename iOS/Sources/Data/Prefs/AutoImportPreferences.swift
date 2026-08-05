import Foundation

final class AutoImportPreferences {
    static let shared = AutoImportPreferences()
    private init() {}

    private enum Key {
        static let gmailEnabled = "gmail_enabled"
        static let gmailEmail = "gmail_email"
        static let gmailAccessToken = "gmail_access_token"
        static let gmailRefreshToken = "gmail_refresh_token"
        static let gmailConsentGiven = "gmail_consent_given"
        static let outlookEnabled = "outlook_enabled"
        static let outlookEmail = "outlook_email"
        static let outlookAccessToken = "outlook_access_token"
        static let outlookConsentGiven = "outlook_consent_given"
        static let downloadFolderBookmark = "download_folder_bookmark"
    }

    var gmailEnabled: Bool {
        get { UserDefaults.standard.bool(forKey: Key.gmailEnabled) }
        set { UserDefaults.standard.set(newValue, forKey: Key.gmailEnabled) }
    }

    var gmailEmail: String? {
        get { KeychainHelper.load(forKey: Key.gmailEmail) }
        set { newValue == nil ? KeychainHelper.delete(forKey: Key.gmailEmail) : KeychainHelper.save(newValue!, forKey: Key.gmailEmail) }
    }

    var gmailAccessToken: String? {
        get { KeychainHelper.load(forKey: Key.gmailAccessToken) }
        set { newValue == nil ? KeychainHelper.delete(forKey: Key.gmailAccessToken) : KeychainHelper.save(newValue!, forKey: Key.gmailAccessToken) }
    }

    var gmailRefreshToken: String? {
        get { KeychainHelper.load(forKey: Key.gmailRefreshToken) }
        set { newValue == nil ? KeychainHelper.delete(forKey: Key.gmailRefreshToken) : KeychainHelper.save(newValue!, forKey: Key.gmailRefreshToken) }
    }

    var gmailConsentGiven: Bool {
        get { UserDefaults.standard.bool(forKey: Key.gmailConsentGiven) }
        set { UserDefaults.standard.set(newValue, forKey: Key.gmailConsentGiven) }
    }

    var outlookEnabled: Bool {
        get { UserDefaults.standard.bool(forKey: Key.outlookEnabled) }
        set { UserDefaults.standard.set(newValue, forKey: Key.outlookEnabled) }
    }

    var outlookEmail: String? {
        get { KeychainHelper.load(forKey: Key.outlookEmail) }
        set { newValue == nil ? KeychainHelper.delete(forKey: Key.outlookEmail) : KeychainHelper.save(newValue!, forKey: Key.outlookEmail) }
    }

    var outlookAccessToken: String? {
        get { KeychainHelper.load(forKey: Key.outlookAccessToken) }
        set { newValue == nil ? KeychainHelper.delete(forKey: Key.outlookAccessToken) : KeychainHelper.save(newValue!, forKey: Key.outlookAccessToken) }
    }

    var outlookConsentGiven: Bool {
        get { UserDefaults.standard.bool(forKey: Key.outlookConsentGiven) }
        set { UserDefaults.standard.set(newValue, forKey: Key.outlookConsentGiven) }
    }

    // Persistent security-scoped bookmark for user-chosen download folder (iOS Files app)
    var downloadFolderBookmark: Data? {
        get { UserDefaults.standard.data(forKey: Key.downloadFolderBookmark) }
        set { UserDefaults.standard.set(newValue, forKey: Key.downloadFolderBookmark) }
    }

    func revokeGmail() {
        gmailEnabled = false
        gmailConsentGiven = false
        gmailEmail = nil
        gmailAccessToken = nil
        gmailRefreshToken = nil
    }

    func revokeOutlook() {
        outlookEnabled = false
        outlookConsentGiven = false
        outlookEmail = nil
        outlookAccessToken = nil
    }
}
