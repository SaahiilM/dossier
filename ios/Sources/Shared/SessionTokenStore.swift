import Foundation
import Security

struct StoredSession: Codable {
    let accessToken: String
    let expiresAt: Date
}

struct SessionTokenStore {
    private let service = "party.sahmai.dossier.mobile-session"
    private let account = "access-token"
    private var accessGroup: String? {
        Bundle.main.object(forInfoDictionaryKey: "DossierSharedKeychainGroup") as? String
    }

    func load() -> StoredSession? {
        guard let data = read(accessGroup: accessGroup) ?? read(accessGroup: nil),
              let session = try? MobileDateCoding.decoder().decode(StoredSession.self, from: data),
              session.expiresAt > Date() else {
            clear()
            return nil
        }
        return session
    }

    @discardableResult
    func save(_ session: StoredSession) -> Bool {
        guard let data = try? MobileDateCoding.encoder().encode(session) else { return false }
        let primary = write(data, accessGroup: accessGroup)
        if primary { return true }
        // Simulator builds without a signed shared access group can still exercise the main app.
        // A signed beta uses the shared group so the extension can read the same token.
        return write(data, accessGroup: nil)
    }

    func clear() {
        delete(accessGroup: accessGroup)
        delete(accessGroup: nil)
    }

    private func read(accessGroup: String?) -> Data? {
        var query = baseQuery(accessGroup: accessGroup)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess else { return nil }
        return result as? Data
    }

    private func write(_ data: Data, accessGroup: String?) -> Bool {
        let query = baseQuery(accessGroup: accessGroup)
        let attributes: [String: Any] = [kSecValueData as String: data, kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        SecItemDelete(query as CFDictionary)
        var item = query
        attributes.forEach { item[$0.key] = $0.value }
        return SecItemAdd(item as CFDictionary, nil) == errSecSuccess
    }

    private func delete(accessGroup: String?) {
        SecItemDelete(baseQuery(accessGroup: accessGroup) as CFDictionary)
    }

    private func baseQuery(accessGroup: String?) -> [String: Any] {
        var query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
        if let accessGroup, !accessGroup.isEmpty { query[kSecAttrAccessGroup as String] = accessGroup }
        return query
    }
}
