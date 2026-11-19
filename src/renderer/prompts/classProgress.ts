import type {
  AddedClass,
  Character,
  CharInfo,
  ClassEntry,
  ClassRecord,
  CourseEntry,
  ProjectSession
} from '@shared/types'
import { studentsOf } from '@shared/classes'
import { globalSlotOf, slotFromId } from '@shared/jobs'
import type { SemesterCalendar } from '@shared/semesters'
import {
  aceShortfall,
  isCourse,
  kindOf,
  midtermRecapSummary,
  PERFECT_SCORE,
  projectProgress,
  projectWorkNeeded,
  type ExamPeriod
} from '@shared/academics'
import {
  classMeetingIndexOf,
  examMeetingDateOf,
  firstMeetingAfter,
  meetingDatesOf,
  meetingsBefore
} from './occasions'
import type { Classmate, ClassRoster } from './lorebook'
import type { ClassMeetingRecap, ClassSceneContext, ProjectSceneContext } from './scenePrompt'

/**
 * Where one course stands on one day — the bridge between the meeting calendar in
 * `occasions.ts` and the arithmetic in `shared/academics.ts`.
 */

/** An empty record, so a class the reader has never done anything in still answers. */
const EMPTY_RECORD: ClassRecord = { meetings: [] }

/** Which assessment falls on `date` for this class, or null on an ordinary meeting. */
export function examOn(
  entry: ClassEntry,
  date: number,
  calendar: SemesterCalendar
): ExamPeriod | null {
  if (kindOf(entry) === null) return null
  if (examMeetingDateOf(entry.slot, 'midterm', calendar) === date) return 'midterm'
  if (examMeetingDateOf(entry.slot, 'final', calendar) === date) return 'final'
  return null
}

/** The date this class's `exam` falls on, or null (never null in the fixed calendar). */
export function examDateOf(
  entry: ClassEntry,
  exam: ExamPeriod,
  calendar: SemesterCalendar
): number | null {
  return examMeetingDateOf(entry.slot, exam, calendar)
}

/**
 * The meeting the midterm comes back at — the first one after it — or null when the midterm
 * is the class's last meeting, which a generated cancellation can produce.
 */
export function handbackDateOf(entry: ClassEntry, calendar: SemesterCalendar): number | null {
  const midterm = examMeetingDateOf(entry.slot, 'midterm', calendar)
  return midterm === null ? null : firstMeetingAfter(entry.slot, midterm, calendar)
}

/** How many exams the reader is *known* to have aced by `date`. */
export function handedBackAcedCount(
  records: Readonly<Record<string, ClassRecord>>,
  classes: Readonly<Record<string, ClassEntry>>,
  calendar: SemesterCalendar,
  date: number,
  finalsScoresShown: boolean
): number {
  let count = 0
  for (const [code, record] of Object.entries(records)) {
    const entry = classes[code]
    if (entry && record.midtermScore !== undefined && record.midtermScore >= PERFECT_SCORE) {
      const handback = handbackDateOf(entry, calendar)
      if (handback !== null && date >= handback) count += 1
    }
    if (finalsScoresShown && record.finalScore !== undefined && record.finalScore >= PERFECT_SCORE) {
      count += 1
    }
  }
  return count
}

/** One project's window: when it was set, when it is shown, and how much work it takes. */
export interface ProjectPeriod {
  exam: ExamPeriod
  /** The meeting it was assigned at. */
  assignmentDate: number
  /** The meeting it is presented at. */
  deadlineDate: number
  /** Sessions needed to finish it. */
  needed: number
}

