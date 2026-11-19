import { kindOf, type ExamPeriod } from '@shared/academics'
import {
  bossMessageOf,
  globalSlotOf,
  jobDefOf,
  judgeShiftChange,
  settleShifts as settleShifts_,
  shiftRecordOf,
  shiftSlotOf,
  slotFromId,
  type JobMessageKind,
  type JobShift
} from '@shared/jobs'
import { sickInSlot } from '@shared/colds'
import type { StatKey } from '@shared/playerStats'
import type { ClassEntry, JobState, TimeSlot } from '@shared/types'
import {
  projectAssigned,
  projectPeriodOf,
  workedOn,
  type ProjectPeriod
} from '../../prompts/classProgress'
import { shiftWeekdayOf } from '../../prompts/gameDate'
import { closureOn, endVacationOf, jobClosedOn } from '../../prompts/occasions'
import { useGameStore } from '../gameStore'
import { deliverBossMessage } from '../textingLoop'
import { loopState, type ProjectWork } from './state'

/**
 * The reader's job and his project classes — the two things a slot
 * can be spent on that are not a scene about somebody.
 */

/**
 * The reader's project classes, each with the period it is currently building
 * for and how far along it is — the pool a `project:` verdict resolves against.
 */
function playerProjects(): Array<{
  entry: ClassEntry
  period: ProjectPeriod
  worked: number
  assigned: boolean
}> {
  const game = useGameStore.getState()
  const codes = new Set(Object.values(game.playerSchedule))
  return [...codes]
    .flatMap((code) => {
      const entry = game.classes[code]
      if (!entry || kindOf(entry) !== 'project') return []
      const period = projectPeriodOf(entry, game.date, game.calendar)
      if (!period) return []
      const record = game.classRecords[code]
      return [
        {
          entry,
          period,
          worked: workedOn(record, period.exam),
          assigned: projectAssigned(record, period)
        }
      ]
    })
    .sort((a, b) => a.entry.code.localeCompare(b.entry.code))
}

/**
 * The reader's project classes, whatever state each one is in — the pool the classifier
 * is shown so it can name the course a work session is for.
 */
export function playerProjectClasses(): ClassEntry[] {
  return playerProjects().map((project) => project.entry)
}

/**
 * Every project the slot-opening row offers to work on, nearest showcase first and least
 * progress breaking a tie; empty when every showcase is already paid for.
 */
export function projectsNeedingWork(): { code: string; name: string }[] {
  return playerProjects()
    .filter((p) => p.assigned && p.worked < p.period.needed)
    .sort((a, b) => a.period.deadlineDate - b.period.deadlineDate || a.worked - b.worked)
    .map((p) => ({ code: p.entry.code, name: p.entry.name }))
}

/**
 * Which project a "work on my project" action is about. The classifier's code is
 * honoured when it names one of his own project classes.
 */
export function resolveProject(
  code: string
): { code: string; exam: ExamPeriod } | 'unassigned' | null {
  const projects = playerProjects()
  if (projects.length === 0) return null

  const named = projects.find((p) => p.entry.code.toLowerCase() === code.trim().toLowerCase())
  if (named) {
    if (!named.assigned) return 'unassigned'
    return { code: named.entry.code, exam: named.period.exam }
  }

  const handedOut = projects.filter((p) => p.assigned)
  if (handedOut.length === 0) return null
  const unfinished = handedOut.filter((p) => p.worked < p.period.needed)
  const pool = unfinished.length > 0 ? unfinished : handedOut
  const pick = [...pool].sort(
    (a, b) => a.period.deadlineDate - b.period.deadlineDate || a.worked - b.worked
  )[0]
  return { code: pick.entry.code, exam: pick.period.exam }
}

/** The shift and the work session a scene is, as the boundary credits them. */
export function sceneRecordsOf(
  job: JobState | null | undefined,
  scene: { jobId?: string; jobStats?: readonly StatKey[]; projectClass?: string } | null | undefined,
  date: number,
  time: TimeSlot
): { jobShift: JobShift | null; projectWork: ProjectWork | null } {
  // Only `resolveProject`'s exact-name arm may answer here; its fallback is for a fresh action.
  const project = scene?.projectClass ? resolveProject(scene.projectClass) : null
  return {
    jobShift: shiftRecordOf(job, scene, date, time),
    projectWork:
      typeof project === 'object' && project?.code === scene?.projectClass ? project : null
  }
}

