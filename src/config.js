/**
 * Configuration loading and normalization.
 *
 * Config resolution order (first hit wins):
 *   1. Inline plugin options, passed by OpenCode from the `plugin` array tuple:
 *        "plugin": [["oc-one-guard", { ... }]]
 *   2. A config file next to the plugin: `<pluginDir>/config.json`
 *   3. The bundled defaults in `src/defaults.js`.
 *
 * The file-based fallback is what makes the plugin portable: copy the plugin
 * folder to another machine, edit `config.json`, and it works there too.
 * It is also the local-checkout path: `config.json` is excluded from the
 * published package, so an npm install relies on inline options instead.
 */

import { readFileSync, existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { DEFAULTS, mergeConfig } from "./defaults.js"

const PLUGIN_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..")

const CONFIG_FILENAMES = ["config.json", "config.jsonc"]

function stripJsonComments(text) {
  // Minimal JSONC stripper: removes // and /* */ comments outside of strings.
  let out = ""
  let inString = false
  let inLine = false
  let inBlock = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    const next = text[i + 1]
    if (inLine) {
      if (ch === "\n") {
        inLine = false
        out += ch
      }
      continue
    }
    if (inBlock) {
      if (ch === "*" && next === "/") {
        inBlock = false
        i++
      }
      continue
    }
    if (inString) {
      out += ch
      if (ch === "\\") {
        out += next ?? ""
        i++
        continue
      }
      if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      out += ch
      continue
    }
    if (ch === "/" && next === "/") {
      inLine = true
      i++
      continue
    }
    if (ch === "/" && next === "*") {
      inBlock = true
      i++
      continue
    }
    out += ch
  }
  return out
}

function readConfigFile(dir) {
  for (const name of CONFIG_FILENAMES) {
    const path = join(dir, name)
    if (!existsSync(path)) continue
    const raw = readFileSync(path, "utf8")
    try {
      return JSON.parse(stripJsonComments(raw))
    } catch (error) {
      throw new Error(`[oc-one-guard] Failed to parse ${path}: ${error.message}`)
    }
  }
  return undefined
}
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Merge a user-supplied config over the defaults.
 */
