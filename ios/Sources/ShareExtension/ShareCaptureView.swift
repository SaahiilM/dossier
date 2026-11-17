import SwiftUI
import UniformTypeIdentifiers

private struct SharedPayload {
    var url: String
    var text: String?
}

struct ShareCaptureView: View {
    let context: NSExtensionContext?
    let onFinish: () -> Void

    @State private var isLoading = true
    @State private var isSaving = false
    @State private var url = ""
    @State private var text = ""
    @State private var note = ""
    @State private var statusMessage: String?
    @State private var didSave = false
    @State private var deliveryState: CaptureDeliveryState?
    @State private var errorMessage: String?

    @State private var outbox = CaptureOutboxStore()
    @State private var tokenStore = SessionTokenStore()

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    VStack(alignment: .leading, spacing: 7) {
                        Text("Save to Dossier")
                            .font(.system(.title, design: .serif).weight(.semibold))
                            .foregroundStyle(DossierPalette.ink)
                            .accessibilityAddTraits(.isHeader)
                        Text("A copy is saved on this device before any upload begins.")
                            .font(.subheadline)
                            .foregroundStyle(DossierPalette.muted)
                    }

                    if isLoading {
                        ProgressView("Reading shared link…")
                            .frame(maxWidth: .infinity, minHeight: 150)
                    } else if let errorMessage {
                        Label(errorMessage, systemImage: "exclamationmark.triangle")
                            .font(.subheadline)
                            .foregroundStyle(DossierPalette.accent)
                            .fixedSize(horizontal: false, vertical: true)
                    } else if didSave {
                        savedStateView
                    } else {
                        VStack(alignment: .leading, spacing: 14) {
                            VStack(alignment: .leading, spacing: 6) {
                                Text("LINK")
                                    .font(.caption.weight(.semibold)).tracking(1).foregroundStyle(DossierPalette.muted)
                                TextField("https://…", text: $url, axis: .vertical)
                                    .keyboardType(.URL)
                                    .textInputAutocapitalization(.never)
                                    .autocorrectionDisabled()
                                    .accessibilityLabel("Job link")
                                    .padding(12)
                                    .background(DossierPalette.canvas, in: RoundedRectangle(cornerRadius: 12))
                            }
                            VStack(alignment: .leading, spacing: 6) {
                                Text("SHARED TEXT")
                                    .font(.caption.weight(.semibold)).tracking(1).foregroundStyle(DossierPalette.muted)
                                TextField("Optional posting text", text: $text, axis: .vertical)
                                    .lineLimit(3...7)
                                    .accessibilityLabel("Shared posting text")
                                    .padding(12)
                                    .background(DossierPalette.canvas, in: RoundedRectangle(cornerRadius: 12))
                            }
                            VStack(alignment: .leading, spacing: 6) {
                                Text("NOTE")
                                    .font(.caption.weight(.semibold)).tracking(1).foregroundStyle(DossierPalette.muted)
                                TextField("Optional reminder", text: $note, axis: .vertical)
                                    .lineLimit(2...4)
                                    .accessibilityLabel("Capture note")
                                    .padding(12)
                                    .background(DossierPalette.canvas, in: RoundedRectangle(cornerRadius: 12))
                            }
                        }

                        Button(action: saveCapture) {
                            HStack {
                                if isSaving { ProgressView().tint(.white) }
                                Text(isSaving ? "Saving…" : "Save capture")
                                Spacer()
                                Image(systemName: "tray.and.arrow.down")
                            }
                            .font(.headline)
                            .foregroundStyle(.white)
                            .padding(16)
                            .background(DossierPalette.ink, in: RoundedRectangle(cornerRadius: 15))
                        }
                        .disabled(isSaving || url.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        .accessibilityHint("Saves this link to the shared Dossier outbox, then attempts one upload if you are signed in.")
                    }
                }
                .padding(20)
            }
            .background(DossierPalette.canvas.ignoresSafeArea())
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(didSave ? "Done" : "Cancel", action: onFinish)
                }
            }
            .task { await loadSharedPayload() }
        }
        .tint(DossierPalette.ink)
    }

    private var savedStateView: some View {
        VStack(alignment: .leading, spacing: 14) {
            Image(systemName: deliveryState == .savedToDossier ? "checkmark.circle.fill" : "tray.circle.fill")
                .font(.system(size: 46))
                .foregroundStyle(deliveryState == .savedToDossier ? DossierPalette.green : DossierPalette.accent)
                .accessibilityHidden(true)
            Text(statusMessage ?? "Saved locally")
                .font(.title3.weight(.semibold))
                .foregroundStyle(DossierPalette.ink)
                .accessibilityAddTraits(.isHeader)
            Text(url)
                .font(.subheadline)
                .foregroundStyle(DossierPalette.muted)
                .textSelection(.enabled)
            if let errorMessage, deliveryState != .savedToDossier {
                Text(errorMessage).font(.footnote).foregroundStyle(DossierPalette.muted)
            }
            Text("Dossier will retry this saved item when the app next opens. Background retries depend on iOS scheduling.")
                .font(.footnote)
                .foregroundStyle(DossierPalette.muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .background(DossierPalette.paper, in: RoundedRectangle(cornerRadius: 18))
    }

    private func loadSharedPayload() async {
        guard let context else {
            isLoading = false
            errorMessage = "The shared link could not be read. Close this sheet and try sharing again."
            return
        }
        do {
            guard let payload = try await Self.extract(from: context) else {
                errorMessage = "Share a web link, or share text that contains a web link."
                isLoading = false
                return
            }
            url = payload.url
            text = payload.text ?? ""
        } catch {
            errorMessage = "The shared item could not be read. Close this sheet and try again."
        }
        isLoading = false
    }

    private func saveCapture() {
        isSaving = true
        errorMessage = nil
        Task { @MainActor in
            let defaults = UserDefaults(suiteName: CaptureOutboxStore.appGroupIdentifier)
            let serverAddress = defaults?.string(forKey: "dossier.mobile.server-address") ?? MobileAPIClient.defaultServerAddress
            let item: CaptureOutboxItem
            do {
                item = try outbox.enqueue(url: url, text: text, note: note, serverAddress: serverAddress)
            } catch {
                errorMessage = error.localizedDescription
                isSaving = false
                return
            }

            if item.state == .savedToDossier {
                didSave = true
                deliveryState = item.state
                statusMessage = "Saved to Dossier"
                isSaving = false
                return
            }
            guard let session = tokenStore.load() else {
                didSave = true
                deliveryState = .savedLocally
                statusMessage = "Saved locally"
                isSaving = false
                return
            }

            outbox.markUploading(item.id)
            do {
                let capture = try await MobileAPIClient(serverAddress: serverAddress).createCapture(item.payload, token: session.accessToken)
                outbox.markSavedToDossier(item.id, capture: capture)
                deliveryState = .savedToDossier
                statusMessage = "Saved to Dossier"
            } catch let error as MobileAPIError where error.statusCode == 401 {
                outbox.markNeedsSignIn(item.id, reason: "Sign in again in the Dossier app to upload this saved capture.")
                deliveryState = .signInNeeded
                statusMessage = "Saved locally"
                errorMessage = "The session expired before upload. Sign in in Dossier to retry."
            } catch {
                outbox.markRetryNeeded(item.id, reason: error.localizedDescription)
                deliveryState = .retryNeeded
                statusMessage = "Saved locally · upload will retry"
                errorMessage = error.localizedDescription
            }
            didSave = true
            isSaving = false
        }
    }

    private static func extract(from context: NSExtensionContext) async throws -> SharedPayload? {
        let items = context.inputItems.compactMap { $0 as? NSExtensionItem }
        var sharedURL: URL?
        var sharedTexts: [String] = []
        for item in items {
            for provider in item.attachments ?? [] {
                if sharedURL == nil, provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                    let value = await load(provider, type: UTType.url.identifier)
                    if let url = value as? URL { sharedURL = url }
                    else if let url = value as? NSURL { sharedURL = url as URL }
                    else if let value = value as? String, let url = URL(string: value) { sharedURL = url }
                }
                if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                    let value = await load(provider, type: UTType.plainText.identifier)
                    if let value = value as? String { sharedTexts.append(value) }
                    else if let value = value as? Data, let string = String(data: value, encoding: .utf8) { sharedTexts.append(string) }
                } else if provider.hasItemConformingToTypeIdentifier(UTType.text.identifier) {
                    let value = await load(provider, type: UTType.text.identifier)
                    if let value = value as? String { sharedTexts.append(value) }
                }
            }
        }
        let joinedText = sharedTexts.joined(separator: "\n\n").trimmingCharacters(in: .whitespacesAndNewlines)
        if sharedURL == nil {
            let candidates = joinedText.split(whereSeparator: \.isWhitespace).compactMap { URL(string: String($0).trimmingCharacters(in: CharacterSet(charactersIn: ".,);]"))) }
            sharedURL = candidates.first { ["http", "https"].contains($0.scheme?.lowercased() ?? "") }
        }
        guard let sharedURL, ["http", "https"].contains(sharedURL.scheme?.lowercased() ?? "") else { return nil }
        return SharedPayload(url: sharedURL.absoluteString, text: joinedText.isEmpty ? nil : joinedText)
    }

    private static func load(_ provider: NSItemProvider, type: String) async -> NSSecureCoding? {
        await withCheckedContinuation { continuation in
            provider.loadItem(forTypeIdentifier: type, options: nil) { value, _ in
                continuation.resume(returning: value)
            }
        }
    }
}
