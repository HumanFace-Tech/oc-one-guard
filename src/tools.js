/**
 * Tool identifiers shared by OpenCode 1.x and 2.x.
 *
 * Canonical names are the OpenCode 2.x ids. Names from 1.x are mapped onto
 * them, so policy lists and checks work for both hosts.
 */

const ALIASES = new Map([
  ["bash", "shell"],
  ["apply_patch", "patch"],
  ["task", "subagent"],
])

export function canonicalTool(name) {
  if (typeof name !== "string") return name
  return ALIASES.get(name) ?? name
}

export function isMutationTool(tool) {
  return ["write", "edit", "patch"].includes(canonicalTool(tool))
}

export function listsTool(list, tool) {
  const wanted = canonicalTool(tool)
  return list.some(entry => typeof entry === "string" && canonicalTool(entry) === wanted)
}

// 1.x write, edit and read take `filePath`; 2.x takes `path`. Every listed
// path counts as evidence, so a call that carries both is judged on both.
export function pathsOf(args) {
  const paths = []
  for (const key of ["filePath", "path"]) {
    const value = args?.[key]
    if (typeof value === "string" && value && !paths.includes(value)) paths.push(value)
  }
  return paths
}
