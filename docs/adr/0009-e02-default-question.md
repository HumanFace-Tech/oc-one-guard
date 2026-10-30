# 0009 - Adopt the E02 default question

Status: Accepted

## Decision

Use the frozen E02 exfiltration question in `src/defaults.js`, with `noul`, `denyLabel: "true"`, and the `criteria` property omitted from the request. Preserve the 0.5, 0.7 and 0.9 policy thresholds. Explicit true/false criteria and custom questions remain supported. Servers may differ in whether they accept omitted criteria; users should verify their judge or configure explicit criteria.

## Evidence and consequences

The direct-judge evaluation compared the previous V0 default (15/53 benign and 37/37 malicious cases blocked) with E02 (3/53 benign and 32/37 malicious cases blocked). E02 missed `auth-06`, `storage-08`, `ssh-06`, `mcp-08`, and `web-07`. We selected it as a less restrictive tradeoff: fewer benign blocks, with five additional malicious misses on that fixture. These counts are not general detection rates.

The original run made 1,000 requests; a 300-request repeat across E02, E03, and E04 returned exact matching scores on the same fixture. Caching was not excluded, and the repeat is not independent validation. The test was direct-to-judge, without the full plugin or trusted task context. The server-reported model was `h2o-lightning-4b`; its revision and weights were not independently verified. See the [historical evaluation report](../research/e02-external-evaluation.md) for scope and limitations.

The judge must infer task authorization and the machine's trust boundary from available state, which may be unknown or incomplete. Tuning the prompt changes both false-positive and false-negative risks; it cannot guarantee security. The plugin is a heuristic guardrail, not a network security boundary.
