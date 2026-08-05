import SwiftUI

struct ConsentView: View {
    enum Provider { case gmail, outlook }
    let provider: Provider
    let onAccept: () -> Void
    let onDecline: () -> Void

    @State private var checked = [false, false, false, false]

    private var providerName: String {
        switch provider {
        case .gmail: return "Gmail"
        case .outlook: return "Outlook"
        }
    }

    private var disclosures: [String] {
        [
            "jInvoice will scan \(providerName) subject lines to find emails likely to contain invoice or receipt PDFs.",
            "Matching PDF attachments will be downloaded directly to this device. No email content or attachment is ever sent to jInvoice servers.",
            "All invoice data extraction happens entirely on this device. Nothing leaves your device.",
            "You can revoke this access at any time from jInvoice Settings. Revocation stops all background polling immediately.",
        ]
    }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 20) {
                Text("Before connecting \(providerName), please read and confirm each of the following:")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal)

                ForEach(0..<disclosures.count, id: \.self) { i in
                    HStack(alignment: .top, spacing: 12) {
                        Image(systemName: checked[i] ? "checkmark.square.fill" : "square")
                            .foregroundStyle(checked[i] ? .blue : .secondary)
                            .font(.title3)
                            .onTapGesture { checked[i].toggle() }
                        Text(disclosures[i])
                            .font(.subheadline)
                    }
                    .padding(.horizontal)
                }

                Spacer()

                Button {
                    onAccept()
                } label: {
                    Text("I understand — Connect \(providerName)")
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(checked.allSatisfy { $0 } ? Color.blue : Color.gray.opacity(0.4))
                        .foregroundStyle(.white)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                }
                .disabled(!checked.allSatisfy { $0 })
                .padding(.horizontal)

                Button("Cancel", role: .cancel) { onDecline() }
                    .frame(maxWidth: .infinity)
                    .padding(.bottom)
            }
            .padding(.top)
            .navigationTitle("Connect \(providerName)")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}
