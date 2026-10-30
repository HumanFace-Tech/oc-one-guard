/**
 * Audit trail for guard decisions.
 *
 * Two sinks:
 *   - The OpenCode server log (`client.app.log`), visible in the TUI logs.
 *   - An optional JSONL file, which is what you want when the guard runs on
 *     another machine and you want the trail to travel with the config.
 *
 * The server log records the decision but not the command: the log is the
 * place a secret is most likely to be read by something that should not see
 * it. The JSONL file records the command, because after an incident the
 * question is "what exactly was blocked". Both redact secret-looking values
 * first.
 */

import { appendFileSync, chmodSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from "node:fs"
import { dirname } from "node:path"

import { redactText } from "./redact.js"

/**
 * Rotate the audit file, keeping `generations` copies.
 */
function rotate(file, generations) {
  for (let index = generations; index >= 1; index--) {
    const from = index === 1 ? file : `${file}.${index - 1}`
    const to = `${file}.${index}`
    if (!existsSync(from)) continue
    try {
      if (index === generations) unlinkSync(to)
    } catch {
      // Ignore: the rename below still makes progress.
    }
    try {
      renameSync(from, to)
    } catch {
      // Ignore rotation failures; the audit must not break the guard.
    }
  }
}

export function createAuditLogger(config, client) {
  const file = config.auditFile
  const redact = config.redactArguments !== false

  function writeFile(entry) {
    if (!file) return
    try {
      const dir = dirname(file)
      if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 })
      if (existsSync(file)) chmodSync(file, 0o600)
      if (config.auditMaxBytes && existsSync(file) && statSync(file).size > config.auditMaxBytes) {
        rotate(file, config.auditGenerations)
      }
      appendFileSync(file, `${JSON.stringify(entry)}\n`, { mode: 0o600 })
    } catch {
      // Auditing must never break the guard.
    }
  }

  function writeServerLog(entry) {
    if (!config.auditLog || !client?.app?.log) return
    try {
      client.app
        .log({
          body: {
            service: "oc-one-guard",
            level: entry.verdict === "allow" ? "debug" : "warn",
            message: `${entry.verdict.toUpperCase()} ${entry.tool} (p=${entry.probability ?? "n/a"}) ${entry.reason}`,
            extra: {
              tool: entry.tool,
              verdict: entry.verdict,
              probability: entry.probability,
              hosts: entry.hosts,
              durationMs: entry.durationMs,
              mode: entry.mode,
              source: entry.source,
            },
          },
        })
        .catch(() => {})
    } catch {
      // Logging must never break the guard.
    }
  }

  return function audit(decision, context = {}) {
    const state = context.state
    const entry = {
      ts: new Date().toISOString(),
      tool: decision.tool,
      verdict: decision.verdict,
      reason: redact ? redactText(decision.reason) : decision.reason,
      probability: decision.probability,
      confidence: decision.confidence,
      hosts: decision.hosts,
      durationMs: decision.durationMs,
      mode: decision.mode,
      source: decision.source,
      // The rendered state is what the judge actually saw. It is recorded so
      // an incident can be reconstructed, and redacted so it does not become
      // a place where secrets pile up.
      state: state === undefined ? undefined : redact ? redactText(state) : state,
      error: redact ? redactText(context.error) : context.error,
    }
    writeServerLog(entry)
    writeFile(entry)
  }
}
