import SwiftUI

struct ProfileView: View {
    @EnvironmentObject private var model: AppModel
    @State private var serverAddress = ""
    @State private var isShowingSignOut = false
    @State private var isProfileBasicsPresented = false
    @State private var isAboutPresented = false

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
                    Button { isAboutPresented = true } label: { Image(systemName: "info.circle") }
                        .accessibilityLabel("About Dossier")
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
        .sheet(isPresented: $isAboutPresented) {
            AboutView(serverAddress: model.serverAddress)
        }
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
