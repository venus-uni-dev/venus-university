#!/usr/bin/env node
// The itch.io store page's picture pipeline: stages one page moment per command in the dev app,
// captures it (a PNG master or a GIF screencast) for `encode.mjs`, and never touches the cloud —
// same launch, scratch playthrough and LLM stub as the trailer.
//
//   node scripts/itch-page/stage.mjs launch
//   node scripts/itch-page/stage.mjs probe
//   node scripts/itch-page/stage.mjs still lab
//   node scripts/itch-page/stage.mjs gif arcade
//   node scripts/itch-page/stage.mjs teardown

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, teardown } from '../trailer/app.mjs'
import { open, sleep } from '../trailer/game.mjs'
import { clearScratch, makeScratch, pruneScratch, SCRATCH_ID } from '../trailer/scratch.mjs'
import { hangout, install, verdict } from '../trailer/stub.mjs'
import { beats, names, swaps } from './copy.mjs'
import { encodeGif, GIFS, MASTERS_DIR, OUT_DIR, STILLS, writeFrames } from './encode.mjs'

const log = (line) => console.log(`[page] ${line}`)

/** How fast a staged scene's lines turn when `--auto` does not say. */
const DEFAULT_PACE_MS = 250

/** How long a screencast is left running before the frames it delivers are kept. */
const SETTLE_MS = 300

/** The box holding a line with nothing of it left unsaid, which is its typewriter having
 * finished. Handing the turn back redraws the box around the field and writes the line out
 * again, so this is what a capture waits on rather than the turn opening. */
const LINE_WRITTEN = `(() => {
    const line = document.querySelector('.vu-box-line')
    const unsaid = document.querySelector('.vu-box-unsaid')
    return Boolean(line && unsaid && line.textContent.trim()) && unsaid.textContent.length === 0
  })()`

// ─── the app ─────────────────────────────────────────────────────────────────────────────────

/**
 * Connects, makes sure the page's own scratch playthrough is the one loaded, and brings the stub
 * up. A session without the stub is refused outright: two of the moments press Go and Send for
 * real, and with main's `llm:*` handlers still its own those presses are cloud calls.
 */
async function session() {
  const g = await open()
  const before = await g.where()
  if (before.playthroughId !== SCRATCH_ID) {
    const scratch = makeScratch(swaps, names)
    log(`built the scratch playthrough ${scratch.id}`)
    const loaded = await g.loadScratch(scratch.id)
    log(`loaded save ${loaded.saveId} with a roster of ${loaded.roster}`)
  }
  const stub = await install()
  if (!stub) {
    g.close()
    throw new Error('the main-process inspector is not answering on 9229 — refusing to stage without the stub')
  }
  await g.music(false)
  await clearAction(g)
  await parkPointer(g)
  return { g, stub }
}

/**
 * Puts the pointer above every screen's own furniture. A press leaves it where it landed and the
 * page outlives the run that pressed, so a later capture finds a card lifted and its delete cross
 * drawn under a pointer nobody moved.
 */
const parkPointer = (g) =>
  g.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 960, y: 8, buttons: 0 })

/**
 * Empties the action field. It is React-local state seeded from the store only when the store has
 * something in it, so an action a previous run typed and never sent survives a reset — and the
 * landing draws that field under every panel the page photographs.
 */
