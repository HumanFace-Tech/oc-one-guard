# ADR 0011: Support OpenCode 2.x through a shared core and two host adapters

**Status:** Accepted for 0.2.0. Supersedes [ADR 0001](0001-opencode-v1-only.md).

## Context

Versions 0.1.x export `{ id, server }`. OpenCode 2.x loads only a default export that has `id` and `setup` (or `effect`). On OpenCode 2.2.5 the 0.1.x package is reported as `failed to load plugin`, startup continues, and no tool call is reviewed. A load failure is therefore a silent loss of protection, which is the worst outcome for this plugin.

OpenCode 2.x replaces several host APIs that the guard used:

| 0.1.x (OpenCode 1.x) | OpenCode 2.2.x |
|---|---|
| `server(input, options)`, `input.directory`, `input.client` | `setup(ctx)`, `ctx.options`, `ctx.location.directory`, domain APIs. No `ctx.client`. |
| `"tool.execute.before"(hookInput, output)` with `callID`, `output.args` | `ctx.tool.hook("execute.before", event)` with `id`, `input` |
| `"tool.execute.after"(hookInput)` | `ctx.tool.hook("execute.after", event)`, also fired for `status: "error"` |
| `"chat.message"` | `ctx.session.hook("prompt", event)` |
| `event({ event })` with `message.part.updated` | No direct equivalent used; see below |
| `client.app.log`, `client.tui.showToast` | Not present. `ctx.app` has only `name`, `version`, `channel`. |
| `client.session.get`, `client.session.abort` | `ctx.session.get({ sessionID })`, `ctx.session.interrupt({ sessionID })` |

## Decision

### 1. Dual export

The default export is `{ id, setup, server }`:

- `setup(ctx)` is the OpenCode 2.x entry. It is a thin adapter in `src/adapters/v2.js`.
- `server(input, options)` is the OpenCode 1.x entry. It is a thin adapter in `src/adapters/v1.js`.
- Named exports `id` and `server` remain, as in 0.1.x.

Both adapters call one host-agnostic core, `createGuardRuntime` in `src/runtime.js`. Policy, judge calls, fallback, thresholds, blocked hosts, written-file tracking and cancellation logic are unchanged.

The package does not import `@opencode/plugin` at runtime. `Plugin.define` is the identity function, so the object literal is equivalent.

The v1 entry is kept because 1.19.4 is still the daily driver. The dual export is accepted only if OpenCode 1.19.4 loads the package and runs the guard. The verification result is recorded at the end of this ADR.

### 2. Canonical tool ids

Tool names are compared through one map in `src/tools.js`. Canonical names are the OpenCode 2.x ids.

| Name seen on host | Canonical id |
|---|---|
| `shell`, `bash`, `run` | `shell` |
| `patch`, `apply_patch` | `patch` |
| `subagent`, `task` | `subagent` |
| `write`, `edit`, `read`, `webfetch`, `grep`, `glob`, and others | unchanged |

User lists (`deniedTools`, `skipTools`, `allowedTools`) are compared through the same map, so a 1.x list such as `["bash"]` also matches the 2.x `shell` tool.

`patch` is a content-tracking tool. In 0.1.x only `apply_patch` was, and `patch` sat in the local-only list. On OpenCode 2.x the patch tool is named `patch`, so it must be tracked the same way. The effect on 1.x is only that a tool named `patch` is no longer skipped as local-only.

### 3. Argument field names

| Tool (canonical) | 2.2.x fields | 1.x fields | Used for |
|---|---|---|---|
| `shell` | `command`, `workdir`, `timeout`, `background` | `command`, `workdir` | command text, relative paths |
| `write` | `path`, `content` | `filePath`, `content` | staged-file tracking, content |
| `edit` | `path`, `oldString`, `newString`, `replaceAll` | `filePath`, `oldString`, `newString` | staged-file tracking, content |
| `patch` | `patchText` | `patchText` (`apply_patch`) | staged-file tracking, content |
| `read` | `path` | `filePath` | path facts |
| `webfetch` | `url`, `format`, `timeout` | `url` | destination host |
| `subagent` | `agent`, `description`, `prompt`, `model`, `sessionID`, `background` | `task` fields | judged as a generic call |

Both `path` and `filePath` are read. The guard treats every listed path as evidence, so a call that carries both is handled as two references, not one.

The judge state still renders the raw arguments, so 2.x calls show `path` and 1.x calls show `filePath`.

### 4. Pending-mutation key and the token leak

Pending state is keyed by `${sessionID}\0${callID}`. In 2.x the key is always defined (`sessionID` and `id`).

0.1.x created a pending token before it checked whether the hook carried `callID` and `sessionID`. Without a key the token was never removed, so `hasPendingMutation` stayed true until restart and interpreter commands were denied.

