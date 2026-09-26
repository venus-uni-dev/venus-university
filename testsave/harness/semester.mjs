// Plays a whole semester of the browser build under Playwright against the mock endpoint, as the
// scripted reader in policy.mjs, and takes seven manual saves, each on the first opening line of
// its slot, into testsave/<playthroughId>/ as manual01.json … manual07.json beside
// playthrough.json. Resumable: run it again with the same VU_RUN_DIR.
//
//   node testsave/harness/semester.mjs [--until <date>:<time>] [--seed <n>]
//
// Env: VU_RUN_DIR (default %TEMP%\vu-testsave-run), VU_WEB_PORT (5199), VU_MOCK_PORT (8783).
// Exit codes: 0 done (or --until reached), 1 setup, 2 the app failed or the game ended, 3 stalled.

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as D from './driver.mjs'
import {
  JOB_SHIFT_PREFERENCE,
  allContactsOf,
  decide,
  loverOf,
  pickFavourite,
  quizLetter,
  rngFor,
  weeklyStatLine
} from './policy.mjs'

// ─── Configuration ────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { until: null, seed: null }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--until') {
      const match = /^(\d+):([01])$/.exec(argv[++i] ?? '')
      if (!match) throw new Error('--until wants <date>:<time>, e.g. 41:0')
      out.until = { date: Number(match[1]), time: Number(match[2]) }
    } else if (arg === '--seed') {
      out.seed = Number(argv[++i])
      if (!Number.isFinite(out.seed)) throw new Error('--seed wants a number')
    } else {
      throw new Error(`unknown argument ${arg}`)
    }
  }
  return out
}

const ARGS = parseArgs(process.argv.slice(2))
const RUN_DIR = process.env.VU_RUN_DIR ?? join(tmpdir(), 'vu-testsave-run')
const WEB_PORT = Number(process.env.VU_WEB_PORT ?? 5199)
const MOCK_PORT = Number(process.env.VU_MOCK_PORT ?? 8783)
const ENDPOINT = `http://127.0.0.1:${MOCK_PORT}/v1`
const MODEL_ID = 'mock-model'

const PROFILE_DIR = join(RUN_DIR, 'profile')
const STATE_FILE = join(RUN_DIR, 'run-state.json')
const LOG_FILE = join(RUN_DIR, 'semester.jsonl')
const CONSOLE_FILE = join(RUN_DIR, 'console.log')
const SHOTS_DIR = join(RUN_DIR, 'shots')
const OUT_ROOT = join(D.REPO_ROOT, 'testsave')

/**
 * The seven manual saves, each taken on its slot's first opening line. manual01's slot is found
 * rather than fixed: the first of days 8-13 whose row offers a class and a project. manual02 and
 * manual05 are the Tuesday days of midterm and finals week, when a scheduled class sits its exam.
 * manual06 is the Sunday night before the finals scores post, so `finalsScoresShown` is still
 * false; manual07 is the night before graduation, and taking it ends the run.
 */
const MANUALS = [
  { slot: 1, days: [8, 13] },
  { slot: 2, date: 43, time: 0 },
  { slot: 3, date: 51, time: 0 },
  { slot: 4, date: 57, time: 0 },
  { slot: 5, date: 113, time: 0 },
  { slot: 6, date: 118, time: 1, finalsPending: true },
  { slot: 7, date: 122, time: 1 }
]
const [FIRST_PROBE_DAY, LAST_PROBE_DAY] = MANUALS[0].days
const saveIdOf = (slot) => `manual${String(slot).padStart(2, '0')}`

const TICK_MS = 80
const WATCHDOG_MS = 90_000
/** Ends a scene mid-way against either mock: the older one ends a continuation on "leave". */
const SAFETY_LINE = 'I leave and head home.'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const slotKey = (s) => `${s.date}:${s.time}`
const slotIndex = (date, time) => date * 2 + time

// ─── Run state and logs ───────────────────────────────────────────────────────

function loadState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'))
  } catch {
    return null
  }
}

let state = null

