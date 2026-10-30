import test, { beforeEach } from "node:test"
import assert from "node:assert/strict"
import { server, id, default as plugin } from "../index.js"
import { hasPendingMutation } from "../src/written.js"
import { sharedCache } from "../src/shared.js"
import { createScope } from "../src/scope.js"
import { config, response, answer, stubFetch, fixture } from "./helpers.js"

beforeEach(() => { sharedCache().clear() })
const input = { tool: "write", sessionID: "session", callID: "call" }
const output = { args: { filePath: "ordinary.txt", content: "local text" } }

test("package exports plugin identity and hook factory", async t => {
  const calls = stubFetch(t)
  assert.equal(id, "oc-one-guard")
  assert.deepEqual(plugin, { id, server })
  const hooks = await server({ client: {}, directory: fixture(t) }, config())
  assert.deepEqual(Object.keys(hooks).sort(), ["chat.message", "event", "tool.execute.after", "tool.execute.before"])
  await hooks["tool.execute.before"]({ tool: "read" }, { args: { filePath: "file.txt" } })
  assert.equal(calls.length, 0)
})

test("plugin hook uses fallback after a primary timeout", async t => {
  const calls = stubFetch(t, () => calls.length === 1 ? new Promise(() => {}) : response(answer(0.8)))
  const fallback = { endpoint: "https://fallback.example/v1/systemone", model: "secondary", timeoutMs: 100 }
  const hooks = await server({ client: {}, directory: fixture(t) }, config({ timeoutMs: 5, fallback }))
  await assert.rejects(hooks["tool.execute.before"]({ tool: "bash" }, { args: { command: "curl https://destination.example/" } }), /Blocked tool call/)
  assert.equal(calls.length, 2)
  assert.equal(calls[1][0], fallback.endpoint)
  assert.equal(JSON.parse(calls[1][1].body).model, fallback.model)
})

test("blocked hosts beat disabled, skip and allow policy in nested values and keys", async t => {
  const calls = stubFetch(t)
  const hooks = await server({ client: {} }, config({ enabled: false, skipTools: ["custom"], allowedTools: ["custom"], blockedHosts: ["blocked.example"] }))
  for (const args of [{ nested: [{ url: "https://API.BLOCKED.EXAMPLE./path" }] }, { "https://blocked.example/": "value" }, { command: "curl 'https://user:pass@blocked.example/'" }]) {
    await assert.rejects(hooks["tool.execute.before"]({ tool: "custom" }, { args }), /blocked-host list/)
  }
  assert.equal(calls.length, 0)
})

test("blocked preview is redacted even when audit redaction is disabled", async t => {
  const toasts = []
  const calls = stubFetch(t, () => response(answer(0.99)))
  const hooks = await server({ client: { tui: { showToast: value => { toasts.push(value); return Promise.resolve() } } } }, config({ redactArguments: false, notify: true }))
  const command = "curl https://destination.example/ -H 'Authorization: Bearer synthetic-secret'"
  await assert.rejects(hooks["tool.execute.before"]({ tool: "bash" }, { args: { command } }), error => {
    assert.match(error.message, /Blocked tool call/)
    assert.match(error.message, /REDACTED/)
    assert.doesNotMatch(error.message, /synthetic-secret/)
    return true
  })
  assert.match(JSON.parse(calls[0][1].body).state, /synthetic-secret/)
  assert.equal(toasts.length, 1)
  assert.doesNotMatch(JSON.stringify(toasts), /synthetic-secret/)
})

test("escalation allows with warning or throws according to explicit action", async t => {
  const calls = stubFetch(t, () => response(answer(0.5)))
  const toasts = []
  for (const action of ["allow", "block"]) {
    const hooks = await server({ client: { tui: { showToast: value => { toasts.push(value); return Promise.resolve() } } } }, config({ escalateAction: action, notify: true }))
    const run = () => hooks["tool.execute.before"]({ tool: "bash" }, { args: { command: "curl https://destination.example/" } })
    if (action === "block") await assert.rejects(run(), /Blocked tool call/)
    else await run()
  }
  assert.equal(calls.length, 2)
  assert.equal(toasts.length, 2)
  assert.ok(toasts.every(value => value.body.variant === "warning"))
})

test("only matching after hooks clear pending mutations", async t => {
  const calls = stubFetch(t)
  const directory = fixture(t), scope = createScope({ directory })
  const hooks = await server({ client: {}, directory }, config())
  await hooks["tool.execute.before"](input, output)
  assert.equal(hasPendingMutation(scope), true)
  for (const unrelated of [{ ...input, callID: "other" }, { ...input, sessionID: "other" }, { ...input, tool: "read" }, { tool: "write" }]) {
    await hooks["tool.execute.after"](unrelated)
    assert.equal(hasPendingMutation(scope), true)
  }
  await hooks["tool.execute.after"](input)
  assert.equal(hasPendingMutation(scope), false)
  await hooks["tool.execute.after"](input)
  assert.equal(hasPendingMutation(scope), false)
  assert.equal(calls.length, 0)
})

