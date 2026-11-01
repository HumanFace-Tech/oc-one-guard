# Changelog

## 0.2.0

- Adds an OpenCode 2.x entry (`setup`) beside the OpenCode 1.x entry (`server`). The default export is `{ id, setup, server }`. Both entries use one shared runtime (`src/runtime.js`). See [ADR 0011](docs/adr/0011-opencode-v2-adapter.md).
- 0.1.x loads as `failed` on OpenCode 2.x, and no tool call is reviewed. Use `bin/oc-one-guard-doctor` to check the plugin loaded.
- Tool names are matched through one map: `bash` and `shell`, `apply_patch` and `patch`, `task` and `subagent`. Policy lists match either name.
- Write, edit and read paths are read from `filePath` (1.x) or `path` (2.x).
- A write, edit or patch call without a session or call ID is refused. This fixes a 0.1.x leak where its pending state denied later script runs until restart.
- The `patch` tool is now tracked for written content, as `apply_patch` already was.
- On OpenCode 2.x, the guard writes no server log and shows no toast. `auditLog` and `notify` have no effect there.
- On 2.x, tool input that is not a JSON object is refused (a string is parsed once first), instead of being treated as empty and skipping the judge.
- `run` is no longer an alias of `shell`, so `skipTools: ["run"]` cannot skip shell calls.
- Nested calls that share a call id (Code Mode) release one pending write per completion hook. A pending write whose completion hook never fires expires after ten minutes and marks the scope uncertain.
- Policy, thresholds, judge protocol and fail-closed defaults are unchanged.
