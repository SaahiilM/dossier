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
    @State private var isProfileBasicsPresented = false

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
                        Text("View your saved work and finish profile basics here. The full guide is available for the remaining setup steps.")
                            .font(.body)
                            .foregroundStyle(DossierPalette.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    setupOverview

                    Button { isProfileBasicsPresented = true } label: {
                        HStack(spacing: 13) {
                            Image(systemName: "person.crop.circle.badge.plus")
                                .font(.title2)
                                .foregroundStyle(.white)
                            VStack(alignment: .leading, spacing: 4) {
                                Text((model.profileReadyOverride ?? model.setupStatus?.profileReady) == true ? "Edit profile basics" : "Set up profile basics")
                                    .font(.headline)
                                    .foregroundStyle(.white)
                                Text("Add your name, contact details, location and resume summary.")
                                    .font(.footnote)
                                    .foregroundStyle(.white.opacity(0.82))
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            Spacer(minLength: 4)
                            Image(systemName: "chevron.right")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.white.opacity(0.85))
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(16)
                        .background(DossierPalette.ink, in: RoundedRectangle(cornerRadius: 17))
                    }
                    .buttonStyle(.plain)
                    .accessibilityHint("Opens the native profile basics form.")

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
                        Text("Continue setup in the full guide")
                            .font(.headline)
                            .foregroundStyle(DossierPalette.ink)
                        Text("Profile basics are available above. Use the guide for setup steps that are not yet available in the app. Your browser may ask you to sign in to this server.")
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
        .sheet(isPresented: $isProfileBasicsPresented) {
            ProfileBasicsEditorView()
                .environmentObject(model)
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
        }
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
        if let profileReady = model.profileReadyOverride {
            return profileReady ? "Ready" : "Needs setup"
        }
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
    @State private var isProfileBasicsPresented = false

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
                ToolbarItemGroup(placement: .topBarTrailing) {
                    Button { isProfileBasicsPresented = true } label: { Image(systemName: "person.crop.circle.badge.pencil") }
                        .accessibilityLabel("Edit profile basics")
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
        .sheet(isPresented: $isProfileBasicsPresented) {
            ProfileBasicsEditorView()
                .environmentObject(model)
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
        }
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

private struct ProfileBasicsEditorView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var draft = MobileProfileBasics.empty
    @State private var baseline = MobileProfileBasics.empty
    @State private var isLoading = true
    @State private var canEdit = false
    @State private var isSaving = false
    @State private var feedback: String?
    @State private var hasConflict = false

    private let requiredFields: Set<String> = ["name", "headline", "email", "city", "country", "summary"]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if isLoading {
                        ProgressView("Loading profile basics…")
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(16)
                            .background(DossierPalette.paper, in: RoundedRectangle(cornerRadius: 16))
                    }

                    if let feedback {
                        VStack(alignment: .leading, spacing: 10) {
                            Label(feedback, systemImage: "exclamationmark.circle")
                                .font(.footnote)
                                .foregroundStyle(DossierPalette.accent)
                                .frame(maxWidth: .infinity, alignment: .leading)
                            if hasConflict {
                                Button("Reload latest and keep my edits") {
                                    Task { await reloadLatestKeepingDraft() }
                                }
                                .font(.footnote.weight(.semibold))
                                .disabled(isLoading || isSaving)
                            }
                        }
                        .padding(14)
                        .background(DossierPalette.accent.opacity(0.08), in: RoundedRectangle(cornerRadius: 14))
                    }

                    if canEdit {
                        basicsFields
                        dateOfBirthFields
                        summaryField
                    }
                }
                .padding(16)
                .frame(maxWidth: 620, alignment: .leading)
                .frame(maxWidth: .infinity)
                .disabled(isLoading || isSaving)
            }
            .background(DossierPalette.canvas)
            .navigationTitle("Profile basics")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                        .disabled(isSaving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task { await save() }
                    } label: {
                        if isSaving { ProgressView() }
                        else { Text("Save").fontWeight(.semibold) }
                    }
                    .disabled(isLoading || isSaving || !canEdit || !hasChanges)
                    .accessibilityHint("Saves only the profile basics fields changed on this screen.")
                }
            }
            .task { await load() }
        }
        .tint(DossierPalette.ink)
        .interactiveDismissDisabled(isSaving)
    }

    private var basicsFields: some View {
        VStack(alignment: .leading, spacing: 15) {
            sectionHeading("The basics", detail: "Fields marked required count toward a complete profile.")
            textField("Full name", value: $draft.name, key: "name", placeholder: "Jane Doe", keyboard: .default, contentType: .name)
            textField("Headline", value: $draft.headline, key: "headline", placeholder: "Senior Product Designer", keyboard: .default, capitalization: .sentences)
            textField("Email", value: $draft.email, key: "email", placeholder: "jane@example.com", keyboard: .emailAddress, contentType: .emailAddress, capitalization: .never, autocorrection: false)
            textField("Phone", value: $draft.phone, key: "phone", placeholder: "+1 555 010 0000", keyboard: .phonePad, contentType: .telephoneNumber, capitalization: .never, autocorrection: false)
            textField("Website", value: $draft.website, key: "website", placeholder: "jane.example.com", keyboard: .URL, contentType: .URL, capitalization: .never, autocorrection: false)
            textField("Street address", value: $draft.address, key: "address", placeholder: "12 Main Street", keyboard: .default, contentType: .fullStreetAddress)
            textField("City", value: $draft.city, key: "city", placeholder: "Springfield", keyboard: .default, contentType: .addressCity)
            textField("Country", value: $draft.country, key: "country", placeholder: "United States", keyboard: .default, contentType: .countryName)
            textField("LinkedIn", value: $draft.linkedin, key: "linkedin", placeholder: "linkedin.com/in/janedoe", keyboard: .URL, capitalization: .never, autocorrection: false)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(DossierPalette.paper, in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(DossierPalette.ink.opacity(0.07)))
    }

    private var dateOfBirthFields: some View {
        VStack(alignment: .leading, spacing: 13) {
            sectionHeading("Date of birth", detail: "Optional. This stays in your private profile on your Dossier server.")
            if draft.dob.isEmpty {
                Button {
                    draft.dob = Self.isoDate(Date())
                } label: {
                    Label("Choose date of birth", systemImage: "calendar")
                        .font(.subheadline.weight(.medium))
                }
                .accessibilityHint("Opens a date picker. The date is private unless you enable showing your age on resumes.")
            } else {
                HStack(alignment: .center) {
                    DatePicker(
                        "Date of birth",
                        selection: Binding(
                            get: { Self.date(fromISODate: draft.dob) ?? Date() },
                            set: { draft.dob = Self.isoDate($0) }
                        ),
                        in: ...Date(),
                        displayedComponents: .date
                    )
                    .datePickerStyle(.compact)
                    Spacer(minLength: 8)
                    Button("Clear", role: .destructive) {
                        draft.dob = ""
                        draft.showAge = false
                    }
                    .font(.subheadline)
                }
            }

            Toggle(isOn: $draft.showAge) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Show age on resumes")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(DossierPalette.ink)
                    Text("Off by default. Your birth date is never printed; age appears only when a birth date is saved.")
                        .font(.footnote)
                        .foregroundStyle(DossierPalette.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .tint(DossierPalette.green)
            .accessibilityHint("When enabled, Dossier prints your age on resumes. Your date of birth is not printed.")
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(DossierPalette.paper, in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(DossierPalette.ink.opacity(0.07)))
    }

    private var summaryField: some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionHeading("Resume summary", detail: "A short introduction at the top of your resume.")
            TextEditor(text: $draft.summary)
                .scrollContentBackground(.hidden)
                .padding(8)
                .frame(minHeight: 150)
                .background(DossierPalette.canvas, in: RoundedRectangle(cornerRadius: 12))
                .accessibilityLabel("Resume summary, required")
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(DossierPalette.paper, in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(DossierPalette.ink.opacity(0.07)))
    }

    private var hasChanges: Bool { draft != baseline }

    private func sectionHeading(_ title: String, detail: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.headline)
                .foregroundStyle(DossierPalette.ink)
                .accessibilityAddTraits(.isHeader)
            Text(detail)
                .font(.footnote)
                .foregroundStyle(DossierPalette.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func textField(
        _ title: String,
        value: Binding<String>,
        key: String,
        placeholder: String,
        keyboard: UIKeyboardType = .default,
        contentType: UITextContentType? = nil,
        capitalization: TextInputAutocapitalization = .words,
        autocorrection: Bool = true
    ) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 5) {
                Text(title)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(DossierPalette.ink)
                if !requiredFields.contains(key) {
                    Text("optional")
                        .font(.caption)
                        .foregroundStyle(DossierPalette.muted)
                } else {
                    Text("required")
                        .font(.caption)
                        .foregroundStyle(DossierPalette.muted)
                }
            }
            TextField(placeholder, text: value)
                .keyboardType(keyboard)
                .textContentType(contentType)
                .textInputAutocapitalization(capitalization)
                .autocorrectionDisabled(!autocorrection)
                .padding(.horizontal, 13)
                .padding(.vertical, 12)
                .background(DossierPalette.canvas, in: RoundedRectangle(cornerRadius: 11))
                .accessibilityLabel(requiredFields.contains(key) ? "\(title), required" : "\(title), optional")
        }
    }

    private func load() async {
        guard isLoading else { return }
        do {
            let basics = try await model.fetchProfileBasics()
            baseline = basics
            draft = basics
            canEdit = true
            feedback = nil
            hasConflict = false
        } catch {
            let cached = model.profileBasics ?? model.profile.map(MobileProfileBasics.init(profile:)) ?? .empty
            baseline = cached
            draft = cached
            canEdit = true
            if let apiError = error as? MobileAPIError, apiError.statusCode == 404 {
                feedback = "This server does not support native profile editing yet. Cached basics are shown when available; your draft will stay here if saving fails."
            } else {
                feedback = "Could not load the latest profile basics. Cached values are shown when available; review them before saving. Your draft will stay here if saving fails. \(error.localizedDescription)"
            }
        }
        isLoading = false
    }

    private func save() async {
        guard hasChanges, !isSaving else { return }
        isSaving = true
        defer { isSaving = false }
        do {
            let saved = try await model.saveProfileBasics(draft, comparedTo: baseline)
            draft = saved
            baseline = saved
            feedback = nil
            hasConflict = false
            dismiss()
        } catch {
            if let apiError = error as? MobileAPIError, apiError.statusCode == 409 {
                feedback = "The profile changed on the server. Your draft is still here. Reload the latest profile before trying to save again."
                hasConflict = true
            } else if let apiError = error as? MobileAPIError, apiError.statusCode == 404 {
                feedback = "This server does not support native profile editing yet. Your draft is still here; update the server and try again."
            } else {
                feedback = "Could not save profile basics. Your draft is still here. \(error.localizedDescription)"
            }
        }
    }

    private func reloadLatestKeepingDraft() async {
        let localDraft = draft
        let previousBaseline = baseline
        isLoading = true
        defer { isLoading = false }
        do {
            let latest = try await model.fetchProfileBasics()
            var rebased = latest
            if localDraft.name != previousBaseline.name { rebased.name = localDraft.name }
            if localDraft.headline != previousBaseline.headline { rebased.headline = localDraft.headline }
            if localDraft.email != previousBaseline.email { rebased.email = localDraft.email }
            if localDraft.phone != previousBaseline.phone { rebased.phone = localDraft.phone }
            if localDraft.dob != previousBaseline.dob { rebased.dob = localDraft.dob }
            if localDraft.website != previousBaseline.website { rebased.website = localDraft.website }
            if localDraft.address != previousBaseline.address { rebased.address = localDraft.address }
            if localDraft.city != previousBaseline.city { rebased.city = localDraft.city }
            if localDraft.country != previousBaseline.country { rebased.country = localDraft.country }
            if localDraft.linkedin != previousBaseline.linkedin { rebased.linkedin = localDraft.linkedin }
            if localDraft.summary != previousBaseline.summary { rebased.summary = localDraft.summary }
            if localDraft.showAge != previousBaseline.showAge { rebased.showAge = localDraft.showAge }
            baseline = latest
            draft = rebased
            feedback = "Latest profile loaded. Your changed fields are still in the draft; review and save again."
            hasConflict = false
        } catch {
            feedback = "Could not reload the latest profile. Your draft is still here. \(error.localizedDescription)"
            hasConflict = true
        }
    }

    private static func date(fromISODate value: String) -> Date? {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.date(from: value)
    }

    private static func isoDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
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
