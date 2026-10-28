/**
 * Process-wide state shared between plugin instances.
 *
 * OpenCode can load the same plugin twice when the global config directory
 * is a symlink to the project directory: the global and project configs
 * resolve `./plugins/...` to two different file URLs, and the dedup key is
 * the URL. Both instances then answer the same tool call, and the judge
 * costs seconds per request, so the verdict must not be computed twice.
 *
 * Only the cache is shared. The configuration is not: each instance keeps
 * its own resolved settings, so a project-level override is never silently
 * discarded because of module load order.
 *
 * The state is stored on `globalThis` under a `Symbol.for` key so it is
 * shared even when the module itself is instantiated twice.
 */

const CACHE_KEY = Symbol.for("oc-one-guard.shared-cache")

/**
 * @returns {Map<string, {stored: number, value?: any, pending?: Promise<any>}>}
 */
export function sharedCache() {
  if (!globalThis[CACHE_KEY]) {
    globalThis[CACHE_KEY] = new Map()
  }
  return globalThis[CACHE_KEY]
}
