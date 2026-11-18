import SwiftUI

struct WorkspaceTabs: View {
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
