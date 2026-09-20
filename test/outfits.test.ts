import { describe, expect, it } from 'vitest'
import { EMOTIONS } from '@shared/emotions'
import { OUTFIT_SETS, parseSpriteRef, spriteRef } from '@shared/outfits'

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
