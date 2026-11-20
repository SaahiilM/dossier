import SwiftUI

struct AboutView: View {
    var serverAddress: String?

    @Environment(\.dismiss) private var dismiss
    @State private var serverBuild: ServerBuildInfo?
    @State private var isLoading = true

    var body: some View {
        NavigationStack {
            Form {
                Section("This app") {
                    LabeledContent("iOS version", value: bundleValue("CFBundleShortVersionString"))
                    LabeledContent("Build number", value: bundleValue("CFBundleVersion"))
                    LabeledContent("Upstream baseline", value: bundleValue("DossierUpstreamVersion"))
                    LabeledContent("Fork version", value: appForkVersion)
                }
                if serverAddress != nil {
                    Section("Connected server") {
                        if let serverBuild {
                            LabeledContent("Upstream version", value: serverBuild.version)
                            LabeledContent("Fork version", value: serverBuild.forkIdentity ?? "Unavailable")
                        } else if isLoading {
                            ProgressView("Checking server version…")
                        } else {
                            Text("Server version unavailable").foregroundStyle(.secondary)
                        }
                    }
                }
            }
            .textSelection(.enabled)
            .navigationTitle("About Dossier")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .task(id: serverAddress) {
            guard let serverAddress else { return }
            isLoading = true
            serverBuild = nil
            let build = try? await MobileAPIClient(serverAddress: serverAddress).serverBuildInfo()
            guard !Task.isCancelled else { return }
            serverBuild = build
            isLoading = false
        }
    }

    private func bundleValue(_ key: String) -> String {
        Bundle.main.object(forInfoDictionaryKey: key) as? String ?? "Unavailable"
    }

    private var appForkVersion: String {
        let revision = bundleValue("DossierForkRevision")
        guard revision.count >= 40 else { return revision }
        let dirty = revision.hasSuffix(".dirty") ? ".dirty" : ""
        return "\(bundleValue("DossierUpstreamVersion"))+fork.\(revision.prefix(12))\(dirty)"
    }
}
