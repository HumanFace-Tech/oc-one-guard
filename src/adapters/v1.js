/**
 * OpenCode 1.x entry point: `server(input, options)` with `client` hooks.
 */

import { resolveConfig } from "../config.js"
import { createScope } from "../scope.js"
import { createGuardRuntime } from "../runtime.js"
import { isMutationTool } from "../tools.js"

/**
 * @param {{client: object, directory?: string, worktree?: string, project?: {id?: string, vcs?: string}}} input OpenCode v1 host context.
 * @param {Record<string, unknown>} [options]
 */
export async function server(input, options) {
  // A broken config must not remove the guard: OpenCode discards a plugin
  // that throws while loading, which would leave every tool call
  // unrestricted. `resolveConfig` falls back to the fail-closed defaults.
  const config = resolveConfig(options)
  const scope = createScope(input)
  const runtime = createGuardRuntime(config, { client: input.client, directory: input.directory, scope })

  return {
    async "chat.message"(hookInput, output) {
      runtime.observe(hookInput, output)
    },
    async "tool.execute.before"(hookInput, output) {
      await runtime.before({ tool: hookInput.tool, sessionID: hookInput.sessionID, callID: hookInput.callID, args: output.args })
    },
    async "tool.execute.after"(hookInput) {
      runtime.after({ tool: hookInput.tool, sessionID: hookInput.sessionID, callID: hookInput.callID })
    },
    async event({ event }) {
      const part = event?.type === "message.part.updated" && event.properties?.part
      // Interrupted parts can be marked as errors before their tool has stopped.
      if (!part || part.type !== "tool" || !isMutationTool(part.tool) || part.state?.status !== "error" || part.state?.metadata?.interrupted === true) return
      runtime.after({ tool: part.tool, sessionID: part.sessionID, callID: part.callID })
    },
  }
}
