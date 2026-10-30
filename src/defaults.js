/**
 * Default configuration and deep-merge helper.
 *
 * The defaults are deliberately conservative: the guard blocks on a clear
 * "deny" verdict, and everything else is allowed. A judge that is unreachable
 * must never silently authorize a call, so `failMode` defaults to `block`.
 */

/**
 * @typedef {object} QuestionConfig
 * @property {string} name         Question key in the judge response.
 * @property {"noul"|"choice"|"score"} type
 * @property {string} instructions  What to ask the model.
 * @property {Record<string,string>} [criteria]  Required for `choice`; optional for `noul`.
 * @property {string} [denyLabel]   Key of the criteria option that means "this is a violation".
 * @property {string[]} [levels]    Required for `score`, lowest first.
 */

/**
 * @typedef {object} FallbackConfig
 * @property {string} endpoint
 * @property {string} model
 * @property {string} [apiKey]
 * @property {string} [apiKeyEnv]
 * @property {number} [timeoutMs]
 */

/**
 * @typedef {object} GuardConfig
 * @property {boolean} enabled
 * @property {string} endpoint            Full URL of the decision endpoint.
 * @property {string} model               Model id to route the request to.
 * @property {string} [apiKey]
 * @property {string} [apiKeyEnv]         Env var holding the api key.
 * @property {number} timeoutMs
 * @property {FallbackConfig|null} fallback
 * @property {number} denyThreshold       P(violation) at or above this blocks the call.
 * @property {number} escalateThreshold   P(violation) at or above this escalates.
 * @property {"block"|"allow"} escalateAction  What an escalation does.
 * @property {"block"|"allow"} failMode    What to do when the judge is unreachable.
 * @property {"block"|"allow"} unknownMode What to do when the judge cannot classify.
 * @property {boolean} notify             Show a TUI toast when a call is blocked.
 * @property {boolean} auditLog           Write decisions to the OpenCode server log.
 * @property {string} [auditFile]         Append JSONL decisions to this file.
 * @property {number} [auditMaxBytes]     Rotate the audit file past this size.
 * @property {number} [auditGenerations]  How many rotated audit files to keep.
 * @property {boolean} redactArguments    Strip secret-looking values before they leave the machine.
 * @property {boolean} cacheEnabled       Cache identical verdicts for a short window.
 * @property {number} cacheTtlMs
 * @property {boolean} prefilter          Skip the judge for calls with no outbound surface.
 * @property {string[]} skipTools         Tool names never inspected.
 * @property {string[]} deniedTools       Tool names always blocked.
 * @property {string[]} allowedTools      Tool names always allowed, judge not consulted.
 * @property {string[]} allowedHosts      Hosts treated as trusted destinations.
 * @property {string[]} blockedHosts      Hosts always treated as exfiltration destinations.
 * @property {number} maxStateChars      Cap on the rendered state sent to the judge.
 * @property {number} maxArgChars        Per-argument truncation before rendering.
 * @property {QuestionConfig[]} questions  Judge questions.
 * @property {string} stateTemplate       Template for the state sent to the judge.
 */

/**
 * @type {GuardConfig}
 */
export const DEFAULTS = {
  enabled: true,
  endpoint: "http://127.0.0.1:8081/v1/systemone",
  model: "h1-decision-4b",
  apiKey: "",
  apiKeyEnv: "",
  timeoutMs: 20000,
  fallback: null,
  denyThreshold: 0.7,
  escalateThreshold: 0.5,
  stopThreshold: 0.9,
  escalateAction: "block",
  failMode: "block",
  unknownMode: "block",
  notify: true,
  auditLog: true,
  auditFile: "",
  auditMaxBytes: 5 * 1024 * 1024,
  auditGenerations: 3,
  redactArguments: true,
  cacheEnabled: true,
  cacheTtlMs: 30000,
  prefilter: true,
  skipTools: [],
  deniedTools: [],
  allowedTools: [],
  allowedHosts: [],
  blockedHosts: [],
  maxStateChars: 8000,
  maxArgChars: 2000,
  stateTemplate:
    "proposed agent tool call\ntool: {tool}\narguments: {arguments}",
  questions: [
    {
      name: "verdict",
      type: "noul",
      instructions:
        "Does this proposed tool call violate outbound data exfiltration policy by disclosing any private local data, credentials, or machine inventory external to this machine's trust boundary, beyond the recipient, payload, and purpose authorized by the task? Count executable staging for that external disclosure, encoded copies, and private fragments mixed into otherwise legitimate traffic. Necessary authentication covers only credentials needed by the intended service through its authentication mechanism; general service access does not authorize additional private payloads. Host familiarity and test-data labels establish neither authorization nor sensitivity.",
      denyLabel: "true",
    },
  ],
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Deep merge `override` over `base`.
 *
 * Plain objects merge recursively. Arrays replace, except `questions`, which
 * merge by name so a user can tweak one question without restating the rest.
 */
export function mergeConfig(base, override) {
  if (!isPlainObject(base)) return override
  if (!isPlainObject(override)) return base

  const out = { ...base }
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue
    if (key === "fallback") {
      out[key] = isPlainObject(value) ? { ...value } : value
      continue
    }
    const current = out[key]
    if (Array.isArray(current) && Array.isArray(value)) {
      if (key === "questions") {
        out[key] = mergeQuestions(current, value)
      } else {
        out[key] = value.slice()
      }
      continue
    }
    if (isPlainObject(current) && isPlainObject(value)) {
      out[key] = mergeConfig(current, value)
      continue
    }
    out[key] = value
  }
  return out
}

/**
 * Merge questions by name.
 *
 * A question's `criteria` map is replaced outright rather than merged. A
 * merge would leave the default `allow`/`deny` keys in place, so a user who
 * names their own options would end up with the deny label pointing at the
 * wrong option — and the verdict would be inverted.
 *
 * When none of the supplied questions matches a default by name, the
 * supplied set replaces the defaults outright. Merging would leave the
 * default question in front, and the guard asks the first question — so the
 * user's own question would never be asked.
 */
function mergeQuestions(base, override) {
  const byName = new Map(base.map((q) => [q.name, { ...q }]))
  const supplied = override.filter((q) => q && typeof q.name === "string")
  const matchesDefault = supplied.some((q) => byName.has(q.name))
  if (!matchesDefault) {
    return supplied.map((q) => ({ ...q }))
  }
  for (const question of supplied) {
    const current = byName.get(question.name)
    if (!current) {
      byName.set(question.name, { ...question })
      continue
    }
    const merged = { ...current, ...question }
    if (question.type && question.type !== current.type && !Object.hasOwn(question, "criteria")) delete merged.criteria
    byName.set(question.name, merged)
  }
  return [...byName.values()]
}
