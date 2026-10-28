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

The suite uses Node's built-in test runner and disposable filesystem fixtures; it does not need a running judge or network access. Coverage includes configuration validation, judge failures, guard policy and cache isolation, staged-file snapshots, mutation lifecycle hooks, host scanning, redaction, and audit files. These tests were reconstructed from the restored implementation; they are not a recovery of an original test suite. There is no live-test or standalone mock-server script in this checkout.

Review changes for:

- Fail-open paths when the judge fails or returns an unusable answer.
- Sensitive data sent to the judge, written to logs, or included in blocked-call errors.
- Changes to precedence between blocked hosts, tool lists, prefiltering, and judge results.
- Documentation that describes a heuristic as a guarantee.

## Pull requests

Explain the behavior change and its security impact. Link related issues when available. Include test commands and results, or state why no tests were run. Do not include secrets or private machine details in examples.

Do not publish to npm or deploy releases unless a maintainer explicitly authorizes it.
