/**
 * The guard engine: decide, cache, audit.
 *
 * Decision order:
 *   1. The judge is asked about every call; no code rule decides for it.
 *   2. The verdict is compared against `denyThreshold` and `escalateThreshold`.
 *   3. Failures fall back to `failMode`; unclassifiable verdicts to `unknownMode`.
 *
 * The cache is keyed on the *full* call as well as the rendered state. The
 * rendered state is truncated, so two different commands could otherwise
 * produce the same key and one would inherit the other's verdict.
 */

import { createHash } from "node:crypto"
import { posix } from "node:path"

import { denyProbability, findDenyOption, JudgeError, requestDecision } from "./judge.js"
import { sharedCache } from "./shared.js"
import { requireScope } from "./scope.js"
import { extractHosts, fullText, hasTransferPrimitive, renderState } from "./state.js"
import { getWrite, recordWrite, referencedWrites, markUncertainPatch, refreshWrite, ambiguousPath } from "./written.js"
import { canonicalTool, pathsOf } from "./tools.js"

// Patch headers are line-oriented. Never interpret content lines as paths.
function trackMutation(name, args, directory, scope) {
  const tool = canonicalTool(name)
  const knownDirectory = typeof directory === "string" && posix.isAbsolute(directory)
  const lookup = path => getWrite(path, directory, scope)
  const uncertainPath = path => {
    if (!knownDirectory && typeof path === "string" && !posix.isAbsolute(path)) markUncertainPatch(scope)
    if (ambiguousPath(path, directory)) markUncertainPatch(scope)
  }
  if (tool === "write" || tool === "edit") {
    const paths = pathsOf(args)
    if (!paths.length) return
    const content = writeContent(tool, args)
    for (const path of paths) {
      uncertainPath(path)
      if (!ambiguousPath(path, directory) && (lookup(path) || hasTransferPrimitive(content))) {
        recordWrite(path, null, directory, scope)
      }
    }
    return
  }
  if (tool !== "patch") return
  const patch = typeof args?.patchText === "string" ? args.patchText : args?.patch
  if (typeof patch !== "string") { markUncertainPatch(scope); return }
  const lines = patch.split(/\r?\n/)
  if (lines.at(-1) === "") lines.pop()
  let current
  let valid = lines[0] === "*** Begin Patch" && lines.at(-1) === "*** End Patch"
  const operations = []
  for (const line of lines.slice(1, -1)) {
    const header = line.match(/^\*\*\* (Add|Update|Delete) File: (.+)$/)
    if (header) {
      current = { kind: header[1], path: header[2], lines: [], valid: true }
      operations.push(current)
    } else if (line.startsWith("*** Move to: ")) {
      if (!current || current.kind !== "Update" || current.move) valid = false
      else current.move = line.slice(13)
    } else if (line.startsWith("*** ") && line !== "*** End of File") {
      valid = false
    } else if (current) {
      current.lines.push(line)
      if (current.kind === "Add" && !line.startsWith("+")) current.valid = false
    } else valid = false
  }
  if (!operations.length) valid = false
  if (!valid) markUncertainPatch(scope)
  for (const op of operations) {
    uncertainPath(op.path)
    if (op.move) uncertainPath(op.move)
    const relevant = lookup(op.path) || (op.move && lookup(op.move)) || hasTransferPrimitive(op.lines.join("\n"))
    if (relevant) {
      if (!ambiguousPath(op.path, directory)) recordWrite(op.path, null, directory, scope)
      if (op.move && !ambiguousPath(op.move, directory)) recordWrite(op.move, null, directory, scope)
    }
  }
}

/**
 * The text a write-like tool puts on disk.
 *
 * `write` uses `content`, `edit` uses `newString` (and `oldString`), and
 * `patch` (2.x) or `apply_patch` (1.x) uses a patch text. All of them can carry a payload.
 */
