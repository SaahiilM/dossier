# Scorer audit (work authorization, fingerprints, agent meta)

This document summarizes how Dossier scores postings after the profile work-authorization and `PostingFit` meta changes. It contains no secrets and no user data.

## Scorers

| Scorer | Version key | Structured meta |
|--------|-------------|-----------------|
| AI chat (`score-posting`) | `score-posting@2` | `chatScoreMeta` from red flags and score |
| Jev (TypeSafe) | `score-posting-jev@3` | `jevFitMeta` from Jev parts |
| OpenRouter chat | `score-posting-openrouter@1` | Same as AI chat |
| OpenRouter Decisions | `score-posting-openrouter-decisions@3` | Same as Jev |

## Work authorization

- Stored in `ProfileField` keys (`workAuthAuthorizedCountries`, sponsorship tri-states, visa rows, relocation).
- `workAuthorizationForScorer` exports user-entered facts only; omitted when empty.
- Included in Jev state, score fingerprints, and the **score-posting** chat prompt only — not in `profileForPrompt` for resumes or cover letters.

## Fingerprints and staleness

`scoreInputFingerprint` hashes:

- Parsed profile from `profileForPrompt`
- Work authorization scorer payload
- Reference date (UTC day)
- Scorer id, OpenRouter model when relevant
- `scorerPolicyVersion` (prompt version, Jev questions/weights, model)
- Posting content hash (Jev-aligned text)

When the fingerprint differs from `inputFingerprint` on `PostingScore` or `AgentCandidate`, the UI and MCP expose `score_stale`.

## Eligibility meta

`PostingFitMeta` carries `review` (`eligible` | `needs_review` | `ineligible`), `blockAutoDraft`, and optional `issues`.

- Jev: hard mismatches (location/permit/language/seniority/thin/missing required) → `ineligible`; uncertain Nouls only → `needs_review`.
- Permit Noul instructions: unknown work-auth fields are **not** conflicts; relocation alone is not permission.
- Auto-draft: blocked when stale, meta is missing, or `blockAutoDraft` is true.

## Persistence

Migration `20261112160000_score_meta_fingerprint` adds `meta`, `scoredWith`, and `inputFingerprint` to agent candidates and posting scores.

## MCP and UI

- `get_agent_candidate` and `list_agent_candidates` return `score_stale`, `score_review`, and `auto_draft_blocked`.
- `get_agent_status` returns queue counts plus `queue_score_stale`, `queue_needs_review`, and `queue_auto_draft_blocked`.
- Agent cards and `FitDetails` show stale and review labels.

## Benchmarks

Runs before Jev v3 / OpenRouter Decisions v3 are **historical** only (`benchmarks/HISTORICAL.md`). Re-run the harness after scorer changes before changing defaults.

## Operational checks

```bash
# Node unit tests
yarn vitest run --project node

# Database tests (isolated SQLite; name must end in _test)
DATABASE_URL="file:./prisma/dev_ending_test.db" yarn vitest run --project db

# Generate clients (both schemas)
yarn generate
```
