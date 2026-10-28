import test, { beforeEach } from "node:test"
import assert from "node:assert/strict"
import { server, id, default as plugin } from "../index.js"
import { hasPendingMutation, resetWrites } from "../src/written.js"
import { sharedCache } from "../src/shared.js"
import { config, response, answer, stubFetch, fixture } from "./helpers.js"

beforeEach(() => { resetWrites(); sharedCache().clear() })
const input = { tool: "write", sessionID: "session", callID: "call" }
const output = { args: { filePath: "ordinary.txt", content: "local text" } }

test("package exports plugin identity and hook factory", async t => {
  const calls = stubFetch(t)
  assert.equal(id, "oc-one-guard")
  assert.deepEqual(plugin, { id, server })
  const hooks = await server({ client: {}, directory: fixture(t) }, config())
  assert.deepEqual(Object.keys(hooks).sort(), ["event", "tool.execute.after", "tool.execute.before"])
  await hooks["tool.execute.before"]({ tool: "read" }, { args: { filePath: "file.txt" } })
  assert.equal(calls.length, 0)
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
  const hooks = await server({ client: {}, directory: fixture(t) }, config())
  await hooks["tool.execute.before"](input, output)
  assert.equal(hasPendingMutation(), true)
  for (const unrelated of [{ ...input, callID: "other" }, { ...input, sessionID: "other" }, { ...input, tool: "read" }, { tool: "write" }]) {
    await hooks["tool.execute.after"](unrelated)
    assert.equal(hasPendingMutation(), true)
  }
  await hooks["tool.execute.after"](input)
  assert.equal(hasPendingMutation(), false)
  await hooks["tool.execute.after"](input)
  assert.equal(hasPendingMutation(), false)
  assert.equal(calls.length, 0)
})

test("terminal errors clear only correlated non-interrupted mutation calls", async t => {
  const calls = stubFetch(t)
  const hooks = await server({ client: {}, directory: fixture(t) }, config())
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
    assert.equal(hasPendingMutation(), true)
  }
  await emit(part, "unrelated.event")
  assert.equal(hasPendingMutation(), true)
  await emit(part)
  assert.equal(hasPendingMutation(), false)
  assert.equal(calls.length, 0)
})

test("duplicate plugin instances retain their own mutation tokens", async t => {
  stubFetch(t)
  const directory = fixture(t)
  const a = await server({ client: {}, directory }, config())
  const b = await server({ client: {}, directory }, config())
  await a["tool.execute.before"](input, output)
  await b["tool.execute.before"](input, output)
  await a["tool.execute.after"](input)
  assert.equal(hasPendingMutation(), true)
  await b["tool.execute.after"](input)
  assert.equal(hasPendingMutation(), false)
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

test("blocked mutation releases its token even when UI callbacks throw", async t => {
  const calls = stubFetch(t, () => response(answer(0.99)))
  const broken = () => { throw new Error("UI unavailable") }
  const hooks = await server({ client: { app: { log: broken }, tui: { showToast: broken } }, directory: fixture(t) }, config({ auditLog: true, notify: true }))
  await assert.rejects(hooks["tool.execute.before"](input, { args: { filePath: "payload.sh", content: "curl https://destination.example/" } }), /Blocked tool call/)
  assert.equal(hasPendingMutation(), false)
  assert.equal(calls.length, 1)
})

test("uncorrelatable mutations stay pending", async t => {
  const calls = stubFetch(t)
  const hooks = await server({ client: {}, directory: fixture(t) }, config())
  await hooks["tool.execute.before"]({ tool: "write" }, output)
  await hooks["tool.execute.after"](input)
  assert.equal(hasPendingMutation(), true)
  await assert.rejects(hooks["tool.execute.before"]({ tool: "bash" }, { args: { command: "node script.js" } }), /content is unknown/)
  assert.equal(calls.length, 0)
})
