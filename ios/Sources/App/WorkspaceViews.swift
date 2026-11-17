import SwiftUI
import UIKit

struct RootView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        Group {
            if model.isSignedIn {
                WorkspaceTabs()
            } else {
                SignInView()
            }
        }
        .background(DossierPalette.canvas.ignoresSafeArea())
        .alert("Dossier", isPresented: Binding(
            get: { model.errorMessage != nil },
            set: { if !$0 { model.dismissError() } }
        )) {
            Button("OK", role: .cancel) { model.dismissError() }
        } message: {
            Text(model.errorMessage ?? "")
        }
        .sheet(isPresented: Binding(
            get: { model.isWelcomePresented },
            set: { if !$0 { model.dismissWelcome() } }
        )) {
            FirstRunWelcomeView()
                .environmentObject(model)
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
        }
        .task(id: model.isSignedIn) {
            guard model.isSignedIn else { return }
            model.presentWelcomeIfNeeded()
            Task { await model.refreshSetupStatus() }
            await model.refreshWorkspace()
            await model.syncPendingCaptures()
        }
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active, model.isSignedIn else { return }
            Task {
                await model.refreshWorkspace()
                await model.syncPendingCaptures()
            }
        }
    }
}

private struct FirstRunWelcomeView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    VStack(alignment: .leading, spacing: 12) {
                        Image(systemName: "doc.text.magnifyingglass")
                            .font(.system(size: 25, weight: .medium))
                            .foregroundStyle(DossierPalette.accent)
                            .frame(width: 54, height: 54)
                            .background(DossierPalette.paper, in: RoundedRectangle(cornerRadius: 16))
                            .accessibilityHidden(true)
                        Text("Welcome to Dossier")
                            .font(.system(.largeTitle, design: .serif).weight(.semibold))
                            .foregroundStyle(DossierPalette.ink)
                            .accessibilityAddTraits(.isHeader)
                        Text("View the work already saved on your server, or continue setup in the full Dossier guide.")
                            .font(.body)
                            .foregroundStyle(DossierPalette.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    setupOverview

                    VStack(alignment: .leading, spacing: 11) {
                        Text("WHAT YOU CAN DO HERE")
                            .font(.caption.weight(.semibold))
                            .tracking(1.1)
                            .foregroundStyle(DossierPalette.muted)
                        actionCard(
                            title: "Applications",
                            detail: "Browse saved applications and open their details.",
                            symbol: "briefcase",
                            tab: .applications
                        )
                        actionCard(
                            title: "Capture Inbox",
                            detail: "Review Dossier captures and uploads waiting on this device.",
                            symbol: "tray",
                            tab: .inbox
                        )
                        actionCard(
                            title: "Profile and settings",
                            detail: "View available profile data, change servers, or reopen this welcome later.",
                            symbol: "gearshape",
                            tab: .settings
                        )
                    }

                    VStack(alignment: .leading, spacing: 10) {
                        Text("Continue setup on the web")
                            .font(.headline)
                            .foregroundStyle(DossierPalette.ink)
                        Text("The full guide covers your profile and AI setup. Your browser may ask you to sign in to this server.")
                            .font(.subheadline)
                            .foregroundStyle(DossierPalette.muted)
                            .fixedSize(horizontal: false, vertical: true)
                        if let setupGuideURL = model.setupGuideURL {
                            Link(destination: setupGuideURL) {
                                Label("Open Dossier setup guide", systemImage: "arrow.up.right.square")
                                    .font(.subheadline.weight(.semibold))
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(14)
                                    .background(DossierPalette.paper, in: RoundedRectangle(cornerRadius: 14))
                            }
                        }
                    }
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(DossierPalette.accent.opacity(0.08), in: RoundedRectangle(cornerRadius: 18))

                    Button("Skip for now") { model.dismissWelcome() }
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(DossierPalette.muted)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 7)
                        .accessibilityHint("Closes this welcome. You can reopen it from Settings.")
                }
                .padding(20)
                .frame(maxWidth: 560, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            .background(DossierPalette.canvas)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { model.dismissWelcome() }
                        .fontWeight(.semibold)
                }
            }
        }
        .tint(DossierPalette.ink)
    }

    private var setupOverview: some View {
        VStack(alignment: .leading, spacing: 13) {
            Text("On this server")
                .font(.headline)
                .foregroundStyle(DossierPalette.ink)
            HStack(spacing: 14) {
                setupStatusRow(title: "Profile", value: profileStatusText, symbol: "person.crop.circle")
                setupStatusRow(title: "AI setup", value: aiStatusText, symbol: "sparkles")
            }
            Text(setupStatusDescription)
                .font(.footnote)
                .foregroundStyle(DossierPalette.muted)
                .fixedSize(horizontal: false, vertical: true)
            if model.setupStatus?.setupInProgress == true {
                Label("Setup is marked in progress on this server.", systemImage: "clock")
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(DossierPalette.accent)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if model.profile != nil {
                Label("Profile data is available on this device.", systemImage: "checkmark.circle")
                    .font(.footnote)
                    .foregroundStyle(DossierPalette.green)
            }
            if let savedAt = model.applicationsSavedAt {
                Text("Saved workspace: \(model.applications.count) applications · updated \(savedAt.formatted(date: .abbreviated, time: .shortened)).")
                    .font(.footnote)
                    .foregroundStyle(DossierPalette.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(DossierPalette.paper, in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(DossierPalette.ink.opacity(0.07)))
    }

    private var profileStatusText: String {
        if model.setupStatusLoadState == .available, let status = model.setupStatus {
            return status.profileReady ? "Ready" : "Needs setup"
        }
        return unknownSetupStatusText
    }

    private var aiStatusText: String {
        if model.setupStatusLoadState == .available, let status = model.setupStatus {
            return status.aiConfigured ? "Configured" : "Not configured"
        }
        return unknownSetupStatusText
    }

    private var unknownSetupStatusText: String {
        switch model.setupStatusLoadState {
        case .notChecked: "Not checked"
        case .loading: "Checking…"
        case .available: "Unknown"
        case .unsupported: "Not reported"
        case .unavailable: "Could not check"
        }
    }

    private var setupStatusDescription: String {
        switch model.setupStatusLoadState {
        case .notChecked: "Setup status has not been checked yet."
        case .loading: "Checking setup status. You can keep using the app while it loads."
        case .available: "Status comes from this Dossier server."
        case .unsupported: "This server does not report setup status yet. You can still explore saved profile and workspace data."
        case .unavailable: "Setup status could not be checked. You can still use the app and open the setup guide."
        }
    }

    private func setupStatusRow(title: String, value: String, symbol: String) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Label(title, systemImage: symbol)
                .font(.caption.weight(.medium))
                .foregroundStyle(DossierPalette.muted)
            Text(value)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(DossierPalette.ink)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(DossierPalette.canvas, in: RoundedRectangle(cornerRadius: 13))
        .accessibilityElement(children: .combine)
    }

    private func actionCard(title: String, detail: String, symbol: String, tab: WorkspaceTab) -> some View {
        Button { model.navigateFromWelcome(to: tab) } label: {
            HStack(alignment: .top, spacing: 13) {
                Image(systemName: symbol)
                    .font(.headline)
                    .foregroundStyle(DossierPalette.accent)
                    .frame(width: 34, height: 34)
                    .background(DossierPalette.canvas, in: RoundedRectangle(cornerRadius: 10))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(DossierPalette.ink)
                    Text(detail)
                        .font(.footnote)
                        .foregroundStyle(DossierPalette.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 4)
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(DossierPalette.muted)
                    .padding(.top, 4)
                    .accessibilityHidden(true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
            .background(DossierPalette.paper, in: RoundedRectangle(cornerRadius: 15))
            .overlay(RoundedRectangle(cornerRadius: 15).stroke(DossierPalette.ink.opacity(0.07)))
            .contentShape(RoundedRectangle(cornerRadius: 15))
        }
        .buttonStyle(.plain)
    }
}

private struct SignInView: View {
    @EnvironmentObject private var model: AppModel
    @State private var password = ""
    @State private var serverAddress = AppModel.defaultServerAddress
    @FocusState private var passwordFocused: Bool

    var body: some View {
        GeometryReader { geometry in
            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    VStack(alignment: .leading, spacing: 18) {
                        Image(systemName: "doc.text.magnifyingglass")
                            .font(.system(size: 32, weight: .medium))
                            .foregroundStyle(DossierPalette.accent)
                            .accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Your work,\nin one place.")
                                .font(.system(.largeTitle, design: .serif).weight(.semibold))
                                .lineSpacing(1)
                                .fixedSize(horizontal: false, vertical: true)
                                .accessibilityAddTraits(.isHeader)
                            Text("Sign in to your private Dossier server.")
                                .font(.body)
                                .foregroundStyle(DossierPalette.muted)
                        }
                    }

                    VStack(alignment: .leading, spacing: 16) {
                        VStack(alignment: .leading, spacing: 7) {
                            Text("SERVER ADDRESS")
                                .font(.caption.weight(.semibold))
                                .tracking(1.1)
                                .foregroundStyle(DossierPalette.muted)
                            TextField("https://dossier.sahmai.party", text: $serverAddress)
                                .keyboardType(.URL)
                                .textContentType(.URL)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                .accessibilityLabel("Server address")
                                .padding(.horizontal, 15)
                                .padding(.vertical, 14)
                                .background(DossierPalette.paper, in: RoundedRectangle(cornerRadius: 14))
                                .overlay(RoundedRectangle(cornerRadius: 14).stroke(DossierPalette.ink.opacity(0.08)))
                        }
                        VStack(alignment: .leading, spacing: 7) {
                            Text("DOSSIER PASSWORD")
                                .font(.caption.weight(.semibold))
                                .tracking(1.1)
                                .foregroundStyle(DossierPalette.muted)
                            SecureField("Enter your server password", text: $password)
                                .textContentType(.password)
                                .focused($passwordFocused)
                                .submitLabel(.go)
                                .onSubmit(signIn)
                                .accessibilityLabel("Dossier password")
                                .padding(.horizontal, 15)
                                .padding(.vertical, 14)
                                .background(DossierPalette.paper, in: RoundedRectangle(cornerRadius: 14))
                                .overlay(RoundedRectangle(cornerRadius: 14).stroke(DossierPalette.ink.opacity(0.08)))
                        }
                        Button(action: signIn) {
                            HStack(spacing: 10) {
                                if model.isSigningIn { ProgressView().tint(.white) }
                                Text(model.isSigningIn ? "Signing in…" : "Sign in")
                                    .font(.headline)
                                Spacer()
                                Image(systemName: "arrow.right")
                                    .font(.headline)
                            }
                            .foregroundStyle(.white)
                            .padding(.horizontal, 18)
                            .padding(.vertical, 16)
                            .background(DossierPalette.ink, in: RoundedRectangle(cornerRadius: 16))
                        }
                        .disabled(model.isSigningIn || password.isEmpty)
                        .opacity(password.isEmpty ? 0.55 : 1)
                        .accessibilityHint("Connects to the server address above using your password.")
                    }

                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: "lock.shield")
                            .foregroundStyle(DossierPalette.green)
                            .accessibilityHidden(true)
                        Text("Your password is sent only to the server address you choose. The access token is kept in Keychain.")
                            .font(.footnote)
                            .foregroundStyle(DossierPalette.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .frame(maxWidth: 460, alignment: .leading)
                .padding(.horizontal, 24)
                .padding(.top, max(geometry.safeAreaInsets.top + 24, 38))
                .padding(.bottom, 32)
                .frame(maxWidth: .infinity, minHeight: geometry.size.height, alignment: .top)
            }
            .background(DossierPalette.canvas)
        }
        .onAppear { serverAddress = model.serverAddress }
        .preferredColorScheme(.light)
    }

    private func signIn() {
        model.updateServerAddress(serverAddress)
        guard model.serverAddress == serverAddress.trimmingCharacters(in: .whitespacesAndNewlines).trimmingCharacters(in: CharacterSet(charactersIn: "/")) else { return }
        Task { await model.signIn(password: password); password = "" }
    }
}

private struct WorkspaceTabs: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        TabView(selection: $model.selectedWorkspaceTab) {
            ApplicationsView()
                .tabItem { Label("Applications", systemImage: "briefcase") }
                .tag(WorkspaceTab.applications)
            CaptureInboxView()
                .tabItem { Label("Inbox", systemImage: "tray") }
                .tag(WorkspaceTab.inbox)
            ProfileView()
                .tabItem { Label("Settings", systemImage: "gearshape") }
                .tag(WorkspaceTab.settings)
        }
        .tint(DossierPalette.ink)
    }
}

