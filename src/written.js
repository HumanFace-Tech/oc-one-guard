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
 * key, so both copies of a doubly-loaded plugin see the same writes.
 */

import { posix } from "node:path"
import { constants, openSync, closeSync, fstatSync, readSync, lstatSync } from "node:fs"

const FILES_KEY = Symbol.for("oc-one-guard.written-files")
const REVISION_KEY = Symbol.for("oc-one-guard.written-revision")
const UNCERTAIN_KEY = Symbol.for("oc-one-guard.uncertain-patch")
const PENDING_KEY = Symbol.for("oc-one-guard.pending-mutations")

export function beginMutation() {
  const pending = globalThis[PENDING_KEY] ??= new Set()
  const token = Symbol()
  pending.add(token)
  return token
}
export function endMutation(token) { globalThis[PENDING_KEY]?.delete(token) }
export function hasPendingMutation() { return (globalThis[PENDING_KEY]?.size ?? 0) > 0 }

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
function store() {
  if (!globalThis[FILES_KEY]) {
    globalThis[FILES_KEY] = new Map()
  }
  return globalThis[FILES_KEY]
}

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
export function recordWrite(path, content, directory) {
  const key = normalize(path, directory)
  if (!key) return
  const files = store()
  const relative = typeof directory === "string" && posix.isAbsolute(directory) && posix.isAbsolute(key) ? posix.relative(directory, key) : undefined
  files.set(key, { path: key, content: typeof content === "string" ? content : null, ...(relative ? { relative } : {}) })
  globalThis[REVISION_KEY] = (globalThis[REVISION_KEY] ?? 0) + 1
  if (files.size > MAX_TRACKED) {
    const oldest = files.keys().next().value
    if (oldest !== undefined) files.delete(oldest)
    markUncertainPatch()
  }
}

export function writesRevision() { return globalThis[REVISION_KEY] ?? 0 }
export function markUncertainPatch() {
  globalThis[UNCERTAIN_KEY] = true
  globalThis[REVISION_KEY] = writesRevision() + 1
}
export function hasUncertainPatch() { return globalThis[UNCERTAIN_KEY] === true }

/**
 * Look up a written file by its normalised path.
 */
export function getWrite(path, directory) {
  const key = normalize(path, directory)
  if (!key) return undefined
  return store().get(key)
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
export function referencedWrites(text, directory) {
  if (typeof text !== "string" || !text) return []
  const files = store()
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
export function refreshWrite(path) {
  const entry = getWrite(path)
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

export function hasWrites() { return store().size > 0 }

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
export function resetWrites() {
  store().clear()
  globalThis[UNCERTAIN_KEY] = false
  globalThis[PENDING_KEY]?.clear()
  globalThis[REVISION_KEY] = writesRevision() + 1
}
