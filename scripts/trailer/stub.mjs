// The LLM stub. It replaces main's four `llm:*` handlers over the V8 inspector on 9229 with
// handlers that answer from a queue the driver fills, so the two beats that run the real loop —
// the typed turn and the texting thread into a hangout — never reach the cloud.

import { main } from './app.mjs'

/** The channels the stub owns. Everything else main handles is left alone. */
export const CHANNELS = ['llm:completeScene', 'llm:completeTexting', 'llm:classify', 'llm:classifyHangout']

/** How long a stubbed reply takes, so the app's own waiting state is on camera. */
export const DEFAULT_DELAY_MS = 1800

/**
 * The code that runs inside the main process. It keeps one queue per channel and answers the
 * IPC envelope itself, because the app's own `handle` wrapper is what it is replacing.
 */
const INSTALL = `(() => {
  const load = (name) => {
    if (typeof require === 'function') return require(name)
    if (process.mainModule && process.mainModule.require) return process.mainModule.require(name)
    const createRequire = process.getBuiltinModule('module').createRequire
    return createRequire(process.mainModule ? process.mainModule.filename : process.argv[1])(name)
  }
  const { ipcMain } = load('electron')
  const channels = __CHANNELS__
  const stub = globalThis.__trStub || (globalThis.__trStub = { queues: {}, delayMs: __DELAY__ })
  for (const channel of channels) {
    stub.queues[channel] = stub.queues[channel] || []
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, async () => {
      const queued = stub.queues[channel].shift()
      await new Promise((resolve) => setTimeout(resolve, stub.delayMs))
      // Nothing queued fails fast rather than hanging: the app shows its own retry modal.
      if (queued === undefined) {
        return { ok: false, error: { code: 'LLM_NETWORK', message: 'the trailer stub had nothing queued for ' + channel } }
      }
      return { ok: true, data: queued }
    })
  }
  stub.installed = true
  return channels.length
})()`

/**
 * Installs the stub, or returns null when the inspector is not listening — in which case the
 * two stub-driven beats fall back to staging their lines straight onto the store.
 */
export async function install(delayMs = DEFAULT_DELAY_MS) {
  const session = await main()
  if (!session) return null
  await session.eval(
    INSTALL.replace('__CHANNELS__', JSON.stringify(CHANNELS)).replace('__DELAY__', String(delayMs))
  )
  return {
    session,
    /** Puts one reply at the back of a channel's queue. */
    queue: (channel, data) =>
      session.eval(
        `globalThis.__trStub.queues[${JSON.stringify(channel)}].push(${JSON.stringify(data)}), 0`
      ),
    /** Empties every queue — what a beat does before it fills its own. */
    clear: () =>
      session.eval(
        `(() => { for (const key of Object.keys(globalThis.__trStub.queues))` +
          ` globalThis.__trStub.queues[key].length = 0; return 0 })()`
      ),
    /** How many replies are still waiting, per channel. */
    pending: () =>
      session.eval(
        `JSON.stringify(Object.fromEntries(Object.entries(globalThis.__trStub.queues)` +
          `.map(([k, v]) => [k, v.length])))`
      ).then((json) => JSON.parse(json)),
    setDelay: (ms) => session.eval(`globalThis.__trStub.delayMs = ${Number(ms)}, 0`),
    close: () => session.close()
  }
}

/** The classifier verdict a staged scene is cast from: exactly these girls, nowhere on the map. */
export function verdict(charKeys, { inPublic = true, sceneLocation = '' } = {}) {
  return {
    characters: [...charKeys],
    mentionedOnly: [],
    actionType: '',
    inPublic,
    sceneLocation
  }
}

/** The hangout verdict that puts "Begin hangout" in front of the player. */
export function hangout(description) {
  return { playerAsked: true, characterOffered: false, description }
}
