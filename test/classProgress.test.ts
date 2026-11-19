import { describe, expect, it } from 'vitest'
import { CLASS_SLOTS, FINAL_DATE } from '@shared/classes'
import { slotFromId } from '@shared/jobs'
import { calendarOf } from '@shared/semesters'
import {
  classMeetingIndexOf,
  examMeetingDateOf,
  firstMeetingAfter,
  meetingDatesOf,
  meetingsBefore
} from '../src/renderer/prompts/occasions'
import {
  examOn,
  handbackDateOf,
  projectAssigned,
  projectPeriodOf,
  skippedFactMeetings,
  workedOn
} from '../src/renderer/prompts/classProgress'
import type { ClassRecord } from '@shared/types'
import { classEntry as entry, peClassEntry } from './fixtures'

const SPRING = calendarOf('spring', [], {})

/**
 * The timetable's meeting calendar: "Week 3" counts meetings held, not weeks elapsed, and
 * every exam date, deadline and score derives from it, so an off-by-one writes a permanent
 * wrong grade.
 */

describe('meetingDatesOf', () => {
  it('lists only the days the class actually meets', () => {
    for (const slot of CLASS_SLOTS) {
      const dates = meetingDatesOf(slot, SPRING)
      const { date: weekday } = slotFromId(slot)
      expect(dates.every((date) => date % 7 === weekday)).toBe(true)
      expect(dates.every((date) => date <= FINAL_DATE)).toBe(true)
      // Strictly ascending, and never repeating a date.
      expect([...dates].sort((a, b) => a - b)).toEqual(dates)
      expect(new Set(dates).size).toBe(dates.length)
    }
  })
})

describe('classMeetingIndexOf', () => {
  it('counts meetings held, not weeks elapsed', () => {
    const dates = meetingDatesOf(0, SPRING)
    // The Monday Day class loses its first two weeks to closures, so its third
    // calendar Monday is still only its first meeting.
    expect(classMeetingIndexOf(0, dates[0], SPRING)).toBe(1)
    expect(classMeetingIndexOf(0, dates[3], SPRING)).toBe(4)
  })
})

describe('the two exam meetings', () => {
  // The whole reason Finals Week runs Monday to Friday: a week that started on
  // the Tuesday would leave both Monday slots with no final at all.
  it('gives every one of the ten slots exactly one midterm and one final', () => {
    for (const slot of CLASS_SLOTS) {
      const midterm = examMeetingDateOf(slot, 'midterm', SPRING)
      const finals = examMeetingDateOf(slot, 'final', SPRING)
      expect(midterm).not.toBeNull()
      expect(finals).not.toBeNull()
      expect(meetingDatesOf(slot, SPRING)).toContain(midterm as number)
      expect(meetingDatesOf(slot, SPRING)).toContain(finals as number)
      expect(midterm as number).toBeLessThan(finals as number)
    }
  })

  it('reports which exam falls on a date, and nothing on an ordinary meeting', () => {
    const course = entry({ slot: 0 })
    expect(examOn(course, examMeetingDateOf(0, 'midterm', SPRING) as number, SPRING)).toBe('midterm')
    expect(examOn(course, examMeetingDateOf(0, 'final', SPRING) as number, SPRING)).toBe('final')
    expect(examOn(course, meetingDatesOf(0, SPRING)[0], SPRING)).toBeNull()
  })

  it('gives a PE class no exams at all', () => {
    const pe = peClassEntry()
    expect(examOn(pe, examMeetingDateOf(0, 'midterm', SPRING) as number, SPRING)).toBeNull()
  })
})

// Each of these is a question the exam answers wrong, so an off-by-one
// here silently writes a wrong grade onto the save.
describe('skippedFactMeetings', () => {
  const course = entry({ slot: 0 })
  const dates = meetingDatesOf(0, SPRING)
  const midterm = examMeetingDateOf(0, 'midterm', SPRING) as number

  it('counts each ditched factoid meeting before the exam', () => {
    const record: ClassRecord = {
      meetings: [
        { date: dates[1], attended: false },
        { date: dates[2], attended: true },
        { date: dates[3], attended: false }
      ]
    }
    expect(skippedFactMeetings(course, midterm, record, SPRING)).toBe(2)
  })

  it('lets week 1 off: the syllabus meeting teaches no factoid', () => {
    const record: ClassRecord = { meetings: [{ date: dates[0], attended: false }] }
    expect(skippedFactMeetings(course, midterm, record, SPRING)).toBe(0)
  })

  it('never counts an exam meeting or a meeting on or past the exam date', () => {
    const final = examMeetingDateOf(0, 'final', SPRING) as number
    const record: ClassRecord = {
      meetings: [
        // The skipped midterm itself: already a flat zero through `present`.
        { date: midterm, attended: false },
        // A skip after the midterm reaches only the final's paper.
        { date: firstMeetingAfter(0, midterm, SPRING) as number, attended: false }
      ]
    }
    expect(skippedFactMeetings(course, midterm, record, SPRING)).toBe(0)
    expect(skippedFactMeetings(course, final, record, SPRING)).toBe(1)
  })
})

