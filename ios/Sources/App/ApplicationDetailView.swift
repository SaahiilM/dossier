import EventKit
import EventKitUI
import MessageUI
import SwiftUI
import UIKit

struct ApplicationDetailView: View {
    @EnvironmentObject private var model: AppModel
    let application: ApplicationRecord
    @State private var draftStatus: String
    @State private var statusBase: ApplicationRecord
    @State private var isSavingStatus = false
    @State private var statusError: String?
    @State private var statusConflictServer: ApplicationRecord?
    @State private var statusConflictNeedsReview = false
    @State private var statusConflictLoadError: String?
    @State private var calendarDraft: CalendarEventDraft?
    @State private var isShowingMailComposer = false
    @State private var notice: String?

    init(application: ApplicationRecord) {
        self.application = application
        _draftStatus = State(initialValue: application.status)
        _statusBase = State(initialValue: application)
    }

    private var currentApplication: ApplicationRecord {
        model.applications.first(where: { $0.id == application.id }) ?? application
    }

    private var emailRecipient: String? { currentApplication.contactEmail?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty }
    private var emailDraft: String? { currentApplication.emailDraft?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty }
    private var hasReviewedEmail: Bool { emailRecipient != nil && emailDraft != nil }
    private var matchItems: [MatchRequirementData] {
        guard case .object(let match)? = currentApplication.match,
              case .array(let items)? = match["items"] else { return [] }
        return items.enumerated().compactMap { index, item in
            guard case .object(let fields) = item,
                  case .string(let requirement)? = fields["requirement"],
                  case .string(let result)? = fields["result"] else { return nil }
            let skill: String?
            if case .string(let value)? = fields["skill"] { skill = value.nilIfEmpty } else { skill = nil }
            let note: String?
            if case .string(let value)? = fields["note"] { note = value.nilIfEmpty } else { note = nil }
            return MatchRequirementData(id: index, requirement: requirement, result: result, skill: skill, note: note)
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 12) {
                    StatusBadge(status: currentApplication.status)
                    Text(currentApplication.title ?? currentApplication.role)
                        .font(.system(.largeTitle, design: .serif).weight(.semibold))
                        .foregroundStyle(DossierPalette.ink)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityAddTraits(.isHeader)
                    Text(currentApplication.company)
                        .font(.title3)
                        .foregroundStyle(DossierPalette.muted)
                    if let title = currentApplication.title, title != currentApplication.role {
                        Text(currentApplication.role)
                            .font(.subheadline)
                            .foregroundStyle(DossierPalette.muted)
                    }
                    if let location = currentApplication.location, !location.isEmpty {
                        Label(location, systemImage: "mappin.and.ellipse")
                            .font(.subheadline)
                            .foregroundStyle(DossierPalette.muted)
                    }
                    if let mode = currentApplication.mode, !mode.isEmpty {
                        Label(mode, systemImage: "building.2")
                            .font(.subheadline)
                            .foregroundStyle(DossierPalette.muted)
                    }
                    if let urlString = currentApplication.url, let url = URL(string: urlString), ["http", "https"].contains(url.scheme?.lowercased() ?? "") {
                        Link(destination: url) {
                            Label("Open original posting", systemImage: "arrow.up.right.square")
                                .font(.subheadline.weight(.medium))
                        }
                        .accessibilityHint("Opens the posting in your browser. Dossier does not sign in to LinkedIn or other job sites automatically.")
                    }
                }
                .padding(20)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(DossierPalette.paper, in: RoundedRectangle(cornerRadius: 20))

                statusEditor

                if let date = currentApplication.createdAt {
                    DetailCard(title: "Started", symbol: "calendar") {
                        Text(date.formatted(date: .long, time: .omitted))
                            .font(.body).foregroundStyle(DossierPalette.ink)
                    }
                }
                if let date = currentApplication.interviewAt {
                    DetailCard(title: "Interview", symbol: "calendar.badge.clock") {
                        VStack(alignment: .leading, spacing: 12) {
                            Text(date.formatted(date: .complete, time: .shortened))
                                .font(.body).foregroundStyle(DossierPalette.ink)
                            Button(action: { requestCalendarAccess(for: date) }) {
                                Label("Add interview to Calendar", systemImage: "calendar.badge.plus")
                                    .font(.subheadline.weight(.semibold))
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                        }
                    }
                }
                if hasApplicationMetadata {
                    DetailCard(title: "Application details", symbol: "list.bullet.rectangle") {
                        VStack(alignment: .leading, spacing: 10) {
                            if let salary = currentApplication.salary?.nilIfEmpty {
                                LabeledContent("Salary", value: salary)
                            }
                            if let deadline = currentApplication.deadline?.nilIfEmpty {
                                LabeledContent("Deadline", value: deadline)
                            }
                            if let language = currentApplication.language?.nilIfEmpty {
                                LabeledContent("Language", value: language)
                            }
                            if let sentAt = currentApplication.sentAt {
                                LabeledContent("Sent", value: sentAt.formatted(date: .long, time: .shortened))
                            }
                            if let updatedAt = currentApplication.updatedAt {
                                LabeledContent("Updated", value: updatedAt.formatted(date: .long, time: .shortened))
                            }
                        }
                        .font(.subheadline)
                        .foregroundStyle(DossierPalette.ink)
                    }
                }
                ApplicationNotesSection(application: currentApplication)
                if let posting = currentApplication.descriptionText, !posting.isEmpty {
                    DetailCard(title: "Posting details", symbol: "doc.text") {
                        Text(posting).font(.body).foregroundStyle(DossierPalette.ink).textSelection(.enabled)
                    }
                }
                if !matchItems.isEmpty {
                    DetailCard(title: "Requirement match", symbol: "checkmark.seal") {
                        VStack(alignment: .leading, spacing: 14) {
                            ForEach(matchItems) { item in
                                VStack(alignment: .leading, spacing: 5) {
                                    HStack(alignment: .firstTextBaseline) {
                                        Text(item.requirement)
                                            .font(.subheadline.weight(.medium))
                                            .foregroundStyle(DossierPalette.ink)
                                        Spacer(minLength: 10)
                                        Text(item.result.capitalized)
                                            .font(.caption.weight(.semibold))
                                            .foregroundStyle(item.result == "covered" ? DossierPalette.green : DossierPalette.accent)
                                    }
                                    if let skill = item.skill {
                                        Text("Skill: \(skill)").font(.caption).foregroundStyle(DossierPalette.muted)
                                    }
                                    if let note = item.note {
                                        Text(note).font(.footnote).foregroundStyle(DossierPalette.muted)
                                    }
                                }
                                if item.id != matchItems.last?.id { Divider() }
                            }
                        }
                    }
                }
                ApplicationDocumentsSection(applicationID: currentApplication.id)
                if hasReviewedEmail {
                    emailActions
                }
                Text("Status and notes sync to Dossier. External posting actions remain under your control.")
                    .font(.footnote)
                    .foregroundStyle(DossierPalette.muted)
                    .padding(.horizontal, 4)
            }
            .padding(16)
        }
        .background(DossierPalette.canvas)
        .navigationTitle("Application")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            if let latest = await model.refreshApplicationDetail(id: application.id), !hasStatusChanges {
                statusBase = latest
                draftStatus = latest.status
            }
        }
        .sheet(item: $calendarDraft) { draft in
            CalendarEditorSheet(draft: draft) { message in notice = message }
                .ignoresSafeArea()
        }
        .sheet(isPresented: $isShowingMailComposer) {
            if let emailRecipient, let emailDraft {
                MailDraftComposer(
                    recipient: emailRecipient,
                    subject: currentApplication.emailSubject ?? "Application: \(currentApplication.role)",
                    body: emailDraft
                ) { result in
                    isShowingMailComposer = false
                    switch result {
                    case .sent: notice = "Mail composer closed. Dossier does not confirm delivery or employer submission."
                    case .saved: notice = "The draft was saved in Mail. Dossier does not confirm delivery or employer submission."
                    case .cancelled: notice = "Mail was closed without sending. The application record was not changed."
                    case .failed: notice = "Mail could not complete the draft. The application record was not changed."
                    }
                }
                .ignoresSafeArea()
            }
        }
        .alert("Application", isPresented: Binding(get: { notice != nil }, set: { if !$0 { notice = nil } })) {
            Button("OK", role: .cancel) { notice = nil }
        } message: { Text(notice ?? "") }
    }

    private var statusEditor: some View {
        DetailCard(title: "Application status", symbol: "arrow.triangle.2.circlepath") {
            VStack(alignment: .leading, spacing: 12) {
                Picker("Status", selection: $draftStatus) {
                    ForEach(ApplicationStatus.allCases) { status in
                        Text(status.title).tag(status.rawValue)
                    }
                    if !ApplicationStatus.allCases.contains(where: { $0.rawValue == draftStatus }) {
                        Text("Unknown · \(draftStatus)").tag(draftStatus)
                    }
                }
                .pickerStyle(.menu)
                .disabled(isSavingStatus)

                if statusBase.expectedUpdatedAt == nil {
                    Text("This server did not include an update time, so status changes are unavailable.")
                        .font(.footnote)
                        .foregroundStyle(DossierPalette.muted)
                }

                if let latest = statusConflictServer {
                    VStack(alignment: .leading, spacing: 8) {
                        Label("This application changed on the server", systemImage: "exclamationmark.arrow.triangle.2.circlepath")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(DossierPalette.ink)
                        Text("Latest saved status: \(statusTitle(latest.status))")
                            .font(.footnote)
                            .foregroundStyle(DossierPalette.muted)
                        Text("Your selected status is still in the picker. Review the server value before saving again.")
                            .font(.footnote)
                            .foregroundStyle(DossierPalette.muted)
                        if statusConflictNeedsReview {
                            Button("I reviewed the latest status") { statusConflictNeedsReview = false }
                                .font(.footnote.weight(.semibold))
                        }
                    }
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(DossierPalette.canvas, in: RoundedRectangle(cornerRadius: 12))
                } else if let statusConflictLoadError {
                    Text(statusConflictLoadError)
                        .font(.footnote)
                        .foregroundStyle(DossierPalette.muted)
                }

                if let statusError {
                    Text(statusError)
                        .font(.footnote)
                        .foregroundStyle(DossierPalette.accent)
                }

                HStack {
                    if statusConflictNeedsReview && statusConflictServer == nil {
                        Button("Reload latest") { Task { await reloadStatusConflict() } }
                            .font(.footnote.weight(.semibold))
                    }
                    Spacer()
                    Button {
                        Task { await saveStatus() }
                    } label: {
                        if isSavingStatus {
                            ProgressView().controlSize(.small)
                        } else {
                            Label("Save status", systemImage: "checkmark")
                        }
                    }
                    .font(.subheadline.weight(.semibold))
                    .disabled(!hasStatusChanges || isSavingStatus || statusConflictNeedsReview || statusBase.expectedUpdatedAt == nil || ApplicationStatus(rawValue: draftStatus) == nil)
                }
            }
        }
    }

    private var hasStatusChanges: Bool {
        draftStatus != statusBase.status
    }

    private func saveStatus() async {
        guard let status = ApplicationStatus(rawValue: draftStatus),
              let expectedUpdatedAt = statusBase.expectedUpdatedAt,
              hasStatusChanges,
              !isSavingStatus else { return }
        isSavingStatus = true
        statusError = nil
        defer { isSavingStatus = false }
        do {
            let updated = try await model.updateApplicationStatus(
                id: application.id,
                expectedUpdatedAt: expectedUpdatedAt,
                status: status
            )
            statusBase = updated
            draftStatus = updated.status
            statusConflictServer = nil
            statusConflictNeedsReview = false
            statusConflictLoadError = nil
        } catch let error as MobileAPIError where error.statusCode == 409 {
            await reloadStatusConflict()
        } catch {
            statusError = statusSaveError(error)
        }
    }

    private func reloadStatusConflict() async {
        statusConflictNeedsReview = true
        statusConflictServer = nil
        statusConflictLoadError = "Loading the latest server version… Your selected status remains here."
        do {
            let latest = try await model.fetchApplicationDetail(id: application.id)
            statusBase = latest
            statusConflictServer = latest
            statusConflictLoadError = nil
        } catch {
            statusConflictLoadError = "Could not load the latest version. Your selected status remains here. Reload before saving again."
        }
    }

    private func statusSaveError(_ error: Error) -> String {
        if let apiError = error as? MobileAPIError, apiError.statusCode == 404 {
            return "This server may not support application editing yet, or this application is no longer available. Your selection is still here."
        }
        return error.localizedDescription
    }

    private func statusTitle(_ value: String) -> String {
        ApplicationStatus(rawValue: value)?.title ?? value.replacingOccurrences(of: "_", with: " ").capitalized
    }

    private var hasApplicationMetadata: Bool {
        currentApplication.salary?.nilIfEmpty != nil
            || currentApplication.deadline?.nilIfEmpty != nil
            || currentApplication.language?.nilIfEmpty != nil
            || currentApplication.sentAt != nil
            || currentApplication.updatedAt != nil
    }

    @ViewBuilder
    private var emailActions: some View {
        DetailCard(title: "Reviewed email draft", symbol: "envelope") {
            VStack(alignment: .leading, spacing: 12) {
                LabeledContent("To", value: emailRecipient ?? "")
                    .font(.subheadline)
                if let subject = currentApplication.emailSubject, !subject.isEmpty {
                    LabeledContent("Subject", value: subject).font(.subheadline)
                }
                Text(emailDraft ?? "")
                    .font(.body)
                    .foregroundStyle(DossierPalette.ink)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if MFMailComposeViewController.canSendMail() {
                    Button { isShowingMailComposer = true } label: {
                        Label("Review in Mail", systemImage: "square.and.pencil")
                            .font(.subheadline.weight(.semibold))
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                } else {
                    Button {
                        let subject = currentApplication.emailSubject ?? "Application: \(currentApplication.role)"
                        UIPasteboard.general.string = "To: \(emailRecipient ?? "")\nSubject: \(subject)\n\n\(emailDraft ?? "")"
                        notice = "The reviewed email draft was copied. Mail is not configured on this device."
                    } label: {
                        Label("Copy reviewed draft", systemImage: "doc.on.doc")
                            .font(.subheadline.weight(.semibold))
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    Text("Mail is not configured on this device. Copy the draft to use another mail app.")
                        .font(.footnote).foregroundStyle(DossierPalette.muted)
                }
            }
        }
    }

    private func requestCalendarAccess(for date: Date) {
        let store = EKEventStore()
        let authorized: (Bool, Error?) -> Void = { granted, error in
            DispatchQueue.main.async {
                guard granted else {
                    notice = error?.localizedDescription ?? "Calendar access was denied. No calendar event was created."
                    return
                }
                calendarDraft = CalendarEventDraft(
                    title: "Interview · \(currentApplication.role) — \(currentApplication.company)",
                    startDate: date,
                    endDate: date.addingTimeInterval(60 * 60),
                    notes: currentApplication.url.map { "Dossier application posting: \($0)" }
                )
            }
        }
        if #available(iOS 17.0, *) {
            store.requestWriteOnlyAccessToEvents(completion: authorized)
        } else {
            store.requestAccess(to: .event, completion: authorized)
        }
    }
}

