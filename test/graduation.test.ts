import { describe, expect, it } from 'vitest'
import { isSummerOutingWeek } from '../src/renderer/prompts/graduation'
import { GRADUATION_DATE, SUMMER_VACATION } from '../src/renderer/prompts/occasions'
import { formatWeekday } from '../src/renderer/prompts/gameDate'

/**
 * The end of the semester: the summer outing window is derived off the
 * occasion table, so an arithmetic slip moves it without anything complaining.
 */

describe('isSummerOutingWeek', () => {
  // The invariant `outingWindowOf` rests on: a per-slot fatigue record and a
  // per-weekend one must never both apply to the same slot.
  it('never covers a weekend', () => {
    for (let date = SUMMER_VACATION.startDate; date <= GRADUATION_DATE; date++) {
      const weekday = formatWeekday(date)
      if (weekday === 'Saturday' || weekday === 'Sunday') {
        expect(isSummerOutingWeek(date)).toBe(false)
      }
    }
  })
})
