import Foundation

enum MobileDateCoding {
    static func decoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let value = try container.decode(String.self)
            guard let date = parse(value) else {
                throw DecodingError.dataCorruptedError(in: container, debugDescription: "Expected an ISO-8601 date in UTC.")
            }
            return date
        }
        return decoder
    }

    static func encoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .custom { date, encoder in
            var container = encoder.singleValueContainer()
            try container.encode(isoString(date))
        }
        return encoder
    }

    static func parse(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: value) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: value)
    }

    static func isoString(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        return formatter.string(from: date)
    }
}

struct LoginResponse: Decodable {
    let accessToken: String
    let expiresAt: Date
}

struct LogoutResponse: Decodable {
    let ok: Bool
}

struct ApplicationPage: Decodable {
    let items: [ApplicationRecord]
    let nextCursor: String?
}

struct CapturePage: Decodable {
    let items: [CaptureRecord]
    let nextCursor: String?
}

struct ApplicationEnvelope: Decodable {
    let application: ApplicationRecord
}

struct ApplicationNoteEnvelope: Decodable {
    let note: ApplicationNote
}

struct ApplicationNoteDeleteResponse: Decodable {
    let ok: Bool
}

enum ApplicationStatus: String, Codable, CaseIterable, Identifiable {
    case draft = "DRAFT"
    case sent = "SENT"
    case screening = "SCREENING"
    case interview = "INTERVIEW"
    case offer = "OFFER"
    case accepted = "ACCEPTED"
    case rejected = "REJECTED"
    case declined = "DECLINED"

    var id: String { rawValue }

    var title: String {
        rawValue.lowercased().capitalized
    }
}

struct ApplicationUpdatePayload: Encodable {
    let expectedUpdatedAt: String
    let status: ApplicationStatus
}

struct ApplicationNoteCreatePayload: Encodable {
    let body: String
}

struct ApplicationNoteUpdatePayload: Encodable {
    let body: String
    let expectedUpdatedAt: String
}

struct ApplicationNoteDeletePayload: Encodable {
    let expectedUpdatedAt: String
}

struct ApplicationNote: Codable, Identifiable, Hashable {
    var id: String
    var body: String
    var createdAt: Date
    var updatedAt: Date
    var updatedAtString: String?

    enum CodingKeys: String, CodingKey {
        case id, body, createdAt, updatedAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        body = try c.decode(String.self, forKey: .body)
        createdAt = try c.decode(Date.self, forKey: .createdAt)
        updatedAt = try c.decode(Date.self, forKey: .updatedAt)
        updatedAtString = try c.decodeIfPresent(String.self, forKey: .updatedAt)
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(body, forKey: .body)
        try c.encode(createdAt, forKey: .createdAt)
        if let updatedAtString {
            try c.encode(updatedAtString, forKey: .updatedAt)
        } else {
            try c.encode(updatedAt, forKey: .updatedAt)
        }
    }

    var expectedUpdatedAt: String {
        updatedAtString ?? MobileDateCoding.isoString(updatedAt)
    }
}

struct ProfileEnvelope: Decodable {
    let profile: JSONValue
}

struct MobileSetupStatus: Decodable, Equatable {
    let profileReady: Bool
    let aiConfigured: Bool
    let setupInProgress: Bool
}

struct CaptureEnvelope: Decodable {
    let capture: CaptureRecord
}

struct CaptureRecord: Codable, Identifiable {
    var id: String
    var url: String
    var text: String
    var note: String
    var state: String
    var canonicalEmployerUrl: String
    var createdAt: Date
    var updatedAt: Date

    enum CodingKeys: String, CodingKey {
        case id, url, text, note, state, canonicalEmployerUrl, createdAt, updatedAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        url = try c.decode(String.self, forKey: .url)
        text = try c.decode(String.self, forKey: .text)
        note = try c.decode(String.self, forKey: .note)
        state = try c.decode(String.self, forKey: .state)
        canonicalEmployerUrl = try c.decode(String.self, forKey: .canonicalEmployerUrl)
        createdAt = try c.decode(Date.self, forKey: .createdAt)
        updatedAt = try c.decode(Date.self, forKey: .updatedAt)
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(url, forKey: .url)
        try c.encode(text, forKey: .text)
        try c.encode(note, forKey: .note)
        try c.encode(state, forKey: .state)
        try c.encode(canonicalEmployerUrl, forKey: .canonicalEmployerUrl)
        try c.encode(createdAt, forKey: .createdAt)
        try c.encode(updatedAt, forKey: .updatedAt)
    }
}

