import { describe, expect, it } from 'vitest'
import { MAX_PLAYER_CLASSES, MIN_PLAYER_COURSES, scheduleComplaint } from '@shared/classes'
import type { ClassEntry, ClassSlot } from '@shared/types'
import { classEntry, peClassEntry } from './fixtures'

/**
 * The rule the two schedule screens share: the only gate between Finalize and a
 * timetable written into the save for the semester.
 */

const CATALOG: Record<string, ClassEntry> = {}
for (let i = 0; i < 8; i++) {
  CATALOG[`BIO ${210 + i}`] = classEntry({ code: `BIO ${210 + i}`, slot: i as ClassSlot })
}
CATALOG['SWIM 102'] = peClassEntry({ code: 'SWIM 102', slot: 8 })

/** A schedule of `n` classes out of the catalog, none of them its PE class. */
function pick(n: number): Record<number, string> {
  const codes = Object.keys(CATALOG).filter((code) => code !== 'SWIM 102')
  const schedule: Record<number, string> = {}
  for (let i = 0; i < n; i++) schedule[i] = codes[i]
  return schedule
}

describe('scheduleComplaint', () => {
  it('complains when nothing picked is PE', () => {
    // A null here is what lets Finalize commit a PE-less timetable into the save.
    for (let n = MIN_PLAYER_COURSES; n <= MAX_PLAYER_CLASSES; n++) {
      expect(scheduleComplaint(pick(n), CATALOG)).not.toBeNull()
    }
  })

  it('does not count PE toward the non-PE minimum', () => {
    const short = { ...pick(MIN_PLAYER_COURSES - 1), 8: 'SWIM 102' }
    expect(scheduleComplaint(short, CATALOG)).not.toBeNull()

    const enough = { ...pick(MIN_PLAYER_COURSES), 8: 'SWIM 102' }
    expect(scheduleComplaint(enough, CATALOG)).toBeNull()
  })

  /**
   * One message is shown at a time and the order is the whole of which one, so a schedule
   * short of everything has to say the same thing a PE-less full one says. Compared against
   * that message rather than against its words: the wording is not what this defends.
   */
  it('names the PE requirement ahead of the count', () => {
    const noPe = scheduleComplaint(pick(MIN_PLAYER_COURSES), CATALOG)
    expect(scheduleComplaint({}, CATALOG)).toBe(noPe)

    // Over the cap with PE seated: the last of the three, and not the first.
    const over = { ...pick(MAX_PLAYER_CLASSES), 8: 'SWIM 102' }
    expect(scheduleComplaint(over, CATALOG)).not.toBeNull()
    expect(scheduleComplaint(over, CATALOG)).not.toBe(noPe)
  })
})
