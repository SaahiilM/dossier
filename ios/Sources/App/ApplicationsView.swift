import SwiftUI

struct ApplicationsView: View {
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