private struct ApplicationNotesSection: View {
    @EnvironmentObject private var model: AppModel
    let application: ApplicationRecord

    @State private var newNoteBody = ""
    @State private var isPostingNote = false
    @State private var noteMessage: String?
    @State private var postNeedsReview = false
    @State private var postLatestLoaded = false
    @State private var attemptedPostBody: String?
    @State private var noteIDsBeforePost: Set<String> = []
    @State private var editingNote: ApplicationNote?
    @State private var noteToDelete: ApplicationNote?
    @State private var isDeletingNote = false

    private var duplicateAfterUnconfirmedPost: Bool {
        guard let attemptedPostBody, attemptedPostBody == newNoteBody else { return false }
        return application.notes.contains { note in
            !noteIDsBeforePost.contains(note.id) && note.body == attemptedPostBody
        }
    }

    var body: some View {
        DetailCard(title: "Notes", symbol: "text.alignleft") {
            VStack(alignment: .leading, spacing: 14) {
                if let legacyNotes = application.legacyNotes?.nilIfEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Older note")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(DossierPalette.muted)
                        Text(legacyNotes)
                            .font(.body)
                            .foregroundStyle(DossierPalette.ink)
                            .textSelection(.enabled)
                        Text("This server returned a single older note format. New note editing needs a server with timeline support.")
                            .font(.caption)
                            .foregroundStyle(DossierPalette.muted)
                    }
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(DossierPalette.canvas, in: RoundedRectangle(cornerRadius: 12))
                }

                if application.notes.isEmpty && application.legacyNotes?.nilIfEmpty == nil {
                    Text("No notes yet.")
                        .font(.subheadline)
                        .foregroundStyle(DossierPalette.muted)
                }

                ForEach(Array(application.notes.enumerated()), id: \.element.id) { index, note in
                    VStack(alignment: .leading, spacing: 9) {
                        Text(note.body)
                            .font(.body)
                            .foregroundStyle(DossierPalette.ink)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .textSelection(.enabled)
                        Text("Added \(note.createdAt.formatted(date: .abbreviated, time: .shortened))" + (note.updatedAt > note.createdAt ? " · Edited \(note.updatedAt.formatted(date: .abbreviated, time: .shortened))" : ""))
                            .font(.caption)
                            .foregroundStyle(DossierPalette.muted)
                        HStack(spacing: 18) {
                            Button("Edit") { editingNote = note }
                                .font(.footnote.weight(.semibold))
                                .disabled(isDeletingNote)
                            Button("Delete", role: .destructive) { noteToDelete = note }
                                .font(.footnote.weight(.semibold))
                                .disabled(isDeletingNote)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    if index < application.notes.count - 1 { Divider() }
                }

                VStack(alignment: .leading, spacing: 8) {
                    Text("Add a note")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(DossierPalette.ink)
                    TextEditor(text: $newNoteBody)
                        .frame(minHeight: 100)
                        .padding(6)
                        .scrollContentBackground(.hidden)
                        .background(DossierPalette.canvas, in: RoundedRectangle(cornerRadius: 12))
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(DossierPalette.ink.opacity(0.08)))
                        .accessibilityLabel("New note")

                    if postNeedsReview {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(duplicateAfterUnconfirmedPost
                                 ? "A new note with this text is already in the refreshed timeline. The draft is still here; clear it to avoid adding a duplicate."
                                 : "The note request did not complete clearly. Your draft is still here. Review the refreshed timeline before another attempt.")
                                .font(.footnote)
                                .foregroundStyle(DossierPalette.muted)
                            if postLatestLoaded {
                                if duplicateAfterUnconfirmedPost {
                                    Button("Clear draft") {
                                        newNoteBody = ""
                                        postNeedsReview = false
                                        attemptedPostBody = nil
                                    }
                                    .font(.footnote.weight(.semibold))
                                } else {
                                    Button("I reviewed the timeline") { postNeedsReview = false }
                                        .font(.footnote.weight(.semibold))
                                }
                            } else {
                                Button("Reload latest timeline") { Task { await reloadAfterUnconfirmedPost() } }
                                    .font(.footnote.weight(.semibold))
                            }
                        }
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(DossierPalette.canvas, in: RoundedRectangle(cornerRadius: 12))
                    }

                    if let noteMessage {
                        Text(noteMessage)
                            .font(.footnote)
                            .foregroundStyle(DossierPalette.muted)
                    }

                    HStack {
                        Spacer()
                        Button {
                            Task { await addNote() }
                        } label: {
                            if isPostingNote {
                                ProgressView().controlSize(.small)
                            } else {
                                Label("Add note", systemImage: "plus")
                            }
                        }
                        .font(.subheadline.weight(.semibold))
                        .disabled(isPostingNote || newNoteBody.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || postNeedsReview || duplicateAfterUnconfirmedPost)
                    }
                }
            }
        }
        .sheet(item: $editingNote) { note in
            ApplicationNoteEditorSheet(applicationID: application.id, note: note)
                .environmentObject(model)
        }
        .confirmationDialog(
            "Delete this note?",
            isPresented: Binding(get: { noteToDelete != nil }, set: { if !$0 { noteToDelete = nil } }),
            titleVisibility: .visible
        ) {
            Button("Delete note", role: .destructive) {
                guard let note = noteToDelete else { return }
                noteToDelete = nil
                Task { await deleteNote(note) }
            }
            Button("Cancel", role: .cancel) { noteToDelete = nil }
        } message: {
            Text("This removes the note from the timeline.")
        }
    }

    private func addNote() async {
        let body = newNoteBody.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty, !isPostingNote, !postNeedsReview, !duplicateAfterUnconfirmedPost else { return }
        isPostingNote = true
        noteMessage = nil
        let previousIDs = Set(application.notes.map(\.id))
        defer { isPostingNote = false }
        do {
            _ = try await model.createApplicationNote(id: application.id, body: body)
            newNoteBody = ""
            attemptedPostBody = nil
            postNeedsReview = false
            noteMessage = nil
        } catch {
            attemptedPostBody = body
            noteIDsBeforePost = previousIDs
            postNeedsReview = true
            postLatestLoaded = false
            if let apiError = error as? MobileAPIError, apiError.statusCode == 404 {
                noteMessage = "This server may not support note timelines yet. Your note draft is still here."
            } else if let apiError = error as? MobileAPIError, apiError.statusCode == 409 {
                noteMessage = "The server rejected this note request. Your draft is still here; the latest timeline is being loaded."
            } else {
                noteMessage = "We could not confirm whether the note was saved. Your draft is still here; the latest timeline is being loaded."
            }
            await reloadAfterUnconfirmedPost()
        }
    }

    private func reloadAfterUnconfirmedPost() async {
        do {
            _ = try await model.fetchApplicationDetail(id: application.id)
            postLatestLoaded = true
        } catch {
            postLatestLoaded = false
            noteMessage = "Could not refresh the timeline. Your note draft is still here. Reload before trying again."
        }
    }

    private func deleteNote(_ note: ApplicationNote) async {
        guard !isDeletingNote else { return }
        isDeletingNote = true
        noteMessage = nil
        defer { isDeletingNote = false }
        do {
            try await model.deleteApplicationNote(id: application.id, noteID: note.id, expectedUpdatedAt: note.expectedUpdatedAt)
            noteMessage = "Note deleted."
        } catch let error as MobileAPIError where error.statusCode == 409 {
            do {
                _ = try await model.fetchApplicationDetail(id: application.id)
                noteMessage = "This note changed on the server. The latest timeline is loaded; review it before deleting again."
            } catch {
                noteMessage = "This note changed on the server. Your timeline could not be refreshed, so it was not deleted."
            }
        } catch {
            noteMessage = noteMutationError(error, action: "delete")
        }
    }

    private func noteMutationError(_ error: Error, action: String) -> String {
        if let apiError = error as? MobileAPIError, apiError.statusCode == 404 {
            return "This server may not support note editing yet, or the note is no longer available."
        }
        return "Could not \(action) this note: \(error.localizedDescription)"
    }
}

