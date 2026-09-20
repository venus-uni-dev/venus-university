import { describe, expect, it } from 'vitest'
import {
  clampSpriteScale,
  defaultSpriteScale,
  SPRITE_SCALE_MAX,
  SPRITE_SCALE_MIN
} from '@shared/spriteScale'

/**
 * How tall a character stands. The clamp guards a persisted field — `Character.height`
 * — so an out-of-range value is a character who renders wrong in every game she is in, and the
 * default is the height written into character.json.
 */

describe('clampSpriteScale', () => {
  it('holds the range and snaps onto a whole step', () => {
    expect(clampSpriteScale(0.5)).toBe(SPRITE_SCALE_MIN)
    expect(clampSpriteScale(1.5)).toBe(SPRITE_SCALE_MAX)
    expect(clampSpriteScale(0.9349)).toBe(0.93)
    expect(clampSpriteScale(0.97)).toBe(0.97)
  })
})

describe('defaultSpriteScale', () => {
  it('reads the breast tag, and small wins where freehand tags carry both', () => {
    expect(defaultSpriteScale(['small_breasts'])).toBe(0.94)
    expect(defaultSpriteScale(['big_breasts'])).toBe(SPRITE_SCALE_MAX)
    expect(defaultSpriteScale([])).toBe(0.97)
    expect(defaultSpriteScale(['small_breasts', 'big_breasts'])).toBe(0.94)
  })
})
