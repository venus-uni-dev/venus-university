#!/usr/bin/env node
// The trailer staging CLI: one command per beat, each loading the scratch playthrough and staging
// itself with hand-written copy. Only the two beats that run the app's own loop reach past the
// main-process stub, so nothing here ever touches the cloud.
//
//   node scripts/trailer/stage.mjs launch
//   node scripts/trailer/stage.mjs duo-day
//   node scripts/trailer/stage.mjs teardown

import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { launch, teardown } from './app.mjs'
import { open, sleep } from './game.mjs'
import { clearScratch, makeScratch, pruneScratch, SCRATCH_ID } from './scratch.mjs'
import { install } from './stub.mjs'
import * as scenes from './beats/scenes.mjs'
import * as apps from './beats/apps.mjs'
import * as school from './beats/school.mjs'
import { duoDay } from './beats/duoDay.mjs'
import { kissNight } from './beats/kissNight.mjs'
import { textsBeach } from './beats/textsBeach.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

/** Every beat command, in the order the video uses them. */
const BEATS = {
  'duo-day': duoDay,
  'kiss-night': kissNight,
  'pe-duo': scenes.peDuo,
  'texts-beach': textsBeach,
  registrar: school.registrar,
  exam: school.exam,
  quiz: (ctx) => school.quizAnswer(ctx, (ctx.args[0] ?? 'A').toUpperCase()),
  rankup: scenes.rankup,
  milestone: scenes.milestone,
  shop: apps.shop,
  map: apps.map,
  calendar: apps.calendar,
  splash: apps.splash,
  'sfw-bedroom': scenes.sfwBedroom,
  'nsfw-bedroom': scenes.nsfwBedroom,
  rain: scenes.rain,
  sting: apps.sting,
  landing: apps.landing,
  caption: apps.caption
}

/** `--auto 900`, `--music`, `--night`, `--cg sex`, `--end`, `--big WORD`, `--shot path`. */
const VALUED = new Set(['auto', 'cg', 'big', 'shot', 'copy', 'delay'])

function parse(argv) {
  const [command, ...rest] = argv
  const opts = { cg: 'nude_foreplay' }
  const args = []
  for (let at = 0; at < rest.length; at++) {
    const token = rest[at]
    if (!token.startsWith('--')) {
      args.push(token)
      continue
    }
    const name = token.slice(2)
    if (VALUED.has(name)) opts[name] = rest[++at]
    else opts[name] = true
  }
  if (opts.auto !== undefined) opts.auto = Number(opts.auto)
  if (opts.delay !== undefined) opts.delay = Number(opts.delay)
  return { command, opts, args }
}

const log = (line) => console.log(`[trailer] ${line}`)

/** The authored text. `--copy` points at another file, which is how a variant is tried out. */
async function loadCopy(where) {
  const path = where ?? join(HERE, 'copy.mjs')
  const resolved = isAbsolute(path) ? path : join(process.cwd(), path)
  try {
    return await import(pathToFileURL(resolved).href)
  } catch (err) {
    throw new Error(`could not load the copy at ${resolved}: ${err.message}`)
  }
}

/** Connects, makes sure the scratch playthrough is the one on screen, and brings the stub up. */
async function session(opts) {
  const g = await open()
  const before = await g.where()
  if (before.playthroughId !== SCRATCH_ID) {
    const scratch = makeScratch()
    log(`built the scratch playthrough ${scratch.id}`)
    const loaded = await g.loadScratch(scratch.id)
    log(`loaded save ${loaded.saveId} with a roster of ${loaded.roster}`)
  }
  // Nothing is reset here: every beat clears the screen itself, and the few commands that act on
  // what is already on it — `quiz`, `caption`, `splash --end` — must find it still there.

  // The stub is installed on every beat, not just the two that use it: with main's four `llm:*`
  // handlers replaced, nothing the app does for the rest of the session can reach the cloud.
  const stub = await install(opts.delay ?? undefined)
  if (!stub) log('the main-process inspector is not answering on 9229 — running without the stub')
  return { g, stub }
}

async function main() {
  const { command, opts, args } = parse(process.argv.slice(2))

  if (!command || command === 'list' || command === 'help') {
    console.log('beats: ' + Object.keys(BEATS).join(', '))
    console.log('other: launch, teardown, list')
    console.log('options: --auto <ms> --music --captions --night --cg <position> --end --clear --big <word> --shot <path> --copy <file> --delay <ms>')
    return
  }

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

  const beat = BEATS[command]
  if (!beat) throw new Error(`no such beat: ${command}`)

  const copy = await loadCopy(opts.copy)
  const { g, stub } = await session(opts)
  try {
    await beat({ g, stub, copy, opts, args, log })
    if (opts.shot) {
      // Long enough for the entrances, the background crossfade and the caption's stagger.
      await sleep(1600)
      await g.cdp.screenshot(opts.shot)
      log(`screenshot: ${opts.shot}`)
    }
    // The stores as the beat left them, which is what the beat is checked against.
    console.log(JSON.stringify(await g.probe(), null, 2))
  } finally {
    // Whatever the app wrote into the scratch folder while the beat ran is not worth keeping.
    pruneScratch()
    stub?.close()
    g.close()
  }
}

main().catch((err) => {
  console.error(`[trailer] ${err.stack ?? err}`)
  process.exitCode = 1
})
