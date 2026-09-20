import { describe, expect, it } from 'vitest'
import { slotOf } from '@shared/classes'
import type { AppError } from '@shared/types'
import { castForClass } from '../src/renderer/stores/loop/classify'
import { useGameStore } from '../src/renderer/stores/gameStore'
import { character, charactersById, charInfo, classEntry } from './fixtures'

/**
 * The class-scene refusals the app composes for itself, against the player's own timetable: a
 * refusal that fires when it should not is a lecture he can never attend, and one that does not
 * fire writes attendance for a class he is not enrolled in.
 */

/** Monday day: shift slot 0, class slot 0, and nothing on the occasion calendar. */
const MONDAY = 35
const MONDAY_DAY = slotOf(0, 0)

/**
 * The reader in BIO 210 this slot, with Sarah and Mina sitting in it and Kira
 * enrolled in something else.
 */
function seed(over: { playerSchedule?: Record<number, string> } = {}): void {
  useGameStore.getState().reset()
  const bio = classEntry({ code: 'BIO 210', slot: MONDAY_DAY })
  const art = classEntry({ code: 'ART 110', name: 'Drawing', slot: MONDAY_DAY })

  useGameStore.setState({
    date: MONDAY,
    time: 0,
    chars: ['a', 'b', 'c'],
    characters: charactersById(
      character({ charId: 'a' }),
      character({ charId: 'b', firstName: 'Mina', lastName: 'Okafor' }),
      character({ charId: 'c', firstName: 'Kira', lastName: 'Weber' })
    ),
    charInfo: {
      a: charInfo({ schedule: { [MONDAY_DAY]: 'BIO 210' } }),
      b: charInfo({ schedule: { [MONDAY_DAY]: 'BIO 210' } }),
      c: charInfo({ schedule: { [MONDAY_DAY]: 'ART 110' } })
    },
    classes: { 'BIO 210': bio, 'ART 110': art },
    playerSchedule: over.playerSchedule ?? { [MONDAY_DAY]: 'BIO 210' }
  })
}

/** A refusal came back rather than a cast. */
function refusal(result: { error: AppError } | { cast: string[] }): void {
  expect(result).toHaveProperty('error')
}

describe('castForClass', () => {
  it('casts the whole room, whoever the action named', () => {
    // A class is a room, not a guest list: naming one classmate does not leave
    // the rest of the lecture empty.
    seed()
    expect(castForClass('', ['a'])).toEqual({ cast: ['a', 'b'], classCode: 'BIO 210' })
  })

  it('refuses a slot he has no class in, weekends included', () => {
    seed({ playerSchedule: {} })
    refusal(castForClass('', []))

    seed()
    // Saturday: no ClassSlot at all, so the same branch answers it.
    useGameStore.setState({ date: MONDAY + 5 })
    refusal(castForClass('BIO 210', []))
  })

  it('refuses a class he is not enrolled in', () => {
    seed()
    refusal(castForClass('ART 110', []))
  })

  it('accepts his own class however the model spelled the code', () => {
    // The regression this exists for: a raw lowercase compare read `bio210` and
    // `BIO-210` as a different course and refused the class he is sitting in.
    seed()
    for (const spelling of ['BIO 210', 'bio 210', 'bio210', 'BIO-210', ' Bio 210 ']) {
      expect(castForClass(spelling, []), spelling).toMatchObject({ classCode: 'BIO 210' })
    }
  })

  it('refuses a classmate who is not in that class, by name', () => {
    seed()
    refusal(castForClass('', ['c']))
  })

  it('refuses when the code resolves to a class the save no longer holds', () => {
    // A dropped course left in `playerSchedule` would otherwise cast an empty
    // room out of a lookup that came back undefined.
    seed()
    useGameStore.setState({ classes: {} })
    refusal(castForClass('', []))
  })

  it('casts an empty room rather than refusing one nobody else takes', () => {
    // He is enrolled and the lecture is meeting; that nobody on the roster shares
    // it makes it a scene about being alone in a lecture hall, not a refusal.
    seed()
    useGameStore.setState({
      charInfo: {
        a: charInfo({ schedule: {} }),
        b: charInfo({ schedule: {} }),
        c: charInfo({ schedule: {} })
      }
    })
    expect(castForClass('', [])).toEqual({ cast: [], classCode: 'BIO 210' })
  })
})
