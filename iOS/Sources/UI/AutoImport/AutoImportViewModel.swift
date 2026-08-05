import Foundation
import SwiftUI
import GoogleSignIn

@MainActor
final class AutoImportViewModel: ObservableObject {
    enum UiEvent {
        case showGmailConsent
        case showOutlookConsent
        case startGmailSignIn
        case startOutlookSignIn
        case error(String)
    }

    struct ConnectorState {
        var enabled: Bool
        var email: String?
        var isAuthenticated: Bool
        var hasConsent: Bool
    }

    @Published var gmail = ConnectorState(enabled: false, email: nil, isAuthenticated: false, hasConsent: false)
    @Published var outlook = ConnectorState(enabled: false, email: nil, isAuthenticated: false, hasConsent: false)
    @Published var pendingEvent: UiEvent?

    private let prefs = AutoImportPreferences.shared

    init() { load() }

    func load() {
        gmail = ConnectorState(
            enabled: prefs.gmailEnabled,
            email: prefs.gmailEmail,
            isAuthenticated: prefs.gmailAccessToken != nil,
            hasConsent: prefs.gmailConsentGiven
        )
        outlook = ConnectorState(
            enabled: prefs.outlookEnabled,
            email: prefs.outlookEmail,
            isAuthenticated: prefs.outlookAccessToken != nil,
            hasConsent: prefs.outlookConsentGiven
        )
    }

    func onGmailToggled(enabled: Bool) {
        if enabled {
            if !prefs.gmailConsentGiven {
                pendingEvent = .showGmailConsent
            } else if prefs.gmailAccessToken == nil {
                pendingEvent = .startGmailSignIn
            } else {
                prefs.gmailEnabled = true
                AutoImportBackgroundTask.schedule()
                load()
            }
        } else {
            prefs.gmailEnabled = false
            if !prefs.outlookEnabled { AutoImportBackgroundTask.cancel() }
            load()
        }
    }

    func onOutlookToggled(enabled: Bool) {
        if enabled {
            if !prefs.outlookConsentGiven {
                pendingEvent = .showOutlookConsent
            } else if prefs.outlookAccessToken == nil {
                pendingEvent = .startOutlookSignIn
            } else {
                prefs.outlookEnabled = true
                AutoImportBackgroundTask.schedule()
                load()
            }
        } else {
            prefs.outlookEnabled = false
            if !prefs.gmailEnabled { AutoImportBackgroundTask.cancel() }
            load()
        }
    }

    func onGmailConsentAccepted() {
        prefs.gmailConsentGiven = true
        pendingEvent = .startGmailSignIn
    }

    func onOutlookConsentAccepted() {
        prefs.outlookConsentGiven = true
        pendingEvent = .startOutlookSignIn
    }

    func onGmailSignedIn(email: String, accessToken: String, refreshToken: String?) {
        prefs.gmailEmail = email
        prefs.gmailAccessToken = accessToken
        prefs.gmailRefreshToken = refreshToken
        prefs.gmailEnabled = true
        AutoImportBackgroundTask.schedule()
        load()
    }

    func onOutlookSignedIn(email: String, accessToken: String) {
        prefs.outlookEmail = email
        prefs.outlookAccessToken = accessToken
        prefs.outlookEnabled = true
        AutoImportBackgroundTask.schedule()
        load()
    }

    func revokeGmail() {
        GIDSignIn.sharedInstance.signOut()
        prefs.revokeGmail()
        if !prefs.outlookEnabled { AutoImportBackgroundTask.cancel() }
        load()
    }

    func revokeOutlook() {
        prefs.revokeOutlook()
        if !prefs.gmailEnabled { AutoImportBackgroundTask.cancel() }
        load()
    }
}
