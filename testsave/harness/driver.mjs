// Playwright helpers for the Venus University browser build (`npx vite -c vite.web.config.ts`),
// driven against the mock endpoint in mock.mjs. semester.mjs is the scenario built on them;
// README.md lists the ids, classes and store functions they lean on and the traps behind them.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const REPO_ROOT = 'C:/Users/Eddie/Documents/venus-university'
const SRC = `/@fs/${REPO_ROOT}/src`
const STORE_DIR = `${SRC}/renderer/stores`

/**
 * Every module the page is reached through, by the `/@fs/` URL the app itself imports it under:
 * the browser build's root is `src/web`, so `/src/...` 404s, and only this spelling hands back
 * the instance the app holds.
 */
export const MODULES = {
  gameStore: `${STORE_DIR}/gameStore.ts`,
  gameLoop: `${STORE_DIR}/gameLoop.ts`,
  textingLoop: `${STORE_DIR}/textingLoop.ts`,
  timetable: `${STORE_DIR}/timetable.ts`,
  loopState: `${STORE_DIR}/loop/state.ts`,
  saves: `${STORE_DIR}/loop/saves.ts`,
  bunnyboard: `${STORE_DIR}/bunnyboardStore.ts`,
  ui: `${STORE_DIR}/uiStore.ts`,
  jobs: `${SRC}/shared/jobs.ts`,
  relationship: `${SRC}/shared/relationship.ts`,
  gameDate: `${SRC}/renderer/prompts/gameDate.ts`,
  slotActions: `${STORE_DIR}/slotActions.ts`
}

/** The Quickstart timetable: one course per slot, by the registrar's own slot label. */
export const ENROLMENT = [
  ['Monday Day', 'PED 140'],
  ['Tuesday Day', 'ARH 101'],
  ['Wednesday Day', 'LIT 330'],
  ['Thursday Day', 'MUS 180'],
  ['Thursday Night', 'MSC 112']
]

/** The same timetable as `playerSchedule` holds it: `weekday * 2 + time`, Monday 0. */
export const ENROLMENT_SCHEDULE = { 0: 'PED 140', 2: 'ARH 101', 4: 'LIT 330', 6: 'MUS 180', 7: 'MSC 112' }

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Loads chromium from the repo's own Playwright, by absolute file URL: a bare specifier does not resolve from here. */
async function loadChromium() {
  const mod = await import(`file:///${REPO_ROOT}/node_modules/playwright/index.mjs`)
  return mod.chromium
}

/** A fresh browser, context (fixed 1920×1080) and page — one per run, nothing kept. */
export async function launch() {
  const chromium = await loadChromium()
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } })
  const page = await context.newPage()
  return { browser, context, page }
}

/**
 * A browser whose IndexedDB outlives the process, so a run can be resumed: headless, 1920×1080,
 * and reduced motion, which the app honours for its own transitions.
 */
export async function launchPersistent(profileDir) {
  const chromium = await loadChromium()
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: true,
    viewport: { width: 1920, height: 1080 },
    reducedMotion: 'reduce'
  })
  const page = context.pages()[0] ?? (await context.newPage())
  return { context, page }
}

/** Clicks a field and types into it — Playwright's `fill` does not reach these controlled inputs. */
async function clickAndType(page, selector, text) {
  await page.click(selector)
  await page.keyboard.type(text)
}

/**
 * One real DOM click on the first match, or false where there is none, it is disabled, or it sits
 * under `[inert]` — a screen behind a crossing is inert, and a click there is dropped silently.
 */
export async function domClick(page, selector) {
  return page
    .$eval(selector, (el) => {
      if (el.disabled || el.closest('[inert]')) return false
      el.click()
      return true
    })
    .catch(() => false)
}

/** Waits until `selector` is attached, enabled and out from under `[inert]`, then clicks it. */
export async function clickWhenLive(page, selector, timeoutMs = 30_000) {
  await page.waitForFunction(
    (sel) => {
      const el = document.querySelector(sel)
      return el !== null && !el.disabled && el.closest('[inert]') === null
    },
    selector,
    { timeout: timeoutMs }
  )
  if (!(await domClick(page, selector))) throw new Error(`${selector} went dead before the click`)
}

