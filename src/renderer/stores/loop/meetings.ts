import { kindOf, type ExamPeriod } from '@shared/academics'
import { studentsOf } from '@shared/classes'
import { readerWords } from '@shared/gender'
import {
  jobDefOf,
  rollShiftGain,
  NO_JOB_MESSAGE,
  NO_SHIFT_MESSAGE,
  NO_SHIFT_SICK_MESSAGE,
  type JobDef
} from '@shared/jobs'
import type { ClassEntry, JobState } from '@shared/types'
import { examOn } from '../../prompts/classProgress'
import { ordinal } from '../../prompts/gameDate'
import { readerAmongCast } from '../../prompts/setting'
import { PORTRAIT_SLOTS, useGameStore, type SceneKind } from '../gameStore'
import { charJobNow, readerSickNow, shiftNow } from '../timetable'
import { shownAt } from '../whereabouts'
import { studentsHere } from './cast'
import {
  admitLocals,
  commitmentNotes,
  drawFreeCast,
  injectPasserby,
  listOf,
  localsAtLocation,
  resolveAttendance,
  resolveLocationId,
  runIntoNote,
  shownFirst,
  slotPlanAttendees,
  workersAtLocation,
  workingHereNote
} from './casting'
import { classNowFor, firstNameOf } from './classify'
import { resolveProject } from './jobs'
import type { ProjectWork } from './state'

/**
 * What kind of scene a verdict's action type makes of this slot for the reader, and the one
 * casting every people-led scene shares — a typed action, a plan's button or a hangout — which
 * puts the people it was called with into that kind of scene.
 */

/** The scene an action type makes of this slot, or why it makes none. */
export type SceneKindVerdict =
  | { kind: 'class'; entry: ClassEntry; students: string[]; exam: ExamPeriod | null }
  | { kind: 'shift'; job: JobState; def: JobDef | undefined; coworkers: string[] }
  | { kind: 'project'; project: ProjectWork }
  | { kind: 'none'; reason?: string }

/** The kind a verdict with no class, work or project in it makes. */
export const NO_KIND: SceneKindVerdict = { kind: 'none' }

/** Resolves an action type against the reader's slot; reads the store and writes nothing. */
export function sceneKindOf(actionType: string): SceneKindVerdict {
  const game = useGameStore.getState()

  if (actionType.startsWith('goto_class:')) {
    const resolved = classNowFor(actionType.slice('goto_class:'.length).trim())
    if ('error' in resolved) return { kind: 'none', reason: resolved.error.message }
    const { entry } = resolved
    return {
      kind: 'class',
      entry,
      students: studentsHere(entry),
      exam: examOn(entry, game.date, game.calendar)
    }
  }

  if (actionType === 'job') {
    if (!game.job) return { kind: 'none', reason: NO_JOB_MESSAGE }
    if (shiftNow() === null) {
      return { kind: 'none', reason: readerSickNow() ? NO_SHIFT_SICK_MESSAGE : NO_SHIFT_MESSAGE }
    }
    const jobId = game.job.jobId
    return {
      kind: 'shift',
      job: game.job,
      def: jobDefOf(jobId),
      coworkers: game.chars.filter((charId) => charJobNow(charId) === jobId)
    }
  }

  if (actionType.startsWith('project:')) {
    // Both refusals are composed from the reader's timetable; the classifier was never told it.
    const resolved = resolveProject(actionType.slice('project:'.length))
    if (resolved === 'unassigned') {
      return { kind: 'none', reason: "That class hasn't handed out its project yet." }
    }
    if (!resolved) return { kind: 'none', reason: "You don't have a project to work on right now." }
    return { kind: 'project', project: resolved }
  }

  return NO_KIND
}

/**
 * The kind a plan or a hangout is met as. A lecture sitting its midterm or final is sat alone,
 * so the meeting goes ahead without it and he skips the exam.
 */
export function meetingKindOf(actionType: string): SceneKindVerdict {
  const kind = sceneKindOf(actionType)
  if (kind.kind === 'class' && kind.exam && kindOf(kind.entry) === 'lecture') {
    return { kind: 'none', reason: `${kind.entry.code} is sitting its ${kind.exam}` }
  }
  return kind
}

