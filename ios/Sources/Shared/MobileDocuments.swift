import Foundation

enum MobileDocumentKind: String, Decodable, CaseIterable, Identifiable, Equatable {
    case resume
    case coverLetter = "cover-letter"

    var id: String { rawValue }

    var title: String {
        switch self {
        case .resume: "Resume"
        case .coverLetter: "Cover letter"
        }
    }
}

struct MobileApplicationDocumentsEnvelope: Decodable {
    let applicationId: String
    let documents: MobileApplicationDocuments
}

struct MobileApplicationDocuments: Decodable {
    let resume: MobileSavedDocument?
    let coverLetter: MobileSavedDocument?

    var available: [MobileSavedDocument] {
        [resume, coverLetter].compactMap { $0 }
    }
}

struct MobileSavedDocument: Decodable, Identifiable {
    let id: String
    let kind: MobileDocumentKind
    let label: String
    let updatedAt: Date
    let currentVersionId: String?
    let units: [MobileDocumentUnit]
}

struct MobileDocumentUnit: Decodable, Identifiable {
    let id: String
    let label: String
    let text: String
    let unverified: Bool?

    var hasUnverifiedContent: Bool { unverified == true }
}

struct MobilePDFResponse {
    let data: Data
    let suggestedFilename: String?
}
