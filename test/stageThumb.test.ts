import { describe, expect, it } from 'vitest'
import {
  STAGE_THUMB_MAX_BYTES,
  STAGE_THUMB_WIDTH,
  stageCgPlacement,
  stagePortraitPlacement
} from '@shared/stageThumb'

/**
 * The stage's picture on a manual save: a portrait or CG placed anywhere but where the stage
 * shows it is a thumbnail of a scene the player never saw.
 */

/** The thumbnail's scale down from the 1920px stage. */
const SCALE = STAGE_THUMB_WIDTH / 1920
/** A sprite canvas's width over its height. */
const ASPECT = 1160 / 1696

describe('stagePortraitPlacement', () => {
  it('stands one portrait in the middle, her feet on the stage’s ground', () => {
    const one = stagePortraitPlacement(0, 1, 1, ASPECT)
    expect(one.x + one.width / 2).toBeCloseTo(STAGE_THUMB_WIDTH / 2)
    expect(one.y + one.height).toBeCloseTo(1782 * SCALE)
    expect(one.width / one.height).toBeCloseTo(ASPECT)
  })

  it('stands a pair either side of the middle, the same distance out', () => {
    const left = stagePortraitPlacement(0, 2, 1, ASPECT)
    const right = stagePortraitPlacement(1, 2, 1, ASPECT)
    const middle = STAGE_THUMB_WIDTH / 2
    expect(middle - (left.x + left.width / 2)).toBeCloseTo(right.x + right.width / 2 - middle)
    expect(left.x + left.width / 2).toBeLessThan(middle)
  })

  it('makes a shorter character shorter at the head, not higher at the feet', () => {
    const tall = stagePortraitPlacement(0, 1, 1, ASPECT)
    const short = stagePortraitPlacement(0, 1, 0.9, ASPECT)
    expect(short.y).toBeGreaterThan(tall.y)
    expect(short.y + short.height).toBeCloseTo(tall.y + tall.height)
  })
})

describe('stageCgPlacement', () => {
  it('shows a CG whole, centred across the stage', () => {
    const aspect = 1216 / 832
    const cg = stageCgPlacement(aspect)
    expect(cg.width / cg.height).toBeCloseTo(aspect)
    expect(cg.x + cg.width / 2).toBeCloseTo(STAGE_THUMB_WIDTH / 2)
  })
})

describe('the thumbnail’s weight', () => {
  it('stays small enough to ride on every manual save', () => {
    // Ninety manual saves each carry one, and the load grid lists them all.
    expect(STAGE_THUMB_MAX_BYTES).toBeLessThan(24 * 1024)
  })
})
