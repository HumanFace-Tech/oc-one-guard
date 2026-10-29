# Security and data handling

`oc-one-guard` is a heuristic OpenCode guardrail, not a sandbox or network egress firewall. It may miss exfiltration attempts or block legitimate tool calls. Do not rely on it as the only control for sensitive systems.

## Host support and activation

This release supports OpenCode v1 only, with a conservative supported range of `>=1.19.4 <2`. The tested host version is 1.19.4, not every version in that range. Older versions and OpenCode v2 are unsupported.

An unregistered or unloaded plugin provides no protection. Fail-closed behavior applies only after the plugin loads and OpenCode invokes its hooks. Check startup logs after registration and restart; a load failure cannot be handled by the guard itself.

## Data handled

For calls that reach the judge, the plugin sends rendered tool arguments and extracted facts to the configured System One endpoint. Depending on the call, this may include command text or staged file contents. Redaction does not run on the judge request. The endpoint must be trusted to receive that data.

Rendered state can include tool arguments, extracted hosts and paths, file references, and content from an agent-written file later run as a script. Extracted facts take priority over raw arguments within the full-state limit. If the required facts cannot fit, the call is blocked. These limits do not make sensitive input safe to disclose.

Audit output may contain rendered state after best-effort redaction. Protect audit files and their rotated copies. The default endpoint is loopback HTTP. A bearer API key authenticates a request but does not encrypt it; use a protected transport when the judge is not on loopback.

Redaction recognizes selected token forms, private-key blocks, credential assignments, connection-string passwords, and common secret query parameters. It can miss secrets. OpenCode logs omit rendered state but contain verdict metadata, destinations, reason, and timing. Audit files may still contain sensitive state; restrict access and retention.

## What the checks do not cover

The plugin cannot observe arbitrary network connections opened by tools or child processes. The prefilter can miss an outbound-capable command. Host scanning checks explicit URLs in string values and object keys, within depth, node, and character limits; it does not detect bare hostnames or encoded URLs. The judge can miss attacks or flag legitimate commands. This is not a substitute for OS sandboxing, network egress controls, or human review.

The guard tracks writes and patches when content contains a recognized transfer primitive, or when they modify a file already tracked. It marks the affected file unknown before the write tool runs. A later shell call that references the file reads its actual regular-file contents; proposed content is never assumed to have reached disk. Missing, unreadable, binary, symlinked, or larger-than-1-MiB files remain blocked.

Paths containing `..` and paths through symlinks are treated as ambiguous rather than normalized into evidence. Ambiguous mutations mark state uncertain; ambiguous shell paths block when tracking is active. Literal paths resolve against the tool workdir or OpenCode directory. Dynamic script paths and shell directory changes fail closed while tracking is active. Ordinary writes without a recognized transfer primitive are not tracked. An unparsable patch, ambiguous mutation, unresolved relative mutation, or more than 100 tracked files can mark state uncertain and block later local-script execution for the process lifetime.

In-flight write, edit, and patch calls remain pending until a matching completion hook or correlated terminal tool-error event. Local-script execution and references to tracked files block while a mutation is pending. Interrupted events do not clear pending state because the underlying tool may still be running; if no completion event arrives, pending state remains until restart. Before allowing a shell call, the plugin rechecks file snapshots after the judge request. Aliases, hard links, filesystem changes outside observed hooks, and races after that final check remain limitations.

## Default policy expectations

- The default `noul` question treats `true` as an exfiltration-policy violation. Its signal is a policy cutoff, not a calibrated probability.
- A signal from `0.50` to below `0.70` blocks for manual review; this hook cannot open a native approval prompt or ask the user directly.
- A signal at or above `0.90` also requests best-effort cancellation of the calling conversation run and verified ancestors. It does not close or delete the conversation, and it cannot guarantee that an in-flight tool or child process stops. Set `stopThreshold` to `null` to disable this request.
- Judge request failures and unusable verdicts block by default.
- The configured escalation band blocks by default; `escalateAction: "allow"` can override that decision without prompting the user.
- Invalid configuration is logged and falls back to validated defaults.
- Host checks and filesystem tracking have bounded, heuristic coverage.

Configuration can change several decisions, including allowing escalation or failure cases. See [configuration](configuration.md).

## Report a vulnerability

Do not post credentials, exploit details, or sensitive data in a public issue. Use GitHub's private vulnerability reporting for this repository if enabled. Otherwise, contact the repository maintainer through GitHub and ask for a private reporting channel before sending technical details.

Include the affected version or commit, impact, and a minimal reproduction. Give maintainers time to investigate and prepare a fix before public disclosure. Do not include real secrets or private data in a report.