The fix is to refuse an uncorrelated mutation call before any token is created. The call is blocked with a message the model can read, and no permanent state is created. Refusing the call is the fail-closed choice. Letting it run would open a window where a script could execute while the write is still in flight. This changes the 0.1.x behavior for calls the host does not correlate, and no normal OpenCode call is expected to take that path.

Pending tokens are removed by `execute.before` on refusal, by `execute.after` for both `completed` and `error` statuses, and by cleanup.

### 5. Events

The 2.x event stream is not used. `execute.after` runs for failed tool calls (`status: "error"`), which covers the 0.1.x terminal-error event. An interrupted call (fiber interruption) does not run `execute.after`, so a `write`, `edit` or `patch` interrupted by the user keeps its pending token until restart. That is over-blocking, not an allow path, and it is documented in `docs/security.md`.

### 6. Logging, toasts and the startup line

| 0.1.x | 0.2.0 on OpenCode 2.x |
|---|---|
| `client.app.log` (audit entries, startup status, config problems) | Not available. Decision records go to the optional JSONL `auditFile`. Startup status is not logged. |
| `client.tui.showToast` (blocked and escalated calls) | Not available. The blocked message is returned to the model as the tool error. |
| `Guard active` / `DISABLED` startup line | Not logged. Activation is checked with the doctor script in `docs/installation.md`, which reads the startup log; `plugin list` is not reliable in a short-lived private server. |

No fake of the old API is provided. `notify` has no effect on OpenCode 2.x. On OpenCode 1.x the behavior is unchanged.

### 7. Stop controller

`src/stop.js` keeps its `client.session.get` and `client.session.abort` shape. The v2 adapter supplies a shim:

- `get` calls `ctx.session.get({ sessionID })`.
- `abort` calls `ctx.session.interrupt({ sessionID })` and returns `interrupted` as `data`. `interrupted: false` means there was no active execution, and the existing "could not be fully confirmed" warning applies.

Root-first ancestry, deadlines, generation checks and transient pending state are unchanged. The warning path uses `warn`, which has no host sink in 2.x.

### 8. Cleanup

`setup` returns a cleanup function, which calls `runtime.dispose()`. Dispose:

- removes every pending token this instance holds;
- if any token was held, marks the scope uncertain, so local-script execution is denied until restart. The in-flight write may still land after its hook is gone, and the guard cannot see it;
- leaves no timers: the stop controller's timers are bounded and cleared when each operation settles.

Registrations are disposed by the host when the plugin unloads.

### 9. Scope

2.x exposes `location.directory` and `location.project` (`id`, `directory`, `canonical`), but not `vcs`. The v2 adapter uses `project.id` and `project.directory` for the scope key. A project with the id `global` falls back to a directory scope, because 0.1.x required `vcs === "git"` before it used the worktree for that id. Two sessions in different subdirectories of an empty Git repository that has the `global` id therefore do not share written-file state. This is documented as a limitation.

### 10. Hook order and input

Hooks run in registration order. Built-in `execute.before` hooks register before user plugins: input repair (which also renames `bash` to `shell`) and subagent defaults. The guard therefore judges the input after those rewrites. Plugins loaded after the guard that change `event.input` or `event.tool` in `execute.before` can change the call after it is judged. This is a documented risk, not a guarantee the guard can enforce.

If `event.input` is not an object, the guard uses `{}`. The host's own input validation is expected to reject a non-object input before the tool runs. This is not verified end to end.

### 11. What does not change

Policy, thresholds, the judge question and protocol, fallback behavior, the blocked-host scan, prefilter lists, redaction, audit redaction and rotation, and the fail-closed defaults for judge failure and unclassifiable answers are unchanged.

## Consequences

- One package runs on OpenCode 1.19.4 and 2.2.x. A load failure on 2.x is detectable with the doctor script (see the installation guide), which reads the startup log; `plugin list` is not reliable in a short-lived private server.
- The 2.x path has less visibility: no server log, no toast. The audit file and the blocked message are the only signals.
- The uncorrelated-call refusal and the `patch` tracking are intentional behavior changes, each covered by tests.

## Verification

Checked in a sandbox against OpenCode 2.2.5 and 1.19.4 (not on the user's data):

- Unit tests: `npm test` passes, including `test/v2-adapter.test.js` (fake OpenCode 2.x context). The uncorrelated-call regression test fails when the refusal is disabled.
- OpenCode 2.2.5 host state, from a private server snapshot: the 0.2.0 package is `active`; the 0.1.2 package is `failed` with `Plugin must export a default definition with an id and an effect or setup function.`
- The doctor script exits 0 with 0.2.0 and exits 1 with 0.1.2.
- OpenCode 1.19.4 loads the 0.2.0 package and logs `Guard active`, through the `server` entry.

Not verified: tool calls on either host through a real model. The scripted end-to-end scenarios (benign, exfiltration, judge outage, staged script, subagent child) were not run because the sandbox could not route a custom provider to a scripted model. The "judge sees staged content" path is covered only by the fake-context test.
