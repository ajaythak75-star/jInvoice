import Foundation
import GoogleSignIn

final class GmailConnector {
    private let prefs = AutoImportPreferences.shared
    private let importDAO = InvoiceDAO()
    private let downloadManager = PdfDownloadManager()

    func pollAndDownload() async throws -> [URL] {
        guard let accessToken = prefs.gmailAccessToken else {
            throw ConnectorError.notAuthenticated
        }

        var downloaded: [URL] = []
        let messages = try await fetchMatchingMessages(accessToken: accessToken)

        for message in messages {
            let messageId = message["id"] as? String ?? ""
            guard !messageId.isEmpty,
                  !(try importDAO.isAlreadyImported(messageId: "\(messageId):gmail")) else { continue }

            let parts = try await fetchMessageParts(messageId: messageId, accessToken: accessToken)
            for part in parts {
                guard let filename = part["filename"] as? String,
                      filename.lowercased().hasSuffix(".pdf"),
                      let attachmentId = (part["body"] as? [String: Any])?["attachmentId"] as? String else { continue }

                let data = try await downloadAttachment(
                    messageId: messageId, attachmentId: attachmentId, accessToken: accessToken
                )
                if let url = try await downloadManager.save(data: data, filename: filename) {
                    downloaded.append(url)
                    try importDAO.recordImport(ImportRecord(
                        id: nil,
                        messageId: "\(messageId):gmail",
                        source: "gmail",
                        status: "imported",
                        importedAt: ISO8601DateFormatter().string(from: Date())
                    ))
                }
            }
        }
        return downloaded
    }

    private func fetchMatchingMessages(accessToken: String) async throws -> [[String: Any]] {
        let query = "has:attachment filename:pdf (invoice OR receipt OR bill) in:inbox"
        let encoded = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        let url = URL(string: "https://gmail.googleapis.com/gmail/v1/users/me/messages?q=\(encoded)&maxResults=50")!
        var request = URLRequest(url: url)
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")

        let (data, _) = try await URLSession.shared.data(for: request)
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
        return json["messages"] as? [[String: Any]] ?? []
    }

    private func fetchMessageParts(messageId: String, accessToken: String) async throws -> [[String: Any]] {
        let url = URL(string: "https://gmail.googleapis.com/gmail/v1/users/me/messages/\(messageId)?format=full")!
        var request = URLRequest(url: url)
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")

        let (data, _) = try await URLSession.shared.data(for: request)
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
        let payload = json["payload"] as? [String: Any] ?? [:]
        return payload["parts"] as? [[String: Any]] ?? []
    }

    private func downloadAttachment(messageId: String, attachmentId: String, accessToken: String) async throws -> Data {
        let url = URL(string: "https://gmail.googleapis.com/gmail/v1/users/me/messages/\(messageId)/attachments/\(attachmentId)")!
        var request = URLRequest(url: url)
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")

        let (data, _) = try await URLSession.shared.data(for: request)
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
        guard let b64 = json["data"] as? String else { throw ConnectorError.attachmentDecodeError }
        let fixed = b64.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        guard let decoded = Data(base64Encoded: fixed, options: .ignoreUnknownCharacters) else {
            throw ConnectorError.attachmentDecodeError
        }
        return decoded
    }
}

enum ConnectorError: Error {
    case notAuthenticated
    case attachmentDecodeError
    case networkError(Error)
}
