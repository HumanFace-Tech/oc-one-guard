/**
 * Host-agnostic guard runtime shared by the OpenCode 1.x and 2.x adapters.
 *
 * The adapters translate host hook payloads into `before`, `after` and
 * `observe` calls. Everything that decides or tracks state lives here.
 */

import { createAuditLogger } from "./audit.js"
import { createGuard, VERDICT } from "./guard.js"
import { redactText } from "./redact.js"
import { beginMutation, endMutation, markUncertainPatch } from "./written.js"
import { createStopController } from "./stop.js"
import { isMutationTool } from "./tools.js"

const PENDING_TTL_MS = 10 * 60 * 1000

/**
 * Build the error the agent sees when a call is blocked.
 *
 * The message is written for the model: it states what was blocked and why,
 * so the agent can adjust instead of retrying blindly. Arguments are
 * redacted first — this text goes back to the model provider, so a secret
 * inside a blocked command would otherwise leave the machine here.
 */
function blockedMessage(decision, tool, args) {
  const preview =
    typeof args?.command === "string" ? redactText(args.command).slice(0, 300) : undefined
  const lines = [
    `[oc-one-guard] Blocked tool call "${tool}".`,
    `Reason: ${redactText(decision.reason)}`,
  ]
  if (decision.probability !== undefined) {
    lines.push(`Exfiltration probability: ${decision.probability.toFixed(3)}`)
  }
  if (decision.hosts?.length) {
    lines.push(`Destinations: ${decision.hosts.join(", ")}`)
  }
  if (preview) {
    lines.push(`Command: ${preview}`)
  }
  if (decision.verdict === VERDICT.ESCALATE) {
    lines.push("Manual review required. No native approval prompt is available from this hook.")
  }
  lines.push(
    "This call was stopped before execution. If it is legitimate, rephrase it so the intent is explicit, or ask the user to run it manually.",
  )
  return lines.join("\n")
}

/**
 * @param {object} config Normalized configuration.
 * @param {object} host
 * @param {string} [host.directory] Absolute project directory.
 * @param {string} host.scope Explicit state scope from `createScope`.
 * @param {object} [host.client] Optional SDK-shaped object. `app.log`, `tui.showToast` and `session.get/abort` are used when present.
 */
