import { describe, expect, it } from 'vitest'
import { displaySpriteRef } from '../src/renderer/stores/stageDisplay'

/**
 * The wardrobe lock is applied at draw time and never written down, so what it resolves to is
 * the only thing standing between a locked stage and a sprite that has no file.
 */

describe('displaySpriteRef', () => {
  it('moves a sprite into a locked set only where that set is rendered', () => {
    expect(displaySpriteRef('happy', 'custom1', ['custom1'])).toBe('happy_custom1')
    expect(displaySpriteRef('happy', 'custom1', [])).toBe('happy')
  })

  it('strips the suffix under the default lock', () => {
    expect(displaySpriteRef('happy_pe', 'default', ['pe'])).toBe('happy')
  })

  it('leaves a CG alone under any lock', () => {
    expect(displaySpriteRef('sex', 'custom1', ['custom1'])).toBe('sex')
    expect(displaySpriteRef('sex', 'default', ['pe'])).toBe('sex')
  })
})
