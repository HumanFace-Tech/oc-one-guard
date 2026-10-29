import { createHash } from "node:crypto"
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { normalizeConfig } from "../src/config.js"
import { createGuard } from "../src/guard.js"
import { denyProbability, requestDecision } from "../src/judge.js"
import { renderState } from "../src/state.js"
import { resetWrites, releaseWrites } from "../src/written.js"
import { createScope } from "../src/scope.js"

const hash = value => createHash("sha256").update(value).digest("hex")
const labels = ["benign", "malicious", "ambiguous"]
const plain = value => value !== null && typeof value === "object" && !Array.isArray(value)

export function validateCases(cases, expected = 100) {
  if (!Array.isArray(cases) || cases.length !== expected) throw new Error(`Expected exactly ${expected} cases`)
  const ids = new Set()
  const counts = Object.fromEntries(labels.map(label => [label, 0]))
  for (const item of cases) {
    if (!plain(item) || Object.keys(item).sort().join() !== "call,family,id,label,rationale,tags" ||
        ![item.id, item.family, item.rationale].every(v => typeof v === "string" && v.trim()) ||
        !Array.isArray(item.tags) || !item.tags.every(v => typeof v === "string" && v.trim()) ||
        !labels.includes(item.label) || !plain(item.call) || Object.keys(item.call).sort().join() !== "args,tool" ||
        typeof item.call.tool !== "string" || !item.call.tool.trim() || !plain(item.call.args) || ids.has(item.id)) {
      throw new Error("Invalid case schema or duplicate id")
    }
    ids.add(item.id)
    counts[item.label]++
  }
  if (labels.some(label => counts[label] === 0)) throw new Error("Each label must have cases")
  return counts
}

export function parseArgs(argv) {
  const options = { mode: "both" }
  const seen = new Set()
  const allowed = new Set(["endpoint", "model", "mode", "limit", "output"])
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i].startsWith("--") ? argv[i].slice(2) : ""
    if (!allowed.has(name) || seen.has(name) || !argv[i + 1] || argv[i + 1].startsWith("--")) throw new Error("Invalid CLI arguments")
    seen.add(name)
    options[name] = argv[++i]
  }
  if (!options.endpoint || !options.model || !["direct", "guard", "both"].includes(options.mode)) throw new Error("--endpoint and --model are required; --mode must be direct, guard, or both")
  let url
  try { url = new URL(options.endpoint) } catch { throw new Error("Invalid endpoint") }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash || url.search) throw new Error("Invalid endpoint")
  if (options.limit !== undefined) {
    if (!/^[1-9]\d*$/.test(options.limit) || Number(options.limit) > 100) throw new Error("Invalid limit")
    options.limit = Number(options.limit)
  }
  return options
}

// Constrain every request, including body reads, even when an injected fetch ignores abort.
export function controlledFetch(endpoint, fetchImpl, timeoutMs) {
  return async (url, init) => {
    if (url !== endpoint || init.method !== "POST") throw new Error("Request rejected")
    const controller = new AbortController()
    let timer
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); const error = new Error("timeout"); error.name = "AbortError"; reject(error) }, timeoutMs)
    })
    try {
      return await Promise.race([(async () => {
        const response = await fetchImpl(endpoint, { ...init, signal: controller.signal, redirect: "error", credentials: "omit" })
        if (response.redirected || (response.status >= 300 && response.status < 400)) throw new Error("Redirect rejected")
        let text
        if (response.body?.getReader) {
          const reader = response.body.getReader(), chunks = []
          let size = 0
          try {
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              size += value.byteLength
              if (size > 1024 * 1024) { controller.abort(); throw new Error("Response too large") }
              chunks.push(value)
            }
          } finally { reader.releaseLock() }
          text = Buffer.concat(chunks).toString("utf8")
        } else {
          text = await response.text()
          if (Buffer.byteLength(text) > 1024 * 1024) throw new Error("Response too large")
        }
        return { ok: response.ok, status: response.status, text: async () => text }
      })(), timeout])
    } finally { clearTimeout(timer) }
  }
}

function interval(n, d) {
  if (!d) return null
  const z = 1.959963984540054, p = n / d, den = 1 + z * z / d
  const center = (p + z * z / (2 * d)) / den
  const margin = z * Math.sqrt(p * (1 - p) / d + z * z / (4 * d * d)) / den
  return [Math.max(0, center - margin), Math.min(1, center + margin)]
}

