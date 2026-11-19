import SwiftUI

struct CaptureInboxView: View {
    @EnvironmentObject private var model: AppModel

    private var pendingItems: [CaptureOutboxItem] { model.captureItems.filter { $0.state != .savedToDossier } }
    private var pendingCount: Int { pendingItems.count }

    var body: some View {
        NavigationStack {
            Group {
                List {
                    if model.isLoadingCaptures && model.serverCaptures.isEmpty {
                        ProgressView("Loading Inbox…")
                            .frame(maxWidth: .infinity)
                            .listRowSeparator(.hidden)
                    }
                    if !model.serverCaptures.isEmpty {
                        if let savedAt = model.capturesSavedAt, Date().timeIntervalSince(savedAt) > 300 {
                            StaleDataBanner(savedAt: savedAt)
                                .listRowSeparator(.hidden)
                        }
                        Section {
                            ForEach(model.serverCaptures) { capture in ServerCaptureRow(capture: capture) }
                            if model.nextCaptureCursor != nil {
                                Button {
                                    Task { await model.loadMoreCaptures() }
                                } label: {
                                    HStack {
                                        Spacer()
                                        if model.isLoadingMoreCaptures { ProgressView() }
                                        else { Text("Load more captures") }
                                        Spacer()
                                    }
                                }
                                .disabled(model.isLoadingMoreCaptures)
                            }
                        } header: {
                            Text("Dossier Inbox")
                        }
                    }
                    if !pendingItems.isEmpty {
                        Section {
                            ForEach(pendingItems) { item in CaptureInboxRow(item: item) }
                                .onDelete { offsets in
                                    for index in offsets { model.removeCapture(pendingItems[index]) }
                                }
                        } header: {
                            Text("Waiting on this device")
                        } footer: {
                            Text("These captures are stored locally until Dossier confirms upload. Retry keeps the same request ID.")
                                .textCase(nil)
                        }
                    }
                    if !model.isLoadingCaptures && model.serverCaptures.isEmpty && pendingItems.isEmpty {
                        EmptyStateView(
                            symbol: "tray.and.arrow.down",
                            title: "Your inbox is empty",
                            message: "Captures shared with Dossier appear here. Shared links are saved on this device first, then uploaded when the server is available."
                        )
                        .listRowSeparator(.hidden)
                    }
                }
                .scrollContentBackground(.hidden)
                .refreshable { await model.refreshCaptures(); await model.syncPendingCaptures(); model.reloadOutbox() }
            }
            .background(DossierPalette.canvas)
            .navigationTitle("Inbox")
            .toolbar {
                if pendingCount > 0 {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button {
                            Task { await model.syncPendingCaptures() }
                        } label: {
                            if model.isSyncingCaptures { ProgressView() }
                            else { Text("Retry \(pendingCount)") }
                        }
                        .disabled(model.isSyncingCaptures)
                        .accessibilityLabel("Retry \(pendingCount) pending captures")
                    }
                }
            }
        }
        .task { model.reloadOutbox() }
    }
}

private struct ServerCaptureRow: View {
    let capture: CaptureRecord

    private var stateLabel: String {
        switch capture.state {
        case "SAVED": "Saved"
        case "NEEDS_DETAILS": "Needs details"
        case "READY": "Ready for prep"
        case "FAILED": "Could not process"
        default: capture.state.replacingOccurrences(of: "_", with: " ").capitalized
        }
    }

    private var shortURL: String {
        guard let components = URLComponents(string: capture.url), let host = components.host else { return capture.url }
        return components.path.isEmpty || components.path == "/" ? host : host + components.path
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(shortURL)
                .font(.headline)
                .foregroundStyle(DossierPalette.ink)
                .lineLimit(2)
                .textSelection(.enabled)
            HStack(spacing: 6) {
                Circle().fill(capture.state == "READY" ? DossierPalette.green : DossierPalette.accent)
                    .frame(width: 7, height: 7)
                    .accessibilityHidden(true)
                Text(stateLabel).font(.caption.weight(.semibold))
                Text("· \(capture.updatedAt.formatted(date: .abbreviated, time: .shortened))")
                    .font(.caption).foregroundStyle(DossierPalette.muted)
            }
            .foregroundStyle(capture.state == "READY" ? DossierPalette.green : DossierPalette.accent)
            if !capture.note.isEmpty { Text(capture.note).font(.subheadline).foregroundStyle(DossierPalette.muted) }
            if !capture.text.isEmpty {
                Text(capture.text).font(.footnote).lineLimit(4).foregroundStyle(DossierPalette.muted)
            }
            if !capture.canonicalEmployerUrl.isEmpty, let url = URL(string: capture.canonicalEmployerUrl), ["http", "https"].contains(url.scheme?.lowercased() ?? "") {
                Link(destination: url) {
                    Label("Open employer posting", systemImage: "arrow.up.right.square")
                        .font(.footnote.weight(.medium))
                }
            }
        }
        .padding(.vertical, 5)
        .accessibilityElement(children: .combine)
    }
}

private struct CaptureInboxRow: View {
    let item: CaptureOutboxItem

    private var stateLabel: String {
        switch item.state {
        case .savedLocally: "Saved locally"
        case .uploading: "Uploading…"
        case .retryNeeded: "Waiting to retry"
        case .signInNeeded: "Sign in to upload"
        case .savedToDossier: "Saved to Dossier"
        }
    }

    private var stateColor: Color { item.state == .savedToDossier ? DossierPalette.green : DossierPalette.accent }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(item.shortURL)
                .font(.headline)
                .foregroundStyle(DossierPalette.ink)
                .lineLimit(2)
                .textSelection(.enabled)
            HStack(spacing: 6) {
                Circle().fill(stateColor).frame(width: 7, height: 7).accessibilityHidden(true)
                Text(stateLabel).font(.caption.weight(.semibold)).foregroundStyle(stateColor)
                Text("· \(item.createdAt.formatted(date: .abbreviated, time: .shortened))")
                    .font(.caption).foregroundStyle(DossierPalette.muted)
            }
            if let note = item.note, !note.isEmpty { Text(note).font(.subheadline).foregroundStyle(DossierPalette.muted) }
            if let message = item.lastError, item.state != .savedToDossier {
                Text(message).font(.footnote).foregroundStyle(DossierPalette.muted)
            }
            if let text = item.text, !text.isEmpty {
                Text(text).font(.footnote).lineLimit(4).foregroundStyle(DossierPalette.muted)
            }
        }
        .padding(.vertical, 5)
        .accessibilityElement(children: .combine)
    }
}