export function createGuardRuntime(config, { client, directory, scope }) {
  const audit = createAuditLogger(config, client)
  const guard = createGuard(config, { writeAudit: audit, directory, scope })
  const pending = new Map()
  const finish = key => {
    for (const entry of pending.get(key) ?? []) endMutation(entry.token, scope)
    pending.delete(key)
  }
  // Code Mode nested calls share the outer call id, so one `after` releases one token.
  const releaseOne = key => {
    const entries = pending.get(key)
    if (!entries?.length) return
    endMutation(entries.shift().token, scope)
    if (!entries.length) pending.delete(key)
  }
  const remove = (key, token) => {
    if (!token) return
    endMutation(token, scope)
    const entries = pending.get(key)
    if (!entries) return
    const remaining = entries.filter(item => item.token !== token)
    if (remaining.length) pending.set(key, remaining)
    else pending.delete(key)
  }
  // `after` never fires when a call is interrupted or a later plugin rejects it.
  // Drop such tokens, but mark the scope uncertain: the write may still land.
  const sweepStale = () => {
    const cutoff = Date.now() - PENDING_TTL_MS
    for (const [key, entries] of pending) {
      const fresh = entries.filter(entry => entry.at >= cutoff)
      if (fresh.length === entries.length) continue
      for (const entry of entries) if (entry.at < cutoff) endMutation(entry.token, scope)
      markUncertainPatch(scope)
      if (fresh.length) pending.set(key, fresh)
      else pending.delete(key)
    }
  }

  const report = (level, message, extra) => {
    try {
      client?.app?.log?.({
        body: { service: "oc-one-guard", level, message, extra },
      })?.catch?.(() => {})
    } catch {
      // Logging must never break the guard.
    }
  }
  const stopNotice = (message, variant) => {
    try {
      client?.tui?.showToast?.({ body: { title: "oc-one-guard", message, variant, duration: 8000 } })?.catch?.(() => {})
    } catch {}
  }
  const stop = createStopController({
    client,
    directory,
    warn: message => { report("warn", message); if (config.notify) stopNotice(message, "warning") },
    notify: message => { report("warn", message); if (config.notify) stopNotice(message, "warning") },
  })

  for (const problem of config.problems ?? []) {
    report("error", `Configuration problem, using fail-closed defaults: ${problem}`)
  }
  if (config.degraded) {
    report("error", "Guard is running with the bundled defaults because the configuration was invalid.")
  }

  if (config.enabled) {
    report(
      "info",
      `Guard active: ${config.endpoint} (model ${config.model}), deny>=${config.denyThreshold}, escalate>=${config.escalateThreshold} (${config.escalateAction})`,
    )
  } else {
    report("warn", "Guard is DISABLED by configuration. Tool calls are not being reviewed.")
  }

  return {
    observe(input, output) {
      stop.observe(input, output)
    },

    async before({ tool, sessionID, callID, args }) {
      sweepStale()
      const ticket = stop.capture(sessionID)
      if (await stop.pending(sessionID)) {
        throw new Error("[oc-one-guard] Blocked tool call while conversation cancellation is pending.")
      }

      const mutation = config.enabled && isMutationTool(tool)
      const key = typeof sessionID === "string" && typeof callID === "string" ? `${sessionID}\0${callID}` : undefined
      const token = mutation ? beginMutation(scope) : undefined
      if (token && key) {
        const entries = pending.get(key) ?? []
        entries.push({ token, at: Date.now() })
        pending.set(key, entries)
      }
      let decision
      try {
        decision = await guard.evaluate({ tool, args })
      } catch (error) {
        remove(key, token)
        throw error
      }

      if (decision.stop) {
        remove(key, token)
        await stop.request(ticket)
        throw new Error(blockedMessage(decision, tool, args))
      }
      if (await stop.pending(sessionID)) {
        remove(key, token)
        throw new Error("[oc-one-guard] Blocked tool call while conversation cancellation is pending.")
      }
      if (decision.verdict === VERDICT.ESCALATE && config.escalateAction === "allow") {
        // Escalated but allowed: warn loudly so the attempt is visible.
        audit(decision, { state: decision.state })
        try {
          client?.tui?.showToast?.({
            body: {
              title: "oc-one-guard",
              message: redactText(`Flagged ${tool}: ${decision.reason}`),
              variant: "warning",
              duration: 8000,
            },
          })?.catch?.(() => {})
        } catch {
          // A toast must never break the guard.
        }
        return
      }

      if (decision.blocked) {
        remove(key, token)
        if (config.notify) {
          try {
            client?.tui?.showToast?.({
              body: {
                title: "oc-one-guard",
                message: redactText(`Blocked ${tool}: ${decision.reason}`),
                variant: decision.verdict === VERDICT.ESCALATE ? "warning" : "error",
                duration: 8000,
              },
            })?.catch?.(() => {})
          } catch {
            // A toast must never break the guard.
          }
        }
        throw new Error(blockedMessage(decision, tool, args))
      }
    },

    after({ tool, sessionID, callID }) {
      if (!isMutationTool(tool)) return
      if (typeof sessionID !== "string" || typeof callID !== "string") return
      releaseOne(`${sessionID}\0${callID}`)
    },

    // Called when the plugin unloads. A mutation still in flight may land after
    // its hook is gone, so the scope is marked uncertain rather than trusted.
    dispose() {
      const held = [...pending.values()].some(entries => entries.length > 0)
      for (const key of [...pending.keys()]) finish(key)
      if (held) markUncertainPatch(scope)
    },
  }
}
