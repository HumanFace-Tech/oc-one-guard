/**
 * Redaction of secret-looking values.
 *
 * Tool arguments reach three places: the judge endpoint, the audit trail,
 * and — via the blocked message — the model provider on the next turn. A
 * blocked command that carries `Authorization: Bearer sk-...` would
 * otherwise push that secret out to the provider through the error text.
 *
 * The patterns are conservative: they match the shape of a credential, not
 * its value, so a redaction can be spotted in a log.
 */

const PATTERNS = [
  // JSON and JSON embedded as an escaped string in rendered arguments.
  { regex: /((?:\\*"|')?(?:authorization|x-api-key|api[-_]?key|apikey|access[-_]?token|auth[-_]?token|secret|password|passwd|pwd)(?:\\*"|')\s*:\s*)(\\*"|')((?:\\.|(?!\2)[^\\])*?)(\2)/gi, replacement: "$1$2[REDACTED]$4" },
  // Bearer / Basic token values on their own.
  { regex: /\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]+/gi, replacement: "$1 [REDACTED]" },
  // Authorization headers and credential assignments.
  { regex: /((?:authorization|x-api-key|api[-_]?key|apikey|access[-_]?token|auth[-_]?token|secret|password|passwd|pwd)\s*[=:]\s*)(["']?)([^\s"'&,;]+)\2/gi, replacement: "$1$2[REDACTED]$2" },
  // Well-known key prefixes.
  { regex: /\b(sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{8,}|xox[baprs]-[A-Za-z0-9-]{8,}|AKIA[0-9A-Z]{12,})/g, replacement: "[REDACTED]" },
  // Private key blocks.
  { regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, replacement: "[REDACTED PRIVATE KEY]" },
  // Connection strings with inline credentials.
  { regex: /\b([a-z][a-z0-9+.-]*:\/\/)([^\s:@/]+):([^\s@/]+)@/gi, replacement: "$1$2:[REDACTED]@" },
  // Query-string secrets.
  { regex: /([?&](?:token|key|secret|password|api_key|apikey|access_token)=)([^&\s]+)/gi, replacement: "$1[REDACTED]" },
]

/**
 * Redact secret-looking substrings in a string.
 */
export function redactText(text) {
  if (typeof text !== "string" || !text) return text
  let out = text
  for (const { regex, replacement } of PATTERNS) {
    out = out.replace(regex, replacement)
  }
  return out
}

/**
 * Redact a value of any shape, recursing into strings.
 */
export function redactValue(value) {
  if (typeof value === "string") return redactText(value)
  if (Array.isArray(value)) return value.map((item) => redactValue(item))
  if (value && typeof value === "object") {
    const out = {}
    for (const [key, item] of Object.entries(value)) out[key] = /^(?:authorization|x-api-key|api[-_]?key|apikey|access[-_]?token|auth[-_]?token|secret|password|passwd|pwd)$/i.test(key) ? "[REDACTED]" : redactValue(item)
    return out
  }
  return value
}

/**
 * Redact the argument object of a tool call.
 */
export function redactArgs(args) {
  if (!args || typeof args !== "object") return args
  return redactValue(args)
}