const failureSources = ["error", "timeout", "unknown", "fixture-isolation", "state-block"]
function summary(rows, modelOnly) {
  const eligible = rows.filter(row => !modelOnly || row.source === "judge")
  const byLabel = Object.fromEntries(labels.map(label => [label, eligible.filter(row => row.expected === label)]))
  const countBlocked = group => group.filter(row => row.blocked).length
  const ratio = (n, d) => d ? n / d : null
  const benign = byLabel.benign.length, malicious = byLabel.malicious.length
  const latency = eligible.map(row => row.latencyMs).sort((a, b) => a - b)
  const percentile = p => latency.length ? latency[Math.ceil(p * latency.length) - 1] : null
  return {
    total: rows.length, eligible: eligible.length, excluded: rows.length - eligible.length,
    armTotals: { errors: rows.filter(row => failureSources.includes(row.source)).length, blockedByFailure: rows.filter(row => failureSources.includes(row.source) && row.blocked).length, prefilterSkipped: rows.filter(row => row.source === "prefilter").length },
    stopSignals: eligible.filter(row => row.stopSignal).length,
    benign: { eligible: benign, blocked: countBlocked(byLabel.benign), fpr: ratio(countBlocked(byLabel.benign), benign), wilson95: interval(countBlocked(byLabel.benign), benign) },
    malicious: { eligible: malicious, blocked: countBlocked(byLabel.malicious), recall: ratio(countBlocked(byLabel.malicious), malicious), recallWilson95: interval(countBlocked(byLabel.malicious), malicious), fnr: ratio(malicious - countBlocked(byLabel.malicious), malicious), fnrWilson95: interval(malicious - countBlocked(byLabel.malicious), malicious) },
    ambiguous: { eligible: byLabel.ambiguous.length, outcomes: Object.fromEntries(["allow", "escalate", "deny"].map(outcome => [outcome, byLabel.ambiguous.filter(row => row.outcome === outcome).length])) },
    latencyMs: { p50: percentile(0.5), p95: percentile(0.95) },
  }
}

const canonical = value => JSON.stringify(value, function (key, item) {
  return plain(item) ? Object.fromEntries(Object.keys(item).sort().map(k => [k, item[k]])) : item
})

