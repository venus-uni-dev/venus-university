import { describe, expect, it } from 'vitest'
import { sfwCgRefOf, sfwSpriteRefOf } from '@shared/sfw'

/**
 * What the stage shows instead of the explicit images. A substitution
 * that quietly undressed her, or quietly dressed her, would look like an ordinary
 * sprite change on screen and only read wrong to somebody watching the scene.
 */

describe('a nude sprite reference', () => {
  it('keeps the wardrobe she is already in', () => {
    expect(sfwSpriteRefOf('aroused_nude', 'happy_swim')).toBe('aroused_swim')
    expect(sfwSpriteRefOf('embarrassed_nude', 'neutral_pe')).toBe('embarrassed_pe')
  })

  it('never keeps a wardrobe this setting would not show', () => {
    // Both reachable from a save written with the setting off: `emotions` can
    // be holding a nude reference or a CG when it is switched on.
    expect(sfwSpriteRefOf('happy_nude', 'sad_nude')).toBe('happy')
    expect(sfwSpriteRefOf('happy_nude', 'nude_foreplay')).toBe('happy')
  })
})

describe('a CG', () => {
  it('becomes an expression in the clothes she is wearing', () => {
    expect(sfwCgRefOf('sex', 'neutral_pe')).toBe('aroused_pe')
    expect(sfwCgRefOf('nude_foreplay', 'happy')).toBe('aroused')
  })

  it('takes her out of the nude set the CG replaced', () => {
    // The only pin on the `_after` branch: a regression here stores `aroused`
    // where `happy` belongs in the save's `scene.emotions`.
    expect(sfwCgRefOf('sex_after', 'aroused_nude')).toBe('happy')
    expect(sfwCgRefOf('handjob', 'sex')).toBe('aroused')
  })
})
