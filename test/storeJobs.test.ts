import { describe, expect, it } from 'vitest'
import {
  bossChatIdOf,
  globalSlotOf,
  jobDefOf,
  MAX_STRIKES,
  newJobState,
  shiftSlotOf,
  SHIFT_CHANGE_SLOT
} from '@shared/jobs'
import { slotOf } from '@shared/classes'
import type { JobState, Occasion, TimeSlot } from '@shared/types'
import { meetingDatesOf } from '../src/renderer/prompts/occasions'
import {
  playerProjectClasses,
  projectsNeedingWork,
  resolveProject,
  settleShifts
} from '../src/renderer/stores/loop/jobs'
import { shiftNow } from '../src/renderer/stores/timetable'
import { useGameStore } from '../src/renderer/stores/gameStore'
import { classEntry, peClassEntry } from './fixtures'

/**
 * The store half of the shift sweep: the strikes it banks, the boss texts it sends, the roster
 * change it applies and the closure notice. The slot-save is written before the sweep runs, so
 * a reload re-enters the same range, and a second strike, text or swap must stay silent.
 */

/** Day 0 is a Monday, so these are the weekday and weekend anchors the week rides on. */
const MONDAY = 35
const SUNDAY = 41
const MONDAY_DAY_SHIFT = shiftSlotOf(0, 0)

/** Puts the clock on a slot with a job already in force, sweeping from `from`. */
function seed(date: number, time: TimeSlot, job: JobState, occasions: Occasion[] = []): void {
  useGameStore.getState().reset()
  useGameStore.setState({ date, time, job, occasions })
}

/** A closure spanning `startDate`–`endDate`, of the kind that shuts the university. */
function closure(startDate: number, endDate: number): Occasion {
  return {
    id: 'storm',
    title: 'Winter storm',
    description: 'Campus is shut.',
    startDate,
    endDate,
    time: null,
    cancelsClasses: true,
    kind: 'academic'
  }
}

/** Everything the boss has said this playthrough. */
function bossTexts(jobId: string): string[] {
  const conversation = useGameStore.getState().bunnyboard.conversations[bossChatIdOf(jobId)]
  return (conversation?.messages ?? []).map((message) => message.text)
}

/** The live job, which the sweep may have ended. */
function job(): JobState | null {
  return useGameStore.getState().job
}

describe('shiftNow', () => {
  it('answers the slot the reader is rostered for, and null everywhere else', () => {
    seed(MONDAY, 0, newJobState('fast_eats', [MONDAY_DAY_SHIFT], 0))
    expect(shiftNow()).toBe(MONDAY_DAY_SHIFT)
    expect(shiftNow(MONDAY, 1)).toBeNull()
    // Weekends are rostered like any other half-day: a job is not a timetable.
    expect(shiftNow(SUNDAY, 0)).toBeNull()
  })

  it('cancels the shift outright while the employer is closed with the university', () => {
    // Answering null here is the whole cancellation: the work action refuses, the
    // slot row stops offering the shift, and the sweep judges it no absence.
    seed(MONDAY, 0, newJobState('kendall_library', [MONDAY_DAY_SHIFT], 0), [
      closure(MONDAY, MONDAY + 4)
    ])
    expect(shiftNow()).toBeNull()

    // The same closure costs an employer that keeps the city's calendar nothing.
    seed(MONDAY, 0, newJobState('fast_eats', [MONDAY_DAY_SHIFT], 0), [closure(MONDAY, MONDAY + 4)])
    expect(shiftNow()).toBe(MONDAY_DAY_SHIFT)
  })
})

describe('resolveProject', () => {
  const SLOT = slotOf(0, 0)

  /** Enrolls one project class, with its assignment meeting held or not. */
  function enrollProject(met: boolean): void {
    useGameStore.getState().reset()
    useGameStore.setState({
      date: MONDAY,
      time: 0,
      classes: { 'ART 110': classEntry({ code: 'ART 110', slot: SLOT, kind: 'project' }) },
      playerSchedule: { [SLOT]: 'ART 110' },
      ...(met
        ? {
            classRecords: {
              'ART 110': { meetings: [{ date: meetingDatesOf(SLOT)[0], attended: true }] }
            }
          }
        : {})
    })
  }

  it('refuses a named class whose project has not been handed out yet', () => {
    // A distinct answer from null: "you have no project" would be a lie.
    enrollProject(false)
    expect(resolveProject('ART 110')).toBe('unassigned')
  })

  it('lets the app pick only among projects already assigned', () => {
    enrollProject(false)
    expect(resolveProject('')).toBeNull()
  })

  it('resolves a handed-out project by name and by blank code alike', () => {
    enrollProject(true)
    expect(resolveProject('ART 110')).toEqual({ code: 'ART 110', exam: 'midterm' })
    expect(resolveProject('')).toEqual({ code: 'ART 110', exam: 'midterm' })
  })

  it('leaves lectures and PE off that list', () => {
    useGameStore.getState().reset()
    useGameStore.setState({
      date: MONDAY,
      time: 0,
      classes: {
        'ART 110': classEntry({ code: 'ART 110', slot: SLOT, kind: 'project' }),
        'BIO 210': classEntry({ code: 'BIO 210', slot: slotOf(1, 0), kind: 'lecture' }),
        'PE 100': peClassEntry({ code: 'PE 100', slot: slotOf(2, 0) })
      },
      playerSchedule: { [SLOT]: 'ART 110', [slotOf(1, 0)]: 'BIO 210', [slotOf(2, 0)]: 'PE 100' }
    })
    expect(playerProjectClasses().map((entry) => entry.code)).toEqual(['ART 110'])
  })
})