/**
 * The key stage, pointed at a custom endpoint: the "Custom" provider, the endpoint URL and the
 * model id, then Save. Test Connection is not needed for Save.
 */
export async function keyStage(page, endpointUrl, modelId) {
  await page.waitForSelector('#setup-provider')
  await page.selectOption('#setup-provider', 'openai')

  await clickAndType(page, '#setup-endpoint-url', endpointUrl)
  // Blurs the URL field (the app swallows Tab) and clears the way for the model-id field.
  await page.click('#setup-endpoint-key')
  await page.keyboard.type('')

  await clickAndType(page, '#setup-model-id', modelId)
  // Blur onto inert card text, not a button — a click on a button or link would act on it.
  await page.click('.vu-setup-card-heading')

  await page.waitForSelector('#setup-key-save:not([disabled])')
  await page.click('#setup-key-save')
}

/** First run: the key stage, then the content question that ends it. */
export async function firstRun(page, endpointUrl, modelId) {
  await keyStage(page, endpointUrl, modelId)
  await page.waitForSelector('#sfw-prompt-continue')
  await page.click('#sfw-prompt-continue')
}

/**
 * The registrar: for each `[label, code]`, the empty slot's `+` and then the picker row whose
 * course code is `code`, then Finalize. A slot with no `+` (already taken) is reported, not fatal:
 * Finalize and the schedule check after it are what decide.
 */
export async function enrol(page, enrolment = ENROLMENT) {
  await page.waitForSelector('#class-select-finalize')
  const missing = []
  for (const [label, code] of enrolment) {
    const slot = `[aria-label="Enroll in a course on ${label}"]`
    try {
      await clickWhenLive(page, slot, 15_000)
    } catch {
      missing.push(label)
      continue
    }
    await page.waitForSelector('#course-picker button.vu-pickcourse-row')
    const picked = await page.$$eval(
      '#course-picker button.vu-pickcourse-row',
      (rows, want) => {
        const row =
          rows.find((r) => r.querySelector('.vu-code')?.textContent?.trim() === want) ??
          rows.find((r) => (r.textContent ?? '').includes(want))
        if (!row) return false
        row.click()
        return true
      },
      code
    )
    if (!picked) throw new Error(`registrar: no ${code} row in the ${label} picker`)
    await page.waitForSelector('#course-picker', { state: 'detached', timeout: 10_000 }).catch(() => {})
  }
  await clickWhenLive(page, '#class-select-finalize', 10_000)
  return { missing }
}

/**
 * Quickstart → the name modal (first and last name typed) → the registrar with the exact
 * enrolment → Finalize. With `wait`, clicks on until the first live action well as well.
 */
export async function quickstartToLanding(page, { name = 'Theo Marsh', enrolment = ENROLMENT, wait = true } = {}) {
  await clickWhenLive(page, '#menu-quickstart')

  const [first, ...rest] = name.split(' ')
  await page.waitForSelector('#player-first-name')
  await clickAndType(page, '#player-first-name', first)
  await clickAndType(page, '#player-last-name', rest.join(' '))
  await clickWhenLive(page, '#player-name-submit')

  const result = await enrol(page, enrolment)
  if (wait) await waitForGameAction(page, 60_000)
  return result
}

/**
 * Everything the semester loop reads, in one `page.evaluate`: the store fields, the loop flags,
 * the phone, the UI store's view and errors, the roster with each girl's derived affection and
 * availability, and the landing's chips off the DOM.
 */
