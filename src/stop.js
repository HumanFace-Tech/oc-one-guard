export function createStopController({ client, directory, warn = () => {}, notify = () => {}, timeoutMs = 2000 }) {
  let epoch = 0
  const messages = new Map()
  const operations = new Map()
  const preparing = new Set()
  const consumed = new Map()
  const warning = "Cancellation could not be fully confirmed. Use OpenCode's interrupt control if the AI is still running."
  const safe = callback => { try { callback() } catch {} }

  function observe(input, output) {
    const id = output?.message?.id ?? input.messageID
    if (typeof input.sessionID !== "string") return
    if (id && messages.get(input.sessionID)?.id === id) return
    messages.set(input.sessionID, { id, epoch: ++epoch })
  }

  async function bounded(callback, controller, deadline) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw new Error("deadline")
    let timer
    try {
      return await Promise.race([
        Promise.resolve().then(callback),
        new Promise((_, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new Error("deadline")) }, remaining)
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }

  async function ancestry(sessionID, chain = [{ id: sessionID, directory }]) {
    const seen = new Set()
    const controller = new AbortController()
    const deadline = Date.now() + timeoutMs
    let complete = false
    try {
      for (let i = 0; i < 32; i++) {
        const current = chain.at(-1)
        if (seen.has(current.id)) break
        seen.add(current.id)
        const result = await bounded(() => client.session.get({
          path: { id: current.id }, query: { directory: current.directory },
          throwOnError: true, signal: controller.signal,
        }), controller, deadline)
        const info = result?.data
        if (result?.error || result?.response?.ok === false || info?.id !== current.id || (info.parentID != null && (typeof info.parentID !== "string" || !info.parentID))) break
        if (typeof info.directory === "string" && info.directory) current.directory = info.directory
        if (!info.parentID) { complete = true; break }
        if (seen.has(info.parentID) || chain.length === 32) break
        chain.push({ id: info.parentID, directory: current.directory })
      }
    } catch {} finally {
      controller.abort()
    }
    return { chain, complete }
  }

  const fresh = (ticket, chain) => chain.every(item => (messages.get(item.id)?.epoch ?? 0) <= ticket.epoch)
  const intersects = (chain, active = operations.values()) => [...active].some(operation => chain.some(item => operation.chain.some(known => known.id === item.id)))

  async function pending(sessionID) {
    if ((!operations.size && !preparing.size) || typeof sessionID !== "string") return false
    const active = () => [...operations.values(), ...preparing]
    if (intersects([{ id: sessionID }], active())) return true
    const { chain } = await ancestry(sessionID)
    return intersects(chain, active())
  }

  async function request(ticket) {
    if (typeof ticket.sessionID !== "string" || !ticket.sessionID) {
      safe(() => warn(warning))
      return
    }
    const operation = { chain: [{ id: ticket.sessionID, directory }] }
    preparing.add(operation)
    let root
    let complete
    try {
      const resolved = await ancestry(ticket.sessionID, operation.chain)
      complete = resolved.complete
      if (!fresh(ticket, operation.chain)) return
      root = operation.chain.at(-1).id
      const generation = messages.get(root)?.epoch ?? 0
      if (intersects(operation.chain) || consumed.get(root) === generation) return
      operations.set(root, operation)
      consumed.set(root, generation)
      setTimeout(() => {
        void cancel().catch(() => safe(() => warn(warning)))
      }, 0)
    } finally {
      preparing.delete(operation)
    }

    async function cancel() {
      const { chain } = operation
      const controller = new AbortController()
      const deadline = Date.now() + timeoutMs
      try {
        if (!fresh(ticket, chain)) return
        if (typeof client.session?.abort !== "function") {
          safe(() => warn(warning))
          return
        }
        safe(() => notify("Requested cancellation of the current AI conversation run."))
        const results = await Promise.allSettled(chain.slice().reverse().map(item => bounded(() => {
          if (!fresh(ticket, chain)) return undefined
          return client.session.abort({
            path: { id: item.id }, query: { directory: item.directory },
            throwOnError: true, signal: controller.signal,
          })
        }, controller, deadline)))
        if (!complete || results.some(result => result.status !== "fulfilled" || result.value?.error || result.value?.response?.ok === false || result.value?.data !== true)) {
          safe(() => warn(warning))
        }
      } finally {
        controller.abort()
        if (operations.get(root) === operation) operations.delete(root)
      }
    }
  }

  return { observe, capture: sessionID => ({ sessionID, epoch }), pending, request }
}