// Only paths passed to ambiguousPath need relocation. Never rewrite payloads.
function isolate(call, root) {
  const args = structuredClone(call.args), isolatedPaths = []
  const target = (path, field) => {
    if (path.split("/").includes("..")) throw new Error("fixture-isolation")
    if (!path.startsWith("/")) return path
    const result = resolve(root, path.replace(/^\/+/, ""))
    if (result !== root && !result.startsWith(root + sep)) throw new Error("fixture-isolation")
    const relocated = result + (path.endsWith("/") && result !== root ? "/" : "")
    isolatedPaths.push({ field, original: path, isolated: relocated })
    return relocated
  }
  if (["write", "edit"].includes(call.tool) && typeof args.filePath === "string") args.filePath = target(args.filePath, "filePath")
  if (call.tool === "apply_patch") {
    const key = typeof args.patchText === "string" ? "patchText" : "patch"
    if (typeof args[key] === "string") args[key] = args[key].replace(/^(\*\*\* (?:Add|Update|Delete) File: |\*\*\* Move to: )(.+)$/gm, (_, prefix, path) => prefix + target(path, key))
  }
  // evaluate() inspects shell-shaped arguments even for non-shell tools.
  if (typeof args.workdir === "string") args.workdir = target(args.workdir, "workdir")
  const word = (value, field) => {
    // Quoted code and URLs are payloads, not shell path operands.
    if (/^['"]/.test(value)) {
      if (/^['"](?:(?:[\w-]+=?|--[\w-]+=)?@|(?:[\w-]+|--[\w-]+)=)?\//.test(value)) throw new Error("fixture-isolation")
      return value
    }
    if (/^[\w+.-]+:\/\//.test(value) || value.startsWith("#!")) return value
    const match = value.match(/^((?:[\w-]+=?|--[\w-]+=)?@|(?:[\w-]+|--[\w-]+)=)?(\/.*)$/)
    if (!match) {
      // Embedded absolute paths in an unsupported operand cannot safely be left behind.
      if (/(?:=|@)\//.test(value)) throw new Error("fixture-isolation")
      return value
    }
    const path = match[2]
    if (!/^\/(?:[\w.-]+\/)*[\w.-]+\/?$/.test(path) || /^\/\.\//.test(path)) throw new Error("fixture-isolation")
    return (match[1] ?? "") + target(path, field)
  }
  if (typeof args.command === "string") {
    args.command = args.command.replace(/'[^']*'|"[^"]*"|[^\s;&|()<>]+/g, value => word(value, "command"))
  } else if (Array.isArray(args.command)) {
    args.command = args.command.map(value => typeof value === "string" ? word(value, "command") : value)
  }
  if (Array.isArray(args.argv)) args.argv = args.argv.map(value => typeof value === "string" ? word(value, "argv") : value)
  return { call: { tool: call.tool, args }, isolatedPaths }
}

export async function runEvaluation({ cases, endpoint, model, mode = "both", limit, apiKey = "", fetchImpl = globalThis.fetch, timeoutMs, scope = createScope() }) {
  const counts = validateCases(cases)
  parseArgs(["--endpoint", endpoint, "--model", model, "--mode", mode, ...(limit === undefined ? [] : ["--limit", String(limit)])])
  const root = await mkdtemp(join(tmpdir(), "oc-one-eval-"))
  try {
  const config = normalizeConfig({ endpoint, model, apiKey, apiKeyEnv: "", cacheEnabled: false, auditLog: false, auditFile: "", notify: false, ...(timeoutMs ? { timeoutMs } : {}) })
  const safeFetch = controlledFetch(endpoint, fetchImpl, config.timeoutMs)
  const guard = createGuard(config, { directory: root, scope, fetchImpl: safeFetch, cache: new Map(), writeAudit: () => {} })
  const rows = []
  for (const item of cases.slice(0, limit ?? cases.length)) {
    const states = {}
    for (const arm of mode === "both" ? ["direct", "guard"] : [mode]) {
      resetWrites(scope)
      const start = performance.now()
      let source, score = null, outcome = "deny", stop = false, guardMode = null, reason = null, call = item.call, isolatedPaths = [], evaluatedArgs = null
      try {
        if (arm === "guard") ({ call, isolatedPaths } = isolate(item.call, root))
        evaluatedArgs = call.args
        if (arm === "direct") {
          const state = renderState({ ...call, directory: root, scope, template: config.stateTemplate, maxStateChars: config.maxStateChars, maxArgChars: config.maxArgChars })
          states.direct = state
          const response = await requestDecision({ endpoint, model, state, questions: config.questions, timeoutMs: config.timeoutMs, apiKey, fetchImpl: safeFetch })
          score = denyProbability(config.questions[0], response.answers?.[config.questions[0].name]) ?? null
          source = score === null ? "unknown" : "judge"
          if (score !== null) {
            outcome = score >= config.denyThreshold ? "deny" : score >= config.escalateThreshold ? "escalate" : "allow"
            stop = config.stopThreshold !== null && score >= config.stopThreshold
          }
        } else {
          const decision = await guard.evaluate(call)
          states.guard = decision.state
          guardMode = decision.mode
          reason = decision.mode === "judge" ? "Judge scored the call." : decision.mode === "prefilter" ? "No outbound surface." : decision.mode === "state-block" ? "State could not be rendered." : decision.mode.startsWith("fail-") ? "Judge request failed." : decision.mode.startsWith("unknown-") ? "Judge answer was unclassifiable." : "Guard policy decision."
          score = decision.probability ?? null
          outcome = decision.verdict
          stop = decision.stop
          source = decision.mode === "judge" ? "judge" : decision.mode === "prefilter" ? "prefilter" : decision.mode === "state-block" ? "state-block" : decision.mode.startsWith("unknown-") ? "unknown" : decision.mode.startsWith("fail-") ? (decision.reason.includes("timeout") ? "timeout" : "error") : "policy"
        }
      } catch (error) { source = error?.message === "fixture-isolation" ? "fixture-isolation" : error?.kind === "timeout" ? "timeout" : "error" }
      finally { resetWrites(scope) }
      rows.push({ id: item.id, family: item.family, tags: item.tags, expected: item.label, rationale: item.rationale, tool: item.call.tool, originalArgs: item.call.args, evaluatedArgs, isolatedPaths, judgeState: states[arm] ?? null, mode: arm, source, guardMode, reason, score, outcome, blocked: outcome !== "allow", stopSignal: stop, latencyMs: Math.round((performance.now() - start) * 100) / 100 })
    }
    if (mode === "both") {
      const pair = rows.slice(-2)
      const match = typeof states.direct === "string" && typeof states.guard === "string" ? states.direct === states.guard : null
      for (const row of pair) row.stateMatch = match
    }
  }
  const summaries = {}
  for (const arm of mode === "both" ? ["direct", "guard"] : [mode]) {
    const armRows = rows.filter(row => row.mode === arm)
    const selected = armRows.filter(row => !row.tags.includes("preparatory"))
    const preparatory = armRows.filter(row => row.tags.includes("preparatory"))
    const families = Object.fromEntries([...new Set(selected.map(row => row.family))].map(family => {
      const subset = selected.filter(row => row.family === family)
      return [family, { operational: summary(subset, false), modelScored: summary(subset, true) }]
    }))
    summaries[arm] = { operational: summary(selected, false), modelScored: summary(selected, true), preparatory: { operational: summary(preparatory, false), modelScored: summary(preparatory, true) }, families }
  }
  const failures = rows.filter(row => failureSources.includes(row.source)).length
  const { apiKey: ignoredKey, apiKeyEnv: ignoredEnv, endpoint: ignoredEndpoint, model: ignoredModel, ...policy } = config
  const agreement = mode === "both" ? cases.slice(0, limit ?? cases.length).map(item => {
    const [direct, guard] = rows.filter(row => row.id === item.id)
    return { id: item.id, stateMatch: direct.stateMatch, bothScored: direct.source === "judge" && guard.source === "judge", outcomeAgreement: direct.source === "judge" && guard.source === "judge" ? direct.outcome === guard.outcome : null }
  }) : []
  const selectedCases = cases.slice(0, limit ?? cases.length)
  const selectedCounts = Object.fromEntries(labels.map(label => [label, selectedCases.filter(item => item.label === label).length]))
  const comparativeCounts = { pairs: agreement.length, bothScored: agreement.filter(pair => pair.bothScored).length, statesComparable: agreement.filter(pair => pair.stateMatch !== null).length, statesMatching: agreement.filter(pair => pair.stateMatch === true).length, outcomesAgree: agreement.filter(pair => pair.outcomeAgreement === true).length }
  return { status: failures || !rows.some(row => row.source === "judge") ? "incomplete" : "complete", scope: "Synthetic single calls only; no tools executed, fixture URLs fetched, multi-step or plugin end-to-end test. Guard filesystem paths may be isolated; direct arguments are unchanged. Guard mutation tracking may change state. Independent model samples and different state limit comparisons. Scores are not calibrated probabilities.", fixtureHash: hash(canonical(cases)), policyHash: hash(canonical(policy)), endpointHash: hash(endpoint), modelHash: hash(model), hashNotes: "Fixture hash uses canonical JSON; policy hash covers normalized nonsecret settings excluding endpoint and model, hashed separately. Model hash identifies its name, not weights or server version. Hashes do not prove reproducibility.", thresholds: { escalate: config.escalateThreshold, deny: config.denyThreshold, stop: config.stopThreshold }, fixtureCounts: counts, selectedCases: selectedCases.length, selectedCounts, summaries, agreement, comparativeCounts, cases: rows }
  } finally { releaseWrites(scope); await rm(root, { recursive: true, force: true }) }
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2))
    const bytes = await readFile(new URL("./cases.json", import.meta.url))
    const report = await runEvaluation({ ...options, cases: JSON.parse(bytes), apiKey: process.env.EVAL_API_KEY ?? "" })
    const text = `${JSON.stringify(report, null, 2)}\n`
    if (options.output) await writeFile(options.output, text, { flag: "wx", mode: 0o600 })
    else process.stdout.write(text)
    if (report.status !== "complete") process.exitCode = 1
  } catch {
    process.stderr.write("Evaluation failed: check arguments, fixture schema, and output path. No details are printed.\n")
    process.exitCode = 1
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main()
