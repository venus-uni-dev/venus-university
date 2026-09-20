import { describe, expect, it } from 'vitest'
import { FINAL_DATE } from '@shared/classes'
import { globalSlotOf } from '@shared/jobs'
import { ADD_DROP_DATE } from '../src/renderer/prompts/occasions'
import { venusMessagesDue } from '../src/renderer/prompts/venus'

/** Every announcement the semester owes, oldest first, and the slot it is owed on. */
const EXPECTED_SLOTS: ReadonlyArray<[string, number]> = [
  ['welcome', globalSlotOf(0, 1)],
  ['first-week', globalSlotOf(8, 0)],
  ['add-drop-week', globalSlotOf(18, 0)],
  ['add-drop-today', globalSlotOf(25, 0)],
  ['midterms-soon', globalSlotOf(35, 0)],
  ['midterms-done', globalSlotOf(63, 0)],
  ['finals-soon', globalSlotOf(105, 0)]
]

const LAST_SLOT = globalSlotOf(FINAL_DATE, 1)

describe('venusMessagesDue', () => {
  it('catches up in order rather than skipping what was missed', () => {
    expect(venusMessagesDue('Sam', -1, LAST_SLOT).map((m) => m.id)).toEqual(
      EXPECTED_SLOTS.map(([id]) => id)
    )
  })

  it('delivers nothing twice for a replayed boundary', () => {
    const slot = globalSlotOf(0, 1)
    expect(venusMessagesDue('Sam', slot, slot)).toEqual([])
  })

  it('is exclusive of the watermark and inclusive of the current slot', () => {
    const addDrop = globalSlotOf(ADD_DROP_DATE, 0)
    // Everything owed after the welcome, up to and including the deadline's own.
    expect(venusMessagesDue('Sam', globalSlotOf(0, 1), addDrop).map((m) => m.id)).toEqual([
      'first-week',
      'add-drop-week',
      'add-drop-today'
    ])
    // One slot short of it, the deadline message is not owed yet.
    expect(venusMessagesDue('Sam', globalSlotOf(0, 1), addDrop - 1).map((m) => m.id)).toEqual([
      'first-week',
      'add-drop-week'
    ])
  })
})
