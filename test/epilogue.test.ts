import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GRADUATION_DATE } from '../src/renderer/prompts/occasions'
import { useGameStore } from '../src/renderer/stores/gameStore'
import { farewellOptions, friendCharIds } from '../src/renderer/stores/loop/farewells'
import { character, charInfo } from './fixtures'

/**
 * Who the graduation epilogue may offer a goodbye to. The gate is derived at every read off
 * four months of memories, so it fails quietly: offering a scene with a stranger, or
 * withholding one from the girl he spent the semester on.
 */

/** A roster of four: two he is close to, one stranger, one he never warmed to. */
function seed(): void {
  useGameStore.getState().reset()
  const chars = ['a', 'b', 'c', 'd']
  useGameStore.setState({
    playthroughId: 'p1',
    date: GRADUATION_DATE,
    time: 0,
    chars,
    characters: {
      a: character({ charId: 'a', firstName: 'Ada' }),
      b: character({ charId: 'b', firstName: 'Bea' }),
      c: character({ charId: 'c', firstName: 'Cam' }),
      d: character({ charId: 'd', firstName: 'Dot' })
    },
    charInfo: {
      // Devoted, and a senior: the whole of what the epilogue branches on.
      a: charInfo({
        nameKnown: true,
        year: 4,
        memories: Array.from({ length: 8 }, () => ({
          date: GRADUATION_DATE,
          type: 'loved' as const,
          desc: 'you were there'
        }))
      }),
      // Friendly, and not graduating.
      b: charInfo({
        nameKnown: true,
        year: 2,
        memories: [
          { date: GRADUATION_DATE, type: 'loved', desc: 'you were there' },
          { date: GRADUATION_DATE, type: 'loved', desc: 'you were there again' }
        ]
      }),
      // Known, and neutral about him.
      c: charInfo({ nameKnown: true, year: 4, memories: [] }),
      // Fond of him, and he still cannot name her.
      d: charInfo({
        nameKnown: false,
        year: 1,
        memories: Array.from({ length: 8 }, () => ({
          date: GRADUATION_DATE,
          type: 'loved' as const,
          desc: 'you were there'
        }))
      })
    }
  })
}

beforeEach(() => {
  seed()
})

afterEach(() => {
  useGameStore.getState().reset()
})

describe('who gets a goodbye', () => {
  // The menu is lowest affection first, so the girl he is closest to is the last goodbye he says.
  it('offers friendly and up, and nobody else', () => {
    expect(farewellOptions().map((o) => o.charId)).toEqual(['b', 'a'])
  })

  // Being together does not stand in for being close: a couple who have fallen
  // below friendly have nothing to say at a train station.
  it('does not let being a lover bypass the tier', () => {
    const info = useGameStore.getState().charInfo.c
    useGameStore.setState({
      charInfo: {
        ...useGameStore.getState().charInfo,
        c: { ...info, flags: { ...info.flags, isLover: true } }
      }
    })
    expect(farewellOptions().map((o) => o.charId)).not.toContain('c')
  })
})

describe('who is in the photograph', () => {
  it('keeps a friend whose goodbye has already been said', () => {
    // The one difference from the menu, and the whole reason this list exists:
    // a spent button is a fact about the button, not about her.
    useGameStore.getState().recordFarewell('a')
    expect(farewellOptions().map((option) => option.charId)).toEqual(['b'])
    expect(friendCharIds()).toEqual(['a', 'b'])
  })
})