private struct ApplicationsView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        NavigationStack {
            Group {
                if model.isLoading && model.applications.isEmpty {
                    ProgressView("Loading applications…")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if model.applications.isEmpty {
                    EmptyStateView(
                        symbol: "briefcase",
                        title: "No applications yet",
                        message: "Applications from your Dossier server will appear here."
                    )
                } else {
                    ScrollView {
                        LazyVStack(spacing: 12) {
                            if let savedAt = model.applicationsSavedAt, Date().timeIntervalSince(savedAt) > 300 {
                                StaleDataBanner(savedAt: savedAt)
                            }
                            ForEach(Array(model.applications.enumerated()), id: \.element.id) { index, application in
                                NavigationLink(value: application) {
                                    ApplicationCard(application: application)
                                }
                                .buttonStyle(.plain)
                                .task {
                                    if index >= model.applications.count - 3 { await model.loadMoreApplications() }
                                }
                            }
                            if model.isLoadingMore { ProgressView().padding(.vertical, 18) }
                        }
                        .padding(.horizontal, 16)
                        .padding(.top, 12)
                        .padding(.bottom, 28)
                    }
                    .refreshable { await model.refreshApplications() }
                }
            }
            .background(DossierPalette.canvas)
            .navigationTitle("Applications")
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task { await model.refreshApplications() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .accessibilityLabel("Refresh applications")
                }
            }
            .navigationDestination(for: ApplicationRecord.self) { application in
                ApplicationDetailView(application: application)
            }
        }
    }
}

