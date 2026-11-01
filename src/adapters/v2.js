/**
 * OpenCode 2.x entry point: `setup(ctx)` with domain hooks.
 */

import { resolveConfig } from "../config.js"
import { createScope } from "../scope.js"
import { createGuardRuntime } from "../runtime.js"

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

// Never replace unusable input with `{}`: a shell call with no command would
// skip the judge, and input repair may turn the same value into a real command.
function inputOf(value) {
  if (value === undefined || value === null) return {}
  let parsed = value
  if (typeof value === "string") {
    try { parsed = JSON.parse(value) } catch { parsed = undefined }
  }
  if (!isPlainObject(parsed)) throw new Error("[oc-one-guard] Blocked tool call: its input is not a JSON object.")
  return parsed
}

// The stop controller reads sessions through an SDK-shaped object. OpenCode 2.x
// exposes the same two operations on `ctx.session`; nothing else is provided.
function sessionClient(ctx) {
  return {
    session: {
      get: async ({ path }) => ({ data: await ctx.session.get({ sessionID: path.id }) }),
      abort: async ({ path }) => ({ data: (await ctx.session.interrupt({ sessionID: path.id })).interrupted === true }),
    },
  }
}

/**
 * @param {object} ctx OpenCode 2.x plugin context: `options`, `location`, `session` and `tool` hooks.
 */
export async function setup(ctx) {
  // Same fail-closed rule as the v1 entry: a bad configuration falls back to
  // the bundled defaults rather than preventing the plugin from loading.
  const config = resolveConfig(ctx.options)
  const directory = ctx.location.directory
  const scope = createScope({
    directory,
    worktree: ctx.location.project?.directory,
    project: { id: ctx.location.project?.id },
  })
  const runtime = createGuardRuntime(config, { client: sessionClient(ctx), directory, scope })

  await ctx.session.hook("prompt", event => {
    runtime.observe({ sessionID: event.sessionID, messageID: event.messageID })
  })
  await ctx.tool.hook("execute.before", async event => {
    await runtime.before({
      tool: event.tool,
      sessionID: event.sessionID,
      callID: event.id,
      args: inputOf(event.input),
    })
  })
  await ctx.tool.hook("execute.after", event => {
    runtime.after({ tool: event.tool, sessionID: event.sessionID, callID: event.id })
  })

  return () => runtime.dispose()
}
