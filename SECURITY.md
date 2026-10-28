# Security policy

`oc-one-guard` is a heuristic OpenCode guardrail, not a sandbox or network egress firewall. It may miss exfiltration attempts or block legitimate tool calls. Do not rely on it as the only control for sensitive systems.

## Host support and activation

This release supports OpenCode v1 only, with a conservative supported range of `>=1.19.4 <2`. The tested host version is 1.19.4, not every version in that range. Older versions are unsupported; no compatibility claim is made for them. OpenCode v2 is not supported.

An unregistered or unloaded plugin provides no protection. Fail-closed behavior applies only after the plugin loads and OpenCode invokes its hooks. Check startup logs after registration and restart; a load failure cannot be handled by the guard itself.

## Data handled

For calls that reach the judge, the plugin sends rendered tool arguments and extracted facts to the configured System One endpoint. Depending on the call, this may include command text or staged file contents. Redaction does not run on the judge request. The endpoint must be trusted to receive that data.

Audit output may contain rendered state after best-effort redaction. Protect audit files and their rotated copies. The default endpoint is loopback HTTP. A bearer API key authenticates a request but does not encrypt it; use a protected transport when the judge is not on loopback.

## Reporting a vulnerability

Do not post credentials, exploit details, or sensitive data in a public issue. Use GitHub's private vulnerability reporting for this repository if it is enabled. Otherwise, contact the repository maintainer through GitHub and ask for a private reporting channel before sending technical details.

Include the affected version or commit, the impact, and a minimal reproduction. Give maintainers time to investigate and prepare a fix before public disclosure. Do not include real secrets or private data in a report.

## Supported security expectations

- Judge request failures and unusable verdicts block by default.
- Escalations block by default.
- Invalid configuration falls back to validated defaults and reports the problem to OpenCode logs.
- Host checks and filesystem tracking have bounded, heuristic coverage. They are not comprehensive inspection of network destinations or process behavior.

These expectations describe the defaults. Configuration can change several decisions, including allowing escalation or failure cases.
