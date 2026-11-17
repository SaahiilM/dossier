import Foundation
import SwiftUI
import UIKit

@MainActor
final class AppModel: ObservableObject {
    static let defaultServerAddress = MobileAPIClient.defaultServerAddress
    private static let serverAddressKey = "dossier.mobile.server-address"

    @Published private(set) var session: StoredSession?
    @Published private(set) var applications: [ApplicationRecord] = []
    @Published private(set) var profile: JSONValue?
    @Published private(set) var captureItems: [CaptureOutboxItem] = []
    @Published private(set) var serverCaptures: [CaptureRecord] = []
    @Published private(set) var nextCursor: String?
    @Published private(set) var nextCaptureCursor: String?
    @Published private(set) var isLoading = false
    @Published private(set) var isLoadingMore = false
    @Published private(set) var isLoadingCaptures = false
    @Published private(set) var isLoadingMoreCaptures = false
    @Published private(set) var isRefreshingProfile = false
    @Published private(set) var isSigningIn = false
    @Published private(set) var isSyncingCaptures = false
    @Published private(set) var applicationsSavedAt: Date?
    @Published private(set) var profileSavedAt: Date?
    @Published private(set) var capturesSavedAt: Date?
    @Published var errorMessage: String?
    @Published var serverAddress: String

    private let tokenStore = SessionTokenStore()
    private let cacheStore = LocalCacheStore()
    let outboxStore = CaptureOutboxStore()
    private let sharedDefaults = UserDefaults(suiteName: CaptureOutboxStore.appGroupIdentifier)
    private let defaults = UserDefaults.standard

    init() {
        let address = defaults.string(forKey: Self.serverAddressKey) ?? Self.defaultServerAddress
        serverAddress = address
        sharedDefaults?.set(address, forKey: Self.serverAddressKey)
        session = tokenStore.load()
        outboxStore.recoverInterruptedUploads()
        reloadOutbox()
        if let session {
            restoreCache(for: session)
        }
    }

    var isSignedIn: Bool { session != nil }

