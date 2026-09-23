import { describe, expect, it } from 'vitest'
import { EMOTIONS } from '@shared/emotions'
import {
  CUSTOM_OUTFIT_NAME_MAX,
  followsMain,
  OUTFIT_SETS,
  outfitTagsFor,
  parseSpriteRef,
  spriteRef,
  withCustomOutfit,
  withoutCustomOutfit
} from '@shared/outfits'
import type { CustomOutfit } from '@shared/types'
import { character } from './fixtures'

/**
 * The sprite-reference grammar, read back. A `SpriteRef` is written into
 * every save's `scene.emotions` and read again on load, so the join and the split
 * have to be exact inverses — a ref that stops parsing is a sprite silently dropped.
 */

describe('parseSpriteRef', () => {
  it('reads back every reference `spriteRef` can write', () => {
    for (const emotion of EMOTIONS) {
      expect(parseSpriteRef(spriteRef(emotion, null))).toEqual({ emotion, set: null })
      for (const set of OUTFIT_SETS) {
        expect(parseSpriteRef(spriteRef(emotion, set))).toEqual({ emotion, set })
      }
    }
  })
})

describe('outfitTagsFor', () => {
  it('reads a custom slot’s tags, and answers nothing for a slot she has none for', () => {
    const written = character({ customOutfits: { custom1: { tags: ['maid', 'apron'] } } })
    expect(outfitTagsFor(written, 'custom1')).toEqual(['maid', 'apron'])
    expect(outfitTagsFor(written, 'custom2')).toEqual([])
    expect(outfitTagsFor(character(), 'custom1')).toEqual([])
  })

  it('answers nothing for a hand-edited entry whose tags are not a list of strings', () => {
    // The prompt builder reads this straight off the record; a throw here is a render lost.
    const broken = character({
      customOutfits: { custom1: { tags: 'maid' } as unknown as CustomOutfit }
    })
    expect(outfitTagsFor(broken, 'custom1')).toEqual([])
  })
})

describe('followsMain', () => {
  it('reads a set with no flag of its own as armed, and a false flag as spent', () => {
    expect(followsMain(character({ seedFollowsMain: {} }), 'custom1')).toBe(true)
    expect(followsMain(character({ seedFollowsMain: { custom1: false } }), 'custom1')).toBe(false)
  })
})

describe('withCustomOutfit', () => {
  it('trims the name, drops a blank one and cuts a long one to the cap', () => {
    const blank = withCustomOutfit(character(), 'custom1', { name: '   ', tags: ['maid'] })
    expect(blank.customOutfits?.custom1).toEqual({ tags: ['maid'] })

    const trimmed = withCustomOutfit(character(), 'custom1', { name: '  Maid  ', tags: [] })
    expect(trimmed.customOutfits?.custom1?.name).toBe('Maid')

    const long = withCustomOutfit(character(), 'custom1', { name: 'x'.repeat(40), tags: [] })
    expect(long.customOutfits?.custom1?.name).toBe('x'.repeat(CUSTOM_OUTFIT_NAME_MAX))
  })
})

describe('withoutCustomOutfit', () => {
  it('takes the entry, its recorded seed and its arming flag off the record together', () => {
    // A slot left holding a seed would render the player's next wardrobe under the
    // clothes the last one was cut from.
    const held = character({
      customOutfits: { custom1: { tags: ['maid'] }, custom2: { tags: ['apron'] } },
      setSeeds: { custom1: 999, pe: 111 },
      seedFollowsMain: { custom1: false, pe: false }
    })
    const result = withoutCustomOutfit(held, 'custom1')

    expect(result.customOutfits).toEqual({ custom2: { tags: ['apron'] } })
    expect(result.setSeeds).toEqual({ pe: 111 })
    expect(result.seedFollowsMain).toEqual({ pe: false })
  })

  it('drops the field entirely once the last wardrobe is gone', () => {
    const only = character({ customOutfits: { custom1: { tags: ['maid'] } } })
    expect('customOutfits' in withoutCustomOutfit(only, 'custom1')).toBe(false)
  })
})
