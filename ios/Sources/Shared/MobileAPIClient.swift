import Foundation

struct ServerBuildInfo: Decodable {
    let version: String
    let build: String?
    let forkVersion: String?

    var forkIdentity: String? {
        if let forkVersion { return forkVersion }
        return build.map { "\(version)+fork.\($0.prefix(12))" }
    }
}

struct MobileAPIClient {
    static let defaultServerAddress = "https://dossier.sahmai.party"
    let serverURL: URL
    var session: URLSession = .shared

    init(serverAddress: String, session: URLSession = .shared) throws {
        guard let url = URL(string: serverAddress.trimmingCharacters(in: .whitespacesAndNewlines)),
              let scheme = url.scheme?.lowercased(),
              (scheme == "https" || Self.isLocalHTTP(url)),
              url.host != nil,
              url.user == nil,
              url.password == nil,
              url.query == nil,
              url.fragment == nil else {
            throw MobileAPIError.invalidServerURL
        }
        self.serverURL = url
        self.session = session
    }

    func serverBuildInfo() async throws -> ServerBuildInfo {
        try await request(url: serverURL.appendingPathComponent("api/health"), method: "GET", token: nil)
    }

    func login(password: String, deviceName: String) async throws -> LoginResponse {
        let body: [String: String] = ["password": password, "deviceName": deviceName]
        return try await request(path: "auth/login", method: "POST", body: body, token: nil)
    }

    func logout(token: String) async throws {
        let response: LogoutResponse = try await request(path: "auth/logout", method: "POST", token: token)
        guard response.ok else { throw MobileAPIError.invalidResponse }
    }

    func applications(cursor: String?, token: String) async throws -> ApplicationPage {
        var components = URLComponents(url: endpoint("applications"), resolvingAgainstBaseURL: false)
        if let cursor { components?.queryItems = [URLQueryItem(name: "cursor", value: cursor)] }
        guard let url = components?.url else { throw MobileAPIError.invalidServerURL }
        return try await request(url: url, method: "GET", token: token)
    }

    func application(id: String, token: String) async throws -> ApplicationRecord {
        let envelope: ApplicationEnvelope = try await request(path: "applications/\(pathSegment(id))", method: "GET", token: token)
        return envelope.application
    }

    func updateApplicationStatus(id: String, expectedUpdatedAt: String, status: ApplicationStatus, token: String) async throws -> ApplicationRecord {
        let payload = ApplicationUpdatePayload(expectedUpdatedAt: expectedUpdatedAt, status: status)
        let envelope: ApplicationEnvelope = try await request(
            path: "applications/\(pathSegment(id))",
            method: "PATCH",
            body: payload,
            token: token
        )
        return envelope.application
    }

    func createApplicationNote(id: String, body: String, token: String) async throws -> ApplicationNote {
        let payload = ApplicationNoteCreatePayload(body: body)
        let envelope: ApplicationNoteEnvelope = try await request(
            path: "applications/\(pathSegment(id))/notes",
            method: "POST",
            body: payload,
            token: token
        )
        return envelope.note
    }

    func updateApplicationNote(id: String, noteID: String, body: String, expectedUpdatedAt: String, token: String) async throws -> ApplicationNote {
        let payload = ApplicationNoteUpdatePayload(body: body, expectedUpdatedAt: expectedUpdatedAt)
        let envelope: ApplicationNoteEnvelope = try await request(
            path: "applications/\(pathSegment(id))/notes/\(pathSegment(noteID))",
            method: "PATCH",
            body: payload,
            token: token
        )
        return envelope.note
    }

    func deleteApplicationNote(id: String, noteID: String, expectedUpdatedAt: String, token: String) async throws {
        let payload = ApplicationNoteDeletePayload(expectedUpdatedAt: expectedUpdatedAt)
        let response: ApplicationNoteDeleteResponse = try await request(
            path: "applications/\(pathSegment(id))/notes/\(pathSegment(noteID))",
            method: "DELETE",
            body: payload,
            token: token
        )
        guard response.ok else { throw MobileAPIError.invalidResponse }
    }

