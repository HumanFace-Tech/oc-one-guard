import { posix } from "node:path"
import { randomUUID } from "node:crypto"

export function requireScope(scope) {
  if (typeof scope !== "string" || !scope) throw new TypeError("An explicit scope is required")
  return scope
}

export function createScope(input = {}) {
  const absolute = value => typeof value === "string" && posix.isAbsolute(value) ? posix.resolve(value) : undefined
  const directory = absolute(input.directory)
  if (!directory) return `anonymous:${randomUUID()}`
  const id = typeof input.project?.id === "string" && input.project.id ? input.project.id : undefined
  const worktree = absolute(input.worktree)
  return id && worktree && (id !== "global" || input.project?.vcs === "git")
    ? JSON.stringify(["project", id, worktree])
    : JSON.stringify(["directory", directory])
}