describe('projectsNeedingWork', () => {
  const SLOT = slotOf(0, 0)
  const OTHER_SLOT = slotOf(1, 0)

  /** Both project classes enrolled, both assignment meetings held. */
  function enrollTwo(): void {
    useGameStore.getState().reset()
    useGameStore.setState({
      date: MONDAY,
      time: 0,
      classes: {
        'ART 110': classEntry({ code: 'ART 110', slot: SLOT, kind: 'project' }),
        'CWR 305': classEntry({ code: 'CWR 305', slot: OTHER_SLOT, kind: 'project' })
      },
      playerSchedule: { [SLOT]: 'ART 110', [OTHER_SLOT]: 'CWR 305' },
      classRecords: {
        'ART 110': { meetings: [{ date: meetingDatesOf(SLOT)[0], attended: true }] },
        'CWR 305': { meetings: [{ date: meetingDatesOf(OTHER_SLOT)[0], attended: true }] }
      }
    })
  }

  it('offers every unfinished project, one entry each', () => {
    enrollTwo()
    expect(projectsNeedingWork().map((project) => project.code)).toEqual(['ART 110', 'CWR 305'])
  })

  it('drops one whose assignment meeting has not happened yet', () => {
    enrollTwo()
    const game = useGameStore.getState()
    useGameStore.setState({ classRecords: { 'ART 110': game.classRecords['ART 110'] } })
    expect(projectsNeedingWork().map((project) => project.code)).toEqual(['ART 110'])
  })
})

describe('settleShifts', () => {
  it('banks a strike, texts the boss about it, and advances the mark', () => {
    seed(
      MONDAY + 7,
      0,
      newJobState('fast_eats', [MONDAY_DAY_SHIFT], globalSlotOf(MONDAY, 0) - 1)
    )
    settleShifts()

    expect(job()).toMatchObject({ strikes: 1, streak: 0 })
    expect(job()?.settledThrough).toBe(globalSlotOf(MONDAY + 7, 0) - 1)
    expect(bossTexts('fast_eats')).toEqual([jobDefOf('fast_eats')!.messages.missed])
  })

  it('is inert on a replay, which is what a reloaded boundary re-enters', () => {
    seed(
      MONDAY + 7,
      0,
      newJobState('fast_eats', [MONDAY_DAY_SHIFT], globalSlotOf(MONDAY, 0) - 1)
    )
    settleShifts()
    settleShifts()

    expect(job()?.strikes).toBe(1)
    expect(bossTexts('fast_eats')).toHaveLength(1)
  })

  it('ends the job on the last strike and closes that employer for good', () => {
    seed(
      MONDAY + 7,
      0,
      newJobState('fast_eats', [MONDAY_DAY_SHIFT], globalSlotOf(MONDAY, 0) - 1)
    )
    useGameStore.getState().updateJob({ strikes: MAX_STRIKES - 1 })
    settleShifts()

    expect(job()).toBeNull()
    expect(useGameStore.getState().jobsClosed).toContain('fast_eats')
    expect(bossTexts('fast_eats')).toEqual([jobDefOf('fast_eats')!.messages.fired])
  })

  it('spends the sick note it used, whether or not it saved a strike', () => {
    seed(MONDAY + 7, 0, {
      ...newJobState('fast_eats', [MONDAY_DAY_SHIFT], globalSlotOf(MONDAY, 0) - 1),
      excusedSlot: globalSlotOf(MONDAY, 0),
      sickUsed: true
    })
    settleShifts()

    expect(job()?.strikes).toBe(0)
    expect(job()?.excusedSlot).toBeUndefined()
    expect(bossTexts('fast_eats')).toEqual([])
  })

  it('strikes nothing for the slots a closure took off him', () => {
    seed(
      MONDAY + 1,
      0,
      newJobState('kendall_library', [MONDAY_DAY_SHIFT], globalSlotOf(MONDAY, 0) - 1),
      [closure(MONDAY, MONDAY + 4)]
    )
    settleShifts()

    expect(job()?.strikes).toBe(0)
    expect(job()?.settledThrough).toBe(globalSlotOf(MONDAY + 1, 0) - 1)
  })
})

