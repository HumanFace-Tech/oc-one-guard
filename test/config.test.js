import test from "node:test"
import assert from "node:assert/strict"
import { normalizeConfig } from "../src/config.js"
import { DEFAULTS, mergeConfig } from "../src/defaults.js"
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { fixture } from "./helpers.js"

async function isolatedLoader(t) {
  const directory = fixture(t)
  mkdirSync(join(directory, "src"))
  writeFileSync(join(directory, "package.json"), '{"type":"module"}')
  for (const name of ["config.js", "defaults.js"]) {
    copyFileSync(new URL(`../src/${name}`, import.meta.url), join(directory, "src", name))
  }
  const loader = await import(pathToFileURL(join(directory, "src", "config.js")).href)
  return { directory, resolve: loader.resolveConfig }
}

test("defaults fail closed and normalized values do not change defaults", () => {
  const config = normalizeConfig({ timeoutMs: 3.8, maxArgChars: -2, cacheTtlMs: -5 })
  assert.equal(config.failMode, "block")
  assert.equal(config.unknownMode, "block")
  assert.equal(config.escalateAction, "block")
  assert.equal(config.timeoutMs, 3)
  assert.equal(config.maxArgChars, 1)
  assert.equal(config.cacheTtlMs, 0)
  assert.equal(DEFAULTS.timeoutMs, 20000)
})

for (const field of ["denyThreshold", "escalateThreshold"]) {
  for (const value of [NaN, Infinity, -Infinity, -0.1, 1.1, "not-a-number"]) {
    test(`${field} rejects ${String(value)}`, () => {
      assert.throws(() => normalizeConfig({ [field]: value }), /Invalid configuration/)
    })
  }
}

test("threshold ordering and conflicting tool policy are rejected", () => {
  assert.throws(() => normalizeConfig({ denyThreshold: 0.2 }), /must not be greater/)
  assert.throws(() => normalizeConfig({ deniedTools: ["bash"], skipTools: ["bash"] }), /both/)
  assert.equal(normalizeConfig({ denyThreshold: "0.8" }).denyThreshold, 0.8)
})

test("stop threshold is numeric, ordered, finite, or explicitly disabled", () => {
  for (const stopThreshold of [false, true, "0.9", NaN, Infinity, -1, 0.69, 1.1]) {
    assert.throws(() => normalizeConfig({ stopThreshold }), /stopThreshold/)
  }
  assert.throws(() => normalizeConfig({ denyThreshold: 0.95 }), /stopThreshold/)
  for (const stopThreshold of [null, 0.7, 0.9, 1]) {
    assert.equal(normalizeConfig({ stopThreshold }).stopThreshold, stopThreshold)
  }
})

for (const field of ["failMode", "unknownMode", "escalateAction"]) {
  test(`${field} accepts only explicit actions`, () => {
    for (const value of [false, null, "ALLOW", "", "typo"]) {
      assert.throws(() => normalizeConfig({ [field]: value }), /must be exactly/)
    }
    assert.equal(normalizeConfig({ [field]: "allow" })[field], "allow")
  })
}

test("question merge replaces criteria and custom question replaces first default", () => {
  const q = { name: "verdict", type: "choice", criteria: { safe: "safe", unsafe: "unsafe" }, denyLabel: "unsafe" }
  const merged = normalizeConfig({ questions: [q] })
  assert.deepEqual(merged.questions[0].criteria, q.criteria)
  assert.equal(merged.questions[0].type, "choice")
  const custom = { ...q, name: "custom", type: "choice", instructions: "Decide" }
  assert.deepEqual(normalizeConfig({ questions: [custom] }).questions, [custom])
  assert.ok(Object.hasOwn(DEFAULTS.questions[0].criteria, "true"))
  assert.deepEqual(mergeConfig({ skipTools: ["read"] }, { skipTools: ["glob"] }).skipTools, ["glob"])
})

test("invalid question semantics and missing arguments placeholder cannot load", () => {
  for (const questions of [[], [{ name: "verdict", denyLabel: "missing" }],
    [{ name: "verdict", type: "score", levels: ["low", "high"] }],
    [{ name: "verdict", type: "noul", criteria: { yes: "yes", no: "no" }, denyLabel: "yes" }],
    [{ name: "verdict", type: "noul", criteria: { true: "yes", false: "no", extra: "extra" }, denyLabel: "true" }]]) {
    assert.throws(() => normalizeConfig({ questions }), /Invalid configuration/)
  }
  assert.throws(() => normalizeConfig({ stateTemplate: "{tool}" }), /placeholder/)
})

test("invalid inline policy falls back to enabled fail-closed configuration", async t => {
  const { resolve } = await isolatedLoader(t)
  const result = resolve({ denyThreshold: NaN, enabled: false, failMode: "typo" })
  assert.equal(result.degraded, true)
  assert.ok(result.problems.length)
  assert.equal(result.enabled, true)
  assert.equal(result.failMode, "block")
  assert.equal(result.unknownMode, "block")
})

test("adjacent JSONC handles comments and quoted URLs; inline values win", async t => {
  const { directory, resolve } = await isolatedLoader(t)
  writeFileSync(join(directory, "config.jsonc"), `{
    // URL and comment-like string content must survive
    "endpoint": "https://judge.example/v1/systemone",
    "model": "quoted-\\\"//not-a-comment",
    /* policy */ "denyThreshold": 0.9,
    "skipTools": ["read"]
  }`)
  const result = resolve({ denyThreshold: 0.8 })
  assert.equal(result.endpoint, "https://judge.example/v1/systemone")
  assert.equal(result.model, 'quoted-"//not-a-comment')
  assert.equal(result.denyThreshold, 0.8)
  assert.deepEqual(result.skipTools, ["read"])
  assert.deepEqual(result.problems, [])
  writeFileSync(join(directory, "config.json"), '{"model":"json-wins"}')
  assert.equal(resolve().model, "json-wins")
})

test("malformed adjacent config reports a problem and keeps guard loaded", async t => {
  const { directory, resolve } = await isolatedLoader(t)
  writeFileSync(join(directory, "config.json"), "{broken")
  const result = resolve({ endpoint: "https://judge.example/v1/systemone" })
  assert.equal(result.endpoint, "https://judge.example/v1/systemone")
  assert.equal(result.enabled, true)
  assert.equal(result.failMode, "block")
  assert.match(result.problems[0], /Failed to parse/)
})

test("invalid adjacent policy degrades to validated inline options", async t => {
  const { directory, resolve } = await isolatedLoader(t)
  writeFileSync(join(directory, "config.json"), '{"failMode":"typo","enabled":false}')
  const result = resolve({ model: "inline-model" })
  assert.equal(result.degraded, true)
  assert.equal(result.enabled, true)
  assert.equal(result.model, "inline-model")
  assert.equal(result.failMode, "block")
  assert.ok(result.problems.length)
})
