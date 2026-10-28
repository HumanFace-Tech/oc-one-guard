# oc-one-guard

`oc-one-guard` is an OpenCode plugin that checks proposed tool calls for possible outbound data exfiltration. It submits a rendered description to a System One decision endpoint and can stop a call before the tool runs. It is a heuristic guardrail, not a network security boundary.

The repository is `git@github.com:HumanFace-Tech/oc-one-guard.git`. It has not been published to npm. Installation is opt-in. Nothing in this repository installs the plugin globally, creates symlinks, or edits OpenCode configuration for you.

## Compatibility and activation

**OpenCode v1 only. OpenCode v2 is not supported.** The tested OpenCode version is **1.19.4**. The conservative supported range is `>=1.19.4 <2`; this does not mean every version in that range has been tested. Versions older than 1.19.4 are unsupported, and this project makes no claim that they work. The current release has no v2 runtime port.

**An unregistered or unloaded plugin provides no protection.** The guard can check calls only after OpenCode successfully loads it and invokes its hooks. Fail-closed defaults apply within the loaded guard; they cannot protect a session where the plugin never loaded. After adding or changing the plugin entry, quit and restart OpenCode and check startup logs for successful activation or configuration problems.

The plugin has no runtime npm dependencies and does not require `@opencode-ai/plugin` to be installed. Its entry-point JSDoc describes only the host fields it consumes with a local structural type. This is not a host-version compatibility check.

## How it works

The plugin registers `tool.execute.before`. It first checks configured blocked hosts, then applies tool overrides and a prefilter. Calls that need review are submitted to `POST /v1/systemone`. A deny or blocking escalation throws from the hook, so OpenCode does not execute the proposed tool call. The judge can be `llama-server` or another server compatible with the System One API. The defaults fail closed when the judge request fails, the answer cannot be classified, or the result reaches the escalation threshold. These defaults do not make the heuristic a security boundary.

The request includes the model id, rendered state, and configured question definitions. State can include tool arguments, extracted hosts and paths, file references, and content from an agent-written file later run as a script. Extracted facts take priority over raw arguments within the full-state limit; calls are blocked if the facts cannot fit. These limits do not make sensitive input safe to disclose.

## Install explicitly from a local checkout

Clone or copy this repository to a stable directory. Then choose exactly where to enable it. The project configuration applies only to one project; the global configuration applies to every OpenCode project for that user. This plugin is not automatically enabled by cloning the repository.

For one project, add an entry to that project's OpenCode configuration file:

```json
{
  "plugin": [
    ["/absolute/path/to/oc-one-guard", { "endpoint": "http://127.0.0.1:8081/v1/systemone" }]
  ]
}
```

To enable it for every project, add the same plugin entry to the user's global OpenCode configuration. Make this change only if you want the guard active everywhere. Do not replace the local path with a symlink or use a package name for this checkout.

If the configured judge is offline, the fail-closed defaults can stop tool calls that need judge review. To disable the plugin when OpenCode cannot proceed, stop OpenCode outside its TUI, then edit the relevant project or global OpenCode configuration with a text editor and remove only the `oc-one-guard` plugin entry. Start OpenCode again. Removing the entry is the full disable path; setting `enabled` to `false` does not disable the blocked-host scan. Do not rely on changing this plugin's settings from within the locked OpenCode session.