/** The project a project class is building on `date`. */
export function projectPeriodOf(
  entry: ClassEntry,
  date: number,
  calendar: SemesterCalendar
): ProjectPeriod | null {
  if (!isCourse(entry) || entry.kind !== 'project') return null

  const meetings = meetingDatesOf(entry.slot, calendar)
  const midterm = examMeetingDateOf(entry.slot, 'midterm', calendar)
  const finals = examMeetingDateOf(entry.slot, 'final', calendar)
  if (meetings.length === 0 || midterm === null) return null

  const difficulty = entry.difficulty

  // Through the midterm showcase is the first project; the second is set at the handback.
  if (date <= midterm) {
    const assignmentDate = meetings[0]
    const span = meetingsBefore(entry.slot, midterm, calendar)
    return {
      exam: 'midterm',
      assignmentDate,
      deadlineDate: midterm,
      needed: projectWorkNeeded(span, difficulty)
    }
  }

  const assignmentDate = handbackDateOf(entry, calendar)
  if (assignmentDate === null || finals === null) return null
  const span =
    meetingsBefore(entry.slot, finals, calendar) -
    meetingsBefore(entry.slot, assignmentDate, calendar)
  return {
    exam: 'final',
    assignmentDate,
    deadlineDate: finals,
    needed: projectWorkNeeded(span, difficulty)
  }
}

/**
 * Whether `period`'s project has been handed out yet: a meeting from the assignment on has a
 * record, attended or ditched. Every meeting on the timetable gets one, so that is the assignment
 * meeting itself, or the first one after it for a class added once it had met.
 */
export function projectAssigned(record: ClassRecord | undefined, period: ProjectPeriod): boolean {
  return (record ?? EMPTY_RECORD).meetings.some((meeting) => meeting.date >= period.assignmentDate)
}

/**
 * Whether a class added at add/drop is still owed its entrance: added after the course had
 * already met, and the room has not met him yet.
 */
export function addOwesEntrance(
  entry: ClassEntry,
  added: AddedClass | undefined,
  calendar: SemesterCalendar
): boolean {
  if (!added || added.announced) return false
  // Meetings held, not dates on the timetable: a first Monday cancelled by orientation is a
  // class that has not met.
  return meetingsBefore(entry.slot, added.date, calendar) > 0
}

/**
 * Whether `date` is a transfer student's first meeting of this class since she arrived in the
 * global slot `transferredAt`, the class having already met before it.
 */
export function transferOwesEntrance(
  entry: ClassEntry,
  transferredAt: number,
  date: number,
  calendar: SemesterCalendar
): boolean {
  const { time } = slotFromId(entry.slot)
  // A meeting in her arrival slot is her first; one earlier that day is before she arrived.
  const first = meetingDatesOf(entry.slot, calendar).find(
    (meeting) => globalSlotOf(meeting, time) >= transferredAt
  )
  return first === date && meetingsBefore(entry.slot, date, calendar) > 0
}

/** The sessions banked against one of the two projects, oldest first. */
function sessionsOf(
  record: ClassRecord | undefined,
  exam: ExamPeriod
): readonly ProjectSession[] {
  const project = exam === 'midterm' ? record?.midtermProject : record?.finalProject
  return project?.sessions ?? []
}

/** How many sessions have gone into `period`'s project so far. */
export function workedOn(record: ClassRecord | undefined, exam: ExamPeriod): number {
  return sessionsOf(record, exam).length
}

/**
 * How many factoid-bearing meetings the reader ditched before `examDate` — each one a question
 * his exam answers wrong.
 */
export function skippedFactMeetings(
  entry: ClassEntry,
  examDate: number,
  record: ClassRecord | undefined,
  calendar: SemesterCalendar
): number {
  return (record ?? EMPTY_RECORD).meetings.filter(
    (meeting) =>
      !meeting.attended &&
      meeting.date < examDate &&
      (classMeetingIndexOf(entry.slot, meeting.date, calendar) ?? 1) > 1 &&
      examOn(entry, meeting.date, calendar) === null
  ).length
}

/** Whether the reader has ever attended this class. */
export function everAttended(record: ClassRecord | undefined): boolean {
  return (record ?? EMPTY_RECORD).meetings.some((meeting) => meeting.attended)
}

