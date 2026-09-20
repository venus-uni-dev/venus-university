/** How tall a character stands on the stage, as a fraction of the maximum. */

/** Ten percent below the maximum, the floor the New Game modal enforces. */
export const SPRITE_SCALE_MIN = 0.9
export const SPRITE_SCALE_MAX = 1
/** One click of the New Game modal's steppers. */
export const SPRITE_SCALE_STEP = 0.01

/**
 * The scale a character is given before the player touches anything, by breast tag;
 * `small` wins when freehand tags carry both.
 */
export function defaultSpriteScale(baseAppearance: readonly string[]): number {
  if (baseAppearance.includes('small_breasts')) return 0.94
  if (baseAppearance.includes('big_breasts')) return SPRITE_SCALE_MAX
  return 0.97
}

/** Into range and onto a whole step — always a value the modal could have produced. */
export function clampSpriteScale(value: number): number {
  const stepped = Math.round(value / SPRITE_SCALE_STEP) * SPRITE_SCALE_STEP
  return Math.min(SPRITE_SCALE_MAX, Math.max(SPRITE_SCALE_MIN, Number(stepped.toFixed(2))))
}

/** The two shipped characters a lineup is measured against, by `charKeyOf`. */
export const HEIGHT_ANCHORS = ['winter_yang', 'april_valentine'] as const
