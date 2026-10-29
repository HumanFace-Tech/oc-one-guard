import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { normalizeConfig } from "../src/config.js"

// Prevent accidental real requests, even when a test omits an injected fetch.
globalThis.fetch = async () => { throw new Error("Real network requests are forbidden in tests") }

export function config(overrides = {}) {
  return normalizeConfig({
    endpoint: "https://judge.example/v1/systemone",
    auditLog: false,
    auditFile: "",
    notify: false,
    ...overrides,
  })
}

export function answer(probability = 0.1) {
  return { answers: { verdict: { type: "noul", noul: probability } } }
}

export function response(body = answer()) {
  return { ok: true, status: 200, text: async () => JSON.stringify(body) }
}

export function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "oc-one-guard-test-"))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  return directory
}

// Plugin hooks use global fetch; record requests so tests can assert bypasses.
export function stubFetch(t, implementation = () => response()) {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (...args) => {
    calls.push(args)
    return implementation(...args)
  }
  t.after(() => { globalThis.fetch = original })
  return calls
}
