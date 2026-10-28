/**
 * Client for the System One decision API (`/v1/systemone`).
 *
 * The wire format follows TypeSafe's Jev contract, as implemented by
 * llama.cpp's llama-server:
 *
 *   POST /v1/systemone
 *   {
 *     "model": "<model id>",
 *     "state": "<text>",
 *     "questions": {
 *       "<name>": { "type": "noul" | "choice" | "score", "instructions": "...", ... }
 *     }
 *   }
 *
 *   -> { "answers": { "<name>": { "noul": 0.93 } | { "choice": "deny", "probabilities": {...} } | { "score": 3.2 } } }
 *
 * Question semantics:
 *
 * - `choice` returns the top option plus a probability per option. The
 *   guard reads the probability of the option named by the question's
 *   `denyLabel`.
 * - `noul` normally returns P(true); llama.cpp's LEV returns a normalized
 *   expected rating instead. The criteria must be
 *   exactly the `true`/`false` pair, and `denyLabel` says which of the two
 *   means "this is a violation" — `denyLabel: "true"` when `true` is the
 *   violation, `denyLabel: "false"` when the violation is the negative
 *   answer. The guard complements the probability when `denyLabel` is
 *   `false`.
 */

/**
 * @typedef {object} DecisionAnswer
 * @property {"noul"|"choice"|"score"} type
 * @property {number} [noul]       Probability of the affirmative label.
 * @property {string} [choice]      Top choice for `choice` questions.
 * @property {Record<string,number>} [probabilities]
 * @property {number} [confidence]
 * @property {number} [score]      Expected level for `score` questions.
 */

export class JudgeError extends Error {
  constructor(message, options = {}) {
    super(message)
    this.name = "JudgeError"
    this.kind = options.kind ?? "unknown"
    this.cause = options.cause
  }
}

/**
 * Build the request payload for the configured questions.
 *
 * @param {string} model
 * @param {string} state
 * @param {import("./defaults.js").QuestionConfig[]} questions
 */
export function buildRequest(model, state, questions) {
  const payload = {}
  for (const question of questions) {
    const body = { type: question.type, instructions: question.instructions }
    if (question.type === "noul" || question.type === "choice") {
      body.criteria = question.criteria ?? {}
    }
    if (question.type === "score") {
      body.criteria = question.levels ?? []
    }
    payload[question.name] = body
  }
  return { model, state, questions: payload }
}

/**
 * Normalize the server answer into a flat probability map.
 */
export function readAnswer(answer) {
  if (!answer || typeof answer !== "object") return undefined
  if (answer.type === "noul" && typeof answer.noul === "number") {
    return { affirmative: answer.noul, probabilities: { true: answer.noul }, confidence: answer.confidence }
  }
  if (answer.type === "choice" && answer.probabilities && typeof answer.probabilities === "object") {
    const probabilities = {}
    for (const [key, value] of Object.entries(answer.probabilities)) {
      if (typeof value === "number") probabilities[key] = value
    }
    return { top: answer.choice, probabilities, confidence: answer.confidence }
  }
  if (answer.type === "score" && typeof answer.score === "number") {
    return { score: answer.score, probabilities: answer.probabilities ?? {}, confidence: answer.confidence }
  }
  return undefined
}

/**
 * Find the criteria key that represents a denial.
 *
 * The question may declare `denyLabel` explicitly. Otherwise a `deny` key is
 * used. If neither is available the caller must not guess, because picking
 * the wrong option inverts the verdict — so this returns undefined.
 */
export function findDenyOption(question) {
  const explicit = question?.denyLabel
  if (typeof explicit === "string" && explicit) return explicit
  const criteria = question?.criteria ?? {}
  if (Object.hasOwn(criteria, "deny")) return "deny"
  return undefined
}

/**
 * Extract the probability that the call is a violation.
 *
 * For `choice`, this is the probability of the deny option.
 * For `noul`, the server returns P(true). If the deny label is `true`, that
 * value is the violation probability; if the deny label is `false`, the
 * violation probability is its complement.
 */
export function denyProbability(question, answer) {
  if (answer?.type !== question?.type) return undefined
  const normalized = readAnswer(answer)
  if (!normalized) return undefined

  if (question?.type === "noul") {
    const denyLabel = findDenyOption(question)
    if (!denyLabel) return undefined
    // The affirmative label must be resolvable, otherwise the server's
    // probability could not be attributed to either side.
    const affirmative = resolveAffirmativeLabel(question)
    if (!affirmative) return undefined
    if (typeof normalized.affirmative !== "number" || !Number.isFinite(normalized.affirmative) || normalized.affirmative < 0 || normalized.affirmative > 1) return undefined
    const affirmativeIsDeny = affirmative === denyLabel
    return affirmativeIsDeny ? normalized.affirmative : 1 - normalized.affirmative
  }

  if (question?.type === "choice") {
    const denyLabel = findDenyOption(question)
    if (!denyLabel) return undefined
    const value = normalized.probabilities[denyLabel]
    return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : undefined
  }

  return undefined
}

/**
 * The label a `noul` question treats as affirmative.
 *
 * A `noul` question carries exactly the criteria `true` and `false`, and the
 * server derives the affirmative from those keys — it is always `true`.
 * The function returns undefined for anything else, because a probability
 * that cannot be attributed to either side would invert the verdict.
 */
export function resolveAffirmativeLabel(question) {
  const criteria = question?.criteria ?? {}
  if (!Object.hasOwn(criteria, "true")) return undefined
  if (!Object.hasOwn(criteria, "false")) return undefined
  return "true"
}

/**
 * POST a decision request to the judge.
 *
 * The timeout covers the response body as well as the headers: a judge that
 * accepts the connection and then stalls must not hang the tool call.
 */
export async function requestDecision(options) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  if (typeof fetchImpl !== "function") {
    throw new JudgeError("No fetch implementation available", { kind: "unavailable" })
  }

  const payload = buildRequest(options.model, options.state, options.questions)
  const headers = { "Content-Type": "application/json" }
  if (options.apiKey) headers.Authorization = `Bearer ${options.apiKey}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs)
  try {
    const response = await fetchImpl(options.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    const text = await response.text()

    if (!response.ok) {
      throw new JudgeError(`Judge returned HTTP ${Number.isInteger(response.status) ? response.status : "error"}`, {
        kind: "http",
      })
    }

    let body
    try {
      body = JSON.parse(text)
    } catch (error) {
      throw new JudgeError("Judge returned invalid JSON", {
        kind: "malformed",
        cause: error,
      })
    }

    if (!body || typeof body.answers !== "object" || body.answers === null) {
      throw new JudgeError("Judge response is missing an `answers` object", { kind: "malformed" })
    }

    return body
  } catch (error) {
    if (error instanceof JudgeError) throw error
    const aborted = error?.name === "AbortError"
    throw new JudgeError(
      aborted
        ? `Judge request timed out after ${options.timeoutMs}ms`
        : "Judge request failed",
      { kind: aborted ? "timeout" : "network", cause: error },
    )
  } finally {
    clearTimeout(timer)
  }
}
