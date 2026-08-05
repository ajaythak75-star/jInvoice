import SwiftUI
import GoogleSignIn

@main
struct jInvoiceApp: App {
    init() {
        AutoImportBackgroundTask.register()
    }

    var body: some Scene {
        WindowGroup {
            MainTabView()
                .onOpenURL { url in
                    GIDSignIn.sharedInstance.handle(url)
                }
        }
    }
}
