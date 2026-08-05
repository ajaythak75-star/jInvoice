import Foundation

final class PdfDownloadManager {
    private let prefs = AutoImportPreferences.shared

    var downloadDirectory: URL {
        if let bookmark = prefs.downloadFolderBookmark {
            var isStale = false
            if let url = try? URL(resolvingBookmarkData: bookmark, bookmarkDataIsStale: &isStale), !isStale {
                return url
            }
        }
        // Default: jInvoice folder in the shared Documents container
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        let dir = docs.appendingPathComponent("jInvoice", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    func save(data: Data, filename: String) async throws -> URL? {
        let safe = sanitize(filename)
        var dest = downloadDirectory.appendingPathComponent(safe)
        if FileManager.default.fileExists(atPath: dest.path) {
            let base = (safe as NSString).deletingPathExtension
            let ext = (safe as NSString).pathExtension
            let stamp = Int(Date().timeIntervalSince1970)
            dest = downloadDirectory.appendingPathComponent("\(base)_\(stamp).\(ext)")
        }
        try data.write(to: dest, options: .atomic)
        return dest
    }

    func setPersistentFolder(url: URL) {
        url.startAccessingSecurityScopedResource()
        defer { url.stopAccessingSecurityScopedResource() }
        let bookmark = try? url.bookmarkData(options: .minimalBookmark, includingResourceValuesForKeys: nil, relativeTo: nil)
        prefs.downloadFolderBookmark = bookmark
    }

    private func sanitize(_ name: String) -> String {
        var result = name.components(separatedBy: CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "._-")).inverted).joined(separator: "_")
        if result.count > 200 { result = String(result.prefix(200)) }
        return result.isEmpty ? "invoice.pdf" : result
    }
}
