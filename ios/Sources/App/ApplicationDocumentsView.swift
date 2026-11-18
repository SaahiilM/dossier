import PDFKit
import SwiftUI
import UIKit

struct ApplicationDocumentsSection: View {
    @EnvironmentObject private var model: AppModel
    let applicationID: String

    @State private var documents: [MobileSavedDocument] = []
    @State private var loadState: LoadState = .loading
    @State private var selectedDocument: MobileSavedDocument?

    private enum LoadState {
        case loading
        case signedOut
        case loaded
        case unsupported
        case failed(String)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label("Saved documents", systemImage: "doc.text")
                .font(.headline)
                .foregroundStyle(DossierPalette.ink)
                .accessibilityAddTraits(.isHeader)

            switch loadState {
            case .loading:
                ProgressView("Loading saved documents…")
                    .font(.subheadline)
                    .foregroundStyle(DossierPalette.muted)
            case .signedOut:
                Text("Sign in to read this application’s saved documents.")
                    .font(.subheadline)
                    .foregroundStyle(DossierPalette.muted)
            case .unsupported:
                Text("Saved documents are not available from this Dossier server yet.")
                    .font(.subheadline)
                    .foregroundStyle(DossierPalette.muted)
            case .failed(let message):
                VStack(alignment: .leading, spacing: 10) {
                    Text(message)
                        .font(.subheadline)
                        .foregroundStyle(DossierPalette.muted)
                    Button("Try again") { Task { await loadDocuments() } }
                        .font(.subheadline.weight(.semibold))
                }
            case .loaded:
                if documents.isEmpty {
                    Text("This application has no saved resume or cover letter.")
                        .font(.subheadline)
                        .foregroundStyle(DossierPalette.muted)
                } else {
                    VStack(spacing: 12) {
                        ForEach(documents) { document in
                            Button { selectedDocument = document } label: {
                                documentRow(document)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(DossierPalette.paper, in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(DossierPalette.ink.opacity(0.07)))
        .task(id: model.session?.accessToken) { await loadDocuments() }
        .onAppear { PrivateDocumentFileStore.purgeExpired() }
        .sheet(item: $selectedDocument) { document in
            SavedDocumentReader(applicationID: applicationID, document: document)
                .environmentObject(model)
        }
    }

    @ViewBuilder
    private func documentRow(_ document: MobileSavedDocument) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(alignment: .firstTextBaseline) {
                Text(document.label)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(DossierPalette.ink)
                Spacer(minLength: 8)
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(DossierPalette.muted)
            }
            Text("Updated \(document.updatedAt.formatted(date: .abbreviated, time: .omitted))")
                .font(.caption)
                .foregroundStyle(DossierPalette.muted)
            if document.currentVersionId == nil {
                Label("No matching saved history version was confirmed", systemImage: "clock.arrow.circlepath")
                    .font(.caption)
                    .foregroundStyle(DossierPalette.muted)
            }
            if document.units.contains(where: \.hasUnverifiedContent) {
                Label("Contains unverified content", systemImage: "exclamationmark.triangle.fill")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(DossierPalette.accent)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
    }

    @MainActor
    private func loadDocuments() async {
        guard let token = model.session?.accessToken else {
            documents = []
            loadState = .signedOut
            return
        }
        loadState = .loading
        do {
            let response = try await MobileAPIClient(serverAddress: model.serverAddress)
                .applicationDocuments(id: applicationID, token: token)
            guard !Task.isCancelled else { return }
            documents = response.documents.available
            loadState = .loaded
        } catch {
            guard !Task.isCancelled else { return }
            documents = []
            if (error as? MobileAPIError)?.statusCode == 404 {
                // The collection route was added after the original mobile API. A 404
                // here is the compatibility signal for a server that has not upgraded.
                loadState = .unsupported
            } else {
                loadState = .failed(error.localizedDescription)
            }
        }
    }
}

private struct SavedDocumentReader: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    let applicationID: String
    let document: MobileSavedDocument

    @State private var isFetchingPDF = false
    @State private var pdfError: String?
    @State private var pdfPresentation: PDFPresentation?
    @State private var activePDFFile: TemporaryDocumentPDF?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(document.label)
                            .font(.system(.largeTitle, design: .serif).weight(.semibold))
                            .foregroundStyle(DossierPalette.ink)
                            .accessibilityAddTraits(.isHeader)
                        Text("Updated \(document.updatedAt.formatted(date: .long, time: .omitted))")
                            .font(.subheadline)
                            .foregroundStyle(DossierPalette.muted)
                    }

                    if document.currentVersionId == nil {
                        DocumentNotice(
                            message: "No matching saved history version was confirmed for this content. Review it before relying on it.",
                            symbol: "clock.arrow.circlepath",
                            isWarning: false
                        )
                    }
                    if document.units.contains(where: \.hasUnverifiedContent) {
                        DocumentNotice(
                            message: "Some content is marked unverified. Check those sections before sharing or using this document.",
                            symbol: "exclamationmark.triangle.fill",
                            isWarning: true
                        )
                    }

                    if document.units.isEmpty {
                        Text("This saved document has no readable text sections.")
                            .font(.body)
                            .foregroundStyle(DossierPalette.muted)
                    } else {
                        ForEach(document.units) { unit in
                            VStack(alignment: .leading, spacing: 9) {
                                HStack(alignment: .firstTextBaseline, spacing: 8) {
                                    Text(unit.label)
                                        .font(.headline)
                                        .foregroundStyle(DossierPalette.ink)
                                    if unit.hasUnverifiedContent {
                                        Label("Unverified", systemImage: "exclamationmark.triangle.fill")
                                            .font(.caption.weight(.medium))
                                            .foregroundStyle(DossierPalette.accent)
                                    }
                                }
                                Text(unit.text)
                                    .font(.body)
                                    .foregroundStyle(DossierPalette.ink)
                                    .textSelection(.enabled)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .padding(16)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(DossierPalette.paper, in: RoundedRectangle(cornerRadius: 16))
                        }
                    }

                    VStack(alignment: .leading, spacing: 10) {
                        HStack(spacing: 12) {
                            Button { Task { await fetchPDF(for: .preview) } } label: {
                                Label("Preview PDF", systemImage: "doc.text.magnifyingglass")
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(DossierPalette.ink)
                            .disabled(isFetchingPDF)

                            Button { Task { await fetchPDF(for: .share) } } label: {
                                Label("Share PDF", systemImage: "square.and.arrow.up")
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.bordered)
                            .disabled(isFetchingPDF)
                        }
                        if isFetchingPDF {
                            ProgressView("Preparing PDF…")
                                .font(.footnote)
                                .foregroundStyle(DossierPalette.muted)
                        }
                        if let pdfError {
                            Text(pdfError)
                                .font(.footnote)
                                .foregroundStyle(DossierPalette.accent)
                        }
                        Text("Sharing opens the iOS share sheet. Nothing is sent until you choose an action.")
                            .font(.footnote)
                            .foregroundStyle(DossierPalette.muted)
                    }
                    .padding(16)
                    .background(DossierPalette.paper, in: RoundedRectangle(cornerRadius: 16))
                }
                .padding(16)
            }
            .background(DossierPalette.canvas)
            .navigationTitle(document.kind.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .sheet(item: $pdfPresentation, onDismiss: removeActivePDF) { presentation in
            switch presentation {
            case .preview(let file):
                PDFPreviewScreen(file: file)
            case .share(let file):
                ActivityShareSheet(fileURL: file.url)
                    .ignoresSafeArea()
            }
        }
        .onDisappear(perform: removeActivePDF)
    }

    @MainActor
    private func fetchPDF(for action: PDFAction) async {
        guard !isFetchingPDF else { return }
        guard let token = model.session?.accessToken else {
            pdfError = "Sign in to preview or share this PDF."
            return
        }
        isFetchingPDF = true
        pdfError = nil
        defer { isFetchingPDF = false }
        do {
            let response = try await MobileAPIClient(serverAddress: model.serverAddress)
                .documentPDF(applicationID: applicationID, kind: document.kind, token: token)
            let file = try PrivateDocumentFileStore.create(response, kind: document.kind)
            activePDFFile = file
            switch action {
            case .preview: pdfPresentation = .preview(file)
            case .share: pdfPresentation = .share(file)
            }
        } catch {
            if (error as? MobileAPIError)?.statusCode == 404 {
                pdfError = "PDF preview is not available from this Dossier server yet. You can still read the saved text above."
            } else {
                pdfError = error.localizedDescription
            }
        }
    }

    private func removeActivePDF() {
        if let activePDFFile { PrivateDocumentFileStore.remove(activePDFFile) }
        activePDFFile = nil
        pdfPresentation = nil
    }
}

private enum PDFAction {
    case preview
    case share
}

private enum PDFPresentation: Identifiable {
    case preview(TemporaryDocumentPDF)
    case share(TemporaryDocumentPDF)

    var id: UUID { file.id }

    private var file: TemporaryDocumentPDF {
        switch self {
        case .preview(let file), .share(let file): file
        }
    }
}

private struct TemporaryDocumentPDF: Identifiable {
    let id = UUID()
    let directoryURL: URL
    let url: URL
    let filename: String
}

private enum PrivateDocumentFileStore {
    private static let directoryPrefix = "dossier-private-document-"

    static func create(_ response: MobilePDFResponse, kind: MobileDocumentKind) throws -> TemporaryDocumentPDF {
        let filename = safeFilename(response.suggestedFilename, fallback: "\(kind.title).pdf")
        let directoryURL = FileManager.default.temporaryDirectory
            .appendingPathComponent(directoryPrefix + UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(
            at: directoryURL,
            withIntermediateDirectories: false,
            attributes: [.protectionKey: FileProtectionType.complete]
        )
        let url = directoryURL.appendingPathComponent(filename, isDirectory: false)
        do {
            try response.data.write(to: url, options: .atomic)
            try FileManager.default.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: url.path)
            return TemporaryDocumentPDF(directoryURL: directoryURL, url: url, filename: filename)
        } catch {
            try? FileManager.default.removeItem(at: directoryURL)
            throw error
        }
    }

    static func remove(_ file: TemporaryDocumentPDF) {
        try? FileManager.default.removeItem(at: file.directoryURL)
    }

    static func purgeExpired() {
        let fileManager = FileManager.default
        guard let directories = try? fileManager.contentsOfDirectory(
            at: fileManager.temporaryDirectory,
            includingPropertiesForKeys: [.contentModificationDateKey],
            options: [.skipsHiddenFiles]
        ) else { return }
        let expiration = Date().addingTimeInterval(-24 * 60 * 60)
        for directory in directories where directory.lastPathComponent.hasPrefix(directoryPrefix) {
            guard let values = try? directory.resourceValues(forKeys: [.contentModificationDateKey]),
                  let modified = values.contentModificationDate,
                  modified < expiration else { continue }
            try? fileManager.removeItem(at: directory)
        }
    }

    private static func safeFilename(_ supplied: String?, fallback: String) -> String {
        var name = supplied?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if name.isEmpty { name = fallback }
        name = name
            .replacingOccurrences(of: "/", with: "-")
            .replacingOccurrences(of: "\\", with: "-")
        name = String(name.unicodeScalars.filter { !CharacterSet.controlCharacters.contains($0) }.prefix(120))
        if name.isEmpty || name == "." || name == ".." { name = fallback }
        if !name.lowercased().hasSuffix(".pdf") { name += ".pdf" }
        return name
    }
}

private struct DocumentNotice: View {
    let message: String
    let symbol: String
    var isWarning = false

    var body: some View {
        Label(message, systemImage: symbol)
            .font(.subheadline)
            .foregroundStyle(isWarning ? DossierPalette.accent : DossierPalette.muted)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
            .background(DossierPalette.paper, in: RoundedRectangle(cornerRadius: 14))
    }
}

private struct PDFPreviewScreen: View {
    @Environment(\.dismiss) private var dismiss
    let file: TemporaryDocumentPDF

    var body: some View {
        NavigationStack {
            PDFDocumentView(url: file.url)
                .background(DossierPalette.canvas)
                .navigationTitle(file.filename)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Done") { dismiss() }
                    }
                }
        }
    }
}

private struct PDFDocumentView: UIViewRepresentable {
    let url: URL

    func makeUIView(context: Context) -> PDFView {
        let view = PDFView()
        view.autoScales = true
        view.displayMode = .singlePageContinuous
        view.displayDirection = .vertical
        view.backgroundColor = UIColor(DossierPalette.canvas)
        view.document = PDFDocument(url: url)
        return view
    }

    func updateUIView(_ view: PDFView, context: Context) {
        if view.document?.documentURL != url {
            view.document = PDFDocument(url: url)
        }
    }
}

private struct ActivityShareSheet: UIViewControllerRepresentable {
    let fileURL: URL

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [fileURL], applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) { }
}
