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

const MAX_ANCESTORS = 32

/**
 * @param {object} ctx OpenCode 2.x plugin context: `options`, `location`, `session`, `tool` and `command` hooks.
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

  // Sessions the user switched off with /guard.off. In memory only, so a service restart turns the guard back on.
  // A subagent session follows its nearest switched-off ancestor.
  const off = new Set()
  const parents = new Map()
  async function parentOf(sessionID) {
    if (parents.has(sessionID)) return parents.get(sessionID)
    let parentID
    try {
      parentID = (await ctx.session.get({ sessionID })).parentID
    } catch {
      // An unreadable session keeps the guard on: do not cache, do not skip.
      return undefined
    }
    parents.set(sessionID, parentID)
    return parentID
  }
  async function isOff(sessionID) {
    if (off.size === 0 || typeof sessionID !== "string") return false
    let current = sessionID
    for (let depth = 0; current !== undefined && depth < MAX_ANCESTORS; depth++) {
      if (off.has(current)) return true
      current = await parentOf(current)
    }
    return false
  }

  await ctx.session.hook("prompt", event => {
    runtime.observe({ sessionID: event.sessionID, messageID: event.messageID })
  })
  await ctx.tool.hook("execute.before", async event => {
    if (await isOff(event.sessionID)) return
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

  const notice = async (sessionID, text) => {
    try {
      await ctx.session.synthetic({ sessionID, text, description: text, resume: false })
    } catch {
      // A missing notice must not fail the command.
    }
  }
  const describe = async sessionID => {
    if (!config.enabled) return "oc-one-guard is disabled in its configuration (enabled: false). Tool calls are not reviewed."
    return (await isOff(sessionID))
      ? "oc-one-guard is OFF for this session and its subagents. Tool calls are not reviewed. /guard.on turns it back on."
      : "oc-one-guard is ON. Every tool call in this session is reviewed."
  }
  await ctx.command?.transform(editor => {
    editor.add({
      name: "guard.off",
      description: "Turn off oc-one-guard review for this session and its subagents until /guard.on or a service restart",
      execute: async input => {
        if (config.enabled) off.add(input.sessionID)
        await notice(input.sessionID, await describe(input.sessionID))
      },
    })
    editor.add({
      name: "guard.on",
      description: "Turn oc-one-guard review back on for this session",
      execute: async input => {
        off.delete(input.sessionID)
        await notice(input.sessionID, await describe(input.sessionID))
      },
    })
    editor.add({
      name: "guard.status",
      description: "Show whether oc-one-guard is reviewing tool calls in this session",
      execute: async input => {
        await notice(input.sessionID, await describe(input.sessionID))
      },
    })
  })

  return () => {
    off.clear()
    parents.clear()
    return runtime.dispose()
  }
}
