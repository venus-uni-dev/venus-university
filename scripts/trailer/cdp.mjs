// A minimal Chrome DevTools Protocol client over Node's global WebSocket, plus the input and
// polling helpers the trailer driver needs. No dependencies.

import { writeFileSync } from 'node:fs'

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** The debugger targets a port is offering, or null when nothing is listening on it. */
export async function targets(port, path = '/json/list') {
  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`)
    return await response.json()
  } catch {
    return null
  }
}

/**
 * Opens a session on one target. `pick` chooses it out of the port's list; the renderer is the
 * `page` target and the main process the first (and only) target on the inspector port.
 */
export async function connect(port = 9222, pick = (t) => t.type === 'page', path = '/json/list') {
  const list = await targets(port, path)
  if (!list) throw new Error(`nothing is listening on ${port}`)
  const target = list.find(pick)
  if (!target) {
    throw new Error(`no target on ${port}: ${JSON.stringify(list.map((t) => [t.type, t.url]))}`)
  }

  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })

  let id = 0
  const waiting = new Map()
  const events = []
  ws.onmessage = (message) => {
    const msg = JSON.parse(message.data)
    if (msg.id === undefined) {
      events.push(msg)
      return
    }
    const pending = waiting.get(msg.id)
    waiting.delete(msg.id)
    if (!pending) return
    if (msg.error) pending.reject(new Error(JSON.stringify(msg.error)))
    else pending.resolve(msg.result)
  }

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const next = ++id
      waiting.set(next, { resolve, reject })
      ws.send(JSON.stringify({ id: next, method, params }))
    })

  await send('Runtime.enable')
  // A renderer alone has a page to keep awake and focused; without both, motion never runs and
  // `document.visibilityState` stays hidden behind an occluded window.
  if (target.type === 'page') {
    await send('Page.enable')
    await send('Page.setWebLifecycleState', { state: 'active' })
    await send('Emulation.setFocusEmulationEnabled', { enabled: true })
  }

  /** One synchronous expression; returns its value or throws what it threw. */
  const evalSync = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true })
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ?? JSON.stringify(result.exceptionDetails)
      )
    }
    return result.result.value
  }

  /**
   * One asynchronous expression. The result is parked on a window slot and polled rather than
   * awaited through `awaitPromise`, which intermittently collects the promise out from under it.
   */
  const evalAsync = async (expression, timeoutMs = 30000) => {
    const slot = `__tr${Math.random().toString(36).slice(2, 8)}`
    await evalSync(
      `globalThis.${slot}=undefined; Promise.resolve().then(()=>(${expression}))` +
        `.then(v=>globalThis.${slot}=[1,v===undefined?null:v],` +
        `e=>globalThis.${slot}=[0,String((e&&e.stack)||e)]); 0`
    )
    const started = Date.now()
    for (;;) {
      const parked = await evalSync(
        `globalThis.${slot}===undefined?null:JSON.stringify(globalThis.${slot})`
      )
      if (parked !== null) {
        await evalSync(`delete globalThis.${slot}; 0`)
        const [ok, value] = JSON.parse(parked)
        if (!ok) throw new Error(value)
        return value
      }
      if (Date.now() - started > timeoutMs) {
        throw new Error(`timed out: ${expression.replace(/\s+/gu, ' ').slice(0, 120)}`)
      }
      await sleep(25)
    }
  }

  /** Polls an expression until it is truthy. */
  const waitFor = async (expression, timeoutMs = 20000, everyMs = 50) => {
    const started = Date.now()
    for (;;) {
      if (await evalSync(`Boolean(${expression})`)) return true
      if (Date.now() - started > timeoutMs) {
        throw new Error(`never became true: ${expression.replace(/\s+/gu, ' ').slice(0, 120)}`)
      }
      await sleep(everyMs)
    }
  }

  /** The centre of an element in CSS pixels, or null when it is not on screen. */
  const rectOf = (selector) =>
    evalSync(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)});` +
        ` if (!el) return null; const r = el.getBoundingClientRect();` +
        ` return r.width && r.height ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null })()`
    )

  /** A real mouse press at a point, which is what a `whileTap` gesture needs to see. */
  const pressAt = async (x, y) => {
    const base = { x, y, button: 'left', clickCount: 1 }
    await send('Input.dispatchMouseEvent', { ...base, type: 'mouseMoved', buttons: 0 })
    await sleep(40)
    await send('Input.dispatchMouseEvent', { ...base, type: 'mousePressed', buttons: 1 })
    await sleep(70)
    await send('Input.dispatchMouseEvent', { ...base, type: 'mouseReleased', buttons: 0 })
  }

  /** The same, aimed at an element. */
  const press = async (selector) => {
    const at = await rectOf(selector)
    if (!at) throw new Error(`nothing to press at ${selector}`)
    await pressAt(at.x, at.y)
    return at
  }

  /** Types into a focused field one character at a time, so the camera sees the words appear. */
  const type = async (selector, text, msPerChar = 60) => {
    await evalSync(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)});` +
        ` if (!el) throw new Error('no field ' + ${JSON.stringify(selector)}); el.focus() })()`
    )
    for (const character of text) {
      await send('Input.insertText', { text: character })
      await sleep(msPerChar)
    }
  }

  const screenshot = async (path) => {
    const shot = await send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(path, Buffer.from(shot.data, 'base64'))
    return path
  }

  return {
    target,
    send,
    eval: evalSync,
    evalAsync,
    waitFor,
    rectOf,
    press,
    pressAt,
    type,
    screenshot,
    events,
    close: () => ws.close()
  }
}
