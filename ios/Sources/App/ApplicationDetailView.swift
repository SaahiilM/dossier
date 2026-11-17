import EventKit
import EventKitUI
import MessageUI
import SwiftUI
import UIKit

struct ApplicationDetailView: View {
    @EnvironmentObject private var model: AppModel
    let application: ApplicationRecord
    @State private var calendarDraft: CalendarEventDraft?
    @State private var isShowingMailComposer = false
    @State private var notice: String?

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
                if let notes = currentApplication.notes, !notes.isEmpty {
                    DetailCard(title: "Notes", symbol: "text.alignleft") {
                        Text(notes).font(.body).foregroundStyle(DossierPalette.ink).textSelection(.enabled)
                    }
                }
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
                if hasReviewedEmail {
                    emailActions
                }
                Text("Dossier’s application status is read-only in this beta. External posting actions remain under your control.")
                    .font(.footnote)
                    .foregroundStyle(DossierPalette.muted)
                    .padding(.horizontal, 4)
            }
            .padding(16)
        }
        .background(DossierPalette.canvas)
        .navigationTitle("Application")
        .navigationBarTitleDisplayMode(.inline)
        .task { await model.refreshApplicationDetail(id: application.id) }
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
