import test from "node:test"
import assert from "node:assert/strict"
import { createStopController } from "../src/stop.js"

const tick = () => new Promise(resolve => setTimeout(resolve, 10))
function setup(overrides = {}) {
  const aborted = []
  const warnings = []
  const notices = []
  const session = {
    get: async ({ path }) => ({ data: { id: path.id, parentID: path.id === "child" ? "root" : undefined, directory: "/project" } }),
    abort: async ({ path }) => { aborted.push(path.id); return { data: true } },
    ...overrides,
  }
  const stop = createStopController({ client: { session }, directory: "/project", timeoutMs: 30, warn: message => warnings.push(message), notify: message => notices.push(message) })
  const message = (sessionID, id) => stop.observe({ sessionID }, { message: { id } })
  return { stop, aborted, warnings, notices, message }
}

test("deferred root-first cancellation is transient, deduplicated, and isolated", async () => {
  let release
  const starts = []
  const state = setup({ abort: ({ path, signal, throwOnError, query }) => {
    assert.equal(throwOnError, true)
    assert.equal(query.directory, "/project")
    assert.ok(signal)
    starts.push(path.id)
    return new Promise(resolve => { if (path.id === "root") release = () => resolve({ data: true }); else resolve({ data: true }) })
  } })
  state.message("root", "first")
  const ticket = state.stop.capture("child")
  await state.stop.request(ticket)
  assert.deepEqual(starts, [])
  assert.equal(await state.stop.pending("child"), true)
  assert.equal(await state.stop.pending("root"), true)
  assert.equal(await state.stop.pending("unrelated"), false)
  await tick()
  assert.deepEqual(starts, ["root", "child"])
  await state.stop.request(ticket)
  release()
  await tick()
  assert.equal(await state.stop.pending("root"), false)
  await state.stop.request(ticket)
  await tick()
  assert.deepEqual(starts, ["root", "child"])
  state.message("root", "second")
  await state.stop.request(state.stop.capture("child"))
  await tick()
  assert.deepEqual(starts, ["root", "child", "root", "child"])
  release()
  await tick()
  assert.match(state.notices[0], /Requested cancellation/)
})

test("new ancestor messages invalidate results before scheduling and before dispatch", async () => {
  for (const phase of ["before-request", "before-dispatch"]) {
    const { stop, message, aborted } = setup()
    message("root", "first")
    const ticket = stop.capture("child")
    if (phase === "before-request") message("root", "second")
    await stop.request(ticket)
    if (phase === "before-dispatch") message("root", "second")
    await tick()
    assert.deepEqual(aborted, [])
    assert.equal(await stop.pending("child"), false)
  }
})

test("origin tools block during ancestry preparation before cancellation is scheduled", async () => {
  let resolveLookup
  const { stop } = setup({ get: () => new Promise(resolve => { resolveLookup = resolve }) })
  const request = stop.request(stop.capture("root"))
  assert.equal(await stop.pending("root"), true)
  resolveLookup({ data: { id: "root" } })
  await request
  await tick()
  assert.equal(await stop.pending("root"), false)
})

test("lookup failures, malformed ancestry, cycles and hanging SDK are bounded and sanitized", async () => {
  for (const get of [
    async () => { throw new Error("secret") },
    async () => ({ error: "secret" }),
    async () => ({ data: { id: "wrong" } }),
    async ({ path }) => ({ data: { id: path.id, parentID: "child" } }),
    () => new Promise(() => {}),
  ]) {
    const { stop, aborted, warnings } = setup({ get })
    await stop.request(stop.capture("child"))
    await tick()
    assert.deepEqual(aborted, ["child"])
    assert.equal(warnings.length, 1)
    assert.doesNotMatch(warnings.join(), /secret/)
    assert.equal(await stop.pending("child"), false)
  }
})

test("partial ancestry cancels verified known parents, capped at 32 sessions", async () => {
  const partial = setup({ get: async ({ path }) => {
    if (path.id === "root") throw new Error("secret")
    return { data: { id: path.id, parentID: "root" } }
  } })
  await partial.stop.request(partial.stop.capture("child"))
  await tick()
  assert.deepEqual(partial.aborted, ["root", "child"])
  assert.equal(partial.warnings.length, 1)
  const capped = setup({ get: async ({ path }) => ({ data: { id: path.id, parentID: `${path.id}x` } }) })
  await capped.stop.request(capped.stop.capture("s"))
  await tick()
  assert.equal(capped.aborted.length, 32)
  assert.equal(capped.warnings.length, 1)
})

test("abort failures, unavailable API, bad data and ignored signals release pending operations", async () => {
  for (const abort of [undefined, async () => { throw new Error("secret") }, async () => ({ data: false }), async () => ({ data: true, error: "secret" }), async () => ({ data: true, response: { ok: false } }), async () => ({}), () => new Promise(() => {})]) {
    const { stop, warnings } = setup({ abort })
    await stop.request(stop.capture("child"))
    await new Promise(resolve => setTimeout(resolve, 50))
    assert.equal(await stop.pending("child"), false)
    assert.equal(warnings.length, 1)
    assert.doesNotMatch(warnings.join(), /secret/)
  }
})
