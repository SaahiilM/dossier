import CryptoKit
import Foundation

struct ApplicationCacheSnapshot: Codable {
    let savedAt: Date
    let items: [ApplicationRecord]
}

struct ProfileCacheSnapshot: Codable {
    let savedAt: Date
    let profile: JSONValue
}

struct CaptureCacheSnapshot: Codable {
    let savedAt: Date
    let items: [CaptureRecord]
}

struct LocalCacheStore {
    func applicationSnapshot(serverAddress: String, token: String) -> ApplicationCacheSnapshot? {
        read(ApplicationCacheSnapshot.self, name: "applications", serverAddress: serverAddress, token: token)
    }

    func profileSnapshot(serverAddress: String, token: String) -> ProfileCacheSnapshot? {
        read(ProfileCacheSnapshot.self, name: "profile", serverAddress: serverAddress, token: token)
    }

    func captureSnapshot(serverAddress: String, token: String) -> CaptureCacheSnapshot? {
        read(CaptureCacheSnapshot.self, name: "captures", serverAddress: serverAddress, token: token)
    }

    func saveApplications(_ items: [ApplicationRecord], serverAddress: String, token: String) {
        write(ApplicationCacheSnapshot(savedAt: Date(), items: items), name: "applications", serverAddress: serverAddress, token: token)
    }

    func saveProfile(_ profile: JSONValue, serverAddress: String, token: String) {
        write(ProfileCacheSnapshot(savedAt: Date(), profile: profile), name: "profile", serverAddress: serverAddress, token: token)
    }

    func saveCaptures(_ items: [CaptureRecord], serverAddress: String, token: String) {
        write(CaptureCacheSnapshot(savedAt: Date(), items: items), name: "captures", serverAddress: serverAddress, token: token)
    }

    func clear(serverAddress: String, token: String) {
        let folder = directory(serverAddress: serverAddress, token: token)
        try? FileManager.default.removeItem(at: folder)
    }

    private func read<T: Decodable>(_ type: T.Type, name: String, serverAddress: String, token: String) -> T? {
        guard let data = try? Data(contentsOf: directory(serverAddress: serverAddress, token: token).appendingPathComponent("\(name).json")) else { return nil }
        return try? MobileDateCoding.decoder().decode(type, from: data)
    }

    private func write<T: Encodable>(_ value: T, name: String, serverAddress: String, token: String) {
        let folder = directory(serverAddress: serverAddress, token: token)
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let file = folder.appendingPathComponent("\(name).json")
            try MobileDateCoding.encoder().encode(value).write(to: file, options: .atomic)
            try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: file.path)
        } catch { }
    }

    private func directory(serverAddress: String, token: String) -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        let identity = "\(serverAddress.lowercased())\n\(token)"
        let digest = SHA256.hash(data: Data(identity.utf8)).prefix(12).map { String(format: "%02x", $0) }.joined()
        return base.appendingPathComponent("Dossier/cache/\(digest)", isDirectory: true)
    }
}