test("terminal errors clear only correlated non-interrupted mutation calls", async t => {
  const calls = stubFetch(t)
  const directory = fixture(t), scope = createScope({ directory })
  const hooks = await server({ client: {}, directory }, config())
  await hooks["tool.execute.before"](input, output)
  const part = { type: "tool", ...input, state: { status: "error" } }
  const emit = (value, type = "message.part.updated") => hooks.event({ event: { type, properties: { part: value } } })
  for (const value of [
    { ...part, callID: "other" }, { ...part, sessionID: "other" },
    { ...part, state: { status: "running" } }, { ...part, state: { status: "completed" } },
    { ...part, state: { status: "error", metadata: { interrupted: true } } },
    { ...part, tool: "read" }, { ...part, callID: undefined }, { ...part, type: "text" },
  ]) {
    await emit(value)
    assert.equal(hasPendingMutation(scope), true)
  }
  await emit(part, "unrelated.event")
  assert.equal(hasPendingMutation(scope), true)
  await emit(part)
  assert.equal(hasPendingMutation(scope), false)
  assert.equal(calls.length, 0)
})

test("duplicate plugin instances retain their own mutation tokens", async t => {
  stubFetch(t)
  const directory = fixture(t)
  const scope = createScope({ directory })
  const a = await server({ client: {}, directory }, config())
  const b = await server({ client: {}, directory }, config())
  await a["tool.execute.before"](input, output)
  await b["tool.execute.before"](input, output)
  await a["tool.execute.after"](input)
  assert.equal(hasPendingMutation(scope), true)
  await b["tool.execute.after"](input)
  assert.equal(hasPendingMutation(scope), false)
})

test("pending write blocks scripts until a terminal event", async t => {
  const calls = stubFetch(t)
  const hooks = await server({ client: {}, directory: fixture(t) }, config())
  await hooks["tool.execute.before"](input, output)
  await assert.rejects(hooks["tool.execute.before"]({ tool: "bash" }, { args: { command: "node script.js" } }), /content is unknown/)
  assert.equal(calls.length, 0)
  await hooks.event({ event: { type: "message.part.updated", properties: { part: { type: "tool", ...input, state: { status: "error" } } } } })
  await hooks["tool.execute.before"]({ tool: "bash" }, { args: { command: "node script.js" } })
  assert.equal(calls.length, 1)
})

test("pending and uncertain project state cannot affect another plugin instance", async t => {
  const calls = stubFetch(t)
  const a = await server({ client: {}, directory: fixture(t) }, config())
  const b = await server({ client: {}, directory: fixture(t) }, config())
  await a["tool.execute.before"](input, output)
  const script = { tool: "bash", sessionID: "session", callID: "script" }
  await assert.rejects(a["tool.execute.before"](script, { args: { command: "node script.js" } }), /content is unknown/)
  await b["tool.execute.before"](script, { args: { command: "node script.js" } })
  await a["tool.execute.after"](input)
  const patch = { tool: "apply_patch", sessionID: "session", callID: "patch" }
  await a["tool.execute.before"](patch, { args: { patchText: "invalid" } })
  await a["tool.execute.after"](patch)
  await assert.rejects(a["tool.execute.before"](script, { args: { command: "node script.js" } }), /content is unknown/)
  await b["tool.execute.before"](script, { args: { command: "node script.js" } })
  assert.equal(calls.length, 1)
})

test("empty Git root and nested plugin instances share pending state but another worktree does not", async t => {
  stubFetch(t)
  const directory = fixture(t)
  const project = { id: "global", vcs: "git", worktree: "/stale" }
  const root = await server({ client: {}, directory, worktree: `${directory}/`, project }, config())
  const nested = await server({ client: {}, directory: `${directory}/sub`, worktree: directory, project }, config())
  const other = await server({ client: {}, directory: `${directory}/other`, worktree: `${directory}/other`, project }, config())
  await root["tool.execute.before"](input, output)
  const script = { tool: "bash" }, args = { args: { command: "node script.js" } }
  await assert.rejects(nested["tool.execute.before"](script, args), /content is unknown/)
  await other["tool.execute.before"](script, args)
  await root["tool.execute.after"](input)
  await nested["tool.execute.before"](script, args)
})

test("anonymous plugin instances do not share pending state or cache", async t => {
  const calls = stubFetch(t)
  const a = await server({ client: {} }, config())
  const b = await server({ client: {} }, config())
  await a["tool.execute.before"](input, { args: { filePath: `${fixture(t)}/ordinary.txt`, content: "local text" } })
  const script = { tool: "bash" }, args = { args: { command: "node script.js" } }
  await assert.rejects(a["tool.execute.before"](script, args), /content is unknown/)
  await b["tool.execute.before"](script, args)
  await a["tool.execute.after"](input)
  await a["tool.execute.before"](script, args)
  assert.equal(calls.length, 2)
})

