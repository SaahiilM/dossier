# Decision model comparison

Cost and token sums use the same 42 cases in the same order. Smoke calls stay separate.
Labels stay out of the request.
No expensive baseline call was sent. Savings stay scenario estimates.
Fair same 42: yes

## perplexity/pplx-decider-v1.3:free
Rows: 42. Same 42: yes.
Direct pass: 0.750. Gate recall: 1.000. False-negative rate: 0.000.
Direct-pass 95% Wilson: 0.409 to 0.929.
Gate-recall 95% Wilson: 0.676 to 1.000.
Case cost USD: 0. Known: 42. Missing: 0.
Case input tokens: 64259. Known: 42. Missing: 0.

## parallel/decisions-fast:free
Rows: 42. Same 42: yes.
Direct pass: 0.250. Gate recall: 1.000. False-negative rate: 0.000.
Direct-pass 95% Wilson: 0.071 to 0.591.
Gate-recall 95% Wilson: 0.676 to 1.000.
Case cost USD: 0. Known: 42. Missing: 0.
Case input tokens: 179786. Known: 42. Missing: 0.

## typesafe/jev-1.14
Rows: 42. Same 42: yes.
Direct pass: 0.250. Gate recall: 1.000. False-negative rate: 0.000.
Direct-pass 95% Wilson: 0.071 to 0.591.
Gate-recall 95% Wilson: 0.676 to 1.000.
Case cost USD: 0.003538206. Known: 42. Missing: 0.
Case input tokens: 84243. Known: 42. Missing: 0.

## perplexity/pplx-decider-v1.3:free vs parallel/decisions-fast:free
Heldout paired: 24. Equal: 13. Differ: 11. Unpaired: 0. Missing gate: 0.
Heldout disagreement 95% Wilson: 0.279 to 0.649.
Heldout pass-discordant CI: 0.566 to 1.000.

## perplexity/pplx-decider-v1.3:free vs typesafe/jev-1.14
Heldout paired: 24. Equal: 16. Differ: 8. Unpaired: 0. Missing gate: 0.
Heldout disagreement 95% Wilson: 0.180 to 0.533.
Heldout pass-discordant CI: 0.566 to 1.000.

## parallel/decisions-fast:free vs typesafe/jev-1.14
Heldout paired: 24. Equal: 15. Differ: 9. Unpaired: 0. Missing gate: 0.
Heldout disagreement 95% Wilson: 0.212 to 0.573.
Heldout pass-discordant CI: 0.150 to 0.850.