/**
 * The classmates the reader knows sit in `entry`, in `chars` order: introduced, and seen there
 * by attending it or told by her Bunnyboard profile.
 */
export function knownClassmatesOf(
  entry: ClassEntry,
  chars: readonly string[],
  charInfo: Readonly<Record<string, CharInfo>>,
  record: ClassRecord | undefined
): string[] {
  const attended = everAttended(record)
  return studentsOf(entry, chars, charInfo).filter(
    (charId) =>
      charInfo[charId]?.nameKnown === true &&
      (attended || charInfo[charId]?.flags?.gaveContactInfo === true)
  )
}

/**
 * Who sits in each class of the catalog, by class code: every roster girl enrolled, and those
 * {@link knownClassmatesOf} says the reader knows are there, each sorted by first name. A class
 * nobody on the roster takes is absent.
 */
export function classRostersOf(
  classes: Readonly<Record<string, ClassEntry>>,
  chars: readonly string[],
  characters: Readonly<Record<string, Pick<Character, 'firstName'>>>,
  charInfo: Readonly<Record<string, CharInfo>>,
  classRecords: Readonly<Record<string, ClassRecord>>
): Record<string, ClassRoster> {
  const named = (charIds: readonly string[]): Classmate[] =>
    charIds
      .flatMap((charId) => {
        const character = characters[charId]
        return character ? [{ charId, firstName: character.firstName }] : []
      })
      .sort((a, b) => (a.firstName < b.firstName ? -1 : a.firstName > b.firstName ? 1 : 0))
  const rosters: Record<string, ClassRoster> = {}
  for (const entry of Object.values(classes)) {
    const enrolled = studentsOf(entry, chars, charInfo)
    if (enrolled.length === 0) continue
    rosters[entry.code] = {
      enrolled: named(enrolled),
      known: named(knownClassmatesOf(entry, chars, charInfo, classRecords[entry.code]))
    }
  }
  return rosters
}

/** Whether the reader has put a session into the project since this class last met. */
function workedSinceLastMeeting(
  entry: ClassEntry,
  date: number,
  record: ClassRecord | undefined,
  exam: ExamPeriod,
  calendar: SemesterCalendar
): boolean {
  const meetings = meetingDatesOf(entry.slot, calendar)
  const previous = [...meetings].reverse().find((meeting) => meeting < date) ?? -1
  return sessionsOf(record, exam).some(
    (session) => session.date > previous && session.date <= date
  )
}

/**
 * Where the project a work session is being spent on stands — the `project:` scene's
 * counterpart to {@link classSceneContextOf}, and null when the course is not a project class.
 */
export function projectSceneContextOf(
  entry: ClassEntry,
  date: number,
  record: ClassRecord | undefined,
  calendar: SemesterCalendar
): ProjectSceneContext | null {
  const period = projectPeriodOf(entry, date, calendar)
  if (!period) return null
  const sessions = sessionsOf(record, period.exam)
  const last = sessions[sessions.length - 1]
  return {
    ...(last ? { lastSession: last } : {}),
    progress: projectProgress(sessions.length, period.needed)
  }
}

/**
 * Where one of the reader's courses stands for Venus's grade check, never giving a score away:
 * a lecture by the exam he sits next, a project by the one he is building now.
 */
export type CourseStanding =
  | { kind: 'lecture'; exam: ExamPeriod; shortfall: number }
  | { kind: 'project'; worked: number; needed: number; lastSession?: ProjectSession }
  | { kind: 'lecture-done' }
  | { kind: 'project-done' }
  | { kind: 'project-unassigned' }