describe('projectPeriodOf', () => {
  const project = entry({ kind: 'project', slot: 0 })

  it('runs the first project from the first meeting to the midterm', () => {
    const period = projectPeriodOf(project, 7, SPRING) as NonNullable<
      ReturnType<typeof projectPeriodOf>
    >
    expect(period.exam).toBe('midterm')
    expect(period.assignmentDate).toBe(meetingDatesOf(0, SPRING)[0])
    expect(period.deadlineDate).toBe(examMeetingDateOf(0, 'midterm', SPRING))
    // One session per meeting strictly before the showcase.
    expect(period.needed).toBe(meetingsBefore(0, examMeetingDateOf(0, 'midterm', SPRING) as number, SPRING))
  })

  it('counts the showcase meeting itself as still the first project', () => {
    const midterm = examMeetingDateOf(0, 'midterm', SPRING) as number
    expect(projectPeriodOf(project, midterm, SPRING)?.exam).toBe('midterm')
  })

  it('runs the second project from the handback to the final', () => {
    const after = (handbackDateOf(project, SPRING) as number) + 1
    const period = projectPeriodOf(project, after, SPRING) as NonNullable<
      ReturnType<typeof projectPeriodOf>
    >
    expect(period.exam).toBe('final')
    expect(period.assignmentDate).toBe(handbackDateOf(project, SPRING))
    expect(period.deadlineDate).toBe(examMeetingDateOf(0, 'final', SPRING))
  })

  it('adjusts the requirement by difficulty and never below one', () => {
    for (const slot of CLASS_SLOTS) {
      const medium = projectPeriodOf(entry({ kind: 'project', slot }), 7, SPRING)
      const easy = projectPeriodOf(entry({ kind: 'project', slot, difficulty: 'easy' }), 7, SPRING)
      const hard = projectPeriodOf(entry({ kind: 'project', slot, difficulty: 'hard' }), 7, SPRING)
      expect(easy?.needed).toBe(Math.max(1, (medium as { needed: number }).needed - 1))
      expect(hard?.needed).toBe((medium as { needed: number }).needed + 1)
      expect(easy?.needed).toBeGreaterThanOrEqual(1)
    }
  })
})

describe('projectAssigned', () => {
  const project = entry({ kind: 'project', slot: 0 })
  const period = projectPeriodOf(project, 7, SPRING) as NonNullable<ReturnType<typeof projectPeriodOf>>

  it('is true once the assignment day passed, attended or ditched alike', () => {
    expect(
      projectAssigned({ meetings: [{ date: period.assignmentDate, attended: true }] }, period)
    ).toBe(true)
    expect(
      projectAssigned({ meetings: [{ date: period.assignmentDate, attended: false }] }, period)
    ).toBe(true)
  })

  it('is handed out at the first meeting of a class added after the assignment', () => {
    const later = meetingDatesOf(0, SPRING)[1]
    expect(projectAssigned({ meetings: [{ date: later, attended: false }] }, period)).toBe(true)
  })

  it('ignores meetings before the assignment', () => {
    const midterm = examMeetingDateOf(0, 'midterm', SPRING) as number
    const final = projectPeriodOf(project, midterm + 1, SPRING) as NonNullable<
      ReturnType<typeof projectPeriodOf>
    >
    expect(final.exam).toBe('final')
    const record: ClassRecord = { meetings: [{ date: midterm, attended: true }] }
    expect(projectAssigned(record, final)).toBe(false)
  })
})

describe('workedOn', () => {
  it('counts the sessions banked for that period alone', () => {
    const record: ClassRecord = {
      meetings: [],
      midtermProject: { sessions: [{ date: 8, time: 0 }, { date: 9, time: 0 }] },
      finalProject: { sessions: [{ date: 60, time: 0 }] }
    }
    expect(workedOn(record, 'midterm')).toBe(2)
    expect(workedOn(record, 'final')).toBe(1)
    expect(workedOn(undefined, 'midterm')).toBe(0)
  })
})
