import SwiftUI

struct EmptyStateView: View {
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
