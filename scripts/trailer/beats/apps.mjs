// The landing's own screens: the three app panels, the day-change splash, BunnyBot's sting,
// and the bare landing the caption card is written over.

import { sleep } from '../game.mjs'

/** The landing, in either half of the day. */
export async function landing({ g, opts }) {
  await g.reset()
  await g.setSlot({ time: opts.night ? 1 : 0 })
  await g.music(Boolean(opts.music))
  await sleep(600)
  return g.probe()
}

/** One of the three panels that are React-local state, so only a real press opens them. */
async function openPanel({ g, opts }, label) {
  await g.reset()
  await g.setSlot({ time: opts.night ? 1 : 0 })
  await sleep(700)
  await g.cdp.waitFor(`document.querySelector('button[aria-label=${JSON.stringify(label)}]')`, 10000)
  await g.cdp.press(`button[aria-label=${JSON.stringify(label)}]`)
  await sleep(1200)
  return g.probe()
}

export const shop = (ctx) => openPanel(ctx, 'BunnyShop')
export const map = (ctx) => openPanel(ctx, 'BunnyMap')
export const calendar = (ctx) => openPanel(ctx, 'Calendar')

/**
 * The wipe: the curtain up on the morning midterms week opens on, held until `splash --end`
 * takes it off again.
 */
export async function splash({ g, opts, log }) {
  if (opts.end) {
    await g.endSplash()
    return g.probe()
  }
  await g.reset()
  await g.setSlot({ time: 1 })
  await sleep(500)
  const date = await g.midtermDate()
  const stamp = await g.splash({ date, time: 0, weather: 'clear', from: 'night', to: 'day' })
  // The card writes itself out over about two seconds; it is whole before anything reads it.
  await sleep(2600)
  log(`the curtain is holding on ${JSON.stringify(stamp)} — run \`splash --end\` to take it off`)
  return g.probe()
}

/** The consequence sting: BunnyBot's own tip lands on the landing, then the thread opens. */
export async function sting({ g, copy, opts, log }) {
  await g.reset()
  await g.setSlot({ time: opts.night ? 1 : 0 })
  await sleep(800)
  const charKey = copy.beats.sting?.charKey ?? copy.beats.kissNight.cast[0]
  const text = await g.phone.bunnybotSeen(charKey)
  log(`delivered: ${text}`)
  // The tile rings and shakes while it is unread; the thread is opened after it.
  await sleep(4000)
  await g.phone.thread('bunnybot')
  await sleep(900)
  return g.probe()
}

/** The caption card on its own, over whatever is on the stage. */
export async function caption({ g, opts, copy, args }) {
  if (opts.clear) {
    await g.clearCaption()
    return g.probe()
  }
  const text = args[0] ?? copy.captions.intro
  await g.caption(text, opts.big ? { big: opts.big } : {})
  return g.probe()
}
