# What's Left?

The repository is an experimental OpenCode plugin with v1 and v2 entries. These are follow-ups, not promises or completed validation.

- [ ] Add CI for `npm test` and package-content checks.
- [ ] Smoke-test a clean checkout and an installed tarball on supported OpenCode, including judge failure and disabling the plugin from outside the session.
- [ ] Choose an available npm package name and maintainer account or organization; publish an explicitly experimental release and document package-based installation.
- [ ] Compare decision formats and calibrate thresholds on representative calls before making reliability claims. See the [research report](research/decision-model-formats-report.md).
- [ ] Complete OpenCode 2.x tool-call tests: benign and exfiltration calls, judge outage, staged-script execution, subagent child sessions and MCP tools. Until then 2.x support is provisional.
- [ ] Run the OpenCode 2.x doctor (`docs/installation.md#verify-it-loaded`) against an installed tarball before each release.

Publishing, deployment, and changes to user configuration require separate approval. None of these tasks should enable the guard automatically.
