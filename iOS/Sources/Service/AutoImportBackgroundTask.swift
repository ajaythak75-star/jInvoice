import Foundation
import BackgroundTasks

final class AutoImportBackgroundTask {
    static let taskIdentifier = "com.jinvoice.autoimport.poll"

    static func register() {
        BGTaskScheduler.shared.register(
            forTaskWithIdentifier: taskIdentifier,
            using: nil
        ) { task in
            handle(task: task as! BGProcessingTask)
        }
    }

    static func schedule() {
        let request = BGProcessingTaskRequest(identifier: taskIdentifier)
        request.requiresNetworkConnectivity = true
        request.earliestBeginDate = Date(timeIntervalSinceNow: 60 * 60) // 1 hour

        try? BGTaskScheduler.shared.submit(request)
    }

    static func cancel() {
        BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: taskIdentifier)
    }

    private static func handle(task: BGProcessingTask) {
        let prefs = AutoImportPreferences.shared
        let pipeline = ExtractionPipeline()

        task.expirationHandler = {
            task.setTaskCompleted(success: false)
        }

        Task {
            var anyFailure = false
            if prefs.gmailEnabled {
                do {
                    let urls = try await GmailConnector().pollAndDownload()
                    for url in urls {
                        await pipeline.processDownloadedPdf(at: url, importSource: "gmail")
                    }
                } catch {
                    anyFailure = true
                }
            }
            if prefs.outlookEnabled {
                do {
                    let urls = try await OutlookConnector().pollAndDownload()
                    for url in urls {
                        await pipeline.processDownloadedPdf(at: url, importSource: "outlook")
                    }
                } catch {
                    anyFailure = true
                }
            }
            schedule()
            task.setTaskCompleted(success: !anyFailure)
        }
    }
}