private struct ApplicationCard: View {
    let application: ApplicationRecord

    var body: some View {
        VStack(alignment: .leading, spacing: 13) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 5) {
                    Text(application.role)
                        .font(.headline)
                        .foregroundStyle(DossierPalette.ink)
                        .multilineTextAlignment(.leading)
                        .accessibilityAddTraits(.isHeader)
                    Text(application.company)
                        .font(.subheadline)
                        .foregroundStyle(DossierPalette.muted)
                }
                Spacer(minLength: 6)
                StatusBadge(status: application.status)
            }
            HStack(spacing: 12) {
                if let location = application.location, !location.isEmpty {
                    Label(location, systemImage: "mappin.and.ellipse")
                        .lineLimit(1)
                }
                if let date = application.updatedAt ?? application.createdAt {
                    Label(date.formatted(date: .abbreviated, time: .omitted), systemImage: "clock")
                        .lineLimit(1)
                }
                if let mode = application.mode, !mode.isEmpty {
                    Label(mode, systemImage: "building.2")
                        .lineLimit(1)
                }
                if let score = application.score {
                    Label("Match " + String(score) + "%", systemImage: "sparkles")
                        .lineLimit(1)
                }
            }
            .font(.caption)
            .foregroundStyle(DossierPalette.muted)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(DossierPalette.paper, in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(DossierPalette.ink.opacity(0.07)))
        .contentShape(RoundedRectangle(cornerRadius: 18))
        .accessibilityElement(children: .combine)
        .accessibilityHint("Opens application details")
    }
}

