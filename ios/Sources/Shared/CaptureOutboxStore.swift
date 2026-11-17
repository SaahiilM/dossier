import CryptoKit
import Foundation
import SQLite3

enum CaptureDeliveryState: String, Codable {
    case savedLocally
    case uploading
    case retryNeeded
    case signInNeeded
    case savedToDossier
}

struct CaptureOutboxItem: Identifiable, Codable, Hashable {
    let clientRequestId: String
    var id: String { clientRequestId }
    var url: String
    var text: String?
    var note: String?
    var createdAt: Date
    var serverAddress: String
    var state: CaptureDeliveryState
    var captureId: String?
    var serverState: String?
    var lastError: String?

    var payload: CaptureCreatePayload {
        CaptureCreatePayload(url: url, text: text, note: note, clientRequestId: clientRequestId)
    }

    var shortURL: String {
        guard let components = URLComponents(string: url), let host = components.host else { return url }
        return components.path.isEmpty || components.path == "/" ? host : host + components.path
    }
}

enum OutboxStoreError: LocalizedError {
    case unavailable
    case database(String)

    var errorDescription: String? {
        switch self {
        case .unavailable: "Shared capture storage is unavailable. Save this link again after installing Dossier with its App Group enabled."
        case .database(let message): "Could not save this capture: \(message)"
        }
    }
}

/// SQLite gives the app and Share Extension transactional access to one durable App Group outbox.
final class CaptureOutboxStore {
    static let appGroupIdentifier = "group.party.sahmai.dossier"

    private let databaseURL: URL?
    private var database: OpaquePointer?

    init(fileManager: FileManager = .default) {
        if let groupURL = fileManager.containerURL(forSecurityApplicationGroupIdentifier: Self.appGroupIdentifier) {
            databaseURL = groupURL.appendingPathComponent("capture-outbox.sqlite")
        } else if Bundle.main.bundleURL.pathExtension != "appex",
                  let support = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first {
            databaseURL = support.appendingPathComponent("Dossier/capture-outbox.sqlite")
        } else {
            databaseURL = nil
        }
        openDatabase()
    }

    deinit { sqlite3_close(database) }

    @discardableResult
    func enqueue(url: String, text: String?, note: String?, serverAddress: String, now: Date = Date()) throws -> CaptureOutboxItem {
        guard let database else { throw OutboxStoreError.unavailable }
        let cleanURL = url.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanURL.isEmpty else { throw OutboxStoreError.database("The shared item did not contain a link.") }
        let cleanText = text?.trimmedOrNil
        let cleanNote = note?.trimmedOrNil
        let key = Self.dedupeKey(url: cleanURL, text: cleanText, note: cleanNote)
        try execute("BEGIN IMMEDIATE TRANSACTION", database)
        defer { try? execute("COMMIT", database) }
        if let existing = try findDuplicate(key: key, newerThan: now.addingTimeInterval(-86_400), database: database) {
            return existing
        }
        let item = CaptureOutboxItem(
            clientRequestId: UUID().uuidString.lowercased(),
            url: cleanURL,
            text: cleanText,
            note: cleanNote,
            createdAt: now,
            serverAddress: serverAddress,
            state: .savedLocally,
            captureId: nil,
            serverState: nil,
            lastError: nil
        )
        try insert(item, dedupeKey: key, database: database)
        return item
    }

    func all(serverAddress: String? = nil) -> [CaptureOutboxItem] {
        guard let database else { return [] }
        var sql = "SELECT request_id,url,text,note,created_at,server_address,state,capture_id,server_state,last_error FROM captures"
        if serverAddress != nil { sql += " WHERE server_address = ?" }
        sql += " ORDER BY created_at DESC"
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK else { return [] }
        defer { sqlite3_finalize(statement) }
        if let serverAddress { bind(serverAddress, to: 1, in: statement) }
        var items: [CaptureOutboxItem] = []
        while sqlite3_step(statement) == SQLITE_ROW {
            if let item = item(from: statement) { items.append(item) }
        }
        return items
    }

    func retryable(serverAddress: String) -> [CaptureOutboxItem] {
        all(serverAddress: serverAddress).filter { $0.state != .savedToDossier }
    }

    func markUploading(_ id: String) { update(id, state: .uploading, captureId: nil, serverState: nil, lastError: nil) }
    func markSavedLocally(_ id: String, reason: String?) { update(id, state: .savedLocally, captureId: nil, serverState: nil, lastError: reason) }
    func markNeedsSignIn(_ id: String, reason: String?) { update(id, state: .signInNeeded, captureId: nil, serverState: nil, lastError: reason) }
    func markRetryNeeded(_ id: String, reason: String?) { update(id, state: .retryNeeded, captureId: nil, serverState: nil, lastError: reason) }
    func markSavedToDossier(_ id: String, capture: CaptureRecord) {
        update(id, state: .savedToDossier, captureId: capture.id, serverState: capture.state, lastError: nil)
    }

    func recoverInterruptedUploads() {
        guard let database else { return }
        try? execute("UPDATE captures SET state='savedLocally', last_error=NULL WHERE state='uploading'", database)
    }

