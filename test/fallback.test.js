import test from "node:test"
import assert from "node:assert/strict"
import { createGuard } from "../src/guard.js"
import { createScope } from "../src/scope.js"
import { requestDecision } from "../src/judge.js"
import { mergeConfig } from "../src/defaults.js"
import { config, response, answer } from "./helpers.js"

const fallback = { endpoint: "https://fallback.example/v1/systemone", model: "secondary", timeoutMs: 5 }
const call = { tool: "bash", args: { command: "curl https://destination.example" } }
const stalled = () => new Promise(() => {})

test("fallback configuration is opt-in and rejects incomplete or invalid settings without disclosing values", () => {
  assert.equal(config().fallback, null)
  assert.equal(config({ timeoutMs: 123, fallback: { endpoint: "x", model: "y" } }).fallback.timeoutMs, 20000)
  for (const value of [{}, { endpoint: "secret-url" }, { model: "secret-model" }, [], false, { ...fallback, apiKey: 42 }, { ...fallback, apiKeyEnv: null }, { ...fallback, timeoutMs: 0 }, { ...fallback, timeoutMs: 1.5 }, { ...fallback, timeoutMs: "5" }, { ...fallback, timeoutMs: Infinity }, { ...fallback, extra: "secret-value" }]) {
    assert.throws(() => config({ fallback: value }), error => {
      assert.doesNotMatch(error.message, /secret-url|secret-model|secret-value|fallback\.example/)
      return true
    })
  }
})

test("overriding a fallback replaces its credentials instead of merging them across endpoints", () => {
  const layered = mergeConfig({ fallback: { ...fallback, apiKey: "private" } }, { fallback: { endpoint: "https://other.example", model: "other" } })
  assert.equal(config(layered).fallback.apiKey, undefined)
  assert.throws(() => config(mergeConfig({ fallback }, { fallback: { model: "other" } })), /fallback.endpoint/)
})

for (const phase of ["headers", "body"]) {
  test(`primary stalled ${phase} triggers one independently authenticated fallback`, async () => {
    const requests = []
    const guard = createGuard(config({ timeoutMs: 5, apiKey: "primary-key", fallback: { ...fallback, apiKey: "secondary-key" } }), {
      scope: createScope(), cache: new Map(), fetchImpl: async (url, init) => {
        requests.push({ url, init })
        if (requests.length === 1) return phase === "headers" ? stalled() : { ok: true, text: stalled }
        return response()
      },
    })
    const result = await guard.evaluate(call)
    assert.equal(result.verdict, "allow")
    assert.equal(result.source, "fallback")
    assert.equal(requests.length, 2)
    assert.equal(requests[0].init.signal.aborted, true)
    assert.equal(requests[0].init.headers.Authorization, "Bearer primary-key")
    assert.equal(requests[1].init.headers.Authorization, "Bearer secondary-key")
    const primary = JSON.parse(requests[0].init.body), secondary = JSON.parse(requests[1].init.body)
    assert.equal(secondary.model, "secondary")
    assert.equal(secondary.state, primary.state)
    assert.deepEqual(secondary.questions, primary.questions)
  })
}

test("fallback resolves its own environment key and never inherits primary credentials", async t => {
  const old = process.env.OC_GUARD_FALLBACK_TEST_KEY
  t.after(() => { if (old === undefined) delete process.env.OC_GUARD_FALLBACK_TEST_KEY; else process.env.OC_GUARD_FALLBACK_TEST_KEY = old })
  process.env.OC_GUARD_FALLBACK_TEST_KEY = "env-key"
  for (const [settings, expected] of [[{ apiKey: "inline", apiKeyEnv: "OC_GUARD_FALLBACK_TEST_KEY" }, "Bearer env-key"], [{}, undefined]]) {
    const headers = []
    const guard = createGuard(config({ timeoutMs: 5, apiKey: "primary", fallback: { ...fallback, ...settings } }), { scope: createScope(), cache: new Map(), fetchImpl: async (_url, init) => {
      headers.push(init.headers.Authorization)
      return headers.length === 1 ? stalled() : response()
    } })
    await guard.evaluate(call)
    assert.deepEqual(headers, ["Bearer primary", expected])
  }
})