/** Written beside and renamed over, retried for a Windows scanner's hold on the file. */
function saveState() {
  const tmp = `${STATE_FILE}.tmp`
  writeFileSync(tmp, JSON.stringify(state, null, 2))
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(tmp, STATE_FILE)
      return
    } catch (error) {
      if (attempt >= 20 || error.code !== 'EPERM') throw error
      const until = Date.now() + 50
      while (Date.now() < until) {
        // A short spin: the rename is retried within about a second.
      }
    }
  }
}

function logRow(row) {
  appendFileSync(LOG_FILE, `${JSON.stringify(row)}\n`)
}

function say(text) {
  console.log(`[semester] ${text}`)
}

async function tokensNow() {
  const mock = await D.mockState(MOCK_PORT)
  return mock?.tokens?.total ?? null
}

// ─── Exits ────────────────────────────────────────────────────────────────────

let context = null
let page = null

async function finish(code, reason) {
  say(`exit ${code}: ${reason}`)
  try {
    logRow({ event: 'exit', code, reason, at: new Date().toISOString() })
  } catch {
    // The log is best effort on the way out.
  }
  if (context) await Promise.race([context.close().catch(() => {}), sleep(10_000)])
  process.exit(code)
}

/** A screenshot, the snapshot and the mock's state into the log, for a failure. */
async function dump(tag, s) {
  const name = `${tag}-${s ? `${s.date}-${s.time}-` : ''}${Date.now()}.png`
  await page?.screenshot({ path: join(SHOTS_DIR, name) }).catch(() => {})
  logRow({ event: tag, shot: name, snapshot: s ?? null, mock: await D.mockState(MOCK_PORT) })
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

async function preflight() {
  const reach = async (url) => {
    try {
      return (await fetch(url)).ok
    } catch {
      return false
    }
  }
  if (!(await reach(`${ENDPOINT}/models`))) {
    await finish(1, `the mock does not answer on ${ENDPOINT} (node testsave/harness/mock.mjs)`)
  }
  if (!(await reach(`http://localhost:${WEB_PORT}/`))) {
    await finish(1, `no vite on ${WEB_PORT} (npx vite -c vite.web.config.ts --port ${WEB_PORT} --strictPort)`)
  }
}

/** Waits for the first of `selectors` to be attached; which one. */
async function waitAny(selectors, timeoutMs) {
  const found = await page.waitForSelector(selectors.join(', '), { timeout: timeoutMs })
  for (const selector of selectors) {
    if (await found.evaluate((el, sel) => el.matches(sel), selector)) return selector
  }
  return null
}

/** Menu → Quickstart or Continue → a game whose store the harness reads. */
async function boot() {
  await page.goto(`http://localhost:${WEB_PORT}/`, { waitUntil: 'domcontentloaded' })
  const menu = ['#menu-continue', '#menu-quickstart']
  let first = await waitAny(['#setup-provider', '#menu-api-key', ...menu], 120_000)
  if (first === '#setup-provider') {
    say('first run')
    await D.firstRun(page, ENDPOINT, MODEL_ID)
    first = await waitAny(menu, 60_000)
  } else if (first === '#menu-api-key') {
    say('key stage from the menu')
    await D.clickWhenLive(page, '#menu-api-key')
    await D.keyStage(page, ENDPOINT, MODEL_ID)
    first = await waitAny(menu, 60_000)
  }

  let fromMenu
  if (first === '#menu-continue') {
    if (!state.playthroughId) say('the profile holds a playthrough the run-state does not name; adopting it')
    await D.clickWhenLive(page, '#menu-continue')
    fromMenu = 'continue'
  } else {
    if (state.playthroughId) await finish(1, `run-state names ${state.playthroughId} but the menu offers no Continue`)
    await D.quickstartToLanding(page, { name: 'Theo Marsh', wait: false })
    fromMenu = 'quickstart'
  }
  say(fromMenu)

  const deadline = Date.now() + 120_000
  let enrolled = fromMenu === 'quickstart'
  for (;;) {
    // Continue opens the registrar when the enrollment is the newest thing in the profile.
    if (!enrolled && (await page.$('#class-select-finalize'))) {
      say('registrar: enrolling')
      await D.enrol(page)
      enrolled = true
    }
    const s = await D.snapshot(page).catch(() => null)
    if (s && s.view === 'game' && s.playthroughId) return { s, fromMenu }
    if (Date.now() > deadline) {
      const onStage = await page.$('.vu-stage-advance')
      await dump('boot', s)
      await finish(
        1,
        onStage
          ? 'the game is on screen but the /@fs store reads no playthrough: a second module instance (restart vite fresh)'
          : `no game after 120 s (view ${s?.view ?? 'unknown'})`
      )
    }
    await sleep(250)
  }
}

function checkSchedule(s) {
  const want = D.ENROLMENT_SCHEDULE
  const have = s.playerSchedule
  const same =
    Object.keys(want).length === Object.keys(have).length &&
    Object.entries(want).every(([slot, code]) => have[slot] === code)
  return same ? null : `playerSchedule is ${JSON.stringify(have)}`
}

// ─── The landing ──────────────────────────────────────────────────────────────

/** A landing is ready: the well is live, nothing is queued or out, and no scene has begun. */
function landingReady(s) {
  return (
    s.input !== null &&
    !s.input.disabled &&
    s.awaitingInput &&
    !s.busy &&
    !s.streaming &&
    !s.waitingForLine &&
    s.pendingLines === 0 &&
    s.transcript === 0 &&
    !s.sceneSummary &&
    !s.sceneEnding &&
    s.quiz === null &&
    s.memoryEdit === null &&
    s.statusModal === null &&
    s.chips.some((c) => !c.disabled)
  )
}

/** A scene's decision point: only the older mock leaves one, and the safety line ends it. */
function midSceneReady(s) {
  return (
    s.input !== null &&
    !s.input.disabled &&
    s.awaitingInput &&
    !s.busy &&
    !s.streaming &&
    !s.waitingForLine &&
    s.pendingLines === 0 &&
    s.transcript > 0 &&
    !s.sceneEnding &&
    s.quiz === null &&
    s.memoryEdit === null &&
    s.statusModal === null
  )
}

/** The slot being played, written out as one log row when the next landing arrives. */
let current = null
/** The landing the loop stands on: how often it has acted there, and whether it has tidied up. */
let landing = null
let forceSolo = false

function startSlot(s, decision, extra = {}) {
  current = {
    key: slotKey(s),
    date: s.date,
    time: s.time,
    decision,
    startedAt: Date.now(),
    tokens: null,
    cast: new Set(),
    quiz: { asked: 0, right: 0 },
    events: [],
    ...extra
  }
}

async function flushRow(s) {
  if (!current || current.key === slotKey(s)) return
  const tokens = await tokensNow()
  const lover = loverOf(s)
  const favourite = s.roster.find((c) => c.id === state.favouriteId)
  const row = {
    date: current.date,
    time: current.time,
    decision: current.decision,
    cast: [...current.cast],
    ...(current.quiz.asked > 0 ? { quiz: current.quiz } : {}),
    ...(current.events.length > 0 ? { events: current.events } : {}),
    ...(current.housekeeping ? { housekeeping: current.housekeeping } : {}),
    stats: s.stats,
    money: s.money,
    contacts: allContactsOf(s).map((c) => c.firstName),
    lover: lover?.firstName ?? null,
    favourite: favourite?.firstName ?? null,
    elapsedMs: Date.now() - current.startedAt,
    mockTokens: tokens,
    mockTokensSlot: tokens !== null && current.tokens !== null ? tokens - current.tokens : null
  }
  logRow(row)
  const d = current.decision
  say(
    `${current.date}:${current.time} ${d.kind}${d.note ? ` (${d.note})` : ''}` +
      `${row.cast.length > 0 ? ` cast ${row.cast.join(', ')}` : ''} | ${Math.round(row.elapsedMs / 100) / 10} s` +
      ` | B${s.stats.brain} Bo${s.stats.body} H${s.stats.heart} $${s.money}` +
      `${tokens !== null ? ` | tokens ${tokens}` : ''}`
  )
}

// ─── The manual saves ─────────────────────────────────────────────────────────

/** The probed slot manual01 belongs to, as `date:time`, or null while none has qualified. */
function manual01Slot() {
  return Object.keys(state.probes).find((key) => state.probes[key].qualifies) ?? null
}

/**
 * The slots whose first opening line the loop must stop on: every fixed slot still owed a save,
 * and while manual01 is owed, its qualifying slot, else every slot of days 8-13 not yet probed.
 */
function heldSlots() {
  const held = []
  if (!state.captured.manual01) {
    const found = manual01Slot()
    if (found) held.push(found)
    else {
      for (let date = FIRST_PROBE_DAY; date <= LAST_PROBE_DAY; date++) {
        for (const time of [0, 1]) if (!state.probes[`${date}:${time}`]) held.push(`${date}:${time}`)
      }
    }
  }
  for (const m of MANUALS) {
    if (m.date !== undefined && !state.captured[saveIdOf(m.slot)]) held.push(`${m.date}:${m.time}`)
  }
  return held
}

/** The first manual save the clock has already passed without taking, or null. */
function missedSave(s) {
  const here = slotIndex(s.date, s.time)
  for (const m of MANUALS) {
    const saveId = saveIdOf(m.slot)
    if (state.captured[saveId]) continue
    if (m.date !== undefined) {
      if (slotIndex(m.date, m.time) < here) return `${saveId} (${m.date}:${m.time})`
      continue
    }
    const found = manual01Slot()
    if (found) {
      const [date, time] = found.split(':').map(Number)
      if (slotIndex(date, time) < here) return `${saveId} (${found})`
    } else if (s.date > LAST_PROBE_DAY) {
      return `${saveId} (no slot of days ${FIRST_PROBE_DAY}-${LAST_PROBE_DAY} offered a class and a project)`
    }
  }
  return null
}

/** The slot's first opening line is on screen and settled: nothing cast, typed, asked or pending. */
function firstLine(s) {
  return (
    s.currentLine !== null &&
    !s.busy &&
    !s.streaming &&
    !s.waitingForLine &&
    !s.loop.openingWait &&
    !s.awaitingInput &&
    s.cast.length === 0 &&
    s.transcript === 0 &&
    !s.sceneSummary &&
    !s.sceneEnding &&
    s.quiz === null &&
    s.memoryEdit === null &&
    s.statusModal === null
  )
}

/** Whether the slot's row offers a class and a project, asked once per slot and kept. */
async function probeManual01(s) {
  const key = slotKey(s)
  if (!state.probes[key]) {
    const tones = (await D.slotActions(page)).map((a) => a.tone)
    const qualifies = tones.includes('class') && tones.includes('project')
    state.probes[key] = { tones, qualifies }
    saveState()
    say(`probe ${key}: ${tones.join(', ')}${qualifies ? ' → manual01' : ''}`)
  }
  return state.probes[key].qualifies
}

async function takeManual(s, m) {
  const saveId = saveIdOf(m.slot)
  let result
  try {
    result = await D.captureManual(page, s.playthroughId, m.slot, { date: s.date, time: s.time }, {
      outDir: join(OUT_ROOT, s.playthroughId),
      finalsPending: m.finalsPending === true
    })
  } catch (error) {
    await dump(saveId, s)
    await finish(error instanceof D.StalledError ? 3 : 2, error.message)
  }
  const mockTokens = await tokensNow()
  state.captured[saveId] = { date: s.date, time: s.time, mockTokens }
  saveState()
  await page.screenshot({ path: join(SHOTS_DIR, `${saveId}-${s.date}-${s.time}.png`) }).catch(() => {})
  logRow({ event: 'capture', saveId, slot: slotKey(s), file: result.file, pendingLines: result.pendingLines, currentLine: result.currentLine, mockTokens })
  say(`${saveId} at ${slotKey(s)}: ${result.file} (${result.pendingLines} queued behind "${result.currentLine}")`)
  if (MANUALS.every((each) => state.captured[saveIdOf(each.slot)])) await finish(0, 'all seven manual saves taken')
}

/** At a held slot's first opening line: probe it for manual01, and take whichever save it owes. */
async function onFirstLine(s) {
  const missed = missedSave(s)
  if (missed) {
    await dump('missed', s)
    await finish(2, `passed ${missed} without taking it`)
  }
  if (!state.captured.manual01 && s.date >= FIRST_PROBE_DAY && s.date <= LAST_PROBE_DAY) {
    const found = manual01Slot()
    if ((found === null || found === slotKey(s)) && (await probeManual01(s))) await takeManual(s, MANUALS[0])
  }
  const m = MANUALS.find((each) => each.date === s.date && each.time === s.time)
  if (m && !state.captured[saveIdOf(m.slot)]) await takeManual(s, m)
}

/** Before the landing's action: friend requests, the job, a phone left open. */
async function housekeep(s) {
  const done = {}
  if (s.requestsReceived.length > 0) done.friends = await D.acceptFriendRequests(page)
  if (s.venusJobIntroSent && s.job === null) {
    const shifts = await D.takeJob(page, JOB_SHIFT_PREFERENCE)
    if (shifts) {
      done.job = shifts
      say(`took Fast Eats, shifts ${shifts.join(', ')}`)
    }
  }
  if (s.bunny.open && !s.bunny.armed) await D.closePhone(page)
  return Object.keys(done).length > 0 ? done : null
}

/** Picks the favourite again on a new week, while there is none, and for good once there is a lover. */
function refreshFavourite(s) {
  const week = Math.floor(s.date / 7)
  const lover = loverOf(s)
  if (lover ? state.favouriteId === lover.id : state.favouriteId && state.favouriteWeek === week) return
  const next = pickFavourite(s)
  if (next !== state.favouriteId) {
    const name = s.roster.find((c) => c.id === next)?.firstName ?? '-'
    say(`favourite: ${name}`)
  }
  state.favouriteId = next
  state.favouriteWeek = week
  saveState()
}

async function act(s, decision) {
  if (decision.kind === 'chip' || decision.kind === 'filler') {
    const clicked = await D.clickChip(page, decision.index)
    if (clicked === null) current.events.push('chip was gone')
  } else if (decision.kind === 'solo' || decision.kind === 'named') {
    await D.submitPreset(page, decision.text, decision.verdict)
  } else if (decision.kind === 'hangout') {
    const result = await D.acceptHangout(page, decision.charId)
    decision.armed = result.armed
    decision.prefetched = result.prefetched
    // Nothing armed (she is away): the landing decides again at once.
    if (!result.armed) landing.actedAt = 0
  }
}

async function onLanding(s) {
  const key = slotKey(s)
  if (!landing || landing.key !== key) {
    await flushRow(s)
    landing = { key, attempts: 0, housekept: false, housekeeping: null, actedAt: 0 }
    if (s.weekday === 0 && s.time === 0) say(weeklyStatLine(s, state))
  }

  const missed = missedSave(s)
  if (missed) {
    await dump('missed', s)
    await finish(2, `passed ${missed} without taking it`)
  }
  // A held slot at its landing never showed an opening line to save on: a probe is still asked,
  // but a save that was owed here cannot be taken on the line it is meant for.
  if (heldSlots().includes(key)) {
    const owed = MANUALS.some((m) => m.date === s.date && m.time === s.time) || manual01Slot() === key
    if (!owed && !state.probes[key]) {
      await probeManual01(s)
      state.probes[key].noOpeningLine = true
      saveState()
    }
    if (owed || state.probes[key].qualifies) {
      await dump('no-opening-line', s)
      await finish(2, `${key} reached its landing without an opening line to save on`)
    }
  }
  if (ARGS.until && slotIndex(s.date, s.time) >= slotIndex(ARGS.until.date, ARGS.until.time)) {
    await page.screenshot({ path: join(SHOTS_DIR, `until-${s.date}-${s.time}.png`) }).catch(() => {})
    await finish(0, `reached --until ${ARGS.until.date}:${ARGS.until.time}`)
  }

  if (!landing.housekept) {
    landing.housekeeping = await housekeep(s)
    landing.housekept = true
    // The chips may have changed (a shift taken); the next ready snapshot decides.
    return
  }
  if (landing.actedAt && Date.now() - landing.actedAt < 2500) return
  if (s.bunny.open) {
    await D.closePhone(page)
    return
  }
  if (landing.attempts >= 6) {
    await dump('landing', s)
    await finish(3, `the landing at ${key} took none of six actions`)
  }

  refreshFavourite(s)
  const rng = rngFor(state.seed, s.date, s.time, landing.attempts === 0 ? undefined : `retry${landing.attempts}`)
  const decision = decide(s, { ...state, forceSolo }, rng)
  landing.attempts++
  landing.actedAt = Date.now()
  forceSolo = false

  startSlot(s, decision, landing.housekeeping ? { housekeeping: landing.housekeeping } : {})
  current.tokens = await tokensNow()
  await act(s, decision)
  state.lastSlot = key
  state.slots = (state.slots ?? 0) + 1
  saveState()
}

// ─── The loop ─────────────────────────────────────────────────────────────────

/** What counts as the app moving, for the watchdog. */
function signatureOf(s) {
  return JSON.stringify([
    s.view, s.date, s.time, s.busy, s.streaming, s.waitingForLine, s.awaitingInput, s.pendingLines,
    s.transcript, s.sceneLog, s.sceneEnding, s.statusModal, s.memoryEdit !== null, s.quiz?.index,
    s.boxLine, s.turnError?.code, s.classifierError?.code, s.introError?.code, s.closingError?.code,
    s.ledgerError?.code, s.textLedgerError?.code, s.loop.writesPending, s.chips.length, s.bunny.open
  ])
}

let retry = { key: '', count: 0 }

/** Counts retries of one failure at one slot; past eight the run stops. */
async function retried(kind, s) {
  const key = `${kind}:${slotKey(s)}`
  retry = retry.key === key ? { key, count: retry.count + 1 } : { key, count: 1 }
  current?.events.push(`${kind} retried`)
  if (retry.count > 8) {
    await dump(kind, s)
    await finish(2, `${kind} failed nine times at ${slotKey(s)}`)
  }
  await sleep(500)
}

async function play() {
  let lastSig = ''
  let lastChange = Date.now()
  let landingStreak = 0
  let midStreak = 0
  let midActed = { transcript: -1, at: 0 }
  let quizActed = { key: '', at: 0 }

  for (;;) {
    let s
    try {
      s = await D.snapshot(page)
    } catch (error) {
      await dump('snapshot', null)
      await finish(2, `snapshot failed: ${error.message}`)
    }

    const sig = signatureOf(s)
    if (sig !== lastSig) {
      lastSig = sig
      lastChange = Date.now()
    } else if (Date.now() - lastChange > WATCHDOG_MS) {
      await dump('watchdog', s)
      await finish(3, `no state change for ${WATCHDOG_MS / 1000} s at ${slotKey(s)}`)
    }
    if (current) for (const name of s.cast) current.cast.add(name)

    if (s.fatalError || s.uiError) {
      await dump('app-error', s)
      await finish(2, `app error: ${JSON.stringify(s.fatalError ?? s.uiError)}`)
    }
    if (s.view !== 'game') {
      await dump('view', s)
      await finish(2, `left the game: view ${s.view}`)
    }
    if (s.activeGameOver) {
      await dump('game-over', s)
      await finish(2, `game over: ${s.activeGameOver}`)
    }

    if (s.classifierError) {
      await retried('classifier', s)
      await D.invoke(page, 'gameLoop', 'retryClassify')
      continue
    }
    const endingError = s.introError ?? s.closingError ?? s.ledgerError ?? s.textLedgerError
    if (endingError) {
      await retried(`ending ${endingError.code}`, s)
      await D.invoke(page, 'gameLoop', 'retryEndingCall')
      continue
    }
    if (s.turnError) {
      if (s.turnError.code === 'CLASSIFIER_REJECTED') {
        current?.events.push(`refused: ${s.turnError.message}`)
        say(`${slotKey(s)} refused: ${s.turnError.message}`)
        await D.invoke(page, 'gameLoop', 'abandonTurn')
        forceSolo = true
        if (landing) landing.actedAt = 0
      } else {
        await retried(`turn ${s.turnError.code}`, s)
        await D.invoke(page, 'gameLoop', 'retryTurn')
      }
      continue
    }
    if (s.memoryEdit && s.loop.memoryGate) {
      const answers = await D.saveMemories(page)
      current?.events.push(`memories ${answers?.length ?? 0}`)
      continue
    }
    if (s.statusModal) {
      await D.dismissStatus(page)
      continue
    }

    if (s.quiz && s.awaitingInput && !s.busy && s.pendingLines === 0) {
      const key = `${s.quiz.code}:${s.quiz.index}`
      if (quizActed.key !== key || Date.now() - quizActed.at > 3000) {
        const letter = quizLetter(s.quiz.correct, rngFor(state.seed, s.date, s.time, `quiz:${s.quiz.index}`))
        if (await D.answerQuiz(page, letter)) {
          quizActed = { key, at: Date.now() }
          if (current) {
            current.quiz.asked++
            if (letter === s.quiz.correct) current.quiz.right++
          }
          await sleep(TICK_MS)
          continue
        }
      }
    }

    // Before any click on the slot: the advance below is held on these slots' opening lines.
    const held = heldSlots()
    if (held.includes(slotKey(s)) && firstLine(s)) {
      await onFirstLine(s)
      await sleep(TICK_MS)
      continue
    }

    if (landingReady(s)) {
      midStreak = 0
      // Twice in a row: a single ready read has been seen to flicker mid-stream.
      if (++landingStreak >= 2) {
        landingStreak = 0
        await onLanding(s)
      }
      await sleep(TICK_MS)
      continue
    }
    landingStreak = 0

    if (midSceneReady(s)) {
      if (++midStreak >= 2 && (midActed.transcript !== s.transcript || Date.now() - midActed.at > 5000)) {
        midStreak = 0
        midActed = { transcript: s.transcript, at: Date.now() }
        current?.events.push('safety line')
        await D.typeAction(page, SAFETY_LINE).catch(() => {})
        await sleep(1500)
        const after = await D.snapshot(page)
        // The well did not take it: the same turn through the loop itself.
        if (!after.busy && after.transcript === s.transcript) {
          await D.invoke(page, 'gameLoop', 'submitAction', [SAFETY_LINE])
        }
      }
      await sleep(TICK_MS)
      continue
    }
    midStreak = 0

    await D.advanceClick(page, held)
    await sleep(TICK_MS)
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  mkdirSync(SHOTS_DIR, { recursive: true })
  state = loadState() ?? {
    seed: ARGS.seed ?? 1,
    playthroughId: null,
    captured: {},
    probes: {},
    favouriteId: null,
    favouriteWeek: null,
    lastSlot: null,
    slots: 0
  }
  if (ARGS.seed !== null && ARGS.seed !== state.seed) {
    say(`--seed ${ARGS.seed} ignored: this run dir was started with seed ${state.seed}`)
  }
  state.probes ??= {}
  saveState()
  if (MANUALS.every((m) => state.captured[saveIdOf(m.slot)])) await finish(0, 'all seven manual saves already taken')

  await preflight()
  ;({ context, page } = await D.launchPersistent(PROFILE_DIR))
  page.on('console', (msg) => {
    appendFileSync(CONSOLE_FILE, `[${msg.type()}] ${msg.text().slice(0, 1000)}\n`)
  })
  page.on('pageerror', (error) => appendFileSync(CONSOLE_FILE, `[pageerror] ${error.message}\n`))
  page.on('crash', () => appendFileSync(CONSOLE_FILE, '[crash]\n'))

  say(`run dir ${RUN_DIR}, seed ${state.seed}${state.playthroughId ? `, resuming ${state.playthroughId}` : ''}`)
  const { s, fromMenu } = await boot()
  if (state.playthroughId && state.playthroughId !== s.playthroughId) {
    await finish(1, `Continue opened ${s.playthroughId}, not the run's ${state.playthroughId}`)
  }
  const wrong = checkSchedule(s)
  if (wrong) await finish(1, `enrolment is not the Quickstart timetable: ${wrong}`)
  state.playthroughId = s.playthroughId
  saveState()
  logRow({ event: 'boot', via: fromMenu, playthroughId: s.playthroughId, at: slotKey(s), time: new Date().toISOString() })
  say(`in game ${s.playthroughId} at ${slotKey(s)}`)

  startSlot(s, { kind: fromMenu === 'quickstart' ? 'authored' : 'resumed' })
  current.tokens = await tokensNow()
  await play()
}

main().catch(async (error) => {
  console.error(error)
  await finish(2, `harness error: ${error.message}`)
})
