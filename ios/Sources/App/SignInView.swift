import SwiftUI

struct SignInView: View {
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
