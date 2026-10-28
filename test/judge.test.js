import test from "node:test"
import assert from "node:assert/strict"
import { buildRequest, denyProbability, requestDecision, JudgeError } from "../src/judge.js"
import { config, response, answer } from "./helpers.js"

test("wire payload omits local deny labels and maps score levels to criteria", async () => {
  const options = config({ apiKey: "synthetic-credential" })
  const questions = [...options.questions, { name: "risk", type: "score", instructions: "Rate", levels: ["low", "high"] }]
  const payload = buildRequest(options.model, "sensitive state", questions)
  assert.equal(payload.questions.verdict.denyLabel, undefined)
  assert.deepEqual(payload.questions.risk.criteria, ["low", "high"])
  const result = await requestDecision({ ...options, questions, state: "sensitive state", fetchImpl: async (url, init) => {
    assert.equal(url, options.endpoint)
    assert.equal(init.method, "POST")
    assert.equal(init.headers.Authorization, "Bearer synthetic-credential")
    assert.deepEqual(JSON.parse(init.body), payload)
    assert.equal(init.signal.aborted, false)
    return response()
  } })
  assert.deepEqual(result, answer())
})

for (const value of [NaN, Infinity, -Infinity, -0.1, 1.1, "0.9", null, undefined]) {
  test(`unusable probability ${String(value)} never becomes a valid verdict`, () => {
    assert.equal(denyProbability({ type: "choice", denyLabel: "deny" }, { type: "choice", probabilities: { deny: value } }), undefined)
    assert.equal(denyProbability({ type: "noul", denyLabel: "true", criteria: { true: "bad", false: "safe" } }, { type: "noul", noul: value }), undefined)
  })
}

test("deny label determines probability, not top choice or confidence", () => {
  assert.equal(denyProbability({ type: "choice", denyLabel: "unsafe" }, { type: "choice", choice: "safe", confidence: 1, probabilities: { unsafe: 0.9 } }), 0.9)
  const q = { type: "noul", denyLabel: "false", criteria: { true: "safe", false: "unsafe" } }
  assert.equal(denyProbability(q, { type: "noul", noul: 0.75 }), 0.25)
  assert.equal(denyProbability(q, { type: "choice", probabilities: { false: 1 } }), undefined)
  assert.equal(denyProbability({ ...q, criteria: { yes: "safe" } }, { type: "noul", noul: 1 }), undefined)
})

for (const [name, fetchImpl, kind] of [
  ["network", async () => { throw new Error("password=synthetic-secret") }, "network"],
  ["http", async () => ({ ok: false, status: 503, text: async () => "password=synthetic-secret" }), "http"],
  ["invalid JSON", async () => ({ ok: true, text: async () => "password=synthetic-secret" }), "malformed"],
  ["missing answers", async () => response({ answers: null }), "malformed"],
]) {
  test(`${name} errors have a typed, non-sensitive message`, async () => {
    await assert.rejects(requestDecision({ ...config(), state: "state", fetchImpl }), error => {
      assert.ok(error instanceof JudgeError)
      assert.equal(error.kind, kind)
      assert.doesNotMatch(error.message, /synthetic-secret/)
      return true
    })
  })
}

for (const phase of ["headers", "body"]) {
  test(`timeout covers stalled ${phase}`, { timeout: 1000 }, async () => {
    const fetchImpl = async (_url, { signal }) => {
      const stalled = () => new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true })
      })
      if (phase === "headers") return stalled()
      return { ok: true, text: stalled }
    }
    await assert.rejects(requestDecision({ ...config(), timeoutMs: 5, state: "state", fetchImpl }), { kind: "timeout" })
  })
}