/** A course's {@link CourseStanding} on `date`, read against the reader's Brain points. */
export function courseStandingOf(
  entry: CourseEntry,
  date: number,
  record: ClassRecord | undefined,
  brain: number,
  calendar: SemesterCalendar
): CourseStanding {
  // A frozen score is a paper sat, so the next one is whichever has none yet.
  const next: ExamPeriod | null =
    typeof record?.midtermScore !== 'number'
      ? 'midterm'
      : typeof record?.finalScore !== 'number'
        ? 'final'
        : null

  if (entry.kind === 'lecture') {
    return next === null
      ? { kind: 'lecture-done' }
      : { kind: 'lecture', exam: next, shortfall: aceShortfall(brain, entry.difficulty, next) }
  }

  if (next === null) return { kind: 'project-done' }
  const period = projectPeriodOf(entry, date, calendar)
  // The showcase's own day still reads as the project it just presented, whose score is in.
  if (!period || period.exam !== next || !projectAssigned(record, period)) {
    return { kind: 'project-unassigned' }
  }
  const sessions = sessionsOf(record, period.exam)
  const last = sessions[sessions.length - 1]
  return {
    kind: 'project',
    worked: sessions.length,
    needed: period.needed,
    ...(last ? { lastSession: last } : {})
  }
}

/**
 * The week-by-week recap of everything that has already happened in this course. **Past the
 * midterm it opens on the midterm and drops everything before it**.
 */
export function recapOf(
  entry: ClassEntry,
  date: number,
  record: ClassRecord | undefined,
  calendar: SemesterCalendar
): ClassMeetingRecap[] {
  const meetings = (record ?? EMPTY_RECORD).meetings.filter((meeting) => meeting.date < date)
  if (meetings.length === 0) return []

  const line = (meeting: ClassRecord['meetings'][number]): ClassMeetingRecap => ({
    week: classMeetingIndexOf(entry.slot, meeting.date, calendar) ?? 0,
    attended: meeting.attended,
    summary: meeting.summary,
    factoid: meeting.factoid,
    ...(meeting.cancelled ? { cancelled: true } : {})
  })

  const kind = kindOf(entry)
  const midterm = kind === null ? null : examMeetingDateOf(entry.slot, 'midterm', calendar)
  if (kind === null || midterm === null || date <= midterm) return meetings.map(line)

  // The score is withheld until the handback meeting has happened.
  const handback = handbackDateOf(entry, calendar)
  const score = handback !== null && date >= handback ? record?.midtermScore : undefined
  const sat = meetings.find((meeting) => meeting.date === midterm)

  return [
    {
      week: classMeetingIndexOf(entry.slot, midterm, calendar) ?? 0,
      attended: true,
      summary: midtermRecapSummary(kind, sat?.attended === true, score)
    },
    ...meetings.filter((meeting) => meeting.date > midterm).map(line)
  ]
}

/**
 * The whole `CLASS` block context for the meeting on `date`, or null when the class
 * does not meet then.
 */
export function classSceneContextOf(
  entry: ClassEntry,
  date: number,
  record: ClassRecord | undefined,
  calendar: SemesterCalendar
): ClassSceneContext | null {
  const index = classMeetingIndexOf(entry.slot, date, calendar)
  if (index === null) return null

  const kind = kindOf(entry)
  const exam = examOn(entry, date, calendar)
  const isHandback = handbackDateOf(entry, calendar) === date

  const period = projectPeriodOf(entry, date, calendar)
  const project = period
    ? {
        worked: workedOn(record, period.exam),
        needed: period.needed,
        progress: projectProgress(workedOn(record, period.exam), period.needed),
        workedThisWeek: workedSinceLastMeeting(entry, date, record, period.exam, calendar)
      }
    : undefined

  return {
    index,
    kind,
    isMidterm: exam === 'midterm',
    isFinals: exam === 'final',
    isHandback,
    recap: recapOf(entry, date, record, calendar),
    ...(project ? { project } : {}),
    // Only the midterm is handed back in a scene; finals land in narration.
    ...(isHandback && typeof record?.midtermScore === 'number'
      ? { handbackScore: record.midtermScore }
      : {})
  }
}
