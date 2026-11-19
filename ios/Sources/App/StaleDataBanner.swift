import SwiftUI

struct StaleDataBanner: View {
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