export async function snapshot(page) {
  return page.evaluate(async (m) => {
    const [gs, ls, sv, tt, jb, rel, bb, ui, gd] = await Promise.all([
      import(m.gameStore),
      import(m.loopState),
      import(m.saves),
      import(m.timetable),
      import(m.jobs),
      import(m.relationship),
      import(m.bunnyboard),
      import(m.ui),
      import(m.gameDate)
    ])
    const g = gs.useGameStore.getState()
    const u = ui.useUiStore.getState()
    const b = bb.useBunnyboardStore.getState()
    const L = ls.loopState
    const err = (e) => (e ? { code: e.code, message: e.message } : null)
    const inGame = g.playthroughId !== null && u.view === 'game'

    const roster = g.chars.map((id) => {
      const c = g.characters[id]
      const info = g.charInfo[id]
      const f = info?.flags ?? {}
      const invite = g.bunnyboard.conversations[id]?.pendingHangout
      return {
        id,
        firstName: c?.firstName ?? '',
        nameKnown: info?.nameKnown === true,
        hasMet: f.hasMet === true,
        hasCrush: f.hasCrush === true,
        isLover: f.isLover === true,
        gaveContactInfo: f.gaveContactInfo === true,
        blocked: f.blocked === true,
        hasKissed: f.hasKissed === true,
        hadSex: f.hadSex === true,
        datingSince: info?.datingSince ?? null,
        memories: info?.memories?.length ?? 0,
        affection: inGame && info ? Math.round(rel.affectionFor(info, g.date, c) * 10) / 10 : 0,
        unavailable: inGame ? tt.charUnavailableNow(id) : false,
        invite: invite
          ? { description: invite.description, dismissed: invite.dismissed === true, occasionId: invite.occasionId ?? null }
          : null,
        planned: g.events.some((e) => e.date === g.date && e.time === g.time && e.charIds.includes(id))
      }
    })

    // Project sessions by exam period, as dates, for the "worked on it this week" test.
    const projects = {}
    for (const code of new Set(Object.values(g.playerSchedule))) {
      const entry = g.classes[code]
      if (entry?.kind !== 'project') continue
      const rec = g.classRecords[code]
      projects[code] = {
        name: entry.name,
        sessions: [...(rec?.midtermProject?.sessions ?? []), ...(rec?.finalProject?.sessions ?? [])].map((s) => s.date)
      }
    }

    const chips = [...document.querySelectorAll('.vu-landing-do, .vu-landing-idle')].map((el, index) => {
      const idle = el.classList.contains('vu-landing-idle')
      const mod = idle
        ? 'idle'
        : ([...el.classList].find((cls) => cls.startsWith('vu-landing-do--'))?.slice('vu-landing-do--'.length) ?? '')
      const text = idle ? el.textContent : el.querySelector('.vu-landing-doword')?.textContent
      return { index, mod, text: (text ?? '').trim(), disabled: el.disabled === true }
    })
    const input = document.querySelector('#game-action')
    const box = document.querySelector('.vu-box:not([aria-hidden="true"]) .vu-box-line')
    const quiz = g.sceneQuiz
    const question = quiz ? quiz.questions[quiz.index] : null

    return {
      at: Date.now(),
      view: u.view,
      uiError: err(u.error),
      fatalError: err(u.fatalError),
      playthroughId: g.playthroughId,
      date: g.date,
      time: g.time,
      weekday: gd.shiftWeekdayOf(g.date),
      stats: { ...g.stats },
      money: g.money,
      tallies: g.tallies,
      job: g.job ? { jobId: g.job.jobId, shifts: g.job.shifts, strikes: g.job.strikes, shiftsWorked: g.job.shiftsWorked } : null,
      venusJobIntroSent: g.venusJobIntroSent,
      playerSchedule: { ...g.playerSchedule },
      projects,
      events: g.events.filter((e) => e.date === g.date && e.time === g.time).map((e) => e.title),
      requestsReceived: [...g.bunnyboard.requestsReceived],
      roster,
      cast: g.cast.map((id) => g.characters[id]?.firstName ?? id),
      currentLine: g.currentLine ? (g.currentLine.text ?? '').slice(0, 120) : null,
      busy: g.busy,
      streaming: g.streaming,
      waitingForLine: g.waitingForLine,
      awaitingInput: g.awaitingInput,
      pendingLines: g.pendingLines.length,
      transcript: g.currentSceneTranscript.length,
      sceneLog: g.sceneLog.length,
      sceneSummary: g.sceneSummary !== null,
      sceneEnding: g.sceneEnding,
      endingInFlight: g.endingInFlight,
      statusModal: g.statusModal ? (g.statusModal.kind ?? 'open') : null,
      memoryEdit: g.memoryEdit
        ? g.memoryEdit.map((r) => ({ charId: r.charId, applied: r.applied ? { type: r.applied.type, desc: r.applied.desc } : null }))
        : null,
      quiz: quiz ? { code: quiz.code, exam: quiz.exam, index: quiz.index, total: quiz.questions.length, right: quiz.correct, correct: question?.correct ?? null } : null,
      turnError: err(g.turnError),
      classifierError: err(g.classifierError),
      introError: err(g.introError),
      closingError: err(g.closingError),
      ledgerError: err(g.ledgerError),
      textLedgerError: err(g.textLedgerError),
      activeGameOver: g.activeGameOver,
      loop: {
        slotSaveId: L.slotSaveId,
        hangoutPrefetch: L.hangoutPrefetch !== null,
        hangoutScene: L.hangoutPrefetch?.scene != null,
        memoryGate: L.memoryGate !== null,
        openingWait: L.openingWait,
        writesPending: sv.writesPending()
      },
      bunny: { open: b.open, armed: b.armedHangout?.charId ?? null, locked: b.locked },
      chips,
      input: input ? { tag: input.tagName.toLowerCase(), disabled: input.disabled === true } : null,
      boxLine: box?.textContent ?? '',
      fastEatsOffered: inGame ? [...jb.offeredShifts(jb.jobDefOf('fast_eats'), g.jobClosures)] : []
    }
  }, MODULES)
}

