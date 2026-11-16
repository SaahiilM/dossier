# Decider benchmark typesafe/jev-1.14

Mode: live
Model request: typesafe/jev-1.14
Snapshot pin: typesafe/jev-1.14-20261014
Billing: paid
Budget cap USD: 0.25
Spent USD: 0.003550218
Endpoint: https://openrouter.ai/api/alpha/decisions
Fallbacks: false
Web grounding: false
Key variable: OPENROUTER_API_KEY
Stopped: no

## Protocol

The request body has model, state, questions, and provider.allow_fallbacks false.
State and questions come from jevState and jevQuestions.
The score uses JEV_WEIGHTS from src/lib/scoring/jev.ts.
Run on Node 24 or newer. Node 22 has no crypto.argon2, and the production loader imports it.
The gate thresholds were fixed before the run. Dev rows did not change them. Heldout rows did not change them.

## Smoke

Smoke HTTP 200, model typesafe/jev-1.14-20261014, cost 0.000012012, shape ok.

## False negatives

A false negative is a heldout eligible case that the gate rejects.
False negatives: 0 of 8 eligible heldout cases.
False-negative rate: 0.000
Direct pass: 2 of 8 eligible heldout cases. Rate: 0.250
Gate recall: 8 of 8 eligible heldout cases. Rate: 1.000
Direct pass counts a gate of pass. Gate recall counts a gate of pass or escalate. A null gate counts as neither.
The field recall stores the direct-pass rate.
Eligible heldout errors: 0
False positives (ineligible and pass): 0
Coverage: 0.292
Selective accuracy: 1.000 (7 of 7)
Errors: 0

| Label | pass | reject | escalate |
| --- | --- | --- | --- |
| eligible | 2 | 0 | 6 |
| ineligible | 0 | 5 | 3 |
| ambiguous | 0 | 0 | 8 |

Dev diagnostic is not the official score.
Dev false negatives: 0 of 6.

## Avoidance

Heldout cases: 24
Avoided expensive calls: 7
Escalations: 17
Avoidance rate: 0.292
Avoidance counts heldout pass and reject gates. It is not a token count and not money. No expensive baseline call was sent, so a savings figure is a scenario estimate only.
No expensive baseline call was sent. Avoided-call counts and baseline USD are scenario estimates only.
Scenario estimate of baseline tokens on avoided heldout calls: 2866
Scenario estimate of baseline USD on avoided heldout calls: none

## Tokens

Measured tokens come from usage fields. Estimates use ceil(chars/4). The two are separate.
Measured input: 84529 known 43 missing 0
Measured output: 11626 known 43 missing 0
Measured cached: 0 known 0 missing 43
Measured reasoning: 0 known 0 missing 43
Estimate decision tokens: 66960
Estimate baseline tokens: 16711
Estimate baseline tokens on avoided heldout calls: 2866

## Money

Measured USD: 0.003550218 known 43 missing 0
Estimate baseline USD: none. Set BENCHMARK_BASELINE_USD_PER_MILLION_INPUT to compute one.
Measured money is usage.cost only. No expensive baseline call was sent. Baseline USD is a scenario estimate only. Simulated money is not added to measured money.

## Latency

Median ms: 129.5
Max ms: 195
Calls: 43
Attempts: 43
Retries: 0
HTTP 429: 0

## Catalog

Catalog ok: true. Blockers: none. Provider: TypeSafe.

