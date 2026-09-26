import { readdir, readFile, stat } from 'node:fs/promises'
import { isDeepStrictEqual } from 'node:util'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { unzipSync } from 'fflate'
import { loadTs } from './ts.mjs'

/**
 * Checks one playthrough folder against the save/record rules (`src/shared/saveRules.ts`,
 * `jsonValidate.ts`) and, past `--structure-only`, against the fixed facts of the checkpoint
 * playthrough this harness builds under `testsave/`: seven manual saves, `manual01` through
 * `manual07`, each taken on the first line of its slot's opening narration.
 *
 * Usage: `node testsave/harness/validate.mjs [folder] [--structure-only]` — `folder` is a bare
 * numeric id (read under `testsave/`) or a path, relative to the repo root or absolute; omitted,
 * the single numeric folder under `testsave/` is used. `--structure-only` skips every assertion
 * tied to this fixture's own dates and content, so the same checks can run on any playthrough
 * folder holding manual and/or numeric slot saves — the save/record shape, the history and
 * class-meeting bookkeeping and the exam-score timing hold for any playthrough, not just this one.
 */

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const TESTSAVE_DIR = join(REPO_ROOT, 'testsave')

const NUMERIC_NAME = /^[0-9]+$/
const SAVE_FILE = /^([0-9]+)\.json$/
const MANUAL_FILE = /^(manual(?:0[1-9]|[1-8][0-9]|90))\.json$/

/**
 * This fixture's seven checkpoints. `dateMin`/`dateMax` in place of `date` is a range rather
 * than an exact day and carries no time check; every other checkpoint's `time` is checked exactly.
 * `examDay` ('midterm' or 'final'): the slot lies in that exam week and a class on the player's
 * schedule sits that exam in it.
 * `finalsPending`: every final is sat but the scores are not shown yet, and the next slot is the
 * Monday day after finals week whose opening posts them.
 * `graduationEve`: the next slot is graduation day's.
 */
const CHECKPOINTS = {
  manual01: { dateMin: 8, dateMax: 13 },
  manual02: { date: 43, time: 0, examDay: 'midterm' },
  manual03: { date: 51, time: 0, springBreak: true },
  manual04: { date: 57, time: 0 },
  manual05: { date: 113, time: 0, examDay: 'final' },
  manual06: { date: 118, time: 1, finalsPending: true },
  manual07: { date: 122, time: 1, graduationEve: true }
}

const args = process.argv.slice(2)
const structureOnly = args.includes('--structure-only')
const positional = args.find((a) => !a.startsWith('--'))

