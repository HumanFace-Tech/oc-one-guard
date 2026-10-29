/**
 * Tracking of files the agent has written.
 *
 * A model can stage an exfiltration payload in a file and execute it in a
 * second call. The write looks local, and the execution of a bare path like
 * `/tmp/p` looks local too — but together they are an outbound transfer.
 *
 * So the guard remembers what has been written and treats any later command
 * that references a written file as an outbound surface.
 *
 * Only files whose content reaches for the network are tracked. Tracking
 * every write would make ordinary commands — `cat index.js`, `git commit -m
 * "update index.js"` — hit the judge, and the judge costs seconds per call.
 *
 * The state is process-wide and stored on `globalThis` under a `Symbol.for`
 * key, partitioned by scope so duplicate instances see the same writes.
 */

import { posix } from "node:path"
import { constants, openSync, closeSync, fstatSync, readSync, lstatSync } from "node:fs"
import { requireScope } from "./scope.js"

const STATE_KEY = Symbol.for("oc-one-guard.scoped-writes.v1")
function state(scope) {
  requireScope(scope)
  const scopes = globalThis[STATE_KEY] ??= new Map()
  if (!scopes.has(scope)) scopes.set(scope, { files: new Map(), revision: 0, uncertain: false, pending: new Set() })
  return scopes.get(scope)
}

export function beginMutation(scope) {
  const pending = state(scope).pending
  const token = Symbol()
  pending.add(token)
  return token
}
export function endMutation(token, scope) { state(scope).pending.delete(token) }
export function hasPendingMutation(scope) { return state(scope).pending.size > 0 }

// Never collapse '..' across a possibly symlinked component or inspect a
// different lexical path as evidence. Missing components are not symlinks yet.
export function ambiguousPath(path, directory) {
  if (typeof path !== "string" || !path) return false
  if (path.split("/").includes("..")) return true
  const value = posix.isAbsolute(path) ? path : directory ? `${directory}/${path}` : path
  if (!posix.isAbsolute(value)) return false
  let current = "/"
  for (const component of value.split("/")) {
    if (!component || component === ".") continue
    if (component === "..") return true
    current = posix.join(current, component)
    try { if (lstatSync(current).isSymbolicLink()) return true } catch (error) {
      if (error?.code !== "ENOENT") return true
      break
    }
  }
  return false
}

const MAX_TRACKED = 100

/**
 * @returns {Map<string, {path: string, content: string}>}
 */
function store(scope) { return state(scope).files }

/**
 * Normalise a path for comparison.
 */
function normalize(path, directory) {
  if (typeof path !== "string" || !path) return ""
  const value = path.replace(/\\/g, "/")
  if (!posix.isAbsolute(value) && typeof directory === "string" && posix.isAbsolute(directory)) return posix.resolve(directory, value)
  return posix.normalize(value)
}

/**
 * Record a file the agent has written.
 *
 * @param {string} path
 * @param {string} content
 */
export function recordWrite(path, content, directory, scope) {
  requireScope(scope)
  const key = normalize(path, directory)
  if (!key) return
  const files = store(scope)
  const relative = typeof directory === "string" && posix.isAbsolute(directory) && posix.isAbsolute(key) ? posix.relative(directory, key) : undefined
  files.set(key, { path: key, content: typeof content === "string" ? content : null, ...(relative ? { relative } : {}) })
  state(scope).revision++
  if (files.size > MAX_TRACKED) {
    const oldest = files.keys().next().value
    if (oldest !== undefined) files.delete(oldest)
    markUncertainPatch(scope)
  }
}

export function writesRevision(scope) { return state(scope).revision }
export function markUncertainPatch(scope) {
  state(scope).uncertain = true
  state(scope).revision++
}
export function hasUncertainPatch(scope) { return state(scope).uncertain }

/**
 * Look up a written file by its normalised path.
 */
export function getWrite(path, directory, scope) {
  requireScope(scope)
  const key = normalize(path, directory)
  if (!key) return undefined
  return store(scope).get(key)
}

/**
 * Find written files that a command references.
 *
 * The match is deliberately narrow. A tracked file always has a payload in
 * it, so a reference is meaningful — but a file whose name is also an
 * ordinary word (`index.js`, `test.py`) would make unrelated commands hit
 * the judge, and the judge costs seconds per call. So a common name is only
 * matched when the command names it with a path, not as a bare word.
 *
 * @param {string} text
 * @returns {{path: string}[]}
 */
export function referencedWrites(text, directory, scope) {
  requireScope(scope)
  if (typeof text !== "string" || !text) return []
  const files = store(scope)
  if (!files.size) return []
  const hits = []
  // Resolve literal shell words as paths. Dynamic shell expansion and changes
  // of directory are handled conservatively by the caller.
  const operands = (text.match(/'[^']*'|"[^"]*"|[^\s;&|()<>]+/g) ?? [])
    .map(word => word.replace(/^(['"])(.*)\1$/, "$2"))
    .filter(word => !/[\s$`*?\[\]{}\\]/.test(word))
    .map(word => normalize(word, directory))
  for (const entry of files.values()) {
    const base = entry.path.split("/").pop()
    if (!base) continue
    const common = COMMON_NAMES.has(base.toLowerCase())
    // A path-qualified reference always counts. A bare word only counts when
    // the name is distinctive enough not to appear in ordinary work.
    if (operands.includes(entry.path) || (entry.path.includes("/") && text.includes(entry.path)) || (entry.relative && text.includes(entry.relative))) {
      hits.push({ path: entry.path })
      continue
    }
    if (common) continue
    if (base.length >= 6 && text.includes(base)) {
      hits.push({ path: entry.path })
    }
  }
  return hits
}

// Refresh from the file itself, never from proposed tool arguments. Limit the
// read and reject symlinks and non-regular files; failures leave it unknown.
export function refreshWrite(path, scope) {
  const entry = getWrite(path, undefined, scope)
  if (!entry || entry.content !== null || !posix.isAbsolute(entry.path) || ambiguousPath(entry.path)) return
  let fd
  try {
    fd = openSync(entry.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.size > 1024 * 1024) return
    const buffer = Buffer.alloc(1024 * 1024 + 1)
    let length = 0
    while (length < buffer.length) {
      const count = readSync(fd, buffer, length, buffer.length - length, null)
      if (!count) break
      length += count
    }
    const content = buffer.subarray(0, length)
    if (length > 1024 * 1024 || content.includes(0)) return
    return content.toString("utf8")
  } catch {
    // Missing, inaccessible or unsafe files remain unknown.
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

export function hasWrites(scope) { return store(scope).size > 0 }

/**
 * File names that are too common to be a useful signal on their own.
 */
const COMMON_NAMES = new Set([
  "index.js",
  "index.ts",
  "index.jsx",
  "index.tsx",
  "readme.md",
  "package.json",
  "main.py",
  "main.go",
  "app.js",
  "app.ts",
  "config.js",
  "config.ts",
  "setup.py",
  "test.py",
  "build.sh",
  "run.sh",
  "makefile",
  "dockerfile",
])

/**
 * Forget everything. Used by tests.
 */
export function resetWrites(scope) {
  const current = state(scope)
  current.files.clear()
  current.uncertain = false
  current.pending.clear()
  current.revision++
}

// Only use when the scope has no remaining users, such as a finished evaluation.
export function releaseWrites(scope) {
  requireScope(scope)
  globalThis[STATE_KEY]?.delete(scope)
}
