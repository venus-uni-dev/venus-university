// The renderer side of the driver: it installs `runtime/` in the dev app's page and wraps every
// call on `window.__tr` so a beat reads like plain Node.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderer } from './app.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

/** The runtime's three parts, in the order they build `window.__tr` up. */
const RUNTIME = ['core.js', 'chrome.js', 'scene.js']

/**
 * Opens a session on the renderer and puts the runtime in it. `call` names one `window.__tr`
 * function and hands it JSON arguments, so no beat has to write JavaScript as a string.
 */
export async function open() {
  const cdp = await renderer()
  for (const part of RUNTIME) {
    await cdp.eval(readFileSync(join(HERE, 'runtime', part), 'utf8'))
  }

  const call = (path, ...args) =>
    cdp.evalAsync(
      `window.__tr.${path}(${args.map((arg) => JSON.stringify(arg === undefined ? null : arg)).join(',')})`
    )

  return {
    cdp,
    call,
    /** Every helper the beats use, each one call on the runtime. */
    where: () => call('where'),
    loadScratch: (playthroughId) => call('loadScratch', playthroughId),
    reset: () => call('resetToLanding'),
    setSlot: (slot) => call('setSlot', slot),
    stageScene: (scene) => call('stageScene', scene),
    openScene: (scene) => call('openScene', scene),
    appendLines: (lines) => call('appendLines', lines),
    openTurn: () => call('openTurn'),
    waitForTurn: (timeoutMs) => call('waitForTurn', timeoutMs),
    waitForReply: (timeoutMs) => call('waitForReply', timeoutMs),
    auto: (count, everyMs) => call('auto', count, everyMs),
    sparkle: (charKey) => call('sparkle', charKey),
    rankUp: (options) => call('rankUp', options),
    milestone: (options) => call('milestone', options),
    splash: (options) => call('splash', options),
    endSplash: () => call('endSplash'),
    midtermDate: () => call('midtermDate'),
    exam: (options) => call('exam', options),
    music: (on) => call('music', on),
    freeNow: (charKeys) => call('freeNow', charKeys),
    caption: (text, options) => call('caption', text, options ?? {}),
    clearCaption: () => call('clearCaption'),
    probe: () => call('probe'),
    phone: {
      close: () => call('phone.close'),
      thread: (charKey) => call('phone.thread', charKey),
      venus: () => call('phone.venus'),
      incoming: (charKey, text) => call('phone.incoming', charKey, text),
      outgoing: (charKey, text) => call('phone.outgoing', charKey, text),
      send: (charKey, text) => call('phone.send', charKey, text),
      bunnybotSeen: (charKey) => call('phone.bunnybotSeen', charKey),
      armed: () => call('phone.armed')
    },
    close: () => cdp.close()
  }
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
