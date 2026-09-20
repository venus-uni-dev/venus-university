import { describe, expect, it } from 'vitest'
import { CLASS_SLOTS, FINAL_DATE } from '@shared/classes'
import { slotFromId } from '@shared/jobs'
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

/**
 * The timetable's meeting calendar: "Week 3" counts meetings held, not weeks elapsed, and
 * every exam date, deadline and score derives from it, so an off-by-one writes a permanent
 * wrong grade.
 */

describe('meetingDatesOf', () => {
  it('lists only the days the class actually meets', () => {
    for (const slot of CLASS_SLOTS) {
      const dates = meetingDatesOf(slot)
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
    const dates = meetingDatesOf(0)
    // The Monday Day class loses its first two weeks to closures, so its third
    // calendar Monday is still only its first meeting.
    expect(classMeetingIndexOf(0, dates[0])).toBe(1)
    expect(classMeetingIndexOf(0, dates[3])).toBe(4)
  })
})

describe('the two exam meetings', () => {
  // The whole reason Finals Week runs Monday to Friday: a week that started on
  // the Tuesday would leave both Monday slots with no final at all.
  it('gives every one of the ten slots exactly one midterm and one final', () => {
    for (const slot of CLASS_SLOTS) {
      const midterm = examMeetingDateOf(slot, 'midterm')
      const finals = examMeetingDateOf(slot, 'final')
      expect(midterm).not.toBeNull()
      expect(finals).not.toBeNull()
      expect(meetingDatesOf(slot)).toContain(midterm as number)
      expect(meetingDatesOf(slot)).toContain(finals as number)
      expect(midterm as number).toBeLessThan(finals as number)
    }
  })

  it('reports which exam falls on a date, and nothing on an ordinary meeting', () => {
    const course = entry({ slot: 0 })
    expect(examOn(course, examMeetingDateOf(0, 'midterm') as number, [])).toBe('midterm')
    expect(examOn(course, examMeetingDateOf(0, 'final') as number, [])).toBe('final')
    expect(examOn(course, meetingDatesOf(0)[0], [])).toBeNull()
  })

  it('gives a PE class no exams at all', () => {
    const pe = peClassEntry()
    expect(examOn(pe, examMeetingDateOf(0, 'midterm') as number, [])).toBeNull()
  })
})

// Each of these is a question the exam answers wrong, so an off-by-one
// here silently writes a wrong grade onto the save.
describe('skippedFactMeetings', () => {
  const course = entry({ slot: 0 })
  const dates = meetingDatesOf(0)
  const midterm = examMeetingDateOf(0, 'midterm') as number

  it('counts each ditched factoid meeting before the exam', () => {
    const record: ClassRecord = {
      meetings: [
        { date: dates[1], attended: false },
        { date: dates[2], attended: true },
        { date: dates[3], attended: false }
      ]
    }
    expect(skippedFactMeetings(course, midterm, record, [])).toBe(2)
  })

  it('lets week 1 off: the syllabus meeting teaches no factoid', () => {
    const record: ClassRecord = { meetings: [{ date: dates[0], attended: false }] }
    expect(skippedFactMeetings(course, midterm, record, [])).toBe(0)
  })

  it('never counts an exam meeting or a meeting on or past the exam date', () => {
    const final = examMeetingDateOf(0, 'final') as number
    const record: ClassRecord = {
      meetings: [
        // The skipped midterm itself: already a flat zero through `present`.
        { date: midterm, attended: false },
        // A skip after the midterm reaches only the final's paper.
        { date: firstMeetingAfter(0, midterm) as number, attended: false }
      ]
    }
    expect(skippedFactMeetings(course, midterm, record, [])).toBe(0)
    expect(skippedFactMeetings(course, final, record, [])).toBe(1)
  })
})

describe('projectPeriodOf', () => {
  const project = entry({ kind: 'project', slot: 0 })

  it('runs the first project from the first meeting to the midterm', () => {
    const period = projectPeriodOf(project, 7, []) as NonNullable<
      ReturnType<typeof projectPeriodOf>
    >
    expect(period.exam).toBe('midterm')
    expect(period.assignmentDate).toBe(meetingDatesOf(0)[0])
    expect(period.deadlineDate).toBe(examMeetingDateOf(0, 'midterm'))
    // One session per meeting strictly before the showcase.
    expect(period.needed).toBe(meetingsBefore(0, examMeetingDateOf(0, 'midterm') as number))
  })

  it('counts the showcase meeting itself as still the first project', () => {
    const midterm = examMeetingDateOf(0, 'midterm') as number
    expect(projectPeriodOf(project, midterm, [])?.exam).toBe('midterm')
  })

  it('runs the second project from the handback to the final', () => {
    const after = (handbackDateOf(project, []) as number) + 1
    const period = projectPeriodOf(project, after, []) as NonNullable<
      ReturnType<typeof projectPeriodOf>
    >
    expect(period.exam).toBe('final')
    expect(period.assignmentDate).toBe(handbackDateOf(project, []))
    expect(period.deadlineDate).toBe(examMeetingDateOf(0, 'final'))
  })

  it('adjusts the requirement by difficulty and never below one', () => {
    for (const slot of CLASS_SLOTS) {
      const medium = projectPeriodOf(entry({ kind: 'project', slot }), 7, [])
      const easy = projectPeriodOf(entry({ kind: 'project', slot, difficulty: 'easy' }), 7, [])
      const hard = projectPeriodOf(entry({ kind: 'project', slot, difficulty: 'hard' }), 7, [])
      expect(easy?.needed).toBe(Math.max(1, (medium as { needed: number }).needed - 1))
      expect(hard?.needed).toBe((medium as { needed: number }).needed + 1)
      expect(easy?.needed).toBeGreaterThanOrEqual(1)
    }
  })
})

describe('projectAssigned', () => {
  const project = entry({ kind: 'project', slot: 0 })
  const period = projectPeriodOf(project, 7, []) as NonNullable<ReturnType<typeof projectPeriodOf>>

  it('is true once the assignment day passed, attended or ditched alike', () => {
    expect(
      projectAssigned({ meetings: [{ date: period.assignmentDate, attended: true }] }, period)
    ).toBe(true)
    expect(
      projectAssigned({ meetings: [{ date: period.assignmentDate, attended: false }] }, period)
    ).toBe(true)
  })

  it('ignores records of other meetings', () => {
    const later = meetingDatesOf(0)[1]
    expect(projectAssigned({ meetings: [{ date: later, attended: true }] }, period)).toBe(false)
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