struct StatusBadge: View {
    let status: String

    private var tint: Color {
        let value = status.lowercased()
        if value.contains("offer") { return DossierPalette.green }
        if value.contains("interview") { return Color(red: 0.40, green: 0.36, blue: 0.67) }
        if value.contains("reject") || value.contains("declin") { return DossierPalette.muted }
        if value.contains("draft") || value.contains("saved") { return DossierPalette.accent }
        return DossierPalette.ink
    }

    var body: some View {
        Text(status.replacingOccurrences(of: "_", with: " ").capitalized)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(tint)
            .padding(.horizontal, 9)
            .padding(.vertical, 6)
            .background(tint.opacity(0.1), in: Capsule())
            .accessibilityLabel("Status: \(status)")
    }
}

private struct StaleDataBanner: View {
    let savedAt: Date

    var body: some View {
        HStack(alignment: .top, spacing: 9) {
            Image(systemName: "clock.arrow.circlepath").accessibilityHidden(true)
            Text("Showing saved data from \(savedAt.formatted(date: .abbreviated, time: .shortened)). Pull to refresh.")
                .fixedSize(horizontal: false, vertical: true)
        }
        .font(.footnote)
        .foregroundStyle(DossierPalette.muted)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(DossierPalette.ink.opacity(0.05), in: RoundedRectangle(cornerRadius: 12))
        .accessibilityElement(children: .combine)
    }
}