export function writeContent(name, args) {
  const tool = canonicalTool(name)
  if (!args || typeof args !== "object") return ""
  if (tool === "write") return typeof args.content === "string" ? args.content : ""
  if (tool === "edit") {
    const parts = []
    if (typeof args.newString === "string") parts.push(args.newString)
    if (typeof args.oldString === "string") parts.push(args.oldString)
    return parts.join("\n")
  }
  if (tool === "patch") {
    const parts = []
    if (typeof args.patchText === "string") parts.push(args.patchText)
    if (typeof args.patch === "string") parts.push(args.patch)
    return parts.join("\n")
  }
  return ""
}

export const VERDICT = {
  ALLOW: "allow",
  DENY: "deny",
  ESCALATE: "escalate",
}

/**
 * Matches a host against a pattern list.
 *
 * A pattern matches exactly, or as a suffix on a dot boundary, so
 * `example.com` matches `api.example.com` but not `notexample.com`.
 * A `*.` prefix matches any subdomain.
 */
export function hostMatches(host, patterns) {
  const lower = host.toLowerCase().replace(/\.$/, "")
  for (const raw of patterns) {
    if (typeof raw !== "string" || !raw) continue
    const pattern = raw.toLowerCase().trim().replace(/\.$/, "")
    if (!pattern) continue
    if (lower === pattern) return true
    if (lower.endsWith(`.${pattern}`)) return true
    if (pattern.startsWith("*.") && lower.endsWith(pattern.slice(1))) return true
  }
  return false
}

/**
 * A stable key for a call, covering everything that can change the verdict.
 *
 * The full argument text is hashed rather than the rendered state, so a
 * truncated state cannot make two different calls share a verdict. The
 * complete configuration and effective credentials isolate instances with
 * different policies or judge requests. The state captures staged content.
 */
export function scopedCacheKey(config, tool, args, state, apiKey, staged, scope, fallbackApiKey) {
  return createHash("sha256").update(stableStringify({ config, tool, args, state, apiKey, fallbackApiKey, staged, scope })).digest("hex")
}

function stableStringify(value) {
  return stringifySafely(value, new WeakSet())
}

/**
 * A JSON-ish serialisation that cannot throw.
 *
 * Tool arguments come from the model, so they can contain anything:
 * circular references, BigInt, functions. A crash here would remove the
 * guard, so every unserialisable value degrades to a placeholder instead.
 */
function stringifySafely(value, seen) {
  if (value === null) return "null"
  const type = typeof value
  if (type === "string") return JSON.stringify(value)
  if (type === "number" || type === "boolean") return String(value)
  if (type === "bigint") return `"${value.toString()}n"`
  if (type === "undefined") return "undefined"
  if (type === "symbol" || type === "function") return `"[${type}]"`
  if (seen.has(value)) return '"[circular]"'
  seen.add(value)
  try {
    if (Array.isArray(value)) {
      return `[${value.map((item) => stringifySafely(item, seen)).join(",")}]`
    }
    const keys = Object.keys(value).sort()
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${stringifySafely(value[key], seen)}`)
      .join(",")}}`
  } catch {
    return '"[unserialisable]"'
  } finally {
    seen.delete(value)
  }
}

export class GuardDecision {
  constructor({ verdict, reason, probability, confidence, tool, hosts, durationMs, mode, state, stop = false, source }) {
    this.verdict = verdict
    this.reason = reason
    this.probability = probability
    this.confidence = confidence
    this.tool = tool
    this.hosts = hosts
    this.durationMs = durationMs
    this.mode = mode
    this.state = state
    this.stop = stop
    this.source = source
  }

  get blocked() {
    return this.verdict === VERDICT.DENY || this.verdict === VERDICT.ESCALATE
  }
}

/**
 * Create a guard instance.
 *
 * @param {object} config Normalized configuration.
 * @param {object} deps   Injectable dependencies for testing.
 */