struct ApplicationRecord: Codable, Identifiable, Hashable {
    var id: String
    var title: String?
    var company: String
    var role: String
    var status: String
    var location: String?
    var mode: String?
    var salary: String?
    var archived: Bool?
    var deadline: String?
    var url: String?
    var descriptionText: String?
    var notes: [ApplicationNote]
    var legacyNotes: String?
    var createdAt: Date?
    var sentAt: Date?
    var updatedAt: Date?
    var updatedAtString: String?
    var interviewAt: Date?
    var language: String?
    var score: Int?
    var extracted: JSONValue?
    var match: JSONValue?
    var contactEmail: String?
    var emailSubject: String?
    var emailDraft: String?

    enum CodingKeys: String, CodingKey {
        case id, applicationId, company, companyName, employer, role, title, jobTitle, position
        case status, stage, applicationStatus, location, mode, salary, archived, deadline
        case url, jobUrl, postingUrl, description, postingText, notes, createdAt, appliedAt, sentAt
        case updatedAt, interviewAt, interviewDate, nextInterviewAt, language, score, extracted, match
        case contactEmail, recipientEmail, email, emailSubject, draftSubject, emailDraft, messageDraft
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(String.self, forKey: .id)
            ?? c.decodeIfPresent(String.self, forKey: .applicationId)
            ?? ""
        company = try c.decodeIfPresent(String.self, forKey: .company)
            ?? c.decodeIfPresent(String.self, forKey: .companyName)
            ?? c.decodeIfPresent(String.self, forKey: .employer)
            ?? "Company"
        title = try c.decodeIfPresent(String.self, forKey: .title)
        role = try c.decodeIfPresent(String.self, forKey: .role)
            ?? c.decodeIfPresent(String.self, forKey: .title)
            ?? c.decodeIfPresent(String.self, forKey: .jobTitle)
            ?? c.decodeIfPresent(String.self, forKey: .position)
            ?? "Role not specified"
        status = try c.decodeIfPresent(String.self, forKey: .status)
            ?? c.decodeIfPresent(String.self, forKey: .stage)
            ?? c.decodeIfPresent(String.self, forKey: .applicationStatus)
            ?? "Unknown"
        location = try c.decodeIfPresent(String.self, forKey: .location)
        mode = try c.decodeIfPresent(String.self, forKey: .mode)
        salary = try c.decodeIfPresent(String.self, forKey: .salary)
        archived = try c.decodeIfPresent(Bool.self, forKey: .archived)
        deadline = try c.decodeIfPresent(String.self, forKey: .deadline)
        url = try c.decodeIfPresent(String.self, forKey: .url)
            ?? c.decodeIfPresent(String.self, forKey: .jobUrl)
            ?? c.decodeIfPresent(String.self, forKey: .postingUrl)
        descriptionText = try c.decodeIfPresent(String.self, forKey: .description)
            ?? c.decodeIfPresent(String.self, forKey: .postingText)
        if c.contains(.notes), (try? c.decodeNil(forKey: .notes)) != true {
            if let entries = try? c.decode([ApplicationNote].self, forKey: .notes) {
                notes = entries
                legacyNotes = nil
            } else {
                notes = []
                legacyNotes = try? c.decode(String.self, forKey: .notes)
            }
        } else {
            notes = []
            legacyNotes = nil
        }
        createdAt = try c.decodeIfPresent(Date.self, forKey: .createdAt)
            ?? c.decodeIfPresent(Date.self, forKey: .appliedAt)
        sentAt = try c.decodeIfPresent(Date.self, forKey: .sentAt)
        updatedAt = try c.decodeIfPresent(Date.self, forKey: .updatedAt)
        updatedAtString = try c.decodeIfPresent(String.self, forKey: .updatedAt)
        interviewAt = try c.decodeIfPresent(Date.self, forKey: .interviewAt)
            ?? c.decodeIfPresent(Date.self, forKey: .nextInterviewAt)
            ?? c.decodeIfPresent(Date.self, forKey: .interviewDate)
        language = try c.decodeIfPresent(String.self, forKey: .language)
        score = try c.decodeIfPresent(Int.self, forKey: .score)
        extracted = try c.decodeIfPresent(JSONValue.self, forKey: .extracted)
        match = try c.decodeIfPresent(JSONValue.self, forKey: .match)
        contactEmail = try c.decodeIfPresent(String.self, forKey: .contactEmail)
            ?? c.decodeIfPresent(String.self, forKey: .recipientEmail)
            ?? c.decodeIfPresent(String.self, forKey: .email)
        emailSubject = try c.decodeIfPresent(String.self, forKey: .emailSubject)
            ?? c.decodeIfPresent(String.self, forKey: .draftSubject)
        emailDraft = try c.decodeIfPresent(String.self, forKey: .emailDraft)
            ?? c.decodeIfPresent(String.self, forKey: .messageDraft)
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encodeIfPresent(title, forKey: .title)
        try c.encode(company, forKey: .company)
        try c.encode(role, forKey: .role)
        try c.encode(status, forKey: .status)
        try c.encodeIfPresent(location, forKey: .location)
        try c.encodeIfPresent(mode, forKey: .mode)
        try c.encodeIfPresent(salary, forKey: .salary)
        try c.encodeIfPresent(archived, forKey: .archived)
        try c.encodeIfPresent(deadline, forKey: .deadline)
        try c.encodeIfPresent(url, forKey: .url)
        try c.encodeIfPresent(descriptionText, forKey: .description)
        if let legacyNotes, notes.isEmpty {
            try c.encode(legacyNotes, forKey: .notes)
        } else {
            try c.encode(notes, forKey: .notes)
        }
        try c.encodeIfPresent(createdAt, forKey: .createdAt)
        try c.encodeIfPresent(sentAt, forKey: .sentAt)
        if let updatedAtString {
            try c.encode(updatedAtString, forKey: .updatedAt)
        } else {
            try c.encodeIfPresent(updatedAt, forKey: .updatedAt)
        }
        try c.encodeIfPresent(interviewAt, forKey: .interviewAt)
        try c.encodeIfPresent(language, forKey: .language)
        try c.encodeIfPresent(score, forKey: .score)
        try c.encodeIfPresent(extracted, forKey: .extracted)
        try c.encodeIfPresent(match, forKey: .match)
        try c.encodeIfPresent(contactEmail, forKey: .contactEmail)
        try c.encodeIfPresent(emailSubject, forKey: .emailSubject)
        try c.encodeIfPresent(emailDraft, forKey: .emailDraft)
    }