private struct CaptureInboxView: View {
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

private struct ProfileView: View {
    @EnvironmentObject private var model: AppModel
    @State private var serverAddress = ""
    @State private var isShowingSignOut = false

    var body: some View {
        NavigationStack {
            Group {
                if let profile = model.profile {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 18) {
                            if let savedAt = model.profileSavedAt, Date().timeIntervalSince(savedAt) > 300 {
                                StaleDataBanner(savedAt: savedAt)
                            }
                            VStack(alignment: .leading, spacing: 7) {
                                Text("Your profile")
                                    .font(.system(.title2, design: .serif).weight(.semibold))
                                    .foregroundStyle(DossierPalette.ink)
                                    .accessibilityAddTraits(.isHeader)
                                Text("Read-only view from your Dossier server.")
                                    .font(.subheadline)
                                    .foregroundStyle(DossierPalette.muted)
                            }
                            VStack(alignment: .leading, spacing: 12) {
                                ProfileValueView(label: nil, value: profile)
                            }
                            .padding(16)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(DossierPalette.paper, in: RoundedRectangle(cornerRadius: 18))
                            .overlay(RoundedRectangle(cornerRadius: 18).stroke(DossierPalette.ink.opacity(0.07)))

                            serverSettings
                            signOutButton
                        }
                        .padding(16)
                    }
                    .refreshable { await model.refreshProfile() }
                } else if model.isRefreshingProfile {
                    ProgressView("Loading profile…").frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    EmptyStateView(symbol: "person.text.rectangle", title: "Profile unavailable", message: "Pull to retry loading your profile from Dossier.")
                }
            }
            .background(DossierPalette.canvas)
            .navigationTitle("Settings")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { model.reopenWelcome() } label: { Image(systemName: "sparkles") }
                        .accessibilityLabel("Reopen welcome")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { Task { await model.refreshProfile() } } label: { Image(systemName: "arrow.clockwise") }
                        .accessibilityLabel("Refresh profile")
                }
            }
            .confirmationDialog("Sign out of Dossier?", isPresented: $isShowingSignOut, titleVisibility: .visible) {
                Button("Sign Out", role: .destructive) { Task { await model.signOut() } }
                Button("Cancel", role: .cancel) { }
            } message: {
                Text("Saved capture drafts stay on this device. Cached profile and application data will be cleared.")
            }
        }
        .onAppear { serverAddress = model.serverAddress }
    }

    private var serverSettings: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("SERVER")
                .font(.caption.weight(.semibold))
                .tracking(1.1)
                .foregroundStyle(DossierPalette.muted)
            TextField("https://dossier.sahmai.party", text: $serverAddress)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .accessibilityLabel("Server address")
                .padding(13)
                .background(DossierPalette.canvas, in: RoundedRectangle(cornerRadius: 12))
            if serverAddress != model.serverAddress {
                Button("Save server address") { model.updateServerAddress(serverAddress) }
                    .font(.subheadline.weight(.semibold))
                    .accessibilityHint("Changing the server signs this device out and clears its cached server data.")
            }
            Text("Changing servers signs this device out. Use HTTPS for remote servers.")
                .font(.footnote)
                .foregroundStyle(DossierPalette.muted)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(DossierPalette.paper, in: RoundedRectangle(cornerRadius: 18))
    }

    private var signOutButton: some View {
        Button(role: .destructive) { isShowingSignOut = true } label: {
            Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right")
                .font(.body.weight(.medium))
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(16)
                .background(DossierPalette.paper, in: RoundedRectangle(cornerRadius: 16))
        }
    }
}