let failures = 0
function check(ok, label) {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}`)
  if (!ok) failures++
  return ok
}
/** A check that could not even run — printed and counted the same as a failed one. */
function checkError(label, err) {
  console.log(`FAIL ${label} — ${err.message}`)
  failures++
}

/** The single numeric folder under `testsave/`, when none is named on the command line. */
async function defaultFolder() {
  const entries = await readdir(TESTSAVE_DIR, { withFileTypes: true })
  const numeric = entries.filter((e) => e.isDirectory() && NUMERIC_NAME.test(e.name))
  if (numeric.length !== 1) {
    throw new Error(
      `expected exactly one numeric folder under testsave/, found ${numeric.length}` +
        (numeric.length > 0 ? ` (${numeric.map((e) => e.name).join(', ')})` : '')
    )
  }
  return join(TESTSAVE_DIR, numeric[0].name)
}

async function resolveFolder(arg) {
  if (!arg) return defaultFolder()
  if (NUMERIC_NAME.test(arg)) return join(TESTSAVE_DIR, arg)
  // `resolve`, not `join`: an absolute `arg` (as a scratchpad copy's path usually is) must
  // override the repo root rather than being appended to it.
  return resolve(REPO_ROOT, arg)
}

/**
 * Every checkpoint save file in `dir` — `<numeric>.json` (a boundary save) ascending by id,
 * then `manualNN.json` ascending by slot — parsed but not yet validated. Boundary saves first,
 * manual saves after: the order `makeBackup.mjs` writes `saves` in too.
 */
async function checkpointSavesIn(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = entries.filter((e) => e.isFile()).map((e) => e.name)

  const boundary = files
    .filter((n) => SAVE_FILE.test(n))
    .map((n) => SAVE_FILE.exec(n)[1])
    .sort((a, b) => Number(a) - Number(b))
    .map((saveId) => ({ saveId, kind: 'boundary' }))

  const manual = files
    .filter((n) => MANUAL_FILE.test(n))
    .map((n) => MANUAL_FILE.exec(n)[1])
    .sort((a, b) => Number(a.slice('manual'.length)) - Number(b.slice('manual'.length)))
    .map((saveId) => ({ saveId, kind: 'manual' }))

  return [...boundary, ...manual].map(({ saveId, kind }) => ({
    saveId,
    kind,
    path: join(dir, `${saveId}.json`)
  }))
}

/** Every other `.json` save file present (`autosave.json`), for the schema-only pass. */
async function otherSavesIn(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.json') && e.name !== 'playthrough.json')
    .map((e) => e.name)
    .filter((name) => !SAVE_FILE.test(name) && !MANUAL_FILE.test(name))
}

async function main() {
  const folder = await resolveFolder(positional)
  const playthroughId = basename(folder)
  console.log(`Validating ${folder} (playthroughId ${playthroughId})${structureOnly ? ' [structure-only]' : ''}`)

  const { SAVE_READ, RECORD_READ, classifySaveId } = await loadTs('src/shared/saveRules.ts')
  const { validateRecord } = await loadTs('src/shared/jsonValidate.ts')
  const { BACKUP_READ, classifyBackupEntry } = await loadTs('src/shared/backup.ts')
  const { isCourse, kindOf, FINALS_POSTED_LINE } = await loadTs('src/shared/academics.ts')
  const { globalSlotOf, slotFromId } = await loadTs('src/shared/jobs.ts')
  // `meetingDatesOf` is exactly "every date `classSlotOf(date, time, occasions) === slot`
  // picks out" (see `occasions.ts`), so it stands in for that formula without walking the
  // whole calendar by hand here too.
  const {
    meetingDatesOf,
    classMeetingIndexOf,
    examMeetingDateOf,
    MIDTERM_WEEK,
    FINALS_WEEK,
    GRADUATION_DATE
  } = await loadTs('src/renderer/prompts/occasions.ts')
  const { nextSlot } = await loadTs('src/renderer/prompts/gameDate.ts')

  // ─── The record ──────────────────────────────────────────────────────────
  let record = null
  try {
    const raw = JSON.parse(await readFile(join(folder, 'playthrough.json'), 'utf8'))
    record = validateRecord(raw, join(folder, 'playthrough.json'), RECORD_READ)
    check(true, 'playthrough.json validates against RECORD_READ')
  } catch (err) {
    checkError('playthrough.json validates against RECORD_READ', err)
  }

  if (record && !structureOnly) {
    try {
      const quickstart = JSON.parse(
        await readFile(join(REPO_ROOT, 'assets', 'quickstart.json'), 'utf8')
      )
      const gotChars = new Set(record.chars)
      const wantChars = new Set(quickstart.chars)
      check(
        gotChars.size === wantChars.size && [...gotChars].every((c) => wantChars.has(c)),
        'record.chars is exactly assets/quickstart.json\'s chars'
      )
    } catch (err) {
      checkError('record.chars is exactly assets/quickstart.json\'s chars', err)
    }
  }

  // ─── Every save file: schema only ───────────────────────────────────────
  const checkpointFiles = await checkpointSavesIn(folder)
  const otherSaves = await otherSavesIn(folder)

  const parsedSaves = []
  for (const { saveId, kind, path } of checkpointFiles) {
    try {
      const raw = JSON.parse(await readFile(path, 'utf8'))
      const save = validateRecord(raw, path, SAVE_READ)
      check(true, `${saveId}.json validates against SAVE_READ`)
      parsedSaves.push({ saveId, kind, path, save })
    } catch (err) {
      checkError(`${saveId}.json validates against SAVE_READ`, err)
    }
  }
  for (const name of otherSaves) {
    try {
      const raw = JSON.parse(await readFile(join(folder, name), 'utf8'))
      validateRecord(raw, join(folder, name), SAVE_READ)
      check(true, `${name} validates against SAVE_READ`)
    } catch (err) {
      checkError(`${name} validates against SAVE_READ`, err)
    }
  }
  check(checkpointFiles.length > 0, 'at least one <numeric>.json or manualNN.json save is present')

  // ─── Per checkpoint save ─────────────────────────────────────────────────
  for (const { saveId, kind, save } of parsedSaves) {
    const checkpoint = CHECKPOINTS[saveId]

    check(save.saveId === saveId, `${saveId}.json: file name equals saveId`)
    check(save.playthroughId === playthroughId, `${saveId}.json: playthroughId equals the folder name`)
    check(classifySaveId(save.saveId) === kind, `${saveId}.json: saveId classifies as a ${kind} save`)

    // A boundary save is minted before its slot's opening has shown a line: everything queued,
    // nothing on screen. A manual save in this fixture is taken right after the first — the
    // rest of the opening still queued, the first line on screen — which a real manual save
    // does not always hold (one taken mid-scene has a cast, a transcript and often a
    // thumbnail), so that shape is checked only for this fixture's own seven, not generally.
    if (kind === 'boundary') {
      const sceneClean =
        save.scene !== null &&
        save.scene.currentLine === null &&
        save.scene.cast.length === 0 &&
        save.scene.transcript.length === 0 &&
        save.scene.pendingLines.length > 0
      check(
        sceneClean,
        `${saveId}.json: scene is queued but unshown — currentLine null, cast/transcript empty, pendingLines not (` +
          `scene ${save.scene === null ? 'is null' : `currentLine=${save.scene.currentLine === null ? 'null' : 'set'} cast=${save.scene.cast.length} transcript=${save.scene.transcript.length} pendingLines=${save.scene.pendingLines.length}`})`
      )
      check(!('thumbnail' in save), `${saveId}.json: carries no thumbnail`)
    } else if (kind === 'manual' && !structureOnly) {
      const openingShape =
        save.scene !== null &&
        save.scene.currentLine !== null &&
        save.scene.cast.length === 0 &&
        save.scene.transcript.length === 0
      check(
        openingShape,
        `${saveId}.json: scene is the slot's first opening line — currentLine set, cast/transcript empty (` +
          `scene ${save.scene === null ? 'is null' : `currentLine=${save.scene.currentLine === null ? 'null' : 'set'} cast=${save.scene.cast.length} transcript=${save.scene.transcript.length}`})`
      )
      check(!('thumbnail' in save), `${saveId}.json: carries no thumbnail`)
    }

    if (!structureOnly) {
      if (checkpoint) {
        if (checkpoint.dateMin !== undefined) {
          check(
            save.date >= checkpoint.dateMin && save.date <= checkpoint.dateMax,
            `${saveId}.json: date is ${checkpoint.dateMin}-${checkpoint.dateMax} (got ${save.date})`
          )
        } else {
          check(save.date === checkpoint.date, `${saveId}.json: date === ${checkpoint.date} (got ${save.date})`)
        }
        if (checkpoint.time !== undefined) {
          check(save.time === checkpoint.time, `${saveId}.json: time === ${checkpoint.time} (got ${save.time})`)
        }
        if (checkpoint.examDay) {
          const week = checkpoint.examDay === 'midterm' ? MIDTERM_WEEK : FINALS_WEEK
          check(
            save.date >= week.startDate && save.date <= week.endDate,
            `${saveId}.json: date lies in ${week.title} (${week.startDate}-${week.endDate}, got ${save.date})`
          )
        }
        if (checkpoint.springBreak) {
          check(
            Array.isArray(save.springBreakAway) && save.springBreakAway.length > 0,
            `${saveId}.json: springBreakAway is a non-empty array (got ${JSON.stringify(save.springBreakAway)})`
          )
        }
        if (checkpoint.finalsPending) {
          check(save.finalsScoresShown === false, `${saveId}.json: finalsScoresShown === false`)
          const pendingTexts = (save.scene?.pendingLines ?? []).map((l) => l.text)
          check(
            !pendingTexts.includes(FINALS_POSTED_LINE),
            `${saveId}.json: pendingLines does not include FINALS_POSTED_LINE`
          )
          const next = nextSlot(save.date, save.time)
          check(
            next.time === 0 && next.date > FINALS_WEEK.endDate && next.date % 7 === 0,
            `${saveId}.json: the next slot is the Monday day after finals week, when the scores post ` +
              `(got ${next.date}:${next.time})`
          )
        }
        if (checkpoint.graduationEve) {
          const next = nextSlot(save.date, save.time)
          check(
            isDeepStrictEqual(next, { date: GRADUATION_DATE, time: 0 }),
            `${saveId}.json: the next slot is graduation day, ${GRADUATION_DATE}:0 (got ${next.date}:${next.time})`
          )
        }
      }
    }

    // ─── history: exactly one entry per slot strictly before this save ─────
    if (record) {
      // No slot is ever skipped, first day included: `advanceSlot` (`gameLoop.ts`) only ever
      // runs right after `commitSceneToHistory`, and every scene-ending path — a normal turn
      // (`loop/turn.ts`), an exam (`loop/exams.ts`), even the forced orientation scene at
      // (0,0) and the player's first scene of the tutorial evening at (0,1) — sets a
      // `sceneSummary` before that boundary crosses. Confirmed against a real save's own
      // history (`data/saves/1789275480528`, unbroken from date 0) and against the creation
      // save at (0,0) itself, which holds zero entries — exactly `globalSlotOf(0, 0)`.
      const saveGlobalSlot = globalSlotOf(save.date, save.time)
      const seen = new Set()
      for (const [dateKey, byTime] of Object.entries(save.history)) {
        for (const timeKey of Object.keys(byTime)) {
          seen.add(globalSlotOf(Number(dateKey), Number(timeKey)))
        }
      }
      let covers = seen.size === saveGlobalSlot
      for (let i = 0; i < saveGlobalSlot && covers; i++) if (!seen.has(i)) covers = false
      check(
        covers,
        `${saveId}.json: history has exactly one entry for every slot before it, none after ` +
          `(expected ${saveGlobalSlot}, got ${seen.size} distinct slots)`
      )

      // ─── classRecords: meetings, attendance, factoids, exam scores ───────
      const codes = [...new Set(Object.values(save.playerSchedule))]
      const finalDueCodes = []
      for (const code of codes) {
        const entry = record.classes[code]
        if (!entry) {
          check(false, `${saveId}.json: record.classes has ${code} (on the player's schedule)`)
          continue
        }
        const examTime = slotFromId(entry.slot).time
        const meetingsBefore = meetingDatesOf(entry.slot, record.occasions).filter(
          (d) => globalSlotOf(d, examTime) < saveGlobalSlot
        )
        const meetings = save.classRecords[code]?.meetings ?? []
        check(
          meetings.length === meetingsBefore.length,
          `${saveId}.json: classRecords[${code}].meetings.length === ${meetingsBefore.length} (got ${meetings.length})`
        )

        // A skipped meeting is this fixture's own policy, not something every playthrough does
        // (a real player can ditch a class) — checked only against the scripted checkpoint.
        if (!structureOnly) {
          const allAttended = meetings.every((m) => m.attended === true)
          check(allAttended, `${saveId}.json: every classRecords[${code}] meeting is attended`)
        }

        const lecture = isCourse(entry) && kindOf(entry) === 'lecture'
        const midtermDate = examMeetingDateOf(entry.slot, 'midterm', record.occasions)
        const finalDate = examMeetingDateOf(entry.slot, 'final', record.occasions)
        let factoidRuleOk = true
        for (const m of meetings) {
          const index = classMeetingIndexOf(entry.slot, m.date, record.occasions)
          const isExamMeeting = m.date === midtermDate || m.date === finalDate
          // Only an attended meeting was ever asked for one (`recordAcademics` in
          // `stores/loop/academics.ts`): a skip writes no summary and no factoid either.
          const wantsFactoid = lecture && m.attended === true && index !== null && index > 1 && !isExamMeeting
          const hasFactoid = typeof m.factoid === 'string' && m.factoid.length > 0
          if (wantsFactoid !== hasFactoid) factoidRuleOk = false
        }
        check(
          factoidRuleOk,
          `${saveId}.json: classRecords[${code}] carries a factoid on every lecture meeting past the first, ` +
            'never on the first or the exam meeting'
        )

        if (isCourse(entry)) {
          const classRecord = save.classRecords[code]
          const midtermDue = midtermDate !== null && globalSlotOf(midtermDate, examTime) < saveGlobalSlot
          const finalDue = finalDate !== null && globalSlotOf(finalDate, examTime) < saveGlobalSlot
          check(
            (typeof classRecord?.midtermScore === 'number') === midtermDue,
            `${saveId}.json: classRecords[${code}].midtermScore is ${midtermDue ? '' : 'not '}present`
          )
          check(
            (typeof classRecord?.finalScore === 'number') === finalDue,
            `${saveId}.json: classRecords[${code}].finalScore is ${finalDue ? '' : 'not '}present`
          )
          if (finalDue) finalDueCodes.push(code)
        }
      }

      if (!structureOnly && checkpoint?.finalsPending) {
        // Already implied by the per-class `finalDue` check above (every graded class's final is
        // behind it by the Sunday night after finals week; the scroll that reports the scores is
        // what the next slot's opening builds), asserted directly too since it is this
        // checkpoint's whole point.
        const allFinalScored = finalDueCodes.every(
          (code) => typeof save.classRecords[code]?.finalScore === 'number'
        )
        check(allFinalScored, `${saveId}.json: every graded class carries a finalScore`)
      }

      if (!structureOnly && checkpoint?.examDay) {
        const sitting = codes.filter((code) => {
          const entry = record.classes[code]
          return (
            entry !== undefined &&
            examMeetingDateOf(entry.slot, checkpoint.examDay, record.occasions) === save.date &&
            slotFromId(entry.slot).time === save.time
          )
        })
        check(
          sitting.length > 0,
          `${saveId}.json: a scheduled class sits its ${checkpoint.examDay} in this slot (${sitting.join(', ') || 'none'})`
        )
      }
    }

    if (!structureOnly) {
      // ─── The job ───────────────────────────────────────────────────────
      if (check(save.job !== null, `${saveId}.json: job is held`)) {
        check(save.job.jobId === 'fast_eats', `${saveId}.json: job.jobId === 'fast_eats' (got ${save.job.jobId})`)
        check(
          (save.tallies?.shiftsWorked ?? null) === save.job.shiftsWorked,
          `${saveId}.json: tallies.shiftsWorked === job.shiftsWorked`
        )
        check(
          (save.tallies?.moneyEarned ?? null) === save.job.earned,
          `${saveId}.json: tallies.moneyEarned === job.earned`
        )
        check(save.job.strikes === 0, `${saveId}.json: job.strikes === 0 (got ${save.job.strikes})`)
      }

      check(
        Number.isInteger(save.tallies?.tokensGenerated) && save.tallies.tokensGenerated > 0,
        `${saveId}.json: tallies.tokensGenerated is a positive integer`
      )

      // From (113, 0) on: manual05, manual06 and manual07.
      if (save.date >= 113) {
        check(save.money > 0, `${saveId}.json: money > 0 (got ${save.money})`)
        for (const key of ['brain', 'body', 'heart']) {
          check(save.stats[key] >= 35, `${saveId}.json: stats.${key} >= 35 (got ${save.stats[key]})`)
        }

        const lovers = Object.values(save.charInfo).filter((c) => c.flags?.isLover === true)
        check(
          lovers.length === 1 && lovers[0].flags.hasKissed === true,
          `${saveId}.json: exactly one flags.isLover, and she hasKissed (got ${lovers.length} lover(s))`
        )
        check(
          (save.tallies?.kisses ?? 0) >= 1,
          `${saveId}.json: tallies.kisses >= 1 (got ${save.tallies?.kisses})`
        )
      }
    }
  }

  // ─── backup.zip, if there is one ────────────────────────────────────────
  const backupPath = join(TESTSAVE_DIR, 'backup.zip')
  const hasBackup = await stat(backupPath).then(
    () => true,
    () => false
  )
  if (hasBackup) {
    try {
      const bytes = await readFile(backupPath)
      const entries = unzipSync(new Uint8Array(bytes))
      const names = Object.keys(entries)
      check(
        names.length === 1 && names[0] === 'backup.json',
        `backup.zip holds exactly one entry, backup.json (got ${names.join(', ') || 'none'})`
      )
      check(
        classifyBackupEntry('backup.json') === 'record',
        "classifyBackupEntry('backup.json') === 'record'"
      )

      const backupRaw = JSON.parse(new TextDecoder().decode(entries['backup.json']))
      const backup = validateRecord(backupRaw, backupPath, BACKUP_READ)
      check(true, 'backup.json validates against BACKUP_READ')

      if (record) {
        check(
          isDeepStrictEqual(backup.playthroughs[playthroughId]?.record, record),
          'backup.json playthroughs[id].record deep-equals playthrough.json'
        )
      }
      const wantSaves = parsedSaves.map(({ saveId, save }) => ({ playthroughId, saveId, save }))
      check(
        isDeepStrictEqual(
          [...backup.saves].sort((a, b) => a.saveId.localeCompare(b.saveId)),
          [...wantSaves].sort((a, b) => a.saveId.localeCompare(b.saveId))
        ),
        'backup.json saves deep-equal the folder\'s checkpoint save files'
      )
    } catch (err) {
      checkError('backup.zip is readable and matches the folder', err)
    }
  } else {
    console.log('(no testsave/backup.zip — skipping the backup checks)')
  }

  console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) failed.`}`)
  if (failures > 0) process.exitCode = 1
}

main().catch((err) => {
  console.error(`validate failed: ${err.stack ?? err.message}`)
  process.exitCode = 1
})