private struct ApplicationNoteEditorSheet: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    let applicationID: String
    @State private var draftBody: String
    @State private var baseNote: ApplicationNote
    @State private var latestNote: ApplicationNote?
    @State private var needsReview = false
    @State private var isSaving = false
    @State private var message: String?

    init(applicationID: String, note: ApplicationNote) {
        self.applicationID = applicationID
        _draftBody = State(initialValue: note.body)
        _baseNote = State(initialValue: note)
    }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 14) {
                if let latestNote {
                    VStack(alignment: .leading, spacing: 8) {
                        Label("This note changed on the server", systemImage: "exclamationmark.arrow.triangle.2.circlepath")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(DossierPalette.ink)
                        Text("Latest saved note")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(DossierPalette.muted)
                        Text(latestNote.body)
                            .font(.body)
                            .foregroundStyle(DossierPalette.ink)
                            .textSelection(.enabled)
                        if needsReview {
                            Button("I reviewed the latest note") { needsReview = false }
                                .font(.footnote.weight(.semibold))
                        }
                    }
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(DossierPalette.canvas, in: RoundedRectangle(cornerRadius: 12))
                }

                Text("Your draft")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(DossierPalette.ink)
                TextEditor(text: $draftBody)
                    .frame(minHeight: 180)
                    .padding(8)
                    .scrollContentBackground(.hidden)
                    .background(DossierPalette.canvas, in: RoundedRectangle(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(DossierPalette.ink.opacity(0.08)))
                    .accessibilityLabel("Edit note")

                if let message {
                    Text(message)
                        .font(.footnote)
                        .foregroundStyle(DossierPalette.muted)
                }
                if needsReview && latestNote == nil {
                    Button("Reload latest note") { Task { await reloadConflict() } }
                        .font(.footnote.weight(.semibold))
                }
                Spacer(minLength: 0)
            }
            .padding(16)
            .background(DossierPalette.paper)
            .navigationTitle("Edit note")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .disabled(isSaving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task { await save() }
                    } label: {
                        if isSaving { ProgressView().controlSize(.small) } else { Text("Save") }
                    }
                    .disabled(isSaving || needsReview || baseNote.body == draftBody || draftBody.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
    }

    private func save() async {
        let body = draftBody.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty, body != baseNote.body, !needsReview, !isSaving else { return }
        isSaving = true
        message = nil
        defer { isSaving = false }
        do {
            _ = try await model.updateApplicationNote(
                id: applicationID,
                noteID: baseNote.id,
                body: body,
                expectedUpdatedAt: baseNote.expectedUpdatedAt
            )
            dismiss()
        } catch let error as MobileAPIError where error.statusCode == 409 {
            await reloadConflict()
        } catch {
            if let apiError = error as? MobileAPIError, apiError.statusCode == 404 {
                message = "This server may not support note editing yet, or this note is no longer available. Your draft is still here."
            } else {
                message = "Could not save this note. Your draft is still here. \(error.localizedDescription)"
            }
        }
    }

    private func reloadConflict() async {
        needsReview = true
        latestNote = nil
        message = "Loading the latest note… Your edit remains in the draft."
        do {
            let latestApplication = try await model.fetchApplicationDetail(id: applicationID)
            guard let note = latestApplication.notes.first(where: { $0.id == baseNote.id }) else {
                message = "This note was removed on the server. Your draft is still here, but it cannot be saved to the removed note."
                return
            }
            baseNote = note
            latestNote = note
            message = "Compare the latest note with your draft before saving again."
        } catch {
            message = "Could not load the latest note. Your edit remains here. Reload the application before trying again."
        }
    }
}

