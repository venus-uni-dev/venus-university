import { beforeEach, describe, expect, it } from 'vitest'
import type { ClassEntry } from '@shared/types'
import { settleGrades } from '../src/renderer/stores/loop/academics'
import { useGameStore } from '../src/renderer/stores/gameStore'
import { classEntry } from './fixtures'

/**
 * The two grade writes the slot opening makes. Both are one-shot and a
 * slot opening is replayed off its own save whenever that save is loaded, so a
 * second scroll out of one replayed boundary is the silent kind of wrong.
 */

/** The Monday after Finals Week — `FINALS_WEEK.endDate` is Friday, May 15. */
const FINALS_MONDAY = 119
/** The Saturday the midterm standing can land on. */
const SATURDAY = 61

function enroll(entry: ClassEntry, at: number): void {
  useGameStore.setState({
    classes: { [entry.code]: entry },
    playerSchedule: { [entry.slot]: entry.code },
    classRecords: {},
    date: at,
    time: 0
  })
}

beforeEach(() => {
  useGameStore.getState().reset()
})

describe('settleGrades — the finals scroll', () => {
  it('is spent on the first opening and silent on a replayed one', () => {
    const entry = classEntry()
    enroll(entry, FINALS_MONDAY)
    useGameStore.getState().setClassScore(entry.code, 'final', 88)

    expect(settleGrades().finals.length).toBeGreaterThan(0)
    expect(useGameStore.getState().finalsScoresShown).toBe(true)
    expect(settleGrades().finals).toEqual([])
  })
})

describe('settleGrades — the Saturday standing', () => {
  it('keeps its place at the head of the opening', () => {
    const entry = classEntry()
    enroll(entry, SATURDAY)
    useGameStore.getState().setClassScore(entry.code, 'midterm', 95)

    settleGrades()

    expect(useGameStore.getState().gradesStanding).toBe('good')
  })
})