/**
 * Calls one export of an app module in the page. A promise it returns is left running (a turn
 * resolves only once its whole reply has played), unless `awaitResult` is set.
 */
export async function invoke(page, module, name, args = [], awaitResult = false) {
  return page.evaluate(
    async ({ url, name, args, awaitResult }) => {
      const mod = await import(url)
      if (typeof mod[name] !== 'function') throw new Error(`${url} exports no function ${name}`)
      const out = mod[name](...args)
      if (out && typeof out.then === 'function') {
        if (awaitResult) return (await out) ?? null
        out.catch((error) => console.error(`[harness] ${name} failed`, error))
        return null
      }
      return out ?? null
    },
    { url: MODULES[module], name, args, awaitResult }
  )
}

/** Clicks landing chip `index` of `.vu-landing-do, .vu-landing-idle` in document order; its text, or null. */
export async function clickChip(page, index) {
  return page.$$eval(
    '.vu-landing-do, .vu-landing-idle',
    (els, i) => {
      const el = els[i]
      if (!el || el.disabled) return null
      // A plain DOM click: Motion buttons never read as stable to Playwright's actionability.
      el.click()
      return (el.textContent ?? '').trim()
    },
    index
  )
}

/**
 * Types an action into the well and sends it: focus, select all, delete, type, then one real DOM
 * click on Go — `fill` does not reach this field, and a forced Playwright click double-submits.
 */
export async function typeAction(page, text) {
  await page.$eval('#game-action', (el) => el.focus())
  await page.keyboard.press('Control+A')
  await page.keyboard.press('Backspace')
  await page.keyboard.type(text)
  await page.$eval('#game-submit', (el) => el.click())
}

/** A turn sent with its classifier answer already known, exactly as a landing chip sends one. */
export async function submitPreset(page, text, verdict) {
  return invoke(page, 'gameLoop', 'submitAction', [text, false, verdict])
}

/** One click on a quiz answer, when it is on screen and live. */
export async function answerQuiz(page, letter) {
  return domClick(page, `#game-quiz-${letter}`)
}

/** Answers the boundary's memory question with every row as the modal opens on it. */
export async function saveMemories(page) {
  return page.evaluate(async (m) => {
    const [gs, gl] = await Promise.all([import(m.gameStore), import(m.gameLoop)])
    const rows = gs.useGameStore.getState().memoryEdit
    if (!rows) return null
    const answers = rows.map((r) => ({ type: r.applied?.type ?? 'liked', desc: r.applied?.desc ?? '' }))
    gl.saveMemoryEdits(answers)
    return answers
  }, MODULES)
}

/** Takes down a status screen (a milestone or a grade). */
export async function dismissStatus(page) {
  return invoke(page, 'gameLoop', 'dismissStatusModal')
}

/**
 * Says Yes to her invitation, waits up to `waitMs` for the prefetched scene to be in flight, then
 * Begins it — the two buttons the phone offers. `armed: false` when nothing was armed (she is
 * away, or the invitation was gone).
 */
