import { describe, expect, it } from 'vitest'
import { FINAL_DATE } from '@shared/classes'
import { globalSlotOf } from '@shared/jobs'
import { DEFAULT_PLAYER_STATS, statsForTiers } from '@shared/playerStats'
import {
  bunnybotCatalog,
  bunnybotMessagesDue,
  FRIENDS_INTRO_SLOT,
  SHOP_UNLOCK_ID,
  STATS_TIP_ID
} from '../src/renderer/prompts/bunnybot'

/** The three clock-owed messages, oldest first, and the slot each is owed on. */
const EXPECTED_SLOTS: ReadonlyArray<[string, number]> = [
  ['friends-intro', globalSlotOf(1, 0)],
  [SHOP_UNLOCK_ID, globalSlotOf(5, 0)],
  [STATS_TIP_ID, globalSlotOf(12, 0)]
]

const LAST_SLOT = globalSlotOf(FINAL_DATE, 1)

/** A reader nobody would look at twice — every stat below `Good`, so the tip is owed. */
const WEAK = DEFAULT_PLAYER_STATS

/** The reader the tip has nothing to tell: `Good` in all three. */
const STRONG = statsForTiers({ brain: 3, body: 3, heart: 3 })

describe('bunnybotCatalog', () => {
  const catalog = bunnybotCatalog('Sam')

  // The gate the event-triggered handovers wait behind. If it drifted off
  // the intro's own trigger, a day-0 contact or haunt would either speak in
  // front of the introduction or be held past it.
  it('waits its event-triggered messages behind the intro it actually sends', () => {
    expect(FRIENDS_INTRO_SLOT).toBe(catalog.find((m) => m.id === 'friends-intro')!.triggerSlot)
    expect(bunnybotMessagesDue('Sam', -1, FRIENDS_INTRO_SLOT - 1, WEAK)).toEqual([])
  })
})

describe('bunnybotMessagesDue', () => {
  it('catches up in order rather than skipping what was missed', () => {
    expect(bunnybotMessagesDue('Sam', -1, LAST_SLOT, WEAK).map((m) => m.id)).toEqual(
      EXPECTED_SLOTS.map(([id]) => id)
    )
  })

  it('delivers nothing twice for a replayed boundary', () => {
    const slot = globalSlotOf(1, 0)
    expect(bunnybotMessagesDue('Sam', slot, slot, WEAK)).toEqual([])
  })

  it('is exclusive of the watermark and inclusive of the current slot', () => {
    const saturday = globalSlotOf(5, 0)
    expect(
      bunnybotMessagesDue('Sam', globalSlotOf(1, 0), saturday, WEAK).map((m) => m.id)
    ).toEqual([SHOP_UNLOCK_ID])
    expect(bunnybotMessagesDue('Sam', globalSlotOf(1, 0), saturday - 1, WEAK)).toEqual([])
  })
})

// The stat tip is the one clock-owed message a *state* can withhold, and
// the watermark advances past it either way.
describe('the stat tip', () => {
  const STATS_TIP_SLOT = globalSlotOf(12, 0)

  it('is dropped, and it alone, for a reader already Good everywhere', () => {
    expect(bunnybotMessagesDue('Sam', STATS_TIP_SLOT - 1, STATS_TIP_SLOT, STRONG)).toEqual([])
    expect(bunnybotMessagesDue('Sam', -1, LAST_SLOT, STRONG).map((m) => m.id)).toEqual([
      'friends-intro',
      SHOP_UNLOCK_ID
    ])
  })
})
