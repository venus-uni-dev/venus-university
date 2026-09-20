import { describe, expect, it } from 'vitest'
import { spentOf } from '@shared/money'

/**
 * The money arithmetic. The balance is persisted and the loop
 * deducts the scene's `spent` from it before the boundary banks it, so a figure
 * normalized wrongly writes a save that looks valid and is quietly off.
 */

describe('spentOf', () => {
  it('reads nothing spent as nothing spent', () => {
    expect(spentOf(undefined)).toBe(0)
    expect(spentOf(Number.NaN)).toBe(0)
    expect(spentOf(Number.POSITIVE_INFINITY)).toBe(0)
  })

  it('truncates toward zero rather than rounding', () => {
    expect(spentOf(19.9)).toBe(19)
  })

  /**
   * The absence of a clamp is a decision, not an oversight: a scene that
   * reports an absurd figure is allowed to end the playthrough on the spot. This
   * is the assertion a future tidy-up trying to add a ceiling has to argue with.
   */
  it('does not cap what a scene can cost', () => {
    expect(spentOf(1_000_000)).toBe(1_000_000)
  })
})