/** The scene fields a shift writes, and the line under the action saying which shift it is. */
export function shiftOf(kind: Extract<SceneKindVerdict, { kind: 'shift' }>): {
  scene: SceneKind
  note: string | null
} {
  const { job, def } = kind
  const r = readerWords(useGameStore.getState().playerPronouns)
  // Rolled once here and written onto the scene, so a reload pays the same stats back.
  // An employer with a single gain leaves the field off: the derivation finds it anyway.
  const gain = def ? rollShiftGain(def) : null
  return {
    // Never also `visitJobId`: one paragraph describes the workplace either way.
    scene: {
      jobId: job.jobId,
      ...(def && gain && def.gains.length > 1 ? { jobStats: [...gain.stats] } : {})
    },
    // The shift he is about to work: `recordShiftWorked` runs at the boundary, after this
    // prompt is built.
    note: def
      ? `(${r.He} is working ${r.his} ${ordinal(job.shiftsWorked + 1)} shift as a ${def.title} at ${def.employer}, ${def.duty}.)`
      : null
  }
}

/** The line under the action naming the project a work session is for. */
function workSessionNote(code: string): string {
  const { classes, playerPronouns } = useGameStore.getState()
  const name = classes[code]?.name ?? 'course'
  const r = readerWords(playerPronouns)
  return `(${r.He} is putting a work session into ${r.his} ${name} project.)`
}

/** The line for the girls in a class scene who do not take the class. */
function sittingInNote(charIds: readonly string[]): string {
  const names = listOf(charIds.map(firstNameOf))
  const him = readerAmongCast(useGameStore.getState().playerPronouns).him
  return charIds.length > 1
    ? `${names} are not in this class and are sitting in on it with ${him}.`
    : `${names} is not in this class and is sitting in on it with ${him}.`
}

/** The kind a cast scene is, for the `[cast]` log lines. */
export function kindLabel(scene: SceneKind): string {
  if (scene.classCode) return `class ${scene.classCode}`
  if (scene.jobId) return `shift ${scene.jobId}`
  if (scene.projectClass) return `project ${scene.projectClass}`
  return ''
}

/**
 * The people a scene is called with, and where the action set it. Whoever of them has a plan this
 * slot clears the busy gate, whichever plan it is.
 */
export interface MeetingCall {
  /** Everyone asked for, a plan's attendees first. */
  called: readonly string[]
  /** The hangout's own girl, in the scene whatever else is true of her. */
  required?: string
  inPublic: boolean
  sceneLocation: string
}

/** Who a scene casts, what the action says about them, and what kind of scene it is. */
export interface ComposedMeeting {
  cast: string[]
  /** The lines under the action: the kind's own first, then absences, commitments and arrivals. */
  notes: string[]
  scene: SceneKind
  passerby: string | null
  /** Who of the people called made it in; empty with somebody called is nobody free. */
  people: string[]
}

/**
 * Casts the people a scene is called with into the kind of scene it is. Only rolls dice and
 * writes nothing, so a refusal that drops the result costs nothing.
 */
export function composeMeeting(call: MeetingCall, kind: SceneKindVerdict): ComposedMeeting {
  const planned = slotPlanAttendees()
  if (kind.kind === 'class') return composeClass(call, kind, planned)
  if (kind.kind === 'shift') return composeShift(call, kind, planned)

  const { called, required, inPublic, sceneLocation } = call
  // Whoever is working where the action is set clears the busy gate.
  const workers = workersAtLocation(sceneLocation).map((worker) => worker.charId)
  const attendance = resolveAttendance(called, required, [...workers, ...planned])
  const notes = [
    ...(kind.kind === 'project' ? [workSessionNote(kind.project.code)] : []),
    ...attendance.notes,
    ...commitmentNotes(attendance.cast, planned, workers)
  ]

  const named = called.length > 0 || required !== undefined
  let uninvited: readonly string[] = []
  // Only a named cast rolls for a passerby, and only a nobody-named one draws; either is seated
  // after whoever the map shows at the place and before everybody else there.
  const pickUp = (seated: readonly string[]): readonly string[] => {
    if (named) {
      const passerby = injectPasserby(seated, inPublic, resolveLocationId(sceneLocation))
      uninvited = passerby ? [passerby] : []
    } else {
      uninvited = drawFreeCast(inPublic, sceneLocation, seated)
    }
    return uninvited
  }

  // After the people the reader came for, so they have their slots first; the one branch
  // that can add to a full scene's notes without adding to its cast.
  const atWork = admitLocals(attendance.cast, sceneLocation, {
    named,
    inPublic,
    shown: shownAt(sceneLocation),
    pickUp
  })
  const passerby = named ? (uninvited[0] ?? null) : null
  // Every uninvited body, whichever step added it, is named in one line under the action.
  const ranInto = [...uninvited, ...atWork.joined]
  return {
    cast: atWork.cast,
    notes: [
      ...notes,
      ...atWork.notes,
      ...(ranInto.length > 0 ? [runIntoNote(ranInto, sceneLocation)] : [])
    ],
    scene: {
      ...(kind.kind === 'project' ? { projectClass: kind.project.code } : {}),
      ...(atWork.jobId ? { visitJobId: atWork.jobId } : {})
    },
    passerby,
    people: attendance.cast
  }
}