private struct ProfileValueView: View {
    let label: String?
    let value: JSONValue

    @ViewBuilder
    var body: some View {
        switch value {
        case .object(let fields):
            if fields.isEmpty {
                if let label { Text("\(label): Not provided").font(.subheadline).foregroundStyle(DossierPalette.muted) }
            } else {
                ForEach(fields.keys.sorted(), id: \.self) { key in
                    if let child = fields[key] {
                        if case .object = child {
                            DisclosureGroup {
                                ProfileValueView(label: nil, value: child).padding(.leading, 8)
                            } label: {
                                Text(key.prettyLabel).font(.headline).foregroundStyle(DossierPalette.ink)
                            }
                        } else if case .array = child {
                            DisclosureGroup {
                                ProfileValueView(label: nil, value: child).padding(.leading, 8)
                            } label: {
                                Text(key.prettyLabel).font(.headline).foregroundStyle(DossierPalette.ink)
                            }
                        } else {
                            ProfileValueView(label: key.prettyLabel, value: child)
                        }
                    }
                }
            }
        case .array(let values):
            ForEach(Array(values.enumerated()), id: \.offset) { index, child in
                VStack(alignment: .leading, spacing: 7) {
                    Text("\(label ?? "Item") \(index + 1)")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(DossierPalette.ink)
                    ProfileValueView(label: nil, value: child)
                }
                .padding(.vertical, 3)
            }
        case .string(let text):
            if !text.isEmpty {
                if text.hasPrefix("data:image/") {
                    if let image = Self.image(from: text) {
                        Image(uiImage: image)
                            .resizable()
                            .scaledToFit()
                            .frame(maxWidth: 180, maxHeight: 180)
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                            .accessibilityLabel(label ?? "Profile photo")
                    } else {
                        Label("Profile photo could not be displayed", systemImage: "person.crop.square")
                            .font(.subheadline)
                            .foregroundStyle(DossierPalette.muted)
                    }
                } else if let label {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(label).font(.caption.weight(.medium)).foregroundStyle(DossierPalette.muted)
                        Text(text).font(.body).foregroundStyle(DossierPalette.ink).textSelection(.enabled)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    Text(text).font(.body).foregroundStyle(DossierPalette.ink).textSelection(.enabled)
                }
            }
        case .number, .bool:
            if let label {
                LabeledContent(label, value: value.displayText)
                    .font(.subheadline)
                    .foregroundStyle(DossierPalette.ink)
            } else { Text(value.displayText).font(.body).foregroundStyle(DossierPalette.ink) }
        case .null:
            EmptyView()
        }
    }

    private static func image(from dataURL: String) -> UIImage? {
        guard let separator = dataURL.firstIndex(of: ",") else { return nil }
        let encoded = String(dataURL[dataURL.index(after: separator)...])
        guard let data = Data(base64Encoded: encoded, options: .ignoreUnknownCharacters) else { return nil }
        return UIImage(data: data)
    }
}

private extension String {
    var prettyLabel: String {
        let spaced = replacingOccurrences(of: "([a-z0-9])([A-Z])", with: "$1 $2", options: .regularExpression)
            .replacingOccurrences(of: "_", with: " ")
            .replacingOccurrences(of: "-", with: " ")
        return spaced.prefix(1).uppercased() + spaced.dropFirst()
    }
}

private struct EmptyStateView: View {
    let symbol: String
    let title: String
    let message: String

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: symbol)
                .font(.system(size: 28, weight: .regular))
                .foregroundStyle(DossierPalette.accent)
                .frame(width: 64, height: 64)
                .background(DossierPalette.accent.opacity(0.1), in: Circle())
                .accessibilityHidden(true)
            Text(title)
                .font(.system(.title3, design: .serif).weight(.semibold))
                .foregroundStyle(DossierPalette.ink)
                .multilineTextAlignment(.center)
                .accessibilityAddTraits(.isHeader)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(DossierPalette.muted)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: 310)
        }
        .padding(28)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
