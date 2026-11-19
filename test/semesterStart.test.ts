import { describe, expect, it } from 'vitest'
import { pairKeyOf } from '@shared/npcRelationships'
import { DEFAULT_PLAYER_STATS } from '@shared/playerStats'
import { emptyFlags } from '@shared/relationship'
import { emptyTallies } from '@shared/tallies'
import { emptyBunnyboard, type CharStart, type SemesterCarry } from '@shared/types'
import { continuedStartOf } from '../src/renderer/stores/semesterStart'
import { character, enrollment } from './fixtures'

/**
 * The opening save a later semester's Finalize writes: a newcomer the player set up opening as a
 * stranger, a pair the player set lost under the carried ones, or BunnyMap handed over twice or
 * never, is a semester unlike the one set up, and nothing throws.
 */

const ANNA = character({ charId: 'anna', firstName: 'Anna', lastName: 'Bell' })
const JUNE = character({ charId: 'june', firstName: 'June', lastName: 'Cole' })
const LIV = character({ charId: 'liv', firstName: 'Liv', lastName: 'Dunn' })
const ROSTER = [ANNA, JUNE, LIV]

/** What the last ending carried: Anna returning, and Anna and Liv friends already. */
function carry(over: Partial<SemesterCarry> = {}): SemesterCarry {
  return {
    stats: DEFAULT_PLAYER_STATS,
    money: 100,
    tallies: emptyTallies(),
    inventory: [],
    jobsClosed: [],
    gradesStanding: null,
    bunnyboard: emptyBunnyboard(),
    bunnymapUnlocked: false,
    bunnyshopUnlocked: true,
    venusJobIntroSent: true,
    bunnybotContactIntroSent: false,
    bunnybotFirstPostNudgeSent: true,
    bunnybotTwoTimingTipSent: false,
    bunnybotDeferred: [],
    bunnybotThrough: 240,
    npcRelationships: { [pairKeyOf('anna', 'liv')]: { affinity: 5 } },
    npcFriendships: [],
    charInfo: { anna: { memories: [], flags: emptyFlags(), nameKnown: true } },
    before: { history: {}, playerSchedule: {}, events: [] },
    ...over
  }
}

/** June, met before the semester and given his number. */
const JUNE_START: CharStart = {
  memories: [{ date: -40, type: 'liked', desc: 'I walked her home.' }],
  flags: { ...emptyFlags(), gaveContactInfo: true },
  nameKnown: true,
  datingSince: -30
}

/** The opening save of a fall with Anna returning, June and Liv new, over `carried`. */
function openingSave(
  carried: SemesterCarry,
  starts: Record<string, CharStart> = {},
  pairs = {},
  notes?: Record<string, string>
): ReturnType<typeof continuedStartOf>['save'] {
  const draft = enrollment({
    chars: ROSTER.map((c) => c.charId),
    starts,
    pairs,
    ...(notes ? { notes } : {}),
    continued: {
      id: '300',
      index: 1,
      alumni: [],
      priorProfiles: { anna: { year: 2, dorm: 'lowrise_1', major: 'History', schedule: {} } },
      pursuits: {},
      carry: carried
    }
  })
  return continuedStartOf(draft, {}, ROSTER).save
}

describe('a later semester’s opening save', () => {
  it('opens a newcomer where the Profiles screen set her, and another as a stranger', () => {
    const save = openingSave(carry(), { june: JUNE_START }, {}, { liv: 'Liv is pre-med.' })

    expect(save.charInfo.june).toMatchObject(JUNE_START)
    expect(save.charInfo.june.notes).toBeUndefined()
    expect(save.charInfo.liv).toMatchObject({
      memories: [],
      nameKnown: false,
      notes: 'Liv is pre-med.'
    })
    expect(save.charInfo.liv.flags.hasMet).toBe(false)
    expect(save.charInfo.liv.flags.gaveContactInfo).toBe(false)
    expect(save.charInfo.liv.datingSince).toBeUndefined()
  })

  it('lays the pairs the player set over the carried ones', () => {
    const save = openingSave(carry(), {}, {
      [pairKeyOf('anna', 'june')]: 'enemies',
      [pairKeyOf('anna', 'liv')]: 'strangers'
    })

    expect(save.npcRelationships).toEqual({ [pairKeyOf('anna', 'june')]: { affinity: -5 } })
  })

  it('queues the contact handover only where BunnyBot has not handed one over', () => {
    const first = openingSave(carry(), { june: JUNE_START })
    expect(first.bunnybotContactIntroSent).toBe(true)
    expect(first.bunnybotDeferred).toEqual(['contact'])

    const handed = openingSave(
      carry({ bunnybotContactIntroSent: true, bunnybotDeferred: ['haunt'] }),
      { june: JUNE_START }
    )
    expect(handed.bunnybotContactIntroSent).toBe(true)
    expect(handed.bunnybotDeferred).toEqual(['haunt'])

    const none = openingSave(carry())
    expect(none.bunnybotContactIntroSent).toBe(false)
    expect(none.bunnybotDeferred).toEqual([])
  })
})