const clearAction = (g) =>
  g.cdp.eval(`(() => {
    const field = document.querySelector('#game-action')
    if (!field) return false
    const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(field, '')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)

/** A store the runtime does not wrap, reached through the runtime's own module resolver. */
const onStore = (g, suffix, body) =>
  g.cdp.evalAsync(
    `(async () => { const m = await window.__tr.mod(${JSON.stringify(suffix)}); ${body}; return true })()`
  )

/** The scene as `copy.mjs` writes it, in the runtime's own shape. */
const sceneOf = (beat) => ({
  cast: beat.cast,
  time: beat.time,
  lines: beat.lines,
  ...(beat.weather ? { weather: beat.weather } : {})
})

// ─── capture ─────────────────────────────────────────────────────────────────────────────────

/** A PNG's pixel size, off its IHDR — what the crop is clamped against. */
function pngSize(path) {
  const head = readFileSync(path).subarray(16, 24)
  return { width: head.readUInt32BE(0), height: head.readUInt32BE(4) }
}

/** The window's geometry, as the renderer itself reads it. */
const geometryOf = (g) =>
  g.cdp.eval(`(() => {
    const root = document.getElementById('root')
    const rect = root.getBoundingClientRect()
    return {
      dpr: window.devicePixelRatio,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      root: { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
    }
  })()`)

/**
 * The master for one still, and the `#root` rect beside it in the master's own pixels. The window
 * is 16:9 with no letterbox, so the crop is a no-op — it is recorded anyway, because a window
 * that is ever anything else would otherwise put black bars on the store page.
 */
async function master(g, name) {
  mkdirSync(MASTERS_DIR, { recursive: true })
  const path = join(MASTERS_DIR, `${name}.png`)
  const geometry = await geometryOf(g)
  await g.cdp.screenshot(path)
  const png = pngSize(path)

  const clamp = (value, limit) => Math.max(0, Math.min(limit, Math.round(value)))
  const left = clamp(geometry.root.left * geometry.dpr, png.width)
  const top = clamp(geometry.root.top * geometry.dpr, png.height)
  const crop = {
    left,
    top,
    width: clamp(geometry.root.width * geometry.dpr, png.width - left),
    height: clamp(geometry.root.height * geometry.dpr, png.height - top)
  }
  writeFileSync(join(MASTERS_DIR, `${name}.json`), JSON.stringify({ ...geometry, png, crop }, null, 2))
  log(`master ${name}.png ${png.width}×${png.height}, #root ${crop.width}×${crop.height} at ${crop.left},${crop.top}`)
  return { path, png, crop }
}

/**
 * A screencast recorder. `cdp.mjs` never hands out the WebSocket, but every unsolicited message
 * reaches its `events` array through that array's own `push`, so the frames are taken there and
 * acknowledged straight away: an unacked frame stops the stream.
 */
function recorder(cdp) {
  const frames = []
  let recording = false

  cdp.events.push = function intercept(msg) {
    if (recording && msg && msg.method === 'Page.screencastFrame') {
      const { data, metadata, sessionId } = msg.params
      frames.push({
        t: metadata && metadata.timestamp ? metadata.timestamp * 1000 : Date.now(),
        buf: Buffer.from(data, 'base64')
      })
      cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
      return frames.length
    }
    return Array.prototype.push.call(this, msg)
  }

  return {
    frames,
    async start() {
      frames.length = 0
      recording = true
      await cdp.send('Page.startScreencast', {
        format: 'jpeg',
        quality: 92,
        maxWidth: 1746,
        maxHeight: 982,
        everyNthFrame: 2
      })
      // Starting the cast lays the page out again, and the frames either side of that catch the
      // dialogue box mid-resize. They are recorded and thrown away, so the loop opens on a
      // settled picture rather than on that.
      await sleep(SETTLE_MS)
      frames.length = 0
    },
    async stop() {
      await cdp.send('Page.stopScreencast')
      recording = false
      delete cdp.events.push
      return frames
    }
  }
}

// ─── the moments ─────────────────────────────────────────────────────────────────────────────

/** The five sidebar stills and the three the description column holds. */
const STILL_MOMENTS = {
  /** The box with the action typed into it and both of them still on stage, Go not yet pressed. */
  async lab({ g, pace, shoot }) {
    const beat = beats.lab
    await g.stageScene(sceneOf(beat))
    await g.auto(beat.lines.length - 1, pace)
    await g.openTurn()
    await g.cdp.waitFor(LINE_WRITTEN, 20000)
    await g.cdp.type('#game-action', beat.action, 70)
    await sleep(700)
    await shoot()
  },

  /** What she took away from the hour in the box, and the milestone sheet risen over it. */
  async greenhouse({ g, pace, shoot }) {
    const beat = beats.greenhouse
    await g.stageScene(sceneOf(beat))
    await g.auto(beat.lines.length - 1, pace)
    await sleep(1500)
    await g.milestone({
      charKey: beat.cast[0],
      memory: beat.memory,
      event: beat.event,
      emotion: beat.emotion
    })
    await sleep(3000)
    await shoot()
  },

  /** Three of them in the queue, once the entrances and the box have finished writing. */
  async themePark({ g, pace, shoot }) {
    const beat = beats.themePark
    await g.stageScene(sceneOf(beat))
    await g.auto(beat.lines.length - 1, pace)
    // Three entrances stagger ahead of the line, and the box only starts typing behind them.
    await sleep(4200)
    await shoot()
  },

  /** The practice room under a storm, on her first line. */
  async storm({ g, pace, shoot }) {
    const beat = beats.storm
    await g.stageScene(sceneOf(beat))
    await g.auto(1, pace)
    // Her entrance runs ahead of the line, and the box types it out behind that.
    await sleep(3400)
    await shoot()
  },

  /** The Body rank-up sheet, given long enough for the radar to walk and the tier to swap. */
  async weightRoom({ g, pace, shoot }) {
    const beat = beats.weightRoom
    await g.stageScene(sceneOf(beat))
    await g.auto(beat.lines.length - 1, pace)
    await sleep(1500)
    await g.rankUp({ stat: beat.stat, before: beat.before, after: beat.after })
    await sleep(3200)
    await shoot()
  },

  /** The phone on its Friends tab: all twelve of them. */
  async friends({ g, shoot }) {
    await g.reset()
    await g.setSlot({ time: 1 })
    await onStore(
      g,
      '/stores/bunnyboardStore.ts',
      "m.useBunnyboardStore.getState().openApp(); m.useBunnyboardStore.getState().setTab('friends')"
    )
    await sleep(1500)
    await shoot()
  },

  /** The map at night. React-local state, so only a real press opens it. */
  async 'map-night'({ g, shoot }) {
    await g.reset()
    await g.setSlot({ time: 1 })
    await sleep(700)
    await g.cdp.waitFor(`document.querySelector('button[aria-label="BunnyMap"]')`, 10000)
    await g.cdp.press('button[aria-label="BunnyMap"]')
    await sleep(1500)
    await shoot()
  },

  /** Manage Characters, once every card has its face off disk. Last in a session: it leaves the game. */
  async characters({ g, shoot }) {
    await g.reset()
    await onStore(g, '/stores/uiStore.ts', "m.useUiStore.getState().setView('manageCharacters')")
    await sleep(2500)
    // The screen wears the clock's half of the day; the page is night, so the root is flipped.
    await g.cdp.eval("document.querySelector('.vu-manage')?.setAttribute('data-theme', 'night'); 0")
    await sleep(500)
    await shoot()
    await onStore(g, '/stores/uiStore.ts', "m.useUiStore.getState().setView('game')")
  }
}

/** The two GIFs. Each holds the recording open across the part of the loop it is showing. */
const GIF_MOMENTS = {
  /** The hero: the action typed, Go pressed, the wait, and their answer typing itself out. */
  async arcade({ g, stub, pace, record }) {
    const beat = beats.arcade
    await g.stageScene(sceneOf(beat))
    await g.auto(beat.lines.length - 1, pace)
    await g.openTurn()

    await stub.clear()
    await stub.queue('llm:completeScene', { lines: beat.reply.lines, summary: beat.reply.summary })
    await g.cdp.waitFor(LINE_WRITTEN, 20000)
    await sleep(900)

    await record.start()
    await sleep(300)
    await g.cdp.type('#game-action', beat.action, 70)
    await sleep(450)
    await g.cdp.press('#game-submit')
    await g.waitForReply(60000)
    // The loop reads as a beat only if it ends on a line the box has finished writing.
    await g.cdp.waitFor(LINE_WRITTEN, 20000)
    await sleep(700)
    await record.stop()
  },

  /** The thread: a text sent for real, her paced replies, and Begin hangout arriving under them. */
  async texts({ g, stub, record }) {
    const beat = beats.texts
    await g.reset()
    await g.setSlot({ time: 1 })
    await g.phone.thread(beat.charKey)
    await sleep(900)

    await stub.clear()
    await stub.queue('llm:completeTexting', { messages: beat.replies, summary: beat.summary })
    await stub.queue('llm:classifyHangout', hangout(beat.hangout.description))
    // Begin hangout is not pressed, but it is live the moment it appears: the diner is queued so
    // that a press — the app's own prefetch, or a stray one — cannot become a call. Two verdicts,
    // because Begin re-classifies when it lands on a prefetch that has not finished casting.
    const cast = verdict(beat.scene.cast, { inPublic: true, sceneLocation: 'fast_food' })
    await stub.queue('llm:classify', cast)
    await stub.queue('llm:classify', cast)
    await stub.queue('llm:completeScene', {
      lines: beat.scene.lines,
      summary: beat.scene.summary ?? null
    })

    await record.start()
    await g.cdp.type('#bb-compose', beat.readerText, 55)
    await sleep(300)
    await g.cdp.press('#bb-send')
    await g.cdp.waitFor(`document.querySelector('#bb-begin-hangout')`, 60000)
    await sleep(900)
    await record.stop()
  }
}

// ─── commands ────────────────────────────────────────────────────────────────────────────────

/** The geometry the whole pipeline rests on, read off the running window. */
async function probe() {
  const { g, stub } = await session()
  try {
    const geometry = await geometryOf(g)
    const shot = await master(g, 'probe')
    console.log(JSON.stringify({ ...geometry, png: shot.png, crop: shot.crop }, null, 2))
  } finally {
    pruneScratch()
    stub.close()
    g.close()
  }
}

/** Two seconds of screencast on the landing: the one thing a GIF cannot be captured without. */
async function preflight() {
  const { g, stub } = await session()
  try {
    await g.reset()
    await sleep(600)
    const record = recorder(g.cdp)
    await record.start()
    await sleep(2000)
    const frames = await record.stop()
    log(`${frames.length} frames in 2000 ms`)
    if (frames.length === 0) {
      throw new Error('the screencast delivered nothing — the window is covered, minimised or not compositing')
    }
  } finally {
    pruneScratch()
    stub.close()
    g.close()
  }
}

/** One still: its moment staged, then a master and its crop written. */
async function still(name, opts) {
  const moment = STILL_MOMENTS[name]
  if (!moment) throw new Error(`no such still: ${name} (${Object.keys(STILLS).join(', ')})`)
  const { g, stub } = await session()
  try {
    await moment({
      g,
      stub,
      pace: opts.auto ?? DEFAULT_PACE_MS,
      shoot: () => master(g, name)
    })
    console.log(JSON.stringify(await g.probe(), null, 2))
  } finally {
    pruneScratch()
    stub.close()
    g.close()
  }
}

/** One GIF: its moment recorded, the frames put on disk, and the ladder walked over them. */
async function gif(name, opts) {
  const moment = GIF_MOMENTS[name]
  if (!moment) throw new Error(`no such GIF: ${name} (${Object.keys(GIFS).join(', ')})`)
  const { g, stub } = await session()
  const record = recorder(g.cdp)
  let frames = []
  try {
    await moment({ g, stub, pace: opts.auto ?? DEFAULT_PACE_MS, record })
    frames = record.frames
    console.log(JSON.stringify(await g.probe(), null, 2))
  } finally {
    pruneScratch()
    stub.close()
    g.close()
  }

  const spanMs = frames.length > 1 ? frames[frames.length - 1].t - frames[0].t : 0
  const expected = (spanMs / 1000) * GIFS[name].fps
  log(`recorded ${frames.length} frames over ${Math.round(spanMs)} ms (${GIFS[name].fps} fps wants ${Math.round(expected)})`)
  if (!(frames.length > 0.6 * expected) || frames.length === 0) {
    throw new Error(`the screencast delivered ${frames.length} frames, too few to encode ${name}`)
  }
  log(`frames: ${writeFrames(name, frames)}`)
  await encodeGif(name, frames)
}

function parse(argv) {
  const [command, ...rest] = argv
  const opts = {}
  const args = []
  for (let at = 0; at < rest.length; at++) {
    if (!rest[at].startsWith('--')) args.push(rest[at])
    else if (rest[at] === '--auto') opts.auto = Number(rest[++at])
    else opts[rest[at].slice(2)] = true
  }
  return { command, opts, args }
}

async function main() {
  const { command, opts, args } = parse(process.argv.slice(2))

  if (!command || command === 'help') {
    console.log('commands: launch, probe, preflight, still <name>, gif <name>, teardown')
    console.log(`stills: ${Object.keys(STILLS).join(', ')}`)
    console.log(`gifs: ${Object.keys(GIFS).join(', ')}`)
    console.log('options: --auto <ms>')
    return
  }

  mkdirSync(OUT_DIR, { recursive: true })

  if (command === 'launch') {
    clearScratch()
    await launch()
    return
  }
  if (command === 'teardown') {
    teardown()
    clearScratch()
    log('the scratch playthrough is gone')
    return
  }
  if (command === 'probe') return probe()
  if (command === 'preflight') return preflight()
  if (command === 'still') return still(args[0], opts)
  if (command === 'gif') return gif(args[0], opts)
  throw new Error(`no such command: ${command}`)
}

main().catch((err) => {
  console.error(`[page] ${err.stack ?? err}`)
  process.exitCode = 1
})
