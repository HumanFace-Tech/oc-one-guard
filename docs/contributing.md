# Contributing

Keep `oc-one-guard` explicit to install, conservative on failures, and clear about its limits. Read [repository guidance](../AGENTS.md) and [security and data handling](security.md) before changing security-sensitive behavior.

## Before changing code

Trace the relevant flow from `index.js` into `src/` and check existing behavior before editing. Keep changes scoped. Do not add automatic global installation, OpenCode configuration edits, or symlinks.

This release supports OpenCode v1 only. Version 1.19.4 is tested; the conservative supported range is `>=1.19.4 <2`. Do not claim compatibility with older versions or v2, or imply every version in the range has been tested. Registration and successful loading are prerequisites for protection.

## Tests and review

Run checks from the repository root and report exact results. Do not claim tests passed unless they ran successfully in the current checkout.

```sh
npm test
npm pack --dry-run
```

`npm test` explicitly lists the `*.test.js` files in `package.json` for shell portability. Add new test files to that list and keep helpers out. Tests use mocked judge requests and do not establish compatibility with other OpenCode versions.

The suite uses Node's built-in test runner and disposable filesystem fixtures; it does not need a running judge or network access. Coverage includes configuration validation, judge failures, guard policy and cache isolation, staged-file snapshots, mutation lifecycle hooks, host scanning, redaction, and audit files. These tests were reconstructed from the restored implementation; they are not a recovery of an original test suite.

## Synthetic evaluation

Run the opt-in evaluator against a trusted System One endpoint, for example:

```sh
EVAL_API_KEY='your-key' npm run eval:live -- --endpoint https://judge.example/v1/systemone --model your-model --mode both --output evaluation.json
```

Omit `EVAL_API_KEY` if authentication is not needed. Modes are `direct`, `guard`, and `both`; `--limit` selects the first N cases. Without `--output` the JSON goes to stdout. Output files are created exclusively with mode 0600. An incomplete report, including judge failures or unclassifiable answers, exits nonzero. No separate canary is sent: actual case requests establish availability.

Only use the checked-in synthetic fixture, with no real credentials or private data. Never run this evaluator on arbitrary inputs: reports include raw arguments, rationale and judge state, and requests send rendered state to the endpoint. Protect stdout and report files accordingly. Only the configured endpoint receives requests. Fixture calls are data, not commands, and fixture URLs are never fetched. Direct arguments are unchanged; the guard arm relocates recognized paths it might inspect into an empty temporary root, records each relocation, and refuses uncertain isolation. Cases and arms reset shared write tracking; this single-call evaluation does not test multi-step staging or the OpenCode plugin. Guard mutation tracking can change its rendered state even during one proposed write, including staged-file text. The report includes original and evaluated arguments and the exact rendered judge state where available. State comparison requires both states; outcome agreement requires two scored samples. Independent samples can vary, and the guard prefilter changes the population: arm rates are not directly comparable.

Operational rates include fail-closed blocks; `armTotals` counters describe all rows in that summary, while rates and stop signals use eligible rows. Model-scored rates exclude failures, unknown answers and prefilter/policy decisions. State rendering blocks and fixture-isolation errors make the report incomplete and are not model scores. Preparatory cases are excluded from main and family summaries and reported separately; their labels describe preparation, not immediate transfer. Selected label counts and comparative pair counts make denominators explicit. Empty denominators yield null. Wilson 95% intervals are descriptive binomial intervals; correlated fixtures and paired arms limit their interpretation. Endpoint and model names are hashed; the model hash does not identify weights or server version. Canonical fixture and nonsecret normalized-policy hashes help identify inputs but do not guarantee reproducibility.

Review changes for:

- Fail-open paths when the judge fails or returns an unusable answer.
- Sensitive data sent to the judge, written to logs, or included in blocked-call errors.
- Changes to precedence between blocked hosts, tool lists, prefiltering, and judge results.
- Documentation that describes a heuristic as a guarantee.

## Pull requests

Explain the behavior change and its security impact. Link related issues when available. Include test commands and results, or state why no tests were run. Do not include secrets or private machine details in examples.

Do not publish to npm or deploy releases unless a maintainer explicitly authorizes it.