export function normalizeConfig(raw) {
  const merged = mergeConfig(DEFAULTS, isPlainObject(raw) ? raw : {})

  const errors = []
  if (typeof merged.endpoint !== "string" || !merged.endpoint.trim()) {
    errors.push("endpoint must be a non-empty string")
  }
  if (typeof merged.model !== "string" || !merged.model.trim()) {
    errors.push("model must be a non-empty string")
  }

  const threshold = Number(merged.denyThreshold)
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    errors.push("denyThreshold must be a number between 0 and 1")
  }
  const escalate = Number(merged.escalateThreshold)
  if (!Number.isFinite(escalate) || escalate < 0 || escalate > 1) {
    errors.push("escalateThreshold must be a number between 0 and 1")
  }
  if (Number.isFinite(threshold) && Number.isFinite(escalate) && escalate > threshold) {
    errors.push("escalateThreshold must not be greater than denyThreshold")
  }
  const stop = merged.stopThreshold
  if (stop !== null && (typeof stop !== "number" || !Number.isFinite(stop) || stop < threshold || stop > 1)) {
    errors.push("stopThreshold must be null or a finite number between denyThreshold and 1")
  }

  // These three decide whether a failure allows or blocks. An unrecognised
  // value must never be read as "allow", so only the exact literals are
  // accepted and anything else is rejected.
  for (const field of ["failMode", "unknownMode", "escalateAction"]) {
    if (merged[field] !== "block" && merged[field] !== "allow") {
      errors.push(`${field} must be exactly "block" or "allow"`)
    }
  }

  if (typeof merged.stateTemplate !== "string" || !merged.stateTemplate.includes("{arguments}")) {
    errors.push('stateTemplate must contain the "{arguments}" placeholder')
  }

  if (!Array.isArray(merged.questions) || !merged.questions.length) {
    errors.push("at least one question is required")
  } else {
    if (merged.questions[0]?.type === "score") {
      errors.push('the first decision question must be "choice" or "noul", not "score"')
    }
    for (const question of merged.questions) {
      if (!question || typeof question.name !== "string" || !question.name) {
        errors.push("every question needs a name")
        continue
      }
      if (!["noul", "choice", "score"].includes(question.type)) {
        errors.push(`question "${question.name}" has an unsupported type "${question.type}"`)
      }
      if (typeof question.instructions !== "string" || !question.instructions.trim()) {
        errors.push(`question "${question.name}" needs instructions`)
      }
      if (question.type === "score" && (!Array.isArray(question.levels) || !question.levels.length || !question.levels.every(level => typeof level === "string" && level.trim()))) {
        errors.push(`question "${question.name}" needs a non-empty array of non-empty text levels`)
      }
      if (question.type === "choice") {
        const criteria = question.criteria
        if (!isPlainObject(criteria) || !Object.keys(criteria).length) {
          errors.push(`question "${question.name}" needs criteria`)
        }
        // The deny option must be unambiguous, otherwise the probability is
        // read from the wrong label and the verdict inverts.
        const denyLabel = question.denyLabel
        if (!denyLabel) {
          errors.push(`question "${question.name}" needs an explicit denyLabel`)
        } else if (!isPlainObject(criteria) || !Object.hasOwn(criteria, denyLabel)) {
          errors.push(`question "${question.name}" denyLabel "${denyLabel}" is not one of its criteria`)
        }
      }
      if (question.type === "noul") {
        const criteria = question.criteria
        if (criteria !== undefined && (!isPlainObject(criteria) || Object.keys(criteria).length !== 2 || !Object.hasOwn(criteria, "true") || !Object.hasOwn(criteria, "false"))) {
          errors.push(
            `question "${question.name}" of type "noul" must have exactly the "true" and "false" criteria`,
          )
        }
        if (question.denyLabel !== "true" && question.denyLabel !== "false") {
          errors.push(
            `question "${question.name}" denyLabel "${question.denyLabel}" must be "true" or "false" for a noul question`,
          )
        }
      }
    }
  }

  const denied = new Set(merged.deniedTools ?? [])
  for (const tool of merged.skipTools ?? []) {
    if (denied.has(tool)) {
      errors.push(`tool "${tool}" is on both the deny list and the skip list`)
    }
  }

  if (errors.length) {
    throw new Error(`[oc-one-guard] Invalid configuration: ${errors.join("; ")}`)
  }

  merged.denyThreshold = threshold
  merged.escalateThreshold = escalate
  merged.timeoutMs = Math.max(1, Math.floor(Number(merged.timeoutMs) || DEFAULTS.timeoutMs))
  merged.maxStateChars = Math.max(1, Math.floor(Number(merged.maxStateChars) || DEFAULTS.maxStateChars))
  merged.maxArgChars = Math.max(1, Math.floor(Number(merged.maxArgChars) || DEFAULTS.maxArgChars))
  merged.cacheTtlMs = Math.max(0, Math.floor(Number(merged.cacheTtlMs) || 0))
  merged.auditGenerations = Math.max(1, Math.floor(Number(merged.auditGenerations) || DEFAULTS.auditGenerations))

  if (!Array.isArray(merged.allowedTools)) merged.allowedTools = []
  if (!Array.isArray(merged.deniedTools)) merged.deniedTools = []
  if (!Array.isArray(merged.skipTools)) merged.skipTools = []
  if (!Array.isArray(merged.allowedHosts)) merged.allowedHosts = []
  if (!Array.isArray(merged.blockedHosts)) merged.blockedHosts = []
  if (!Array.isArray(merged.questions)) merged.questions = []

  return merged
}

/**
 * Resolve the effective configuration for this plugin instance.
 *
 * Inline options win over the file so a user can override a shared file for
 * one project without editing it.
 *
 * A broken config must not remove the guard: OpenCode discards a plugin
 * that throws while loading, which would leave every tool call unrestricted.
 * So a bad file — or bad inline options — falls back to the bundled
 * defaults, which point at loopback and fail closed, and the problem is
 * reported to the caller.
 */
export function resolveConfig(inlineOptions) {
  const inline = isPlainObject(inlineOptions) ? inlineOptions : {}
  const problems = []

  let file
  try {
    file = readConfigFile(PLUGIN_DIR)
  } catch (error) {
    problems.push(error.message)
  }

  const layered = file ? mergeConfig(file, inline) : inline
  try {
    const config = normalizeConfig(layered)
    config.problems = problems
    return config
  } catch (error) {
    problems.push(error.message)
  }

  // Fall back to the defaults. If the inline options are also broken, the
  // defaults alone are used: the guard must always load.
  try {
    const fallback = normalizeConfig(inline)
    fallback.problems = problems
    fallback.degraded = true
    return fallback
  } catch {
    const fallback = normalizeConfig({})
    fallback.problems = problems
    fallback.degraded = true
    return fallback
  }
}

export { PLUGIN_DIR }
