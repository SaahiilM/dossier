# Native Dossier changelog

Add native app and mobile API changes under **Personal release notes** in the
same PR. When it merges to main, its notes and build identity are the source
release record. Record actual phone installs separately, with the date, iOS
version and build number, fork SHA, upstream baseline, and checks run.
See the [versioning rules](README.md#releases-and-versioning).

## Personal release notes

- Fix the blank action in the Settings toolbar and put a labeled Edit profile
  basics button under Your profile. Use a book icon for the setup guide.

## Merged history

These entries record source merges. The legacy physical iPhone installation
reported **0.1.0 (1)** without a source identifier, so its exact contents and
installation date cannot be reconstructed from the bundle.

| Date | Fork commit or PR | Native or mobile API change |
| --- | --- | --- |
| 2026-11-19 | [#17](https://github.com/SaahiilM/dossier/pull/17) · `8d6b8a3` | Split SwiftUI views by screen. Signed iPad simulator smoke passed for sign-in, Welcome, Profile, Applications, and Inbox. The Share Extension compiled. |
| 2026-11-19 | [#19](https://github.com/SaahiilM/dossier/pull/19) · `6d051e9` | Adopted upstream 1.15.1. Mobile and provider compatibility tests passed. |
| 2026-11-19 | [#18](https://github.com/SaahiilM/dossier/pull/18) · `ae8cae1` | Adopted upstream 1.15.0. Mobile v1 reads and edits the default profile under the new multi-profile schema. |
| 2026-11-18 | [#16](https://github.com/SaahiilM/dossier/pull/16) · `b251296` | Added native profile basics from Welcome and Settings. iPhone simulator verified validation, editing, persistence, and readiness. |
| 2026-11-18 | [#15](https://github.com/SaahiilM/dossier/pull/15) · `6ac7a07` | Added native résumé and cover letter review, authenticated PDF preview, and sharing. |
| 2026-11-18 | [#13](https://github.com/SaahiilM/dossier/pull/13) · `39c3420`, [#14](https://github.com/SaahiilM/dossier/pull/14) · `76c9aab` | Added application status editing and versioned note creation, editing, and deletion. |
| 2026-11-18 | [#12](https://github.com/SaahiilM/dossier/pull/12) · `216a953` | Added authenticated document read and PDF export endpoints. |
| 2026-11-17 | [#11](https://github.com/SaahiilM/dossier/pull/11) · `8004b2e`, [#10](https://github.com/SaahiilM/dossier/pull/10) · `40dac89` | Added native Welcome and setup readiness. |
| 2026-11-17 | [#9](https://github.com/SaahiilM/dossier/pull/9) · `bedd634`, [#8](https://github.com/SaahiilM/dossier/pull/8) · `b65102d`, [#7](https://github.com/SaahiilM/dossier/pull/7) · `25841c9` | Initial SwiftUI beta with device sign-in, Applications, Profile, capture Inbox, and the Share Extension target. |

## Distribution history

### iOS 0.1.0 (54) · 2026-11-20 · test iPhone

- Source `80427c5626c3bb7fb3294a236b910d1ce1cfb96a`. Upstream 1.15.1.
- Installed and confirmed on the iPhone 16 Pro Max. This app-only build uses
  the existing development provisioning and excludes the Share Extension.

- Show the native version, build number, upstream baseline, and fork version in
  About Dossier, available from sign-in and Settings. Settings also checks the
  connected server's version. Versioned builds stamp the commit into the app.
- Publish the version tuple on each merge to fork main. Native and mobile API
  PRs include a changelog update.

### Earlier rollouts

- **2026-11-20 · Linux server** — upstream 1.15.1, fork
  `1.15.1+fork.8d6b8a336df5`. Production health and SQLite migration checks
  passed. This entry tracks the native app's backend rollout.
- **Legacy physical iPhone install** — iOS 0.1.0 (1). Installation verified on
  the iPhone 16 Pro Max. The source SHA is unavailable.
