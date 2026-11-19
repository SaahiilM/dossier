import SwiftUI
import UIKit

struct ProfileValueView: View {
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
