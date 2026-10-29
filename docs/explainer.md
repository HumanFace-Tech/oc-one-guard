# What happens to a tool call?

oc-one-guard checks a proposed OpenCode tool call before it runs. It is a heuristic guardrail, not a network security boundary. This is the short GitHub-native version; the [HTML explainer](explainer.html) has a visual layout.

## The flow

```mermaid
flowchart TD
    A[Tool call proposed] --> B[Scan arguments for blocked URL hosts]
    B -->|Blocked host or incomplete scan| X[Block]
    B -->|No match| C[Apply tool overrides]
    C -->|deniedTools| X
    C -->|skipTools or allowedTools| Y[Allow without judge]
    C -->|No outbound surface| Y
    C -->|Needs review| D[Send state to System One judge]
    D -->|Below 0.50| Y
    D -->|0.50 to below 0.70| E[Block for manual review]
    D -->|0.70 or higher| X
    D -->|0.90 or higher| S[Block and request run cancellation]
    D -->|Offline, error, or unusable answer| X
```

If Mermaid does not render where you're reading this, here's the same flow in plain text:

1. OpenCode proposes a tool call. The plugin checks it in the `tool.execute.before` hook, before the tool runs.
2. The local blocked-host scan checks explicit URLs in argument strings and object keys. A matching host, or an incomplete scan, blocks the call before overrides or the judge.
3. Tool policy runs. `deniedTools` blocks; `skipTools` and `allowedTools` bypass the judge. A prefilter also allows calls with no detected outbound surface.
4. Calls still needing review go to the configured System One judge.
5. The result allows, escalates, or blocks the proposed call.

## What do the thresholds mean?

The default question is `noul`, with `true` configured as the violation label. The guard uses the resulting violation signal as a decision cutoff; it is not a calibrated probability. A custom `choice` question uses the probability for its configured `denyLabel`. A `score` question cannot drive the policy decision.

- Below `0.50`: allow.
- From `0.50` up to (but not including) `0.70`: block for manual review. This hook cannot create a native approval prompt or ask the user directly. `escalateAction: "allow"` is an explicit configuration override, not a prompt.
- `0.70` or higher: deny.
- `0.90` or higher: also request best-effort cancellation of the current conversation run and its verified ancestors. The conversation is retained. `stopThreshold: null` disables this; [configuration](configuration.md) explains the remaining per-run race.
- Judge offline, request error or timeout, malformed response, or unclassifiable answer: block by default (`failMode` and `unknownMode`).

The thresholds and question are configurable. `stopThreshold` must be `null` or a finite value from `denyThreshold` through `1`; `null` disables run-cancellation requests. Failures, unclassifiable output, blocked hosts, and denied tools do not trigger cancellation. See [ADR 0007](adr/0007-risk-bands-and-run-cancellation.md) for cancellation limits.

## Three example shapes

These are illustrative, not literal patterns the plugin guarantees to catch:

- A command posts `~/.aws/credentials` to an unfamiliar collector.
- A shell command pipes environment variables to an HTTP upload.
- A script is written first, then run later to send local files. Tracked staged-file contents can be included in the judge state.

The heuristics and judge can miss these, and can also flag legitimate work. No claim that every attack is caught.

## What should you keep in mind?

- The judge request is **not redacted**. It can contain rendered arguments and, in some cases, staged file contents. Use an endpoint you trust.
- The plugin cannot control arbitrary network activity from tools or child processes. Treat it as a guardrail, not a firewall or sandbox.
- This release targets OpenCode v1. Version `1.19.4` is the tested host; v2 is not supported.

For setup and details, see the [installation guide](installation.md), [configuration guide](configuration.md), and [security and data handling guide](security.md). The [HTML explainer](explainer.html) gives the longer visual walkthrough.
