# Native Dossier

`project.yml` defines the Xcode project. Regenerate the checked-in project with
`xcodegen generate --spec ios/project.yml` after adding, moving, or removing a source file.

## Where code belongs

- **App entry and navigation:** `DossierApp.swift`, `RootView.swift`,
  `WorkspaceTabs.swift`, and `SignInView.swift`.
- **Screens:** `Sources/App` has a file for each major screen. Keep controls
  private to their screen until a second screen needs them. Use stable
  record IDs for list identity and preserve record values for display updates.
- **App state:** `AppModel.swift` owns the authenticated workspace and persisted
  session. Keep editable drafts, progress, and validation display in the
  relevant feature.
- **API, storage, and extension:** `Sources/Shared` contains the mobile client,
  wire models, and storage. `Sources/ShareExtension` handles incoming shares.
  Keep shared code safe to compile in an extension target.
- **Server:** mobile route handlers authenticate and translate requests.
  Reuse the same server validation and write operations the web app uses.
  Keep provider credentials and application-preparation rules on the server.

Check the wire contract in [Mobile API v1](../docs/mobile-api-v1.md) when
changing an endpoint or DTO. Run the corresponding server tests and an iOS
Simulator build. For user-facing flows, verify the app against a disposable
backend and inspect persisted results where the flow writes data.

```sh
xcodebuild -project ios/Dossier.xcodeproj -scheme Dossier -configuration Debug \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

That command verifies compilation. See the [iOS beta guide](../docs/native-ios-beta.md)
for signing, device installation, and Share Extension requirements.