    static func == (lhs: ApplicationRecord, rhs: ApplicationRecord) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }

    var expectedUpdatedAt: String? {
        updatedAtString ?? updatedAt.map(MobileDateCoding.isoString)
    }
}

indirect enum JSONValue: Decodable, Encodable, Hashable {
    case object([String: JSONValue])
    case array([JSONValue])
    case string(String)
    case number(Double)
    case bool(Bool)
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() { self = .null }
        else if let value = try? container.decode(Bool.self) { self = .bool(value) }
        else if let value = try? container.decode(Double.self) { self = .number(value) }
        else if let value = try? container.decode(String.self) { self = .string(value) }
        else if let value = try? container.decode([JSONValue].self) { self = .array(value) }
        else { self = .object(try container.decode([String: JSONValue].self)) }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .object(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .string(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .bool(let value): try container.encode(value)
        case .null: try container.encodeNil()
        }
    }

    var displayText: String {
        switch self {
        case .string(let value): value
        case .number(let value): value.formatted()
        case .bool(let value): value ? "Yes" : "No"
        case .null: "Not provided"
        case .array(let values): values.map(\.displayText).filter { $0 != "Not provided" }.joined(separator: ", ")
        case .object: ""
        }
    }
}

struct APIErrorEnvelope: Decodable {
    struct Detail: Decodable { let code: String; let message: String }
    let error: Detail
}

enum MobileAPIError: LocalizedError {
    case invalidServerURL
    case missingSession
    case expiredSession
    case server(code: String, message: String, status: Int)
    case network(String)
    case invalidResponse
    case encoding

    var statusCode: Int? {
        if case .server(_, _, let status) = self { return status }
        return nil
    }

    var errorDescription: String? {
        switch self {
        case .invalidServerURL: "Enter a valid server address using HTTPS."
        case .missingSession: "Sign in to continue."
        case .expiredSession: "Your Dossier session expired. Sign in again to continue."
        case .server(_, let message, _): message
        case .network(let message): message
        case .invalidResponse: "Dossier returned a response the app could not read. Try again later."
        case .encoding: "Dossier could not prepare this request. Try again."
        }
    }
}