export function createGuard(config, deps = {}) {
  const scope = requireScope(deps.scope)
  const now = deps.now ?? (() => Date.now())
  const fetchImpl = deps.fetchImpl
  const writeAudit = deps.writeAudit ?? (() => {})
  const cache = deps.cache ?? sharedCache()
  let apiKey = config.apiKey

  if (config.apiKeyEnv) {
    const fromEnv = process.env[config.apiKeyEnv]
    if (fromEnv) apiKey = fromEnv
  }
  let fallbackApiKey = config.fallback?.apiKey
  if (config.fallback?.apiKeyEnv && process.env[config.fallback.apiKeyEnv]) fallbackApiKey = process.env[config.fallback.apiKeyEnv]

  function cacheGet(key) {
    if (!config.cacheEnabled) return undefined
    const hit = cache.get(key)
    if (!hit) return undefined
    if (hit.pending) return { pending: hit.pending }
    if (now() - hit.stored > config.cacheTtlMs) {
      cache.delete(key)
      return undefined
    }
    return { value: hit.value }
  }

  function cacheSet(key, value) {
    if (!config.cacheEnabled) return
    cache.set(key, { stored: now(), value })
    if (cache.size > 500) {
      const oldest = [...cache.entries()].sort((a, b) => (a[1].stored ?? 0) - (b[1].stored ?? 0))[0]
      if (oldest) cache.delete(oldest[0])
    }
  }

  /**
   * Evaluate a proposed tool call.
   *
   * @param {object} input
   * @param {string} input.tool
   * @param {any} input.args
   */
  async function evaluate(input) {
    const started = now()
    const tool = canonicalTool(input.tool)
    const { args } = input
    const hosts = extractHosts(tool, args)

    if (!config.enabled) {
      return new GuardDecision({
        verdict: VERDICT.ALLOW,
        reason: "Guard is disabled.",
        tool,
        hosts,
        durationMs: 0,
        mode: "disabled",
      })
    }

    // Writes are tracked only as context for the judge; nothing here decides.
    trackMutation(tool, args, deps.directory, scope)

    const isShell = tool === "shell"
    const command = typeof args?.command === "string" ? args.command : ""
    const base = typeof deps.directory === "string" && posix.isAbsolute(deps.directory) ? deps.directory : undefined
    const workdir = typeof args?.workdir === "string" && args.workdir ? args.workdir : undefined
    const directory = workdir ? (posix.isAbsolute(workdir) ? posix.normalize(workdir) : base ? posix.resolve(base, workdir) : undefined) : base
    const hits = isShell ? referencedWrites(command, directory, scope) : []
    const snapshots = new Map(hits.map(hit => {
      const entry = getWrite(hit.path, undefined, scope)
      const content = entry.content === null ? refreshWrite(hit.path, scope) : entry.content
      return [hit.path, { ...entry, content: content ?? null }]
    }))

    let state
    try {
      state = renderState({
      // The host's own name, so the judge sees the same text as before canonical ids.
      tool: input.tool,
      args,
      template: config.stateTemplate,
      maxStateChars: config.maxStateChars,
      maxArgChars: config.maxArgChars,
      directory,
      staged: snapshots,
      scope,
      })
    } catch {
      const blocked = config.failMode === "block"
      const decision = new GuardDecision({ verdict: blocked ? VERDICT.DENY : VERDICT.ALLOW, reason: `Call state could not be rendered for the judge. failMode="${config.failMode}".`, tool, hosts, durationMs: now() - started, mode: blocked ? "fail-block" : "fail-allow" })
      writeAudit(decision, {})
      return decision
    }

    const staged = referencedWrites(fullText(tool, args), directory, scope).map(hit => snapshots.get(hit.path) ?? getWrite(hit.path, undefined, scope))
    const key = scopedCacheKey(config, tool, args, state, apiKey, staged, scope, fallbackApiKey)
    const cached = cacheGet(key)
    if (cached?.pending) {
      const decision = await cached.pending
      return new GuardDecision({ ...decision, durationMs: now() - started, mode: `${decision.mode}:coalesced` })
    }
    if (cached?.value) {
      return new GuardDecision({
        ...cached.value,
        durationMs: now() - started,
        mode: `${cached.value.mode}:cached`,
      })
    }

    const pending = evaluateWithJudge({ tool, args, state, hosts, started })
    if (config.cacheEnabled) {
      cache.set(key, { stored: now(), pending })
    }
    let decision
    try {
      decision = await pending
    } catch (error) {
      // A rejected pending promise must not stay in the cache: the next call
      // for the same key would await the same rejection and never reach the
      // judge again.
      if (config.cacheEnabled && cache.get(key)?.pending === pending) {
        cache.delete(key)
      }
      throw error
    }
    if (decision.mode === "judge" && decision.verdict !== VERDICT.ESCALATE && !decision.stop) cacheSet(key, { ...decision })
    else if (config.cacheEnabled && cache.get(key)?.pending === pending) cache.delete(key)
    return decision
  }

  async function evaluateWithJudge({ tool, args, state, hosts, started }) {
    let response
    let source = "primary"
    try {
      const request = {
        endpoint: config.endpoint,
        model: config.model,
        state,
        questions: config.questions,
        timeoutMs: config.timeoutMs,
        apiKey,
        fetchImpl,
      }
      try {
        response = await requestDecision(request)
      } catch (error) {
        if (!(error instanceof JudgeError) || error.kind !== "timeout" || !config.fallback) throw error
        source = "fallback"
        response = await requestDecision({ ...request, ...config.fallback, apiKey: fallbackApiKey })
      }
    } catch (error) {
      const message = error instanceof JudgeError && ["http", "malformed", "timeout", "network", "unavailable"].includes(error.kind) ? `judge ${error.kind} error` : "judge error"
      const blocked = config.failMode === "block"
      const decision = new GuardDecision({
        verdict: blocked ? VERDICT.DENY : VERDICT.ALLOW,
        reason: `Judge unavailable (${message}). failMode="${config.failMode}".`,
        tool,
        hosts,
        durationMs: now() - started,
        mode: blocked ? "fail-block" : "fail-allow",
        state,
      })
      writeAudit(decision, { state, error: message })
      return decision
    }

    const question = config.questions[0] ?? { type: "choice" }
    const answer = response.answers?.[question.name]
    const probability = denyProbability(question, answer)

    if (probability === undefined) {
      const blocked = config.unknownMode === "block"
      const decision = new GuardDecision({
        verdict: blocked ? VERDICT.DENY : VERDICT.ALLOW,
        reason: `Judge could not classify the call. unknownMode="${config.unknownMode}".`,
        tool,
        hosts,
        durationMs: now() - started,
        mode: blocked ? "unknown-block" : "unknown-allow",
        state,
      })
      writeAudit(decision, { state })
      return decision
    }

    const denyLabel = findDenyOption(question) ?? "deny"
    let verdict
    let reason
    if (probability >= config.denyThreshold) {
      verdict = VERDICT.DENY
      reason = `P(${denyLabel}) = ${probability.toFixed(3)} >= denyThreshold ${config.denyThreshold}.`
    } else if (probability >= config.escalateThreshold) {
      verdict = VERDICT.ESCALATE
      reason = `P(${denyLabel}) = ${probability.toFixed(3)} >= escalateThreshold ${config.escalateThreshold}.`
    } else {
      verdict = VERDICT.ALLOW
      reason = `P(${denyLabel}) = ${probability.toFixed(3)} < escalateThreshold ${config.escalateThreshold}.`
    }

    const decision = new GuardDecision({
      verdict,
      reason,
      probability,
      confidence: answer?.confidence,
      tool,
      hosts,
      durationMs: now() - started,
      mode: "judge",
      source,
      state,
      stop: config.stopThreshold !== null && Number.isFinite(probability) && probability >= config.stopThreshold,
    })

    writeAudit(decision, { state })
    return decision
  }

  return { evaluate }
}
