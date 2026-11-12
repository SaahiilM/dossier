# Decider benchmark

Mode: live
Model request: perplexity/pplx-decider-v1.3:free
Snapshot pin: perplexity/pplx-decider-v1.3-20261112
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

Smoke HTTP 200, model perplexity/pplx-decider-v1.3-20261112, cost 0, shape ok.

## False negatives

A false negative is a heldout eligible case that the gate rejects.
False negatives: 0 of 8 eligible heldout cases.
False-negative rate: 0.000
Direct-pass rate among eligible: 0.750
Gate recall (pass or escalate): 1.000
False positives (ineligible and pass): 0
Coverage: 0.542
Selective accuracy: 0.923 (12 of 13)
Errors: 0

| Label | pass | reject | escalate |
| --- | --- | --- | --- |
| eligible | 6 | 0 | 2 |
| ineligible | 0 | 6 | 2 |
| ambiguous | 1 | 0 | 7 |

Dev diagnostic is not the official score.
Dev false negatives: 0 of 6.

## Avoidance

Heldout cases: 24
Avoided expensive calls: 13
Escalations: 11
Avoidance rate: 0.542
Avoidance counts heldout pass and reject gates. It is not a token count and not money.
No paid baseline request was sent.

## Tokens

Measured tokens come from usage fields. Estimates use ceil(chars/4). The two are separate.
Measured input: 64341 known 43 missing 0
Measured output: 533 known 43 missing 0
Measured cached: 0 known 0 missing 43
Measured reasoning: 0 known 0 missing 43
Estimate decision tokens: 67132
Estimate baseline tokens: 16711
Estimate baseline tokens on avoided heldout calls: 5264

## Money

Measured USD: 0 known 43 missing 0
Estimate baseline USD: none. Set BENCHMARK_BASELINE_USD_PER_MILLION_INPUT to compute one.
Measured money is usage.cost only. Simulated money is not added to it.

## Latency

Median ms: 285.5
Max ms: 1379

## Catalog

Catalog ok: true. Blockers: none. Provider: Perplexity.