export async function acceptHangout(page, charId, waitMs = 3000) {
  await invoke(page, 'textingLoop', 'answerHangout', [charId, true])
  const deadline = Date.now() + waitMs
  let state = { armed: null, scene: false }
  while (Date.now() < deadline) {
    state = await page.evaluate(async (m) => {
      const [bb, ls] = await Promise.all([import(m.bunnyboard), import(m.loopState)])
      return {
        armed: bb.useBunnyboardStore.getState().armedHangout?.charId ?? null,
        scene: ls.loopState.hangoutPrefetch?.scene != null
      }
    }, MODULES)
    if (!state.armed || state.scene) break
    await sleep(100)
  }
  if (state.armed !== charId) return { armed: false, prefetched: false }
  await invoke(page, 'textingLoop', 'beginHangout')
  return { armed: true, prefetched: state.scene }
}

/** Accepts every friend request waiting; the ids accepted. */
export async function acceptFriendRequests(page) {
  return page.evaluate(async (m) => {
    const [gs, tl] = await Promise.all([import(m.gameStore), import(m.textingLoop)])
    const ids = [...gs.useGameStore.getState().bunnyboard.requestsReceived]
    for (const id of ids) tl.acceptFriendRequest(id)
    return ids
  }, MODULES)
}

/**
 * What the jobs board's Apply does for Fast Eats: the first two shifts off `preference` that it
 * offers, that no class of his holds and that are not the slot he is standing in; then the boss's
 * welcome. Null when he already has a job or the opening is closed.
 */
export async function takeJob(page, preference) {
  return page.evaluate(
    async ({ m, preference }) => {
      const [gs, jb, tl, gd] = await Promise.all([import(m.gameStore), import(m.jobs), import(m.textingLoop), import(m.gameDate)])
      const g = gs.useGameStore.getState()
      if (g.job || g.jobsClosed.includes('fast_eats')) return null
      const def = jb.jobDefOf('fast_eats')
      if (!def || jb.unmetStatKeys(g.stats, def).length > 0) return null
      const offered = jb.offeredShifts(def, g.jobClosures)
      const here = jb.shiftSlotOf(gd.shiftWeekdayOf(g.date), g.time)
      const shifts = []
      for (const slot of preference) {
        if (shifts.length === 2) break
        const classSlot = jb.classSlotForShift(slot)
        if (!offered.includes(slot) || slot === here) continue
        if (classSlot !== null && g.playerSchedule[classSlot]) continue
        shifts.push(slot)
      }
      if (shifts.length === 0) return null
      g.takeJob('fast_eats', shifts, jb.globalSlotOf(g.date, g.time))
      tl.deliverBossMessage('fast_eats', 'intro')
      return shifts
    },
    { m: MODULES, preference }
  )
}

/** Shuts the phone. */
export async function closePhone(page) {
  return page.evaluate(async (m) => {
    const bb = await import(m.bunnyboard)
    bb.useBunnyboardStore.getState().closeApp()
  }, MODULES)
}

/**
 * One click on the stage's advance surface; a no-op while nothing is queued. Held — no click,
 * `'held'` back — while the clock stands on a slot in `hold` with its opening narration on screen,
 * checked in the same task as the click, so the first opening line is never clicked past.
 */
export async function advanceClick(page, hold = []) {
  return page.evaluate(
    async ({ m, hold }) => {
      if (hold.length > 0) {
        const gs = await import(m.gameStore)
        const g = gs.useGameStore.getState()
        const opening =
          g.currentLine !== null &&
          !g.awaitingInput &&
          g.cast.length === 0 &&
          g.currentSceneTranscript.length === 0 &&
          g.sceneSummary === null &&
          g.sceneQuiz === null &&
          !g.sceneEnding
        if (opening && hold.includes(`${g.date}:${g.time}`)) return 'held'
      }
      const el = document.querySelector('.vu-stage-advance')
      if (!el) return false
      el.click()
      return true
    },
    { m: MODULES, hold }
  )
}

/** The slot's row as `slotActionsNow()` deals it: `[{ key, text, tone }]`. */
export async function slotActions(page) {
  return page.evaluate(async (m) => {
    const sa = await import(m.slotActions)
    return sa.slotActionsNow().map((a) => ({ key: a.key, text: a.text, tone: a.tone }))
  }, MODULES)
}

