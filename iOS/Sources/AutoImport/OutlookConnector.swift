import Foundation
import MSAL

final class OutlookConnector {
    private let prefs = AutoImportPreferences.shared
    private let importDAO = InvoiceDAO()
    private let downloadManager = PdfDownloadManager()

    private static let scopes = ["Mail.Read"]
    private static let clientId = "YOUR_AZURE_CLIENT_ID"  // fill from Azure portal

    func pollAndDownload() async throws -> [URL] {
        let accessToken = try await acquireToken()
        prefs.outlookAccessToken = accessToken

        var downloaded: [URL] = []
        let messages = try await fetchMatchingMessages(token: accessToken)

        for message in messages {
            guard let messageId = message["id"] as? String,
                  !(try importDAO.isAlreadyImported(messageId: "\(messageId):outlook")) else { continue }

            let attachments = try await fetchAttachments(messageId: messageId, token: accessToken)
            for attachment in attachments {
                guard let name = attachment["name"] as? String,
                      name.lowercased().hasSuffix(".pdf"),
                      let contentBytes = attachment["contentBytes"] as? String else { continue }

                guard let data = Data(base64Encoded: contentBytes, options: .ignoreUnknownCharacters) else { continue }
                if let url = try await downloadManager.save(data: data, filename: name) {
                    downloaded.append(url)
                    try importDAO.recordImport(ImportRecord(
                        id: nil,
                        messageId: "\(messageId):outlook",
                        source: "outlook",
                        status: "imported",
                        importedAt: ISO8601DateFormatter().string(from: Date())
                    ))
                }
            }
        }
        return downloaded
    }

    private func acquireToken() async throws -> String {
        let authority = try MSALAADAuthority(url: URL(string: "https://login.microsoftonline.com/common")!)
        let config = MSALPublicClientApplicationConfig(
            clientId: Self.clientId,
            redirectUri: "msauth.com.jinvoice://auth",
            authority: authority
        )
        let client = try MSALPublicClientApplication(configuration: config)

        let params = MSALSilentTokenParameters(scopes: Self.scopes, account: try client.allAccounts().first!)
        return try await withCheckedThrowingContinuation { cont in
            client.acquireTokenSilent(with: params) { result, error in
                if let error { cont.resume(throwing: error); return }
                cont.resume(returning: result?.accessToken ?? "")
            }
        }
    }

    private func fetchMatchingMessages(token: String) async throws -> [[String: Any]] {
        let filter = "hasAttachments eq true"
        let search = "\"invoice\" OR \"receipt\" OR \"bill\""
        let encoded = filter.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        let searchEncoded = search.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        let urlStr = "https://graph.microsoft.com/v1.0/me/messages?$filter=\(encoded)&$search=\(searchEncoded)&$select=id,subject,sender,hasAttachments&$top=50"
        var request = URLRequest(url: URL(string: urlStr)!)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let (data, _) = try await URLSession.shared.data(for: request)
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
        return json["value"] as? [[String: Any]] ?? []
    }

    private func fetchAttachments(messageId: String, token: String) async throws -> [[String: Any]] {
        let url = URL(string: "https://graph.microsoft.com/v1.0/me/messages/\(messageId)/attachments?$select=id,name,contentType,contentBytes")!
        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let (data, _) = try await URLSession.shared.data(for: request)
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
        let all = json["value"] as? [[String: Any]] ?? []
        return all.filter { ($0["contentType"] as? String)?.contains("pdf") == true }
    }
}
