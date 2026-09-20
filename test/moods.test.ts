import { describe, expect, it } from 'vitest'
import {
  isMoodHomebound,
  isMoodLustful,
  MOOD_CYCLE_LENGTH,
  moodIndexOf
} from '../src/renderer/prompts/moods'

/**
 * The mood table is a hand-written thirty-day list every character is indexed
 * into by a date and an offset, so a bad wrap is wrong silently.
 */

describe('moodIndexOf', () => {
  it('stays in range for a date before the offset', () => {
    // Floored modulo: a plain % would index backwards off the array.
    expect(moodIndexOf(-1, 0)).toBe(29)
    expect(moodIndexOf(-40, 0)).toBe(20)
  })
})

describe('isMoodHomebound', () => {
  it('keeps her in for the first three days of the cycle and the last one', () => {
    for (const index of [0, 1, 2, MOOD_CYCLE_LENGTH - 1]) {
      expect(isMoodHomebound(index, 0)).toBe(true)
    }
  })

  it('lets her out on the days either side of those', () => {
    expect(isMoodHomebound(3, 0)).toBe(false)
    expect(isMoodHomebound(MOOD_CYCLE_LENGTH - 2, 0)).toBe(false)
  })

  it('reads the offset the same way the line does', () => {
    // Offset 7 puts date 23 on index 0, the worst day of the cycle.
    expect(moodIndexOf(23, 7)).toBe(0)
    expect(isMoodHomebound(23, 7)).toBe(true)
    expect(isMoodHomebound(23, 0)).toBe(false)
  })
})

describe('isMoodLustful', () => {
  it('holds for the normal column\'s two days and stops just outside them', () => {
    expect(isMoodLustful(13, 0, false)).toBe(true)
    expect(isMoodLustful(14, 0, false)).toBe(true)
    expect(isMoodLustful(12, 0, false)).toBe(false)
    expect(isMoodLustful(15, 0, false)).toBe(false)
  })

  it('holds for the wider moodSwings run and stops just outside it', () => {
    expect(isMoodLustful(12, 0, true)).toBe(true)
    expect(isMoodLustful(15, 0, true)).toBe(true)
    expect(isMoodLustful(11, 0, true)).toBe(false)
    expect(isMoodLustful(16, 0, true)).toBe(false)
  })

  it('reads the offset the same way moodIndexOf does', () => {
    // Offset 7 puts date 6 on index 13, the first lustful day.
    expect(moodIndexOf(6, 7)).toBe(13)
    expect(isMoodLustful(6, 7, false)).toBe(true)
    expect(isMoodLustful(6, 0, false)).toBe(false)
  })
})
