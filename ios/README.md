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

## Releases and versioning

See the [native changelog](CHANGELOG.md) for merged work and distribution history.
This app is for personal use and is installed directly on the owner's iPhone.
Every merge to main that changes iOS or its mobile API is a personal source release.

| Identifier | Rule |
| --- | --- |
| Upstream | Keep the root `package.json` version aligned with the upstream release incorporated into fork main. Fork-only changes leave it alone. |
| Fork | `<upstream>+fork.<12-character commit SHA>` identifies the exact fork revision. Server health retains the full SHA in `build`. |
| iOS version | `MARKETING_VERSION` in `ios/project.yml`. Keep it stable across routine personal builds. When intentionally changing it, regenerate the Xcode project. |
| iOS build | The number of first-parent commits at the source revision. It advances on every merge to main and is shared by the app and extension. Rebuilding the same commit uses the same build number. |

The native version workflow records the tuple on each push to main and
identifies pushes that contain a personal iOS release. Add notes for native
code, configuration, or mobile API changes under **Personal release notes**
in the same PR. Note any server version required by an iOS feature.

Use the versioned build command for the personal iPhone. Run it
from a clean checkout of the intended main commit with full Git history.
It requires Node.js to read the upstream version from `package.json`.

```sh
scripts/build-native-ios.sh --version
scripts/build-native-ios.sh -configuration Debug \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

Pass the usual Xcode signing and device destination arguments to the same
script for a device build. Direct Xcode builds use development defaults.
The wrapper marks a modified checkout with `.dirty` in its fork identity.
Open **About Dossier** from the iOS sign-in screen or tap the info button
in Settings. The app's upstream baseline describes its source tree.
Settings also looks up the version of the connected server.
On the web, including the Home Screen app, use **Settings → About**.
In the desktop app, **Help → About** identifies the desktop build and
**Settings → About** identifies its server.

After installing on the phone, record its iOS version, build number, full
source SHA, upstream baseline, and verification in the changelog.
