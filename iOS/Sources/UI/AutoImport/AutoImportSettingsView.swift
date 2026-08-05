import SwiftUI
import GoogleSignIn

struct AutoImportSettingsView: View {
    @StateObject private var viewModel = AutoImportViewModel()
    @State private var showingGmailConsent = false
    @State private var showingOutlookConsent = false
    @State private var showingFolderPicker = false

    var body: some View {
        List {
            Section {
                infoCard
            }
            Section("Email Connectors") {
                connectorCard(
                    logo: "envelope.badge",
                    name: "Gmail",
                    state: viewModel.gmail,
                    onToggle: { viewModel.onGmailToggled(enabled: $0) },
                    onRevoke: { viewModel.revokeGmail() }
                )
                connectorCard(
                    logo: "envelope",
                    name: "Outlook",
                    state: viewModel.outlook,
                    onToggle: { viewModel.onOutlookToggled(enabled: $0) },
                    onRevoke: { viewModel.revokeOutlook() }
                )
            }
            Section("Download Folder") {
                folderRow
            }
        }
        .navigationTitle("Auto-Import")
        .sheet(isPresented: $showingGmailConsent) {
            ConsentView(provider: .gmail) {
                showingGmailConsent = false
                viewModel.onGmailConsentAccepted()
            } onDecline: {
                showingGmailConsent = false
            }
        }
        .sheet(isPresented: $showingOutlookConsent) {
            ConsentView(provider: .outlook) {
                showingOutlookConsent = false
                viewModel.onOutlookConsentAccepted()
            } onDecline: {
                showingOutlookConsent = false
            }
        }
        .onChange(of: viewModel.pendingEvent) { _, event in
            guard let event else { return }
            viewModel.pendingEvent = nil
            handleEvent(event)
        }
    }

    @ViewBuilder
    private var infoCard: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label("Off by default", systemImage: "lock.shield")
                .font(.subheadline.bold())
            Text("Auto-Import scans your inbox for PDF invoices. All processing is on-device. Nothing is ever sent to jInvoice servers.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
    }

    @ViewBuilder
    private func connectorCard(
        logo: String,
        name: String,
        state: AutoImportViewModel.ConnectorState,
        onToggle: @escaping (Bool) -> Void,
        onRevoke: @escaping () -> Void
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: logo)
                    .foregroundStyle(.blue)
                Text(name)
                    .font(.headline)
                Spacer()
                Toggle("", isOn: Binding(
                    get: { state.enabled },
                    set: { onToggle($0) }
                ))
                .labelsHidden()
            }
            if let email = state.email {
                Text(email)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Button("Revoke access", role: .destructive) { onRevoke() }
                    .font(.caption)
            } else {
                Text("Not connected")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
    }

    @ViewBuilder
    private var folderRow: some View {
        HStack {
            Image(systemName: "folder")
                .foregroundStyle(.orange)
            VStack(alignment: .leading) {
                Text("Download folder")
                    .font(.subheadline)
                Text("jInvoice/ in Files app")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Button("Change") {
                showingFolderPicker = true
            }
            .font(.subheadline)
        }
        .fileImporter(
            isPresented: $showingFolderPicker,
            allowedContentTypes: [.folder]
        ) { result in
            if case .success(let url) = result {
                PdfDownloadManager().setPersistentFolder(url: url)
            }
        }
    }

    private func handleEvent(_ event: AutoImportViewModel.UiEvent) {
        switch event {
        case .showGmailConsent:
            showingGmailConsent = true
        case .showOutlookConsent:
            showingOutlookConsent = true
        case .startGmailSignIn:
            signInGmail()
        case .startOutlookSignIn:
            signInOutlook()
        case .error:
            break
        }
    }

    private func signInGmail() {
        guard let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
              let root = scene.windows.first?.rootViewController else { return }
        GIDSignIn.sharedInstance.signIn(
            withPresenting: root,
            additionalScopes: ["https://www.googleapis.com/auth/gmail.readonly"]
        ) { result, error in
            guard let result, error == nil else { return }
            let email = result.user.profile?.email ?? ""
            let accessToken = result.user.accessToken.tokenString
            let refreshToken = result.user.refreshToken.tokenString
            viewModel.onGmailSignedIn(email: email, accessToken: accessToken, refreshToken: refreshToken)
        }
    }

    private func signInOutlook() {
        // MSAL sign-in triggered from here; full implementation in OutlookConnector
    }
}
