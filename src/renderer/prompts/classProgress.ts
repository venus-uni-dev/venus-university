import type { ClassEntry, ClassRecord, Occasion, ProjectSession } from '@shared/types'
import {
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
  occasions: readonly Occasion[]
): ExamPeriod | null {
  if (kindOf(entry) === null) return null
  if (examMeetingDateOf(entry.slot, 'midterm', occasions) === date) return 'midterm'
  if (examMeetingDateOf(entry.slot, 'final', occasions) === date) return 'final'
  return null
}

/** The date this class's `exam` falls on, or null (never null in the fixed calendar). */
export function examDateOf(
  entry: ClassEntry,
  exam: ExamPeriod,
  occasions: readonly Occasion[]
): number | null {
  return examMeetingDateOf(entry.slot, exam, occasions)
}

/**
 * The meeting the midterm comes back at — the first one after it — or null when the midterm
 * is the class's last meeting, which a generated cancellation can produce.
 */
export function handbackDateOf(entry: ClassEntry, occasions: readonly Occasion[]): number | null {
  const midterm = examMeetingDateOf(entry.slot, 'midterm', occasions)
  return midterm === null ? null : firstMeetingAfter(entry.slot, midterm, occasions)
}

/** How many exams the reader is *known* to have aced by `date`. */
export function handedBackAcedCount(
  records: Readonly<Record<string, ClassRecord>>,
  classes: Readonly<Record<string, ClassEntry>>,
  occasions: readonly Occasion[],
  date: number,
  finalsScoresShown: boolean
): number {
  let count = 0
  for (const [code, record] of Object.entries(records)) {
    const entry = classes[code]
    if (entry && record.midtermScore !== undefined && record.midtermScore >= PERFECT_SCORE) {
      const handback = handbackDateOf(entry, occasions)
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
  occasions: readonly Occasion[]
): ProjectPeriod | null {
  if (!isCourse(entry) || entry.kind !== 'project') return null

  const meetings = meetingDatesOf(entry.slot, occasions)
  const midterm = examMeetingDateOf(entry.slot, 'midterm', occasions)
  const finals = examMeetingDateOf(entry.slot, 'final', occasions)
  if (meetings.length === 0 || midterm === null) return null

  const difficulty = entry.difficulty

  // Through the midterm showcase is the first project; the second is set at the handback.
  if (date <= midterm) {
    const assignmentDate = meetings[0]
    const span = meetingsBefore(entry.slot, midterm, occasions)
    return {
      exam: 'midterm',
      assignmentDate,
      deadlineDate: midterm,
      needed: projectWorkNeeded(span, difficulty)
    }
  }

  const assignmentDate = handbackDateOf(entry, occasions)
  if (assignmentDate === null || finals === null) return null
  const span =
    meetingsBefore(entry.slot, finals, occasions) -
    meetingsBefore(entry.slot, assignmentDate, occasions)
  return {
    exam: 'final',
    assignmentDate,
    deadlineDate: finals,
    needed: projectWorkNeeded(span, difficulty)
  }
}

/**
 * Whether `period`'s project has been handed out yet: the assignment meeting has a
 * record, attended or ditched.
 */
export function projectAssigned(record: ClassRecord | undefined, period: ProjectPeriod): boolean {
  return (record ?? EMPTY_RECORD).meetings.some((meeting) => meeting.date === period.assignmentDate)
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
  occasions: readonly Occasion[]
): number {
  return (record ?? EMPTY_RECORD).meetings.filter(
    (meeting) =>
      !meeting.attended &&
      meeting.date < examDate &&
      (classMeetingIndexOf(entry.slot, meeting.date, occasions) ?? 1) > 1 &&
      examOn(entry, meeting.date, occasions) === null
  ).length
}

/** Whether the reader has ever attended this class. */
export function everAttended(record: ClassRecord | undefined): boolean {
  return (record ?? EMPTY_RECORD).meetings.some((meeting) => meeting.attended)
}

/** Whether the reader has put a session into the project since this class last met. */
function workedSinceLastMeeting(
  entry: ClassEntry,
  date: number,
  record: ClassRecord | undefined,
  exam: ExamPeriod,
  occasions: readonly Occasion[]
): boolean {
  const meetings = meetingDatesOf(entry.slot, occasions)
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
  occasions: readonly Occasion[]
): ProjectSceneContext | null {
  const period = projectPeriodOf(entry, date, occasions)
  if (!period) return null
  const sessions = sessionsOf(record, period.exam)
  const last = sessions[sessions.length - 1]
  return {
    ...(last ? { lastSession: last } : {}),
    progress: projectProgress(sessions.length, period.needed)
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
  occasions: readonly Occasion[]
): ClassMeetingRecap[] {
  const meetings = (record ?? EMPTY_RECORD).meetings.filter((meeting) => meeting.date < date)
  if (meetings.length === 0) return []

  const line = (meeting: ClassRecord['meetings'][number]): ClassMeetingRecap => ({
    week: classMeetingIndexOf(entry.slot, meeting.date, occasions) ?? 0,
    attended: meeting.attended,
    summary: meeting.summary,
    factoid: meeting.factoid
  })

  const kind = kindOf(entry)
  const midterm = kind === null ? null : examMeetingDateOf(entry.slot, 'midterm', occasions)
  if (kind === null || midterm === null || date <= midterm) return meetings.map(line)

  // The score is withheld until the handback meeting has happened.
  const handback = handbackDateOf(entry, occasions)
  const score = handback !== null && date >= handback ? record?.midtermScore : undefined
  const sat = meetings.find((meeting) => meeting.date === midterm)

  return [
    {
      week: classMeetingIndexOf(entry.slot, midterm, occasions) ?? 0,
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
  occasions: readonly Occasion[]
): ClassSceneContext | null {
  const index = classMeetingIndexOf(entry.slot, date, occasions)
  if (index === null) return null

  const kind = kindOf(entry)
  const exam = examOn(entry, date, occasions)
  const isHandback = handbackDateOf(entry, occasions) === date

  const period = projectPeriodOf(entry, date, occasions)
  const project = period
    ? {
        worked: workedOn(record, period.exam),
        needed: period.needed,
        progress: projectProgress(workedOn(record, period.exam), period.needed),
        workedThisWeek: workedSinceLastMeeting(entry, date, record, period.exam, occasions)
      }
    : undefined

  return {
    index,
    kind,
    isMidterm: exam === 'midterm',
    isFinals: exam === 'final',
    isHandback,
    recap: recapOf(entry, date, record, occasions),
    ...(project ? { project } : {}),
    // Only the midterm is handed back in a scene; finals land in narration.
    ...(isHandback && typeof record?.midtermScore === 'number'
      ? { handbackScore: record.midtermScore }
      : {})
  }
}
