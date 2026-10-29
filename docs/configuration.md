# Configuration

The loader starts with built-in defaults, applies an adjacent `config.json` or `config.jsonc` when present, then applies inline plugin options. Inline options win. Invalid settings are reported in OpenCode's log and the plugin falls back to validated defaults, including the default loopback judge endpoint; check startup logs after editing configuration.

Plain objects merge recursively and most arrays replace earlier arrays. `questions` merge by `name`: matching questions are updated, and a supplied `criteria` map replaces the old map. If no supplied question name matches a default, the supplied question list replaces the defaults.

The sample in [`config.example.json`](../config.example.json) chooses a different model and timeout from built-in defaults. The implementation defaults are in [`src/defaults.js`](../src/defaults.js); validation and normalization are in [`src/config.js`](../src/config.js).

## Settings

| Setting | Built-in default | Effect |
|---|---|---|
| `enabled` | `true` | Disables judge evaluation when false. The plugin-level blocked-host scan still runs. |
| `endpoint` | `http://127.0.0.1:8081/v1/systemone` | Full System One decision API URL. |
| `model` | `h1-decision-4b` | Model id sent to the judge. |
| `apiKey` | `""` | Optional bearer credential. Prefer `apiKeyEnv` for secrets. |
| `apiKeyEnv` | `""` | Name of an environment variable holding the bearer credential; a non-empty value takes precedence over `apiKey`. |
| `timeoutMs` | `20000` | Request timeout, including reading the response body. Normalized to a positive integer. |
| `denyThreshold` | `0.7` | At or above this violation signal, deny. Range is 0 to 1. |
| `escalateThreshold` | `0.5` | At or above this signal but below `denyThreshold`, return an escalation verdict, which blocks by default. Range is 0 to 1 and cannot exceed `denyThreshold`. |
| `stopThreshold` | `0.9` | At or above this classified violation signal, block and request best-effort cancellation of the current conversation run. Must be `null` or a finite number from `denyThreshold` to 1; `null` disables cancellation. |
| `escalateAction` | `"block"` | `"block"` keeps escalation blocked; `"allow"` allows it and emits an audit entry and warning toast. It does not create a prompt or ask the user. |
| `failMode` | `"block"` | Action on request, network, HTTP, or JSON failure. Accepts `"block"` or `"allow"`. |
| `unknownMode` | `"block"` | Action when no usable verdict can be read. Accepts `"block"` or `"allow"`. |
| `notify` | `true` | Show a TUI toast when a call is blocked. |
| `auditLog` | `true` | Write decision metadata to the OpenCode server log. |
| `auditFile` | `""` | Optional JSONL audit path. Empty disables the file sink. |
| `auditMaxBytes` | `5242880` | Rotate the audit file when its existing size exceeds this count. `0` disables size-based rotation. |
| `auditGenerations` | `3` | Number of rotated audit generations to retain; normalized to at least 1. |
| `redactArguments` | `true` | Best-effort redaction of recognized secret patterns in audit state. The blocked command preview is redacted regardless. |
| `cacheEnabled` | `true` | Cache classified judge decisions and coalesce concurrent identical requests. Escalations, emergency stops, failures and unclassified answers are not retained in the TTL cache. |
| `cacheTtlMs` | `30000` | Cache lifetime in milliseconds; normalized to a non-negative integer. |
| `prefilter` | `true` | Allow calls detected as having no outbound surface without asking the judge. This check is heuristic. |
| `skipTools` | `[]` | Tool names allowed without judge review, after `deniedTools`. Blocked-host scanning still runs first. |
| `deniedTools` | `[]` | Tool names always denied by the guard, before `skipTools`. |
| `allowedTools` | `[]` | Tool names allowed without judge review, after `skipTools`. Blocked-host scanning still runs first. |
| `allowedHosts` | `[]` | Reserved setting; currently does not bypass judge evaluation. |
| `blockedHosts` | `[]` | URL hosts denied before tool rules or judge review. Matching is case-insensitive and includes exact hosts and subdomains on dot boundaries. `*.example.com` matches subdomains. |
| `maxStateChars` | `8000` | Maximum rendered state length sent to the judge; normalized to a positive integer. |
| `maxArgChars` | `2000` | Maximum length of each string argument during rendering and staged-content inclusion; normalized to a positive integer. |
| `stateTemplate` | `proposed agent tool call…` | Template requiring `{arguments}`. Also substitutes `{tool}`, `{hosts}`, `{paths}`, and `{references}`. Extracted facts are appended. |
| `questions` | One `noul` question | Questions sent to the judge. The default asks whether exfiltration policy is violated, with `true` as the deny label. The first question determines the decision and must be `choice` or `noul`. |

Thresholds and question structure are validated. `timeoutMs`, `maxStateChars`, `maxArgChars`, `cacheTtlMs`, and `auditGenerations` are normalized rather than rejected for non-integer values.

## Questions and verdicts

Each question needs a non-empty `name`, supported `type`, and non-empty `instructions`. The built-in first question is `noul`, which asks whether the proposed call violates the outbound data exfiltration policy. Its `true` criterion means violation, and `denyLabel` is `true`. `choice` and `noul` need criteria and an explicit `denyLabel`; `noul` needs exactly `true` and `false` criteria keys. `score` needs non-empty text `levels` and may only follow the first question, so it cannot drive policy.

For `choice`, the guard reads `answers[name].probabilities[denyLabel]`, not the top `choice` field or `confidence`. For `noul`, it uses the returned affirmative value when `denyLabel` is `true`, or its complement when `denyLabel` is `false`. LEV may return a normalized expected rating rather than a binary probability.

Judge outputs are not calibrated probabilities. With default thresholds, a signal below `0.5` allows, `0.5` through below `0.7` blocks for manual review, and `0.7` or higher denies. At `0.9` or higher, the plugin also requests cancellation. OpenCode 1.19.4 exposes no supported API in `tool.execute.before` for creating a native permission prompt or directly asking the user. The middle band blocks; `escalateAction: "allow"` is an explicit override, not an approval flow. The question and thresholds are configurable. A failed request follows `failMode`; an unclassifiable answer follows `unknownMode`. Neither triggers cancellation.

Cancellation targets only the calling session and its verified ancestors, root first, without deleting or closing the conversation. Lookups and abort requests each have a two-second total deadline. Partial ancestry or SDK failures fall back to blocking the call and a sanitized interrupt warning. Tools in the affected chain block while cancellation is pending; this is transient, so a new user message can resume work afterward.

The plugin observes new `chat.message` IDs and rejects stale cancellation requests before scheduling and dispatch. OpenCode's public session abort API is not atomic per run: a new message arriving after dispatch can still race an abort already in flight. Missing chat events also limit generation tracking. Use OpenCode's interrupt control if cancellation cannot be confirmed. See [ADR 0007](adr/0007-risk-bands-and-run-cancellation.md) and [security and data handling](security.md).