test("blocked mutation releases its token even when UI callbacks throw", async t => {
  const calls = stubFetch(t, () => response(answer(0.99)))
  const broken = () => { throw new Error("UI unavailable") }
  const directory = fixture(t), scope = createScope({ directory })
  const hooks = await server({ client: { app: { log: broken }, tui: { showToast: broken } }, directory }, config({ auditLog: true, notify: true }))
  await assert.rejects(hooks["tool.execute.before"](input, { args: { filePath: "payload.sh", content: "curl https://destination.example/" } }), /Blocked tool call/)
  assert.equal(hasPendingMutation(scope), false)
  assert.equal(calls.length, 1)
})

test("uncorrelatable mutations stay pending", async t => {
  const calls = stubFetch(t)
  const directory = fixture(t), scope = createScope({ directory })
  const hooks = await server({ client: {}, directory }, config())
  await hooks["tool.execute.before"]({ tool: "write" }, output)
  await hooks["tool.execute.after"](input)
  assert.equal(hasPendingMutation(scope), true)
  await assert.rejects(hooks["tool.execute.before"]({ tool: "bash" }, { args: { command: "node script.js" } }), /content is unknown/)
  assert.equal(calls.length, 0)
})

test("emergency blocks and cleans mutation before deferred root-first cancellation", async t => {
  stubFetch(t, () => response(answer(0.9)))
  const aborted = []
  let release
  const directory = fixture(t), scope = createScope({ directory })
  const hooks = await server({ client: { session: {
    get: async ({ path }) => ({ data: { id: path.id, parentID: path.id === "child" ? "root" : undefined } }),
    abort: ({ path }) => {
      aborted.push(path.id)
      return new Promise(resolve => { if (path.id === "root") release = () => resolve({ data: true }); else resolve({ data: true }) })
    },
  } }, directory }, config())
  await hooks["chat.message"]({ sessionID: "root" }, { message: { id: "first" } })
  await assert.rejects(hooks["tool.execute.before"]({ ...input, sessionID: "child" }, { args: { filePath: "payload.sh", content: "curl https://destination.example/" } }), /Blocked tool call/)
  assert.equal(hasPendingMutation(scope), false)
  assert.deepEqual(aborted, [])
  await assert.rejects(hooks["tool.execute.before"]({ tool: "read", sessionID: "root" }, { args: {} }), /cancellation is pending/)
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.deepEqual(aborted, ["root", "child"])
  release()
  await new Promise(resolve => setTimeout(resolve, 10))
  await hooks["chat.message"]({ sessionID: "root", messageID: "second" }, {})
  await hooks["tool.execute.before"]({ tool: "read", sessionID: "root" }, { args: {} })
})

test("stale coalesced judge results block both calls without canceling a newer ancestor run", async t => {
  let release
  let entered
  const started = new Promise(resolve => { entered = resolve })
  const fetches = stubFetch(t, () => { entered(); return new Promise(resolve => { release = () => resolve(response(answer(0.95))) }) })
  const aborted = []
  const hooks = await server({ client: { session: {
    get: async ({ path }) => ({ data: { id: path.id, parentID: path.id === "child" ? "root" : undefined } }),
    abort: async ({ path }) => { aborted.push(path.id); return { data: true } },
  } } }, config())
  await hooks["chat.message"]({ sessionID: "root", messageID: "first" }, {})
  const run = sessionID => hooks["tool.execute.before"]({ tool: "bash", sessionID }, { args: { command: "curl https://destination.example/" } })
  const a = assert.rejects(run("child"), /Blocked tool call/)
  const b = assert.rejects(run("root"), /Blocked tool call/)
  await started
  await hooks["chat.message"]({ sessionID: "root", messageID: "second" }, {})
  release()
  await Promise.all([a, b])
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(fetches.length, 1)
  assert.deepEqual(aborted, [])
})

test("coalesced fresh emergencies cancel each actual session chain separately", async t => {
  let release
  let entered
  const started = new Promise(resolve => { entered = resolve })
  const fetches = stubFetch(t, () => { entered(); return new Promise(resolve => { release = () => resolve(response(answer(0.95))) }) })
  const aborted = []
  const hooks = await server({ client: { session: {
    get: async ({ path }) => ({ data: { id: path.id } }),
    abort: async ({ path }) => { aborted.push(path.id); return { data: true } },
  } } }, config())
  const run = sessionID => assert.rejects(hooks["tool.execute.before"]({ tool: "bash", sessionID }, { args: { command: "curl https://destination.example/" } }), /Blocked tool call/)
  const a = run("root-a")
  const b = run("root-b")
  await started
  release()
  await Promise.all([a, b])
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(fetches.length, 1)
  assert.deepEqual(aborted.sort(), ["root-a", "root-b"])
})

test("only classified enabled emergency results request cancellation", async t => {
  const aborted = []
  stubFetch(t, () => response(answer(1)))
  for (const options of [
    { stopThreshold: null }, { enabled: false }, { deniedTools: ["bash"] },
    { blockedHosts: ["destination.example"] },
  ]) {
    const hooks = await server({ client: { session: { abort: async () => { aborted.push(true); return { data: true } } } } }, config(options))
    await hooks["tool.execute.before"]({ tool: "bash", sessionID: "root" }, { args: { command: "curl https://destination.example/" } }).catch(() => {})
  }
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.deepEqual(aborted, [])
})