for (const [name, impl] of [
  ["network", async () => { throw new Error("secret") }],
  ["abort", async () => { throw Object.assign(new Error("secret"), { name: "AbortError" }) }],
  ["HTTP", async () => ({ ok: false, status: 500, text: async () => "secret" })],
  ["malformed", async () => ({ ok: true, text: async () => "secret" })],
  ["unclassifiable", async () => response({ answers: {} })],
]) {
  test(`${name} primary result does not trigger fallback`, async () => {
    let count = 0
    const audit = []
    const guard = createGuard(config({ fallback }), { scope: createScope(), cache: new Map(), writeAudit: (...args) => audit.push(args), fetchImpl: async (...args) => { count++; return impl(...args) } })
    const decision = await guard.evaluate(call)
    assert.equal(decision.verdict, "deny")
    assert.equal(count, 1)
    assert.doesNotMatch(JSON.stringify(audit), /secret|fallback\.example/)
  })
}

test("an unrelated AbortError is network, not timeout", async () => {
  await assert.rejects(requestDecision({ ...config(), state: "x", fetchImpl: async () => { throw Object.assign(new Error(), { name: "AbortError" }) } }), { kind: "network" })
})

for (const [probability, verdict, stop] of [[0.1, "allow", false], [0.6, "escalate", false], [0.8, "deny", false], [0.95, "deny", true]]) {
  test(`fallback probability ${probability} uses normal policy and stop threshold`, async () => {
    let count = 0
    const guard = createGuard(config({ timeoutMs: 5, fallback }), { scope: createScope(), cache: new Map(), fetchImpl: async () => ++count % 2 ? stalled() : response(answer(probability)) })
    const result = await guard.evaluate(call)
    assert.equal(result.verdict, verdict)
    assert.equal(result.stop, stop)
    assert.equal(result.source, "fallback")
    const again = await guard.evaluate(call)
    assert.equal(again.source, "fallback")
    assert.equal(count, verdict === "escalate" || stop ? 4 : 2)
  })
}

test("fallback failures and unclassifiable responses follow policy and are not cached", async () => {
  for (const [impl, overrides, mode] of [
    [stalled, {}, "fail-block"],
    [async () => { throw new Error("secret") }, { failMode: "allow" }, "fail-allow"],
    [async () => response({ answers: {} }), {}, "unknown-block"],
    [async () => response({ answers: {} }), { unknownMode: "allow" }, "unknown-allow"],
  ]) {
    let count = 0
    const guard = createGuard(config({ timeoutMs: 5, fallback, ...overrides }), { scope: createScope(), cache: new Map(), fetchImpl: async () => ++count % 2 ? stalled() : impl() })
    assert.equal((await guard.evaluate(call)).mode, mode)
    assert.equal((await guard.evaluate(call)).mode, mode)
    assert.equal(count, 4)
  }
})

test("fallback cache is isolated by configuration and resolved environment credential", async t => {
  const name = "OC_GUARD_CACHE_TEST_KEY", old = process.env[name]
  t.after(() => { if (old === undefined) delete process.env[name]; else process.env[name] = old })
  const cache = new Map(), scope = createScope()
  let count = 0
  const deps = { cache, scope, fetchImpl: async () => ++count % 2 ? stalled() : response() }
  const options = config({ timeoutMs: 5, fallback: { ...fallback, apiKeyEnv: name } })
  process.env[name] = "first"
  assert.equal((await createGuard(options, deps).evaluate(call)).source, "fallback")
  const cached = await createGuard(options, deps).evaluate(call)
  assert.equal(cached.mode, "judge:cached")
  assert.equal(cached.source, "fallback")
  process.env[name] = "second"
  assert.equal((await createGuard(options, deps).evaluate(call)).mode, "judge")
  assert.equal((await createGuard(config({ timeoutMs: 5, fallback: { ...fallback, model: "other", apiKeyEnv: name } }), deps).evaluate(call)).mode, "judge")
  assert.equal(count, 6)
})