describe('the closure notice', () => {
  it('texts him once when a closure takes shifts off him, and marks it settled', () => {
    seed(MONDAY, 0, newJobState('kendall_library', [MONDAY_DAY_SHIFT], globalSlotOf(MONDAY, 0)), [
      closure(MONDAY, MONDAY + 4)
    ])
    settleShifts()

    expect(job()?.holidayNoticeDate).toBe(MONDAY)
    expect(bossTexts('kendall_library')).toEqual([jobDefOf('kendall_library')!.messages.holiday])
  })

  it('is one message for the whole closure, not one per slot inside it', () => {
    // A week-long break is one text, and a reload inside it cannot repeat it.
    seed(MONDAY, 0, newJobState('kendall_library', [MONDAY_DAY_SHIFT], globalSlotOf(MONDAY, 0)), [
      closure(MONDAY, MONDAY + 4)
    ])
    settleShifts()
    useGameStore.setState({ date: MONDAY + 1 })
    settleShifts()
    settleShifts()

    expect(bossTexts('kendall_library')).toHaveLength(1)
  })

  it('stays quiet about a closure that cost him nothing, and still settles it', () => {
    // A boss who writes to cancel a shift the reader was never rostered for is a
    // boss announcing the calendar.
    seed(
      MONDAY,
      0,
      newJobState('kendall_library', [shiftSlotOf(4, 1)], globalSlotOf(MONDAY, 0)),
      [closure(MONDAY, MONDAY)]
    )
    settleShifts()

    expect(job()?.holidayNoticeDate).toBe(MONDAY)
    expect(bossTexts('kendall_library')).toEqual([])
  })

  it('says nothing for an employer that keeps the city’s calendar', () => {
    seed(MONDAY, 0, newJobState('fast_eats', [MONDAY_DAY_SHIFT], globalSlotOf(MONDAY, 0)), [
      closure(MONDAY, MONDAY + 4)
    ])
    settleShifts()

    expect(job()?.holidayNoticeDate).toBeUndefined()
    expect(bossTexts('fast_eats')).toEqual([])
  })
})

describe('the roster change', () => {
  it('acknowledges a request at the next boundary, once', () => {
    seed(MONDAY, 1, {
      ...newJobState('fast_eats', [MONDAY_DAY_SHIFT], globalSlotOf(MONDAY, 1)),
      pendingShifts: [shiftSlotOf(2, 1)]
    })
    settleShifts()
    settleShifts()

    expect(job()).toMatchObject({ shiftChangeApproved: true, shifts: [MONDAY_DAY_SHIFT] })
    expect(bossTexts('fast_eats')).toEqual([jobDefOf('fast_eats')!.messages.shiftApproved])
  })

  it('swaps the roster on Sunday Day and nowhere else', () => {
    // The player always knows when a change lands: it takes effect on the next
    // Sunday morning, whichever boundary the request was made at.
    expect(shiftSlotOf(6, 0)).toBe(SHIFT_CHANGE_SLOT)
    seed(SUNDAY, 0, {
      ...newJobState('fast_eats', [MONDAY_DAY_SHIFT], globalSlotOf(SUNDAY, 0)),
      pendingShifts: [shiftSlotOf(3, 1), shiftSlotOf(1, 0)],
      shiftChangeApproved: true
    })
    settleShifts()

    // Sorted, so the grid and the calendar read the roster the same way.
    expect(job()?.shifts).toEqual([shiftSlotOf(1, 0), shiftSlotOf(3, 1)])
    expect(job()?.pendingShifts).toBeUndefined()
    expect(job()?.shiftChangeApproved).toBeUndefined()
    expect(bossTexts('fast_eats')).toEqual([jobDefOf('fast_eats')!.messages.shiftChange])
  })

  it('does not swap a roster onto a job the same sweep just ended', () => {
    // The firing returns before the change is judged: there is no roster left to
    // apply it to, and a boss who fires him and then confirms his new Tuesdays
    // is the kind of thing only a replayed save would show.
    seed(MONDAY + 7, 0, {
      ...newJobState('fast_eats', [MONDAY_DAY_SHIFT], globalSlotOf(MONDAY, 0) - 1),
      strikes: MAX_STRIKES - 1,
      pendingShifts: [shiftSlotOf(2, 1)]
    })
    settleShifts()

    expect(job()).toBeNull()
    expect(bossTexts('fast_eats')).toEqual([jobDefOf('fast_eats')!.messages.fired])
  })
})
