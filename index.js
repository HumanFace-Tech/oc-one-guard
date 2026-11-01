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
 *
 * The default export serves both hosts: `setup` for OpenCode 2.x and `server`
 * for OpenCode 1.x. Both adapters call the same runtime.
 */

import { server } from "./src/adapters/v1.js"
import { setup } from "./src/adapters/v2.js"

export const id = "oc-one-guard"

export { server, setup }

export default { id, setup, server }