/** A failure that is the app not settling rather than the save being wrong. */
export class StalledError extends Error {}

/**
 * Writes manual save `slot` where the game stands — meant for a slot's first opening line —
 * once the Save Game offer is open (polled for up to `offerTimeoutMs`), reads it back through the
 * bridge once every queued write has landed, checks it, and writes it to `outDir` as
 * `manual0N.json` beside `playthrough.json` (the latter once). `expected` is `{ date, time }`;
 * `finalsPending` also requires `finalsScoresShown` to be false. Throws with the reason when a check fails, a
 * `StalledError` when the offer never opens.
 */
export async function captureManual(page, playthroughId, slot, expected, { outDir, finalsPending = false, offerTimeoutMs = 60_000 } = {}) {
  const saveId = `manual${String(slot).padStart(2, '0')}`
  const deadline = Date.now() + offerTimeoutMs
  let offer = null
  while (Date.now() < deadline) {
    offer = await invoke(page, 'gameLoop', 'manualSaveOffer')
    if (offer !== 'waiting') break
    await sleep(250)
  }
  if (offer === 'waiting') throw new StalledError(`${saveId}: the save offer stayed 'waiting' for ${offerTimeoutMs / 1000} s`)
  if (offer !== 'open') throw new Error(`${saveId}: the save offer is '${offer}'`)
  if (!(await invoke(page, 'gameLoop', 'writeManualSave', [slot], true))) {
    throw new Error(`${saveId}: writeManualSave answered false`)
  }

  let read = null
  const settle = Date.now() + 30_000
  while (Date.now() < settle) {
    read = await page.evaluate(
      async ({ m, id, saveId }) => {
        const sv = await import(m.saves)
        if (sv.writesPending()) return { pending: true }
        const r = await window.api.saves.read(id, saveId)
        return r.ok ? { save: r.data.save, record: r.data.record } : { error: r.error }
      },
      { m: MODULES, id: playthroughId, saveId }
    )
    if (!read.pending) break
    await sleep(200)
  }
  if (!read || read.pending) throw new StalledError(`${saveId}: save writes still pending after 30 s`)
  if (read.error) throw new Error(`${saveId}: ${read.error.code} ${read.error.message}`)

  const { save, record } = read
  const problems = []
  if (save.saveId !== saveId) problems.push(`saveId is ${save.saveId}`)
  if (save.date !== expected.date || save.time !== expected.time) {
    problems.push(`save is ${save.date}:${save.time}, expected ${expected.date}:${expected.time}`)
  }
  if (!save.scene) problems.push('save.scene is null')
  else {
    if (save.scene.cast.length !== 0) problems.push(`scene.cast has ${save.scene.cast.length}`)
    if (save.scene.transcript.length !== 0) problems.push(`scene.transcript has ${save.scene.transcript.length}`)
    const lines = (save.scene.pendingLines?.length ?? 0) + (save.scene.currentLine ? 1 : 0)
    if (lines < 1) problems.push('scene holds no opening line')
  }
  if ('thumbnail' in save) problems.push('save carries a thumbnail')
  if (finalsPending && save.finalsScoresShown !== false) problems.push('finalsScoresShown is not false')
  if (save.schemaVersion !== 12) problems.push(`save schemaVersion ${save.schemaVersion}`)
  if (record.schemaVersion !== 3) problems.push(`record schemaVersion ${record.schemaVersion}`)
  if (problems.length > 0) throw new Error(`${saveId} at ${expected.date}:${expected.time}: ${problems.join('; ')}`)

  mkdirSync(outDir, { recursive: true })
  const file = join(outDir, `${saveId}.json`)
  writeFileSync(file, JSON.stringify(save, null, 2))
  const recordFile = join(outDir, 'playthrough.json')
  if (!existsSync(recordFile)) writeFileSync(recordFile, JSON.stringify(record, null, 2))
  return {
    saveId,
    file,
    pendingLines: save.scene.pendingLines?.length ?? 0,
    currentLine: save.scene.currentLine?.text ?? null,
    resumeOnLine: save.scene.resumeOnLine === true
  }
}

