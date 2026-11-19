/**
 * How tall a character stands on the stage, as a fraction of full size: at 1 her sprite's top
 * edge meets the stage's, so a taller one runs off it.
 */

import type { Gender } from './types'

/** Ten percent below full size, the floor the New Game modal enforces. */
export const SPRITE_SCALE_MIN = 0.9
export const SPRITE_SCALE_MAX = 1.05
/** One click of the New Game modal's steppers. */
export const SPRITE_SCALE_STEP = 0.01

/**
 * The scale a character is given before the player touches anything: a male character's by build
 * tag, a slim one shortest, and a female one's by breast tag, the shorter pick winning wherever
 * freehand tags carry both.
 */
export function defaultSpriteScale(baseAppearance: readonly string[], gender: Gender): number {
  if (gender === 'male') {
    if (baseAppearance.includes('bishounen')) return 1.03
    if (baseAppearance.includes('muscular_male')) return 1.05
    return 1
  }
  if (baseAppearance.includes('small_breasts')) return 0.94
  if (baseAppearance.includes('big_breasts')) return 1
  return 0.97
}

/** Into range and onto a whole step — always a value the modal could have produced. */
export function clampSpriteScale(value: number): number {
  const stepped = Math.round(value / SPRITE_SCALE_STEP) * SPRITE_SCALE_STEP
  return Math.min(SPRITE_SCALE_MAX, Math.max(SPRITE_SCALE_MIN, Number(stepped.toFixed(2))))
}

/** The two shipped characters a lineup is measured against, by `charKeyOf`. */
export const HEIGHT_ANCHORS = ['winter_yang', 'april_valentine'] as const