    func signIn(password: String) async {
        errorMessage = nil
        isSigningIn = true
        defer { isSigningIn = false }
        do {
            let client = try MobileAPIClient(serverAddress: serverAddress)
            let response = try await client.login(password: password, deviceName: UIDevice.current.localizedModel)
            guard !response.accessToken.isEmpty, response.expiresAt > Date() else {
                throw MobileAPIError.invalidResponse
            }
            let newSession = StoredSession(accessToken: response.accessToken, expiresAt: response.expiresAt)
            guard tokenStore.save(newSession) else {
                throw MobileAPIError.network("The sign-in token could not be stored in Keychain. Check the app's Keychain entitlement and try again.")
            }
            session = newSession
            restoreCache(for: newSession)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func signOut() async {
        guard let session else { return }
        do {
            let client = try MobileAPIClient(serverAddress: serverAddress)
            try await client.logout(token: session.accessToken)
        } catch {
            // Local sign-out still removes the credential. Explain that server revocation failed.
            errorMessage = "This device is signed out. The server could not confirm session revocation: \(error.localizedDescription)"
        }
        cacheStore.clear(serverAddress: serverAddress, token: session.accessToken)
        tokenStore.clear()
        self.session = nil
        applications = []
        profile = nil
        applicationsSavedAt = nil
        profileSavedAt = nil
        serverCaptures = []
        capturesSavedAt = nil
        nextCursor = nil
        nextCaptureCursor = nil
        reloadOutbox()
    }

    func updateServerAddress(_ value: String) {
        let cleaned = value.trimmingCharacters(in: .whitespacesAndNewlines).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        do { _ = try MobileAPIClient(serverAddress: cleaned) }
        catch { errorMessage = error.localizedDescription; return }
        guard cleaned != serverAddress else { return }
        if let session {
            cacheStore.clear(serverAddress: serverAddress, token: session.accessToken)
            tokenStore.clear()
            self.session = nil
            applications = []
            profile = nil
            applicationsSavedAt = nil
            profileSavedAt = nil
            serverCaptures = []
            capturesSavedAt = nil
            nextCursor = nil
            nextCaptureCursor = nil
            errorMessage = "Server address changed. Sign in again to continue."
        }
        serverAddress = cleaned
        defaults.set(cleaned, forKey: Self.serverAddressKey)
        sharedDefaults?.set(cleaned, forKey: Self.serverAddressKey)
        reloadOutbox()
    }

    func refreshWorkspace() async {
        await refreshApplications()
        await refreshProfile()
        await refreshCaptures()
    }

    func refreshApplications() async {
        guard let session else { return }
        isLoading = applications.isEmpty
        defer { isLoading = false }
        do {
            let page = try await MobileAPIClient(serverAddress: serverAddress).applications(cursor: nil, token: session.accessToken)
            applications = page.items
            nextCursor = page.nextCursor
            applicationsSavedAt = Date()
            cacheStore.saveApplications(applications, serverAddress: serverAddress, token: session.accessToken)
        } catch {
            await handle(error)
        }
    }

    func loadMoreApplications() async {
        guard let session, let cursor = nextCursor, !isLoadingMore else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }
        do {
            let page = try await MobileAPIClient(serverAddress: serverAddress).applications(cursor: cursor, token: session.accessToken)
            let known = Set(applications.map(\.id))
            applications += page.items.filter { !known.contains($0.id) }
            nextCursor = page.nextCursor
            applicationsSavedAt = Date()
            cacheStore.saveApplications(applications, serverAddress: serverAddress, token: session.accessToken)
        } catch {
            await handle(error)
        }
    }

    func refreshCaptures() async {
        guard let session else { return }
        isLoadingCaptures = serverCaptures.isEmpty
        defer { isLoadingCaptures = false }
        do {
            let page = try await MobileAPIClient(serverAddress: serverAddress).captures(cursor: nil, token: session.accessToken)
            serverCaptures = page.items
            nextCaptureCursor = page.nextCursor
            capturesSavedAt = Date()
            cacheStore.saveCaptures(serverCaptures, serverAddress: serverAddress, token: session.accessToken)
        } catch {
            await handle(error)
        }
    }

    func loadMoreCaptures() async {
        guard let session, let cursor = nextCaptureCursor, !isLoadingMoreCaptures else { return }
        isLoadingMoreCaptures = true
        defer { isLoadingMoreCaptures = false }
        do {
            let page = try await MobileAPIClient(serverAddress: serverAddress).captures(cursor: cursor, token: session.accessToken)
            let known = Set(serverCaptures.map(\.id))
            serverCaptures += page.items.filter { !known.contains($0.id) }
            nextCaptureCursor = page.nextCursor
            capturesSavedAt = Date()
            cacheStore.saveCaptures(serverCaptures, serverAddress: serverAddress, token: session.accessToken)
        } catch {
            await handle(error)
        }
    }

    func refreshProfile() async {
        guard let session else { return }
        isRefreshingProfile = true
        defer { isRefreshingProfile = false }
        do {
            profile = try await MobileAPIClient(serverAddress: serverAddress).profile(token: session.accessToken)
            profileSavedAt = Date()
            if let profile { cacheStore.saveProfile(profile, serverAddress: serverAddress, token: session.accessToken) }
        } catch {
            await handle(error)
        }
    }

    func refreshApplicationDetail(id: String) async {
        guard let session else { return }
        do {
            let record = try await MobileAPIClient(serverAddress: serverAddress).application(id: id, token: session.accessToken)
            if let index = applications.firstIndex(where: { $0.id == id }) {
                applications[index] = record
                cacheStore.saveApplications(applications, serverAddress: serverAddress, token: session.accessToken)
            }
        } catch { await handle(error) }
    }

    func syncPendingCaptures() async {
        guard let session, !isSyncingCaptures else { return }
        isSyncingCaptures = true
        defer { isSyncingCaptures = false }
        let items = outboxStore.retryable(serverAddress: serverAddress)
        var didUpload = false
        for item in items {
            outboxStore.markUploading(item.id)
            do {
                let result = try await MobileAPIClient(serverAddress: serverAddress).createCapture(item.payload, token: session.accessToken)
                outboxStore.markSavedToDossier(item.id, capture: result)
                upsertServerCapture(result)
                didUpload = true
            } catch let error as MobileAPIError where error.statusCode == 401 {
                outboxStore.markNeedsSignIn(item.id, reason: "Sign in again to upload this saved capture.")
                await expireSession()
                return
            } catch {
                outboxStore.markRetryNeeded(item.id, reason: error.localizedDescription)
            }
        }
        reloadOutbox()
        if didUpload { await refreshCaptures() }
    }

    func reloadOutbox() {
        captureItems = outboxStore.all(serverAddress: serverAddress)
    }

    func removeCapture(_ item: CaptureOutboxItem) {
        outboxStore.delete(item.id)
        reloadOutbox()
    }

    func dismissError() { errorMessage = nil }

    private func restoreCache(for session: StoredSession) {
        if let snapshot = cacheStore.applicationSnapshot(serverAddress: serverAddress, token: session.accessToken) {
            applications = snapshot.items
            applicationsSavedAt = snapshot.savedAt
        }
        if let snapshot = cacheStore.profileSnapshot(serverAddress: serverAddress, token: session.accessToken) {
            profile = snapshot.profile
            profileSavedAt = snapshot.savedAt
        }
        if let snapshot = cacheStore.captureSnapshot(serverAddress: serverAddress, token: session.accessToken) {
            serverCaptures = snapshot.items
            capturesSavedAt = snapshot.savedAt
        }
    }

    private func upsertServerCapture(_ capture: CaptureRecord) {
        serverCaptures.removeAll { $0.id == capture.id }
        serverCaptures.insert(capture, at: 0)
        serverCaptures.sort { $0.updatedAt > $1.updatedAt }
        capturesSavedAt = Date()
        if let session {
            cacheStore.saveCaptures(serverCaptures, serverAddress: serverAddress, token: session.accessToken)
        }
    }

    private func handle(_ error: Error) async {
        if let apiError = error as? MobileAPIError, apiError.statusCode == 401 {
            await expireSession()
            errorMessage = MobileAPIError.expiredSession.localizedDescription
        } else {
            errorMessage = error.localizedDescription
        }
    }

    private func expireSession() async {
        guard let session else { return }
        cacheStore.clear(serverAddress: serverAddress, token: session.accessToken)
        tokenStore.clear()
        self.session = nil
        applications = []
        profile = nil
        serverCaptures = []
        applicationsSavedAt = nil
        profileSavedAt = nil
        capturesSavedAt = nil
        nextCursor = nil
        nextCaptureCursor = nil
    }
}