/**
 * The mock's `/state` (`{ tokens: { total, byKind }, calls, last }`), or its older `/calls`
 * counter as `{ tokens: null, calls }`, or null when the mock does not answer.
 */
export async function mockState(port = Number(process.env.VU_MOCK_PORT ?? 8783)) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/state`)
    if (res.ok) return await res.json()
    const calls = await fetch(`http://127.0.0.1:${port}/calls`)
    if (calls.ok) return { tokens: null, calls: await calls.json(), last: null }
  } catch {
    // Unreachable: reported as null.
  }
  return null
}

/**
 * True once `#game-action` is on screen, enabled, and the reply that unlocked it has fully
 * landed — `pendingLines === 0` as well as enabled, since the textarea's `disabled` attribute
 * has been observed to read `false` for a single fleeting frame mid-stream.
 */
async function atInput(page) {
  const input = page.locator('#game-action')
  if ((await input.count()) === 0) return false
  const enabled = await input.isEnabled().catch(() => false)
  if (!enabled) return false
  const pending = await page
    .evaluate(async (dir) => {
      const mod = await import(`${dir}/gameStore.ts`)
      return mod.useGameStore.getState().pendingLines.length
    }, STORE_DIR)
    .catch(() => 0)
  return pending === 0
}

/**
 * `.vu-box-line` scoped to the real, visible box: `views/boxRows.ts` mounts a hidden probe with
 * the same class under `#root` to measure line wraps, overwritten out of display order.
 */
const VISIBLE_BOX_LINE = '.vu-box:not([aria-hidden="true"]) .vu-box-line'

/** The dialogue box's current line, or '' where none is on screen. */
async function currentBoxLine(page) {
  const line = page.locator(VISIBLE_BOX_LINE).first()
  if ((await line.count()) === 0) return ''
  return (await line.textContent().catch(() => '')) ?? ''
}

/**
 * Clicks `.vu-stage-advance` until `#game-action` is live on two consecutive polls. `onLine`,
 * when given, is called with each new line as it comes on screen.
 */
export async function waitForGameAction(page, timeoutMs = 30_000, onLine) {
  const deadline = Date.now() + timeoutMs
  let last = ''
  let readyStreak = 0
  while (Date.now() < deadline) {
    if (await atInput(page)) {
      readyStreak++
      if (readyStreak >= 2) return true
      await sleep(80)
      continue
    }
    readyStreak = 0
    const line = await currentBoxLine(page)
    if (line && line !== last) {
      last = line
      if (onLine) onLine(line)
    }
    await advanceClick(page)
    await sleep(200)
  }
  return false
}

/** One click on the stage's advance surface, through Playwright. */
export async function advance(page) {
  await page.locator('.vu-stage-advance').click()
}

/** Store access through the module instance the app holds. */
export async function store(page) {
  return {
    /** How many lines are queued but not yet shown. */
    async pendingLines() {
      return page.evaluate(async (dir) => {
        const mod = await import(`${dir}/gameStore.ts`)
        return mod.useGameStore.getState().pendingLines.length
      }, STORE_DIR)
    },
    /** A snapshot of named `gameStore` fields. */
    async get(keys) {
      return page.evaluate(
        async ({ dir, keys }) => {
          const mod = await import(`${dir}/gameStore.ts`)
          const state = mod.useGameStore.getState()
          const out = {}
          for (const key of keys) out[key] = state[key]
          return out
        },
        { dir: STORE_DIR, keys }
      )
    }
  }
}

/** The text every `.vu-box-line` in the real, visible dialogue box currently reads. */
export async function boxLines(page) {
  return page.$$eval(VISIBLE_BOX_LINE, (nodes) => nodes.map((n) => n.textContent ?? ''))
}

/**
 * Watches `pendingLines` for `timeoutMs` right after a submit, without advancing. The default
 * covers the 3 s reply floor, which holds every streamed line back until it expires.
 */
export async function peakPendingLines(page, timeoutMs = 8000) {
  const s = await store(page)
  const deadline = Date.now() + timeoutMs
  let max = 0
  while (Date.now() < deadline) {
    const n = await s.pendingLines()
    if (n > max) max = n
    await sleep(20)
  }
  return max
}
