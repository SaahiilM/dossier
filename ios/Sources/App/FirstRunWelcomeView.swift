import SwiftUI

struct FirstRunWelcomeView: View {
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