    func applicationDocuments(id: String, token: String) async throws -> MobileApplicationDocumentsEnvelope {
        let encodedID = try encodedApplicationID(id)
        let url = try applicationDocumentsEndpoint(encodedID: encodedID, suffix: "")
        let envelope: MobileApplicationDocumentsEnvelope = try await request(url: url, method: "GET", token: token)
        guard envelope.applicationId == id,
              envelope.documents.resume?.kind == nil || envelope.documents.resume?.kind == .resume,
              envelope.documents.coverLetter?.kind == nil || envelope.documents.coverLetter?.kind == .coverLetter else {
            throw MobileAPIError.invalidResponse
        }
        return envelope
    }

    /// Fetches a PDF from a route built from the configured server and typed document kind.
    /// The server's JSON `pdfUrl` field is deliberately not used by the native client.
    func documentPDF(applicationID: String, kind: MobileDocumentKind, token: String) async throws -> MobilePDFResponse {
        let encodedID = try encodedApplicationID(applicationID)
        let url = try applicationDocumentsEndpoint(encodedID: encodedID, suffix: "/\(kind.rawValue)/pdf")
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 25
        request.setValue("application/pdf", forHTTPHeaderField: "Accept")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let data: Data
        let response: URLResponse
        do {
            // Refuse redirects so an authenticated request can never be forwarded to a
            // URL supplied by the server or a third-party host.
            (data, response) = try await session.data(for: request, delegate: RejectPDFRedirects())
        } catch let error as URLError where error.code == .cancelled {
            throw error
        } catch {
            throw MobileAPIError.network(Self.friendlyNetworkMessage(error))
        }

        guard let http = response as? HTTPURLResponse else { throw MobileAPIError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else {
            if let envelope = try? MobileDateCoding.decoder().decode(APIErrorEnvelope.self, from: data) {
                throw MobileAPIError.server(code: envelope.error.code, message: envelope.error.message, status: http.statusCode)
            }
            throw MobileAPIError.server(code: "http_\(http.statusCode)", message: "Dossier could not complete that request (\(http.statusCode)).", status: http.statusCode)
        }
        guard http.mimeType?.lowercased() == "application/pdf", data.starts(with: Data("%PDF-".utf8)) else {
            throw MobileAPIError.invalidResponse
        }
        return MobilePDFResponse(data: data, suggestedFilename: response.suggestedFilename)
    }

    func profile(token: String) async throws -> JSONValue {
        let envelope: ProfileEnvelope = try await request(path: "profile", method: "GET", token: token)
        return envelope.profile
    }

    func profileBasics(token: String) async throws -> MobileProfileBasics {
        let envelope: MobileProfileBasicsEnvelope = try await request(path: "profile/basics", method: "GET", token: token)
        return envelope.basics
    }

    func updateProfileBasics(_ patch: MobileProfileBasicsPatch, token: String) async throws -> MobileProfileBasics {
        let envelope: MobileProfileBasicsEnvelope = try await request(
            path: "profile/basics",
            method: "PATCH",
            body: patch,
            token: token
        )
        return envelope.basics
    }

    /// Returns nil when the server predates the optional mobile setup endpoint.
    func setupStatus(token: String) async throws -> MobileSetupStatus? {
        do {
            return try await request(path: "setup", method: "GET", token: token)
        } catch let error as MobileAPIError where error.statusCode == 404 {
            return nil
        }
    }

    var setupGuideURL: URL? {
        guard var components = URLComponents(url: serverURL, resolvingAgainstBaseURL: false) else { return nil }
        components.path = "/welcome"
        components.query = nil
        components.fragment = nil
        return components.url
    }

    func createCapture(_ payload: CaptureCreatePayload, token: String) async throws -> CaptureRecord {
        let envelope: CaptureEnvelope = try await request(path: "captures", method: "POST", body: payload, token: token)
        return envelope.capture
    }

    func captures(cursor: String?, token: String) async throws -> CapturePage {
        var components = URLComponents(url: endpoint("captures"), resolvingAgainstBaseURL: false)
        if let cursor { components?.queryItems = [URLQueryItem(name: "cursor", value: cursor)] }
        guard let url = components?.url else { throw MobileAPIError.invalidServerURL }
        return try await request(url: url, method: "GET", token: token)
    }

    private func endpoint(_ relativePath: String) -> URL {
        let root = serverURL.appendingPathComponent("api/mobile/v1", isDirectory: true)
        return root.appendingPathComponent(relativePath)
    }

    private func pathSegment(_ value: String) -> String {
        var allowed = CharacterSet.urlPathAllowed
        allowed.remove(charactersIn: "/?#")
        return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
    }

    private func encodedApplicationID(_ id: String) throws -> String {
        guard !id.isEmpty, id.count <= 128 else { throw MobileAPIError.invalidResponse }
        var pathCharacters = CharacterSet.urlPathAllowed
        pathCharacters.remove(charactersIn: "/?#%")
        guard let encoded = id.addingPercentEncoding(withAllowedCharacters: pathCharacters) else {
            throw MobileAPIError.invalidResponse
        }
        return encoded
    }

    private func applicationDocumentsEndpoint(encodedID: String, suffix: String) throws -> URL {
        guard var components = URLComponents(url: serverURL, resolvingAgainstBaseURL: false) else {
            throw MobileAPIError.invalidServerURL
        }
        let serverPath = components.percentEncodedPath.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let basePath = serverPath.isEmpty ? "" : "/\(serverPath)"
        components.percentEncodedPath = "\(basePath)/api/mobile/v1/applications/\(encodedID)/documents\(suffix)"
        guard let url = components.url else { throw MobileAPIError.invalidServerURL }
        return url
    }

    private func request<T: Decodable>(path: String, method: String, token: String?) async throws -> T {
        try await request(url: endpoint(path), method: method, token: token)
    }

    private func request<Body: Encodable, Response: Decodable>(path: String, method: String, body: Body, token: String?) async throws -> Response {
        let bodyData: Data
        do { bodyData = try MobileDateCoding.encoder().encode(body) }
        catch { throw MobileAPIError.encoding }
        return try await perform(url: endpoint(path), method: method, body: bodyData, token: token)
    }

    private func request<Response: Decodable>(url: URL, method: String, token: String?) async throws -> Response {
        try await perform(url: url, method: method, body: nil, token: token)
    }

    private func perform<Response: Decodable>(url: URL, method: String, body: Data?, token: String?) async throws -> Response {
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 25
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        let data: Data
        let response: URLResponse
        do { (data, response) = try await session.data(for: request) }
        catch let error as URLError where error.code == .cancelled { throw error }
        catch { throw MobileAPIError.network(Self.friendlyNetworkMessage(error)) }
        guard let http = response as? HTTPURLResponse else { throw MobileAPIError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else {
            if let envelope = try? MobileDateCoding.decoder().decode(APIErrorEnvelope.self, from: data) {
                throw MobileAPIError.server(code: envelope.error.code, message: envelope.error.message, status: http.statusCode)
            }
            throw MobileAPIError.server(code: "http_\(http.statusCode)", message: "Dossier could not complete that request (\(http.statusCode)).", status: http.statusCode)
        }
        do { return try MobileDateCoding.decoder().decode(Response.self, from: data) }
        catch { throw MobileAPIError.invalidResponse }
    }

    private static func isLocalHTTP(_ url: URL) -> Bool {
        guard url.scheme?.lowercased() == "http" else { return false }
        let host = url.host?.lowercased() ?? ""
        return host == "localhost" || host == "127.0.0.1" || host == "::1"
    }

    private static func friendlyNetworkMessage(_ error: Error) -> String {
        if let urlError = error as? URLError {
            switch urlError.code {
            case .notConnectedToInternet, .networkConnectionLost: return "No internet connection. Your saved captures are still on this device."
            case .timedOut: return "The server took too long to respond. Try again when the connection is stable."
            case .cannotFindHost, .cannotConnectToHost, .dnsLookupFailed: return "Could not reach this Dossier server. Check the server address and connection."
            default: break
            }
        }
        return "Could not reach Dossier. Check your connection and try again."
    }
}

private final class RejectPDFRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        completionHandler(nil)
    }
}

struct CaptureCreatePayload: Encodable {
    let url: String
    let text: String?
    let note: String?
    let clientRequestId: String
}
