import SwiftUI

struct MainTabView: View {
    var body: some View {
        TabView {
            NavigationStack {
                Text("Invoices")  // placeholder — Invoice list screen comes next
                    .navigationTitle("Invoices")
            }
            .tabItem { Label("Invoices", systemImage: "doc.text") }

            NavigationStack {
                Text("Search")   // placeholder — FTS5 search screen
                    .navigationTitle("Search")
            }
            .tabItem { Label("Search", systemImage: "magnifyingglass") }

            NavigationStack {
                AutoImportSettingsView()
            }
            .tabItem { Label("Import", systemImage: "envelope.badge") }

            NavigationStack {
                Text("Settings")
                    .navigationTitle("Settings")
            }
            .tabItem { Label("Settings", systemImage: "gearshape") }
        }
    }
}