private struct MatchRequirementData: Identifiable {
    let id: Int
    let requirement: String
    let result: String
    let skill: String?
    let note: String?
}

private struct DetailCard<Content: View>: View {
    let title: String
    let symbol: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label(title, systemImage: symbol)
                .font(.headline)
                .foregroundStyle(DossierPalette.ink)
                .accessibilityAddTraits(.isHeader)
            content
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(DossierPalette.paper, in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(DossierPalette.ink.opacity(0.07)))
    }
}

private struct CalendarEventDraft: Identifiable {
    let id = UUID()
    let title: String
    let startDate: Date
    let endDate: Date
    let notes: String?
}

private struct CalendarEditorSheet: UIViewControllerRepresentable {
    let draft: CalendarEventDraft
    let onComplete: (String) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onComplete: onComplete) }

    func makeUIViewController(context: Context) -> EKEventEditViewController {
        let store = EKEventStore()
        let event = EKEvent(eventStore: store)
        event.title = draft.title
        event.startDate = draft.startDate
        event.endDate = draft.endDate
        event.notes = draft.notes
        event.calendar = store.defaultCalendarForNewEvents
        let controller = EKEventEditViewController()
        controller.eventStore = store
        controller.event = event
        controller.editViewDelegate = context.coordinator
        controller.title = "Review interview"
        return controller
    }

    func updateUIViewController(_ uiViewController: EKEventEditViewController, context: Context) { }

    final class Coordinator: NSObject, EKEventEditViewDelegate {
        let onComplete: (String) -> Void
        init(onComplete: @escaping (String) -> Void) { self.onComplete = onComplete }

        func eventEditViewController(_ controller: EKEventEditViewController, didCompleteWith action: EKEventEditViewAction) {
            let message: String
            switch action {
            case .saved: message = "The interview was added to this device’s calendar. It was not uploaded to Dossier."
            case .deleted: message = "The calendar event was removed on this device. Your Dossier application record was not changed."
            case .canceled: message = "Calendar editing was canceled. No event was added."
            @unknown default: message = "Calendar editing ended. Your Dossier application record was not changed."
            }
            controller.dismiss(animated: true) { self.onComplete(message) }
        }
    }
}

