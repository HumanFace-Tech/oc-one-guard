/**
 * oc-one-guard
 *
 * An OpenCode plugin that reviews every proposed tool call with a local
 * decision-model judge and blocks calls that look like outbound data
 * exfiltration. The judge is a System One / Jev style decision model served
 * over `POST /v1/systemone` (llama.cpp's llama-server, or any compatible
 * server).
 *
 * The guard runs in `tool.execute.before`. OpenCode awaits that hook before
 * executing the tool, so throwing from it aborts the call and surfaces the
 * reason to the agent as a failed tool result.
 */

import { createAuditLogger } from "./src/audit.js"
import { resolveConfig } from "./src/config.js"
import { createGuard, VERDICT } from "./src/guard.js"
import { scanBlockedHosts } from "./src/blocked-hosts.js"
import { redactText } from "./src/redact.js"
import { beginMutation, endMutation } from "./src/written.js"

export const id = "oc-one-guard"

/**
 * Build the error the agent sees when a call is blocked.
 *
 * The message is written for the model: it states what was blocked and why,
 * so the agent can adjust instead of retrying blindly. Arguments are
 * redacted first — this text goes back to the model provider, so a secret
 * inside a blocked command would otherwise leave the machine here.
 */
function blockedMessage(decision, tool, args, redact) {
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
  lines.push(
    "This call was stopped before execution. If it is legitimate, rephrase it so the intent is explicit, or ask the user to run it manually.",
  )
  return lines.join("\n")
}

/**
 * The OpenCode plugin entry point.
 *
 * @param {{client: object, directory?: string}} input OpenCode v1 host context (only consumed fields).
 * @param {Record<string, unknown>} [options]
 */
export async function server(input, options) {
  // A broken config must not remove the guard: OpenCode discards a plugin
  // that throws while loading, which would leave every tool call
  // unrestricted. `resolveConfig` falls back to the fail-closed defaults.
  const config = resolveConfig(options)

  const audit = createAuditLogger(config, input.client)
  const guard = createGuard(config, { writeAudit: audit, directory: input.directory })
  const pending = new Map()
  const finish = key => {
    for (const token of pending.get(key) ?? []) endMutation(token)
    pending.delete(key)
  }
  const remove = (key, token) => {
    if (!token) return
    endMutation(token)
    const tokens = pending.get(key)
    if (!tokens) return
    const remaining = tokens.filter(item => item !== token)
    if (remaining.length) pending.set(key, remaining)
    else pending.delete(key)
  }

  const report = (level, message, extra) => {
    try {
      input.client.app?.log?.({
        body: { service: "oc-one-guard", level, message, extra },
      })?.catch?.(() => {})
    } catch {
      // Logging must never break the guard.
    }
  }

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
    async "tool.execute.before"(hookInput, output) {
      const tool = hookInput.tool
      const args = output.args

      const scan = config.blockedHosts.length ? scanBlockedHosts(args, config.blockedHosts) : {}
      if (scan.host || scan.limited) {
        const decision = {
          verdict: VERDICT.DENY,
          reason: scan.host ? `Destination ${scan.host} is on the blocked-host list.` : "Blocked-host scan could not inspect all arguments (scan limit or inaccessible value).",
          tool,
          hosts: scan.host ? [scan.host] : [],
          probability: undefined,
          durationMs: 0,
          mode: "host-block",
          state: undefined,
        }
        audit(decision, {})
        throw new Error(blockedMessage(decision, tool, args, config.redactArguments))
      }

      const mutation = config.enabled && ["write", "edit", "apply_patch"].includes(tool)
      const key = typeof hookInput.sessionID === "string" && typeof hookInput.callID === "string" ? `${hookInput.sessionID}\0${hookInput.callID}` : undefined
      const token = mutation ? beginMutation() : undefined
      if (token && key) {
        const tokens = pending.get(key) ?? []
        tokens.push(token)
        pending.set(key, tokens)
      }
      let decision
      try {
        decision = await guard.evaluate({ tool, args })
      } catch (error) {
        remove(key, token)
        throw error
      }

      if (decision.verdict === VERDICT.ESCALATE && config.escalateAction === "allow") {
        // Escalated but allowed: warn loudly so the attempt is visible.
        audit(decision, { state: decision.state })
        try {
          input.client.tui?.showToast?.({
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
            input.client.tui?.showToast?.({
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
        throw new Error(blockedMessage(decision, tool, args, config.redactArguments))
      }
    },
    async "tool.execute.after"(hookInput) {
      if (!["write", "edit", "apply_patch"].includes(hookInput.tool)) return
      if (typeof hookInput.sessionID !== "string" || typeof hookInput.callID !== "string") return
      const key = `${hookInput.sessionID}\0${hookInput.callID}`
      finish(key)
    },
    async event({ event }) {
      const part = event?.type === "message.part.updated" && event.properties?.part
      // Interrupted parts can be marked as errors before their tool has stopped.
      if (!part || part.type !== "tool" || !["write", "edit", "apply_patch"].includes(part.tool) || part.state?.status !== "error" || part.state?.metadata?.interrupted === true) return
      if (typeof part.sessionID !== "string" || typeof part.callID !== "string") return
      finish(`${part.sessionID}\0${part.callID}`)
    },
  }
}

export default { id, server }
