# Repository guidance

This file gives coding agents and contributors repository-specific rules. The source code and tests define current behavior; update documentation when behavior changes.

## Scope and safety

- Keep the plugin opt-in. Do not add automatic global registration, install hooks that edit OpenCode configuration, or symlink setup.
- Preserve the fail-closed defaults for judge failures and unclassifiable results. Any change to allow/block behavior needs focused tests and a clear explanation in a relevant `docs/adr/` record.
- Treat tool arguments and staged file contents as sensitive. Do not add logging or telemetry that sends more data than the configured judge request requires.
- Do not claim the plugin is a network security boundary. It cannot control arbitrary network activity by tools or child processes.
- Do not include private machine paths, network addresses, credentials, or unverified test results in public documentation.

## Changes and checks

- Keep changes focused and preserve the existing JavaScript module style.
- Add or update tests for behavior changes. Run the checks relevant to the change and report the commands and outcomes accurately.
- Review `README.md` and the relevant documents under `docs/` when changing installation, data handling, or policy behavior.
- Do not publish a package, change a user's OpenCode configuration, create symlinks, or commit changes unless explicitly authorized.

## Project map

- Start with [the Markdown explainer](docs/explainer.md) for the guard's flow and limits. Keep it consistent with `docs/explainer.html`; agents should read the local Markdown, not the third-party HTML preview.
- `index.js` is the OpenCode plugin entry point and hook registration.
- `src/config.js` and `src/defaults.js` load, validate, and normalize policy.
- `src/guard.js`, `src/state.js`, and `src/written.js` evaluate calls and track selected file mutations.
- `src/blocked-hosts.js` scans tool arguments for configured blocked URL hosts; `src/shared.js` holds shared utilities.
- `src/judge.js` sends decision requests; `src/audit.js` records results; `src/redact.js` handles best-effort redaction.
- `README.md` is the quick introduction. `docs/README.md` indexes the [installation](docs/installation.md), [configuration](docs/configuration.md), [security](docs/security.md), and [contributing](docs/contributing.md) guides; `docs/adr/README.md` indexes accepted design decisions.
