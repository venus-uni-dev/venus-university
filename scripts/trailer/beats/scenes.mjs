// The store-driven scene beats: a cast, a background and hand-written lines, with no call of
// any kind behind them. Each returns what the driver prints and screenshots.

import { sleep } from '../game.mjs'

/** The scene as `copy.mjs` writes it, ready for the runtime. */
function sceneOf(beat, extra = {}) {
  return {
    cast: beat.cast,
    bg: beat.bg,
    time: beat.time,
    lines: beat.lines,
    ...(beat.weather ? { weather: beat.weather } : {}),
    ...extra
  }
}

/** Chorus 1: the track, opened under the curtain so the reveal is on camera. */
export async function peDuo({ g, copy, opts }) {
  const beat = copy.beats.peDuo
  const staged = await g.openScene(sceneOf(beat))
  if (opts.auto) await g.auto(beat.lines.length - 1, opts.auto)
  return staged
}

/** Cooldown 1: movie night in her room, twelve PG lines. */
export async function sfwBedroom({ g, copy, opts }) {
  const beat = copy.beats.sfwBedroom
  const staged = await g.stageScene(sceneOf(beat))
  if (opts.auto) await g.auto(beat.lines.length - 1, opts.auto)
  return staged
}

/** Cooldown 2: the same opening, then the CG the `--cg` option names. */
export async function nsfwBedroom({ g, copy, opts }) {
  const beat = copy.beats.nsfwBedroom
  const staged = await g.stageScene(sceneOf(beat, { cg: opts.cg }))
  if (opts.auto) await g.auto(beat.lines.length - 1, opts.auto)
  return staged
}

/** Extra: the storm at the train stop. The sky is patched at this slot before the stage is set. */
export async function rain({ g, copy, opts }) {
  const beat = copy.beats.rain
  const staged = await g.stageScene(sceneOf(beat, { weather: beat.weather ?? 'storm' }))
  if (opts.auto) await g.auto(beat.lines.length - 1, opts.auto)
  return staged
}

/** School 3: a rank-up sheet rising over a scene, exactly as one does at the end of a slot. */
export async function rankup({ g, copy, opts }) {
  const beat = copy.beats.rankup
  await g.stageScene(sceneOf(beat))
  // The scene is read out first: the screen arrives over lines the player has already turned.
  if (opts.auto) await g.auto(beat.lines.length - 1, opts.auto)
  await sleep(opts.auto ? 600 : 2500)
  await g.rankUp({ stat: beat.stat, before: beat.before, after: beat.after })
  return g.probe()
}

/**
 * School 4: what she took away from the hour, in the box, and then the milestone screen over it
 * — the order the end of a scene plays them in.
 */
export async function milestone({ g, copy, opts }) {
  const beat = copy.beats.milestone
  await g.stageScene(sceneOf(beat))
  if (opts.auto) await g.auto(beat.lines.length - 1, opts.auto)
  await sleep(opts.auto ? 600 : 2500)
  // What she took away from the hour lands in the box first, as it would in play; the sentence
  // on the sheet is the app's own, off the same flag diff the ledger would fold.
  await g.milestone({
    charKey: beat.cast[0],
    memory: beat.memory,
    event: beat.event,
    emotion: beat.emotion
  })
  return g.probe()
}
