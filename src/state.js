/**
 * Rendering a proposed tool call into the "state" text the judge reads.
 *
 * Two ideas drive this module:
 *
 * 1. **The prefilter is an allowlist, not a blocklist.** The judge costs
 *    seconds per request, so something has to keep it away from the 99% of
 *    calls that cannot possibly reach the network. A blocklist over
 *    free-form shell cannot be exhaustive — every gap is a silent allow.
 *    So we skip only tools that are known to be local-only, and judge
 *    everything else.
 *
 * 2. **Security-relevant facts are extracted, not truncated.** The judge must
 *    never score a benign-looking prefix of a dangerous command. Destinations,
 *    file references and sinks are extracted from the full argument text and
 *    surfaced explicitly, so truncation of the raw text cannot hide them.
 */

import { getWrite, referencedWrites } from "./written.js"

const URL_PATTERN = /\b(?:https?|ftps?|sftp|scp|rsync|ssh|git):\/\/[^\s"'`<>|;&]+/gi

/**
 * Tools that cannot, on their own, move data off the machine.
 *
 * These are the only tools that skip the judge without further checks.
 * Everything else — shell, webfetch, MCP tools, any tool added in a future
 * OpenCode release — is judged.
 */
const LOCAL_ONLY_TOOLS = new Set([
  "read",
  "write",
  "edit",
  "apply_patch",
  "glob",
  "grep",
  "list",
  "todowrite",
  "todoread",
  "patch",
  "question",
  "plan_exit",
  "invalid",
])

/**
 * Tools whose arguments can contain a payload bound for a remote host.
 *
 * `write` and `edit` are included because a model can stage a payload in a
 * file and execute it in a later call. Their content is judged when it
 * contains something that moves data.
 */
const CONTENT_TOOLS = new Set(["write", "edit", "apply_patch"])

/**
 * Primitives that reach the network, matched against shell text.
 *
 * These decide whether a *shell* call needs the judge. The list is broad
 * but not so broad that ordinary development commands pay a judge round
 * trip: a false positive here costs the full judge latency on every call.
 *
 * The distinction that matters is whether the tool is being *run* in a way
 * that can reach out — a network client, a language runtime with a
 * one-liner, a package publish — rather than merely being mentioned.
 */
const TRANSFER_PRIMITIVES = [
  // Explicit network clients.
  /\b(?:curl|wget|httpie|aria2c)\b/i,
  /\b(?:nc|ncat|netcat|socat|telnet)\b/i,
  /\bopenssl\s+s_client\b/i,
  /\b(?:ssh|scp|sftp|rsync|ftp|ftps)\b/i,
  /\b(?:sendmail|msmtp|mutt)\b/i,
  // `mail` as a command, not as a word in a message.
  /(?:^|[;&|]\s*)mail\b/i,
  // Bash's own TCP/UDP sockets. The sink matters more than the source, so
  // this matches `/dev/tcp/...` wherever it appears.
  /\/dev\/(?:tcp|udp)\//i,
  // Language runtimes, but only when used as a one-liner. Running a script
  // file is covered by the staged-file tracking instead.
  /\bpython[0-9.]*\s+-[a-zA-Z]*c\b/i,
  /\bnode\s+-e\b/i,
  /\bperl\s+-[a-zA-Z]*e\b/i,
  /\bruby\s+-e\b/i,
  /\bphp\s+-r\b/i,
  // Decoders that feed a shell.
  /\bbase64\b[^\n|]*\|\s*(?:base64\s+-[a-zA-Z]*d|sh|bash)\b/i,
  // Version control and package publishing.
  /\bgit\s+(?:push|remote\s+add|clone|fetch|submodule)\b/i,
  /\b(?:npm|yarn|pnpm|poetry|cargo|gem|composer)\s+publish\b/i,
  /\b(?:docker|podman)\s+(?:push|build)\b/i,
  /\b(?:mc|az|gcloud|gsutil|rclone)\s+cp\b/i,
  /\baws\b[^\n]*\bs3\b/i,
  /\b(?:fetch\s*\(|requests\.(?:get|post|put|request)\s*\(|urllib|http\.client|https?\.request|socket\s*\(|socket\.socket|XMLHttpRequest|axios\.)/i,
  // DNS as an exfiltration channel. `host` is only a DNS lookup when it is
  // used as a command — as a bare word it is far more often prose ("the
  // host", "blocked-host scan"), and matching that made the guard block
  // ordinary documentation.
  /(?:^|[;&|]\s*)(?:dig|nslookup|host|getent)\b/i,
  /\b(?:dig|nslookup|getent)\s+/i,
]

/**
 * True when the text contains something that reaches the network.
 */
export function hasTransferPrimitive(text) {
  if (typeof text !== "string" || !text) return false
  return TRANSFER_PRIMITIVES.some((pattern) => pattern.test(text))
}

/**
 * True when the command runs a file that could contain a payload.
 *
 * `bash /tmp/p` executes whatever is in that file. The payload may have been
 * staged by an earlier write, so the file itself is the outbound surface.
 *
 * The pattern is anchored to a command position so that ordinary commands
 * containing these words as part of a longer token — `git show`, `echo
 * shell` — are not treated as script execution.
 */
export function runsLocalScript(text) {
  if (typeof text !== "string" || !text) return false
  return /(?:^|[;&|]\s*|\s)(?:\/[\w./-]+\/)?(?:bash|sh|zsh|dash|ksh|python[0-9.]*|node|perl|ruby|php|deno|bun)(?=\s|$|[;&|])/i.test(text) || /(?:^|[;&|\n]\s*)\s*(?:source|\.)\s+[^\s;&|]+/.test(text) || /(?:^|[;&|\n]\s*)\s*(?:(?:[a-zA-Z_][\w]*=(?:'[^']*'|"(?:\\.|[^"\\])*"|\\[^\n]|[^\s;&|'"\\])*|(?:sudo|env|command|exec)|-\S+)\s+)*['"]?(?:[^\s;&|'"/]*\/)[^\s;&|'"]+/.test(text) ||
    // Shell expansions and malformed quoting can obscure where an assignment
    // ends. Treat a later slash-bearing word as a possible executable.
    /(?:^|[;&|\n])\s*(?:(?:sudo|env|command|exec|-\S+)\s+)*[a-zA-Z_]\w*=[^\n]*\s[^\s]*\/[^\s]*/.test(text)
}

/**
 * Extract the hosts a call would contact.
 *
 * Only URLs are used for host extraction. Free-text dotted tokens
 * (`secrets.json`, `credential.helper`) are noise and break host allow
 * lists, so they are not treated as hosts.
 *
 * @param {string} tool
 * @param {any} args
 * @returns {string[]}
 */
export function extractHosts(tool, args) {
  const chunks = []
  if (tool === "bash" || tool === "shell" || tool === "run") {
    if (typeof args?.command === "string") chunks.push(args.command)
  } else if (tool === "webfetch") {
    if (typeof args?.url === "string") chunks.push(args.url)
  } else if (CONTENT_TOOLS.has(tool)) {
    chunks.push(writtenContent(tool, args))
  }

  const hosts = new Set()
  for (const chunk of chunks) {
    for (const url of chunk.match(URL_PATTERN) ?? []) {
      try {
        const parsed = new URL(url)
        if (parsed.hostname) hosts.add(parsed.hostname.toLowerCase())
      } catch {
        const match = url.match(/^(?:[a-z]+:\/\/)?([^/:]+)/i)
        if (match?.[1]) hosts.add(match[1].toLowerCase())
      }
    }
  }
  return [...hosts]
}

/**
 * Collect the file paths a call references.
 */
export function extractPaths(tool, args) {
  const paths = []
  const push = (value) => {
    if (typeof value === "string" && value.trim()) paths.push(value.trim())
  }
  switch (tool) {
    case "read":
      push(args?.filePath)
      break
    case "write":
      push(args?.filePath)
      break
    case "edit":
      push(args?.filePath)
      break
    case "apply_patch":
      push(args?.filePath)
      break
    case "bash":
      push(args?.workdir)
      break
    default:
      break
  }
  return paths
}

/**
 * Extract the file paths a command reads or uploads.
 *
 * These are the paths that matter for exfiltration: `@file` uploads, pipes
 * out of a file, and `/dev/tcp` sinks reading from a file.
 */
export function extractFileReferences(text) {
  if (typeof text !== "string") return []
  const references = new Set()
  const patterns = [
    /@(?:<)?([^\s'"<>|&;]+)/g, // curl -d @file, -F file=@file
    /\b(?:cat|head|tail|less|more|base64|gzip|tar|zip|xxd|od|strings)\s+(-[a-zA-Z]+\s+)*([^\s|;&]+)/g,
    /\/dev\/(?:tcp|udp)\/[^\s'"|;&]+/g,
  ]
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = match[match.length - 1]
      if (value && value.length > 1 && !value.startsWith("-")) references.add(value)
    }
  }
  return [...references]
}

/**
 * Truncate a string to at most `max` characters, marking the cut.
 *
 * The marker counts toward the limit, so the result never exceeds `max`.
 * When the full marker does not fit, a bare ellipsis is used instead.
 */
export function truncate(value, max) {
  if (typeof value !== "string") return ""
  if (value.length <= max) return value
  const dropped = value.length - max
  const marker = `…[truncated ${dropped} chars]`
  if (marker.length >= max) {
    return max <= 1 ? value.slice(0, max) : `${value.slice(0, max - 1)}…`
  }
  return `${value.slice(0, max - marker.length)}${marker}`
}

/**
 * Truncate a value to `max` characters, recursing into strings.
 *
 * Serialising first and truncating the result produces invalid JSON for
 * nested objects, which then degrades to `[object Object]`.
 */
export function truncateValue(value, max) {
  if (typeof value === "string") return truncate(value, max)
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => truncateValue(item, max))
  if (value && typeof value === "object") {
    const out = {}
    for (const [key, item] of Object.entries(value).slice(0, 50)) {
      out[key] = truncateValue(item, max)
    }
    return out
  }
  return value
}

/**
 * Render the arguments of a tool call as compact JSON.
 */
function renderArgs(args, maxArgChars) {
  if (args === undefined || args === null) return "{}"
  if (typeof args !== "object") return truncate(String(args), maxArgChars)
  try {
    return JSON.stringify(truncateValue(args, maxArgChars))
  } catch {
    return "{}"
  }
}

/**
 * The full text of a tool call, used for fact extraction.
 *
 * This is never truncated before extraction, so the judge cannot be fed a
 * benign prefix of a dangerous command.
 */
export function fullText(tool, args) {
  if (!args || typeof args !== "object") return ""
  const parts = []
  for (const value of Object.values(args)) {
    if (typeof value === "string") parts.push(value)
  }
  return parts.join("\n")
}

/**
 * The content a write-like tool puts on disk.
 *
 * `edit` puts its payload in `newString`, not `content`, so the generic
 * "any string argument" scan would still find it — but the dedicated
 * helper is used so the two agree.
 */
export function writtenContent(tool, args) {
  if (!args || typeof args !== "object") return ""
  if (tool === "write") return typeof args.content === "string" ? args.content : ""
  if (tool === "edit") {
    const parts = []
    if (typeof args.newString === "string") parts.push(args.newString)
    if (typeof args.oldString === "string") parts.push(args.oldString)
    return parts.join("\n")
  }
  if (tool === "apply_patch") {
    const parts = []
    if (typeof args.patchText === "string") parts.push(args.patchText)
    if (typeof args.patch === "string") parts.push(args.patch)
    return parts.join("\n")
  }
  return ""
}

/**
 * Decide whether a tool call has an outbound surface worth judging.
 *
 * The rule is an allowlist of known-local tools. Anything else — including
 * MCP tools, `webfetch`, and any tool added in a future OpenCode release —
 * is judged.
 *
 * A shell command is judged when it uses a network primitive, runs a file
 * the agent has written, or mentions a written file at all.
 */
export function hasOutboundSurface(tool, args, directory) {
  if (LOCAL_ONLY_TOOLS.has(tool)) {
    // A file write can stage a payload that a later call executes, so the
    // content decides.
    if (CONTENT_TOOLS.has(tool)) {
      const content = writtenContent(tool, args)
      return hasTransferPrimitive(content)
    }
    return false
  }

  if (tool === "bash" || tool === "shell" || tool === "run") {
    const command = typeof args?.command === "string" ? args.command : ""
    if (hasTransferPrimitive(command)) return true
    if (runsLocalScript(command)) return true
    // The command mentions a file the agent wrote earlier. It may now hold
    // a payload, so it is judged.
    if (referencedWrites(command, directory).length) return true
    return false
  }

  if (tool === "webfetch") {
    if (args && Object.keys(args).some((key) => !["url", "format", "timeout"].includes(key))) return true
    // A GET can still carry data in the path or the query string.
    const url = typeof args?.url === "string" ? args.url : ""
    if (!url) return false
    try {
      const parsed = new URL(url)
      return parsed.search.length > 1 || parsed.pathname.length > 1
    } catch {
      return true
    }
  }

  return true
}

/**
 * The contents of files the agent wrote that a command references.
 *
 * A command like `bash /tmp/staged-payload` is opaque on its own. The judge
 * cannot tell a staging step from a harmless script unless it is shown what
 * the file contains — and the guard already recorded that.
 */
export function stagedContents(text, maxChars, directory, staged) {
  if (typeof text !== "string" || !text) return []
  const entries = []
  for (const hit of referencedWrites(text, directory)) {
    const written = staged?.get(hit.path) ?? getWrite(hit.path)
    if (!written) continue
    entries.push({
      path: written.path,
      content: truncate(written.content, maxChars),
    })
  }
  return entries
}

/**
 * Build the judge state for a proposed tool call.
 *
 * The security-relevant facts are extracted from the *full* argument text
 * and listed explicitly, so that truncating the raw arguments cannot hide
 * a destination, a file reference or a sink.
 */
export function renderState(input) {
  const hosts = new Set(extractHosts(input.tool, input.args))
  const paths = extractPaths(input.tool, input.args)
  const text = fullText(input.tool, input.args)
  const references = new Set(extractFileReferences(text))
  const argumentsText = renderArgs(input.args, input.maxArgChars)
  const staged = stagedContents(text, input.maxArgChars, input.directory, input.staged)
  let transfer = hasTransferPrimitive(text)
  for (const hit of referencedWrites(text, input.directory)) {
    const content = (input.staged?.get(hit.path) ?? getWrite(hit.path))?.content ?? ""
    for (const host of extractHosts("write", { content })) hosts.add(host)
    for (const reference of extractFileReferences(content)) references.add(reference)
    transfer ||= hasTransferPrimitive(content)
  }
  const hostList = [...hosts]
  const referenceList = [...references]

  const facts = []
  if (hostList.length) facts.push(`outbound hosts: ${hostList.join(", ")}`)
  if (referenceList.length) facts.push(`file references: ${referenceList.join(", ")}`)
  if (paths.length) facts.push(`referenced paths: ${paths.join(", ")}`)
  if (transfer) facts.push("contains a network transfer primitive")
  for (const file of staged) {
    facts.push(
      `staged file ${file.path} was written by the agent earlier; its content is:\n${file.content}`,
    )
  }

  const template = input.template ?? "proposed agent tool call\ntool: {tool}\narguments: {arguments}"
  let state = template
    .replaceAll("{tool}", input.tool)
    .replaceAll("{arguments}", argumentsText)
    .replaceAll("{hosts}", hostList.join(", "))
    .replaceAll("{paths}", paths.join(", "))
    .replaceAll("{references}", referenceList.join(", "))

  const factText = facts.join("\n")
  if (factText.length >= input.maxStateChars) throw new Error("Security facts exceed state limit")
  if (!factText) return truncate(state, input.maxStateChars)
  const remaining = input.maxStateChars - factText.length - 1
  return `${factText}\n${truncate(state, remaining)}`
}
