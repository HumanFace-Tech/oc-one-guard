# Contributing

Contributions should keep `oc-one-guard` explicit to install, conservative on failures, and clear about its limits. Read `AGENTS.md` and `SECURITY.md` before changing security-sensitive behavior.

## Before changing code

Trace the relevant flow from `index.js` into `src/` and check the existing behavior before editing. Keep the change scoped to the feature or bug. Do not add automatic global installation, OpenCode configuration edits, or symlinks.

This release is OpenCode v1-only. The tested host is 1.19.4; the conservative supported range is `>=1.19.4 <2`. Do not claim compatibility with older versions or v2, or imply every supported version has been tested. Registration and successful loading are prerequisites for any protection.

## Tests and review

Add focused tests for changed behavior where a test harness is available. Run applicable checks from the repository root and include their exact results in the pull request. Do not report tests as passing unless they ran successfully in the current checkout.

Run `npm test` and `npm pack --dry-run` for release review. The test command explicitly enumerates `*.test.js` files for shell portability; update the list in `package.json` when adding a test file. Keep helpers out of that list. Mock-based tests do not establish host compatibility.

Review changes for:

- Fail-open paths when the judge fails or returns an unusable answer.
- Sensitive data sent to the judge, written to logs, or included in blocked-call errors.
- Changes to precedence between blocked hosts, tool lists, prefiltering, and judge results.
- Documentation that describes a heuristic as a guarantee.

## Pull requests

Explain the behavior change and its security impact. Link related issues when available. Include test commands and results, or state why no tests were run. Do not include secrets or private machine details in examples.

Do not publish to npm or deploy releases as part of a contribution unless a maintainer explicitly authorizes that action.