The supported OpenCode v1 plugin configuration accepts plugin specs and inline plugin options. See the [OpenCode plugin documentation](https://opencode.ai/docs/plugins/), which may describe newer, unsupported releases. A local path spec points directly at the checkout. Do not use a package name as the spec until the package is published and you intend to install that package.

For a copied plugin folder, `config.json` or `config.jsonc` next to the plugin source supplies configuration when no inline setting overrides it. Both local configuration filenames are ignored by Git and excluded from the npm package. The package includes `config.example.json`; an installed package therefore needs inline options for non-default settings unless you maintain a local config adjacent to the installed plugin's source. Do not assume an installed package has a writable config file beside it.

### Configuration precedence

The loader starts with built-in defaults, merges the adjacent `config.json` (or `config.jsonc`) if present, then merges inline plugin options. Inline options win. Plain objects merge recursively, most arrays replace their previous value, and `questions` merge by `name`; a matching question is updated, and its `criteria` map replaces the old map. If supplied question names do not match any defaults, the supplied question list replaces the defaults.

Invalid configuration is reported to the OpenCode log and falls back to validated defaults. The guard still loads rather than disappearing because plugin initialization failed. This fallback can mean a misconfigured endpoint silently becomes the default loopback endpoint, so check startup logs.

## Configuration reference

The full set of fields is shown in [`config.example.json`](./config.example.json). Defaults are defined in [`src/defaults.js`](./src/defaults.js). Numeric values are normalized by `src/config.js`. The example file is a sample configuration, not an exact copy of the built-in defaults. In particular, it selects a different model and timeout.

| Field | Default | Meaning |
|---|---:|---|
| `enabled` | `true` | Disables judge evaluation when false. The plugin-level blocked-host scan still runs. |
| `endpoint` | `http://127.0.0.1:8081/v1/systemone` | Full decision API URL. |
| `model` | `h1-decision-4b` | Model id sent in the request. |
| `apiKey` | `""` | Optional bearer credential. Prefer `apiKeyEnv` for secrets. |
| `apiKeyEnv` | `""` | Environment variable name whose non-empty value is used as the bearer credential; it takes precedence over `apiKey`. |
| `timeoutMs` | `20000` | Request timeout, including reading the response body. Normalized to a positive integer. |
| `denyThreshold` | `0.75` | At or above this violation probability, deny. Must be from 0 to 1. |
| `escalateThreshold` | `0.45` | At or above this probability, but below the deny threshold, escalate. Must be from 0 to 1 and no greater than `denyThreshold`. |
| `escalateAction` | `"block"` | `"block"` stops escalated calls; `"allow"` allows them and emits an audit entry and warning toast. |
| `failMode` | `"block"` | Action on request/network/HTTP/JSON failure. `"block"` denies; `"allow"` permits. |
| `unknownMode` | `"block"` | Action when no usable answer or violation probability can be read. `"block"` denies; `"allow"` permits. |
| `notify` | `true` | Show a TUI toast when the decision blocks. |
| `auditLog` | `true` | Write decision metadata to OpenCode's server log. |
| `auditFile` | `""` | Optional JSONL audit path. Empty disables the file sink. |
| `auditMaxBytes` | `5242880` | Rotate the audit file when its existing size exceeds this byte count; `0` disables size-based rotation. |
| `auditGenerations` | `3` | Number of rotated audit generations to retain; normalized to at least 1. |
| `redactArguments` | `true` | Redact recognized secret patterns in audit state. The blocked command preview is redacted regardless of this setting. Redaction is best-effort, not comprehensive. |
| `cacheEnabled` | `true` | Cache classified judge decisions and coalesce concurrent identical requests. Failures and unclassified answers are retried. |
| `cacheTtlMs` | `30000` | Cache lifetime in milliseconds; normalized to a non-negative integer. |
| `prefilter` | `true` | Allow calls detected as having no outbound surface without contacting the judge. This is heuristic. |
| `skipTools` | `[]` | Tool names allowed without judge review, checked after `deniedTools`. Blocked-host scan still runs first in the plugin. |
| `deniedTools` | `[]` | Tool names always denied by the guard, checked before `skipTools`. |
| `allowedTools` | `[]` | Tool names allowed without judge review, checked after `skipTools`. Blocked-host scan still runs first. |
| `allowedHosts` | `[]` | Reserved/configurable host list. It currently does not bypass judge evaluation. |
| `blockedHosts` | `[]` | URL hosts blocked before tool overrides or judge evaluation. Matching is case-insensitive and includes exact hosts and subdomains on dot boundaries; `*.example.com` matches subdomains. |
| `maxStateChars` | `8000` | Maximum rendered state length sent to the judge; normalized to a positive integer. |
| `maxArgChars` | `2000` | Maximum length of each string argument during rendering and staged-content inclusion; normalized to a positive integer. |
| `stateTemplate` | `"proposed agent tool call…"` | Template with required `{arguments}`. Also substitutes `{tool}`, `{hosts}`, `{paths}`, and `{references}`. Extracted facts are appended. |
| `questions` | One `choice` question | Questions sent to the judge. The first configured question determines the decision. See below. |

`failMode`, `unknownMode`, and `escalateAction` accept exactly `"block"` or `"allow"`. Thresholds and question structure are validated. `timeoutMs`, `maxStateChars`, `maxArgChars`, `cacheTtlMs`, and `auditGenerations` are clamped/normalized rather than rejected for non-integer values.

### Question types and thresholds

Each question requires a non-empty `name`, a supported `type`, and non-empty `instructions`. `choice` and `noul` also require a criteria map and an explicit `denyLabel`. `noul` requires exactly the `true` and `false` criteria keys. `score` requires a non-empty array of non-empty text `levels`. Judge models can impose further limits on the number of levels. The first question determines the verdict and must be `choice` or `noul`; `score` is allowed only as an additional question.

For `choice`, the guard uses the probability in `answers[name].probabilities[denyLabel]`; it does not use the top `choice` field or `confidence`. For `noul`, most llama.cpp decision models return `P(true)`. LEV instead returns the expected value of a nine-point no-to-yes rating, normalized to 0 through 1. The guard treats either result as the affirmative signal: with `denyLabel: "true"`, it uses the value directly; with `denyLabel: "false"`, it uses `1 - value`. LEV's value is not a binary probability.

These values are model outputs, not calibrated probabilities. The thresholds are decision cutoffs, not a statistical guarantee. With the defaults, a violation signal below `0.45` allows, `0.45` through below `0.75` escalates, and `0.75` or higher denies. An unclassifiable answer follows `unknownMode`; a failed request follows `failMode`.

The guard tracks writes and patches when their content contains a recognized transfer primitive, or when they modify a file already tracked. It marks the affected file unknown before the tool runs. When a later shell call references it, the guard reads the actual regular file and sends its contents to the judge; proposed replacement content is never assumed to have reached disk. Missing, unreadable, binary, symlinked, or larger-than-1-MiB files remain blocked. Paths containing `..` and paths through symlinks are treated as ambiguous rather than normalized into evidence; ambiguous mutations mark state uncertain, and ambiguous shell paths block when tracking is active. Literal shell paths otherwise resolve against the tool workdir or OpenCode directory. Dynamic script paths and shell directory changes fail closed when tracking is active. Ordinary writes without a recognized transfer primitive are not tracked. If a patch cannot be parsed, a mutation path is ambiguous, or a relative mutation cannot be resolved because OpenCode's project directory is unavailable, the guard marks state uncertain and blocks later local-script execution for the process lifetime. Exceeding the 100-file limit also marks state uncertain.

The plugin tracks in-flight write, edit, and patch calls process-wide until the matching `tool.execute.after` hook or a correlated terminal tool-error event. Local-script execution and references to tracked files block while a mutation is pending. OpenCode can report an interrupted call before the underlying tool stops, so interruption events do not clear pending state; if no later completion hook arrives, it remains until restart. Missing or uncorrelatable lifecycle events have the same limitation. Snapshots are re-read after judge requests before a shell call is allowed. Shell parsing is heuristic, and filesystem changes outside the observed tool hooks or after the final check can still race execution. Aliases and hard links are not fully accounted for.

## Secrets and data handling

The guard sends rendered tool arguments and extracted facts to the configured judge. Depending on the call, that can include secret-bearing command strings or staged file content. The judge endpoint is part of the trusted computing base. Use loopback or a trusted, protected network endpoint. The default URL uses plain HTTP, which provides no transport confidentiality or server authentication. `apiKey` adds a bearer header but does not encrypt the request.

Redaction runs on audit state and error text when `redactArguments` is true, and on the command preview returned in a blocked tool error regardless of that setting. It recognizes selected token forms, private-key blocks, credential assignments, connection-string passwords, and common secret query parameters. Redaction does not run on the judge request. Patterns can miss secrets, and redacting arguments can remove the context needed for an audit. Audit files are created with owner-only permissions, and existing active files are restricted before writing or rotation. They may still contain sensitive rendered state; protect their retention and existing rotated files. OpenCode logs omit the rendered state but contain verdict metadata, destinations, reason, and timing.

The guard cannot observe arbitrary network connections opened by child processes or tools. The prefilter can miss an outbound-capable command. Host scanning only examines explicit URLs in string values and object keys and has depth, node, and character limits; it does not detect bare hostnames or encoded URLs. The judge can miss attacks or flag legitimate commands. This plugin is not a substitute for OS sandboxing, network egress controls, or human review.

## Tests

Use Node.js 18.17 or newer. Run the test suite from the repository checkout:

```sh
npm test
```

`npm test` explicitly lists the five `*.test.js` files in `package.json`, so it does not depend on shell glob expansion or count `test/helpers.js` as a test file. Add new test files to that list. It runs deterministic `node:test` tests reconstructed from the restored implementation. These are new tests, not a recovery of the original suite. Judge requests use mock fetch implementations; no running judge or network access is needed. Filesystem fixtures use disposable temporary directories. Coverage includes configuration validation, judge failures, guard policy and cache isolation, staged-file snapshots, mutation lifecycle hooks, host scanning, redaction, and audit files. These tests do not establish compatibility with other OpenCode versions.

The checkout has no live-test or standalone mock-server script. Use `npm pack --dry-run` to inspect the publishable file list without creating a package archive. A test result describes that run and configuration. It does not establish that the guard detects every exfiltration attempt.

## Repository documentation

- [Security policy and vulnerability reporting](https://github.com/HumanFace-Tech/oc-one-guard/blob/main/SECURITY.md)
- [Design decisions](https://github.com/HumanFace-Tech/oc-one-guard/blob/main/DECISIONS.md)
- [Contributing](https://github.com/HumanFace-Tech/oc-one-guard/blob/main/CONTRIBUTING.md)

These documents are maintained in the repository rather than included in the npm package.

## References

- [OpenCode plugin documentation](https://opencode.ai/docs/plugins/)
- [llama.cpp System One server decision implementation](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/server-decision.cpp)
- [opencode-helicone-session](https://github.com/H2Shami/opencode-helicone-session) and [opencode-wakatime](https://github.com/angristan/opencode-wakatime) as examples of OpenCode plugins

## License

MIT. See [`LICENSE`](./LICENSE).