private enum MailComposerResult { case sent, saved, cancelled, failed }

private struct MailDraftComposer: UIViewControllerRepresentable {
    let recipient: String
    let subject: String
    let body: String
    let onComplete: (MailComposerResult) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onComplete: onComplete) }

    func makeUIViewController(context: Context) -> MFMailComposeViewController {
        let controller = MFMailComposeViewController()
        controller.setToRecipients([recipient])
        controller.setSubject(subject)
        controller.setMessageBody(body, isHTML: false)
        controller.mailComposeDelegate = context.coordinator
        return controller
    }

    func updateUIViewController(_ uiViewController: MFMailComposeViewController, context: Context) { }

    final class Coordinator: NSObject, MFMailComposeViewControllerDelegate {
        let onComplete: (MailComposerResult) -> Void
        init(onComplete: @escaping (MailComposerResult) -> Void) { self.onComplete = onComplete }

        func mailComposeController(_ controller: MFMailComposeViewController, didFinishWith result: MFMailComposeResult, error: Error?) {
            let outcome: MailComposerResult
            switch result {
            case .sent: outcome = .sent
            case .saved: outcome = .saved
            case .cancelled: outcome = .cancelled
            case .failed: outcome = .failed
            @unknown default: outcome = .failed
            }
            controller.dismiss(animated: true) { self.onComplete(outcome) }
        }
    }
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}
