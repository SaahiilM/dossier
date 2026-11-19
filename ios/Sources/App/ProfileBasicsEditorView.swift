import SwiftUI
import UIKit

struct ProfileBasicsEditorView: View {
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