    func delete(_ id: String) {
        guard let database else { return }
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, "DELETE FROM captures WHERE request_id = ?", -1, &statement, nil) == SQLITE_OK else { return }
        defer { sqlite3_finalize(statement) }
        bind(id, to: 1, in: statement)
        sqlite3_step(statement)
    }

    private func openDatabase() {
        guard let databaseURL else { return }
        do {
            try FileManager.default.createDirectory(at: databaseURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        } catch { return }
        guard sqlite3_open_v2(databaseURL.path, &database, SQLITE_OPEN_CREATE | SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK,
              let database else { return }
        try? FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: databaseURL.path)
        sqlite3_busy_timeout(database, 5_000)
        try? execute("PRAGMA journal_mode=WAL", database)
        try? execute("PRAGMA synchronous=FULL", database)
        try? execute("CREATE TABLE IF NOT EXISTS captures (request_id TEXT PRIMARY KEY, dedupe_key TEXT NOT NULL, url TEXT NOT NULL, text TEXT, note TEXT, created_at REAL NOT NULL, server_address TEXT NOT NULL, state TEXT NOT NULL, capture_id TEXT, server_state TEXT, last_error TEXT)", database)
        try? execute("CREATE INDEX IF NOT EXISTS captures_dedupe_created ON captures(dedupe_key, created_at)", database)
    }

    private func insert(_ item: CaptureOutboxItem, dedupeKey: String, database: OpaquePointer) throws {
        let sql = "INSERT INTO captures(request_id,dedupe_key,url,text,note,created_at,server_address,state,capture_id,server_state,last_error) VALUES(?,?,?,?,?,?,?,?,?,?,?)"
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK else { throw databaseError(database) }
        defer { sqlite3_finalize(statement) }
        bind(item.clientRequestId, to: 1, in: statement)
        bind(dedupeKey, to: 2, in: statement)
        bind(item.url, to: 3, in: statement)
        bind(item.text, to: 4, in: statement)
        bind(item.note, to: 5, in: statement)
        sqlite3_bind_double(statement, 6, item.createdAt.timeIntervalSince1970)
        bind(item.serverAddress, to: 7, in: statement)
        bind(item.state.rawValue, to: 8, in: statement)
        bind(item.captureId, to: 9, in: statement)
        bind(item.serverState, to: 10, in: statement)
        bind(item.lastError, to: 11, in: statement)
        guard sqlite3_step(statement) == SQLITE_DONE else { throw databaseError(database) }
    }

    private func findDuplicate(key: String, newerThan date: Date, database: OpaquePointer) throws -> CaptureOutboxItem? {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, "SELECT request_id,url,text,note,created_at,server_address,state,capture_id,server_state,last_error FROM captures WHERE dedupe_key = ? AND created_at >= ? ORDER BY created_at DESC LIMIT 1", -1, &statement, nil) == SQLITE_OK else { throw databaseError(database) }
        defer { sqlite3_finalize(statement) }
        bind(key, to: 1, in: statement)
        sqlite3_bind_double(statement, 2, date.timeIntervalSince1970)
        guard sqlite3_step(statement) == SQLITE_ROW else { return nil }
        return item(from: statement)
    }

    private func update(_ id: String, state: CaptureDeliveryState, captureId: String?, serverState: String?, lastError: String?) {
        guard let database else { return }
        var statement: OpaquePointer?
        let sql = "UPDATE captures SET state=?, capture_id=?, server_state=?, last_error=? WHERE request_id=?"
        guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK else { return }
        defer { sqlite3_finalize(statement) }
        bind(state.rawValue, to: 1, in: statement)
        bind(captureId, to: 2, in: statement)
        bind(serverState, to: 3, in: statement)
        bind(lastError, to: 4, in: statement)
        bind(id, to: 5, in: statement)
        sqlite3_step(statement)
    }

    private func item(from statement: OpaquePointer?) -> CaptureOutboxItem? {
        guard let id = text(statement, 0), let url = text(statement, 1),
              let created = CaptureDeliveryState(rawValue: text(statement, 6) ?? "savedLocally") else { return nil }
        return CaptureOutboxItem(
            clientRequestId: id,
            url: url,
            text: text(statement, 2),
            note: text(statement, 3),
            createdAt: Date(timeIntervalSince1970: sqlite3_column_double(statement, 4)),
            serverAddress: text(statement, 5) ?? "",
            state: created,
            captureId: text(statement, 7),
            serverState: text(statement, 8),
            lastError: text(statement, 9)
        )
    }

    private func text(_ statement: OpaquePointer?, _ index: Int32) -> String? {
        guard sqlite3_column_type(statement, index) != SQLITE_NULL, let value = sqlite3_column_text(statement, index) else { return nil }
        return String(cString: value)
    }

    private func bind(_ value: String?, to index: Int32, in statement: OpaquePointer?) {
        guard let value else { sqlite3_bind_null(statement, index); return }
        sqlite3_bind_text(statement, index, value, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
    }

    private func execute(_ sql: String, _ database: OpaquePointer) throws {
        var message: UnsafeMutablePointer<CChar>?
        guard sqlite3_exec(database, sql, nil, nil, &message) == SQLITE_OK else {
            let detail = message.map { String(cString: $0) } ?? String(cString: sqlite3_errmsg(database))
            sqlite3_free(message)
            throw OutboxStoreError.database(detail)
        }
    }

    private func databaseError(_ database: OpaquePointer) -> OutboxStoreError {
        .database(String(cString: sqlite3_errmsg(database)))
    }

    private static func dedupeKey(url: String, text: String?, note: String?) -> String {
        let canonicalURL: String
        if var components = URLComponents(string: url) {
            components.fragment = nil
            canonicalURL = (components.url?.absoluteString ?? url).trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        } else { canonicalURL = url.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
        let normalizedText = (text ?? "").split(whereSeparator: \.isWhitespace).joined(separator: " ").lowercased()
        let normalizedNote = (note ?? "").split(whereSeparator: \.isWhitespace).joined(separator: " ").lowercased()
        let source = Data("\(canonicalURL)\n\(normalizedText)\n\(normalizedNote)".utf8)
        return SHA256.hash(data: source).map { String(format: "%02x", $0) }.joined()
    }
}

private extension String {
    var trimmedOrNil: String? {
        let value = trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? nil : value
    }
}
