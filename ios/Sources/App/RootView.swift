import SwiftUI

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
