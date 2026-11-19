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
    expect(clampSpriteScale(1.03)).toBe(1.03)
  })
})

describe('defaultSpriteScale', () => {
  it('reads the breast tag, and small wins where freehand tags carry both', () => {
    expect(defaultSpriteScale(['small_breasts'], 'female')).toBe(0.94)
    expect(defaultSpriteScale(['big_breasts'], 'female')).toBe(1)
    expect(defaultSpriteScale([], 'female')).toBe(0.97)
    expect(defaultSpriteScale(['small_breasts', 'big_breasts'], 'female')).toBe(0.94)
  })

  it("reads a guy's build tag, and bishounen wins where freehand tags carry both", () => {
    expect(defaultSpriteScale(['muscular_male'], 'male')).toBe(1.05)
    expect(defaultSpriteScale(['bishounen'], 'male')).toBe(1.03)
    expect(defaultSpriteScale([], 'male')).toBe(1)
    expect(defaultSpriteScale(['muscular_male', 'bishounen'], 'male')).toBe(1.03)
    // Each gender reads its own tag alone.
    expect(defaultSpriteScale(['muscular_male'], 'female')).toBe(0.97)
    expect(defaultSpriteScale(['big_breasts'], 'male')).toBe(1)
  })
})