/**
 * His class with company: the people called first, the rest of the room after them. The
 * students are never capped nor busy, as a class scene of his own has them all.
 */
function composeClass(
  call: MeetingCall,
  kind: Extract<SceneKindVerdict, { kind: 'class' }>,
  planned: readonly string[]
): ComposedMeeting {
  const { called, required } = call
  const { entry, students } = kind
  const outsiders = called.filter((charId) => !students.includes(charId))
  const attendance = resolveAttendance(
    outsiders,
    required !== undefined && !students.includes(required) ? required : undefined,
    planned
  )

  const own: string[] = []
  for (const charId of [...(required !== undefined ? [required] : []), ...called]) {
    if (own.includes(charId)) continue
    if (students.includes(charId) || attendance.cast.includes(charId)) own.push(charId)
  }
  // Off the enrollment, not the room: a student the plan got out of her sickbed takes the class.
  const game = useGameStore.getState()
  const enrolled = studentsOf(entry, game.chars, game.charInfo)
  const sittingIn = own.filter((charId) => !enrolled.includes(charId))

  return {
    cast: [...own, ...students.filter((charId) => !own.includes(charId))],
    notes: [
      ...(sittingIn.length > 0 ? [sittingInNote(sittingIn)] : []),
      ...attendance.notes,
      ...commitmentNotes(own, planned, students)
    ],
    scene: { classCode: entry.code },
    passerby: null,
    people: own
  }
}

/**
 * His shift with company: the people called first, then whoever else is at his workplace —
 * the coworkers on the rota and the locals standing there — up to the stage's slots.
 */
function composeShift(
  call: MeetingCall,
  kind: Extract<SceneKindVerdict, { kind: 'shift' }>,
  planned: readonly string[]
): ComposedMeeting {
  const { called, required } = call
  const { job, def, coworkers } = kind
  // A coworker is at the shift the scene is; a girl at work anywhere else is busy.
  const attendance = resolveAttendance(called, required, [...planned, ...coworkers])
  const locals = def ? localsAtLocation(def.locationId) : []
  const others: string[] = []
  // Whoever the map shows at the workplace is seated first.
  const here = shownFirst([...coworkers, ...locals], def ? shownAt(def.locationId) : [])
  for (const charId of here) {
    if (!attendance.cast.includes(charId) && !others.includes(charId)) others.push(charId)
  }
  // The attendance holds at most a stage's worth, so the cut never reaches the people called.
  const cast = [...attendance.cast, ...others].slice(0, PORTRAIT_SLOTS)
  const joined = cast.filter((charId) => others.includes(charId) && !coworkers.includes(charId))

  const shift = shiftOf(kind)
  return {
    cast,
    notes: [
      ...(shift.note ? [shift.note] : []),
      ...attendance.notes,
      ...commitmentNotes(attendance.cast, planned, coworkers),
      ...cast
        .filter((charId) => coworkers.includes(charId))
        .map((charId) => workingHereNote(charId, job.jobId)),
      ...(joined.length > 0 ? [runIntoNote(joined, def?.locationId)] : [])
    ],
    scene: shift.scene,
    passerby: null,
    people: attendance.cast
  }
}
