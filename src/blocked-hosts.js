import { hostMatches } from "./guard.js"

// Bound both traversal and text scanning, including object keys. Exceeding a
// limit is a denial: an unseen suffix could contain a blocked destination.
const MAX_NODES = 10000
const MAX_DEPTH = 100
const MAX_CHARS = 1000000
// Stop at the authority, leaving paths and queries available for independent
// URL matches. Shell punctuation can also be valid URL credentials, so it
// must not truncate the authority before the URL parser sees it.
const URLS = /\b([a-z][a-z0-9+.-]*:\/\/)([^\s/?#]+)/gi
const SHELL_PUNCTUATION = /["'`<>|;&()]/
const TRAILING_SHELL_PUNCTUATION = /["'`<>|;&()]+$/

export function scanBlockedHosts(args, patterns) {
  const seen = new WeakSet()
  const pending = [{ value: args, depth: 0 }]
  let nodes = 0
  let chars = 0
  try {
    while (pending.length) {
      const { value, depth } = pending.pop()
      if (++nodes > MAX_NODES || depth > MAX_DEPTH) return { limited: true }
      if (typeof value === "string") {
        chars += value.length
        if (chars > MAX_CHARS) return { limited: true }
        for (const match of value.matchAll(URLS)) {
          // Check at most two interpretations: the complete authority (minus
          // closing shell punctuation), and the prefix a shell could use.
          // Never enumerate every punctuation prefix: work stays bounded.
          const authority = match[2]
          const candidates = [authority.replace(TRAILING_SHELL_PUNCTUATION, "")]
          const delimiter = authority.search(SHELL_PUNCTUATION)
          if (delimiter >= 0) candidates.push(authority.slice(0, delimiter))
          for (const candidate of candidates) {
            try {
              const host = new URL(match[1] + candidate).hostname.toLowerCase().replace(/\.$/, "")
              if (!host) return { limited: true }
              if (hostMatches(host, patterns)) return { host }
            } catch {
              // An ambiguous/unparseable authority is not evidence of safety.
              return { limited: true }
            }
          }
        }
      } else if (value && typeof value === "object" && !seen.has(value)) {
        seen.add(value)
        const keys = Object.keys(value)
        if (nodes + pending.length + keys.length * 2 > MAX_NODES) return { limited: true }
        for (const key of keys) {
          const descriptor = Object.getOwnPropertyDescriptor(value, key)
          if (!descriptor || !("value" in descriptor)) return { limited: true }
          pending.push({ value: key, depth: depth + 1 }, { value: descriptor.value, depth: depth + 1 })
        }
      }
    }
    return {}
  } catch {
    return { limited: true }
  }
}