/** Arms both records off the scene the store holds, the way a reload derives them. */
export function armSceneRecords(): void {
  const game = useGameStore.getState()
  const records = sceneRecordsOf(
    game.job,
    {
      ...(game.sceneJob ? { jobId: game.sceneJob } : {}),
      ...(game.sceneJobStats.length > 0 ? { jobStats: game.sceneJobStats } : {}),
      ...(game.sceneProject ? { projectClass: game.sceneProject } : {})
    },
    game.date,
    game.time
  )
  loopState.jobShift = records.jobShift
  loopState.projectWork = records.projectWork
}

/** Texts the reader once when a closure takes his shifts off him. */
function noticeClosure(): void {
  const game = useGameStore.getState()
  const job = game.job
  if (!job) return

  const closure = closureOn(game.date, game.calendar)
  if (!closure || job.holidayNoticeDate === closure.startDate) return
  const def = jobDefOf(job.jobId)
  const season = game.calendar.season
  const lastClosure = closure.id === endVacationOf(season).id
  const kind: JobMessageKind = !lastClosure ? 'holiday' : season === 'spring' ? 'summer' : 'winter'
  const text =
    bossMessageOf(def, kind, game.playerPronouns) ??
    bossMessageOf(def, 'holiday', game.playerPronouns)
  if (!text || !jobClosedOn(job.jobId, game.date, game.calendar)) return

  let rostered = false
  for (let date = closure.startDate; date <= closure.endDate && !rostered; date++) {
    for (const time of [0, 1] as const) {
      if (job.shifts.includes(shiftSlotOf(shiftWeekdayOf(date), time))) rostered = true
    }
  }

  // Set either way: a closure he had no shifts in is settled too.
  useGameStore.getState().updateJob({ holidayNoticeDate: closure.startDate })
  if (rostered) deliverBossMessage(job.jobId, kind)
}

/**
 * Judges every shift slot the clock has passed since the last sweep and files what it finds.
 */
export function settleShifts(): void {
  const game = useGameStore.getState()
  const job = game.job
  if (!job) return

  // The slot that just ended — the current one has not been spent yet.
  const throughSlot = globalSlotOf(game.date, game.time) - 1
  const result = settleShifts_(
    job,
    throughSlot,
    (slotId) => {
      const { date, time } = slotFromId(slotId)
      return shiftSlotOf(shiftWeekdayOf(date), time)
    },
    // A closure, or a shift his cold kept him off: neither is his to answer for.
    (slotId) =>
      jobClosedOn(job.jobId, slotFromId(slotId).date, game.calendar) ||
      sickInSlot(game.readerCold ?? undefined, slotId)
  )

  for (const judgement of result.judgements) {
    if (!judgement.strike) continue
    useGameStore.getState().recordStrike(judgement.slotId)
    deliverBossMessage(job.jobId, judgement.strike)
  }

  // An excuse is spent whether or not it saved anything; the mark advances regardless.
  useGameStore.getState().updateJob({
    settledThrough: result.settledThrough,
    ...(result.excusedUsed.length > 0 ? { excusedSlot: undefined } : {})
  })

  if (result.fired) {
    useGameStore.getState().endJob('fired')
    return
  }

  noticeClosure()

  // A requested roster is acknowledged at the next boundary and takes effect the next Sunday
  // morning; the judgement is `shared/jobs.ts`'s, and this applies it.
  const live = useGameStore.getState().job
  if (!live) return
  switch (judgeShiftChange(live, shiftSlotOf(shiftWeekdayOf(game.date), game.time))) {
    case 'swap':
      useGameStore.getState().updateJob({
        shifts: [...live.pendingShifts!].sort((a, b) => a - b),
        pendingShifts: undefined,
        shiftChangeApproved: undefined
      })
      deliverBossMessage(live.jobId, 'shiftChange')
      break
    case 'approve':
      useGameStore.getState().updateJob({ shiftChangeApproved: true })
      deliverBossMessage(live.jobId, 'shiftApproved')
      break
  }
}
