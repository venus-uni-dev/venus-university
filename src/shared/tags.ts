/**
 * Appendix A tag lists; values are pre-normalized. The lists steer the LLM through the
 * prompt and the structured-output enums (Appendix A).
 */

// ---------------------------------------------------------------- expressions

/** General emotion — pick 0–1. */
export const EXPRESSION_GENERAL = [
  'expressionless',
  'happy',
  '(smug:0.5)',
  '(angry:0.5)',
  '(sad:0.7)',
  '(embarrassed:0.5)',
  '(surprised:0.7)',
  'naughty_face',
] as const

/** Eyebrows — pick 0–1. */
export const EXPRESSION_EYEBROWS = ['raised_eyebrow', 'raised_eyebrows', 'furrowed_brow'] as const

/** Mouth — pick 0–1. */
export const EXPRESSION_MOUTH = [
  'clenched_teeth',
  '(frown:0.5)',
  'parted_lips',
  'light_smile',
  'smirk',
  'grin',
  'open_mouth'
] as const

/** Eyes — pick 0–1. */
export const EXPRESSION_EYES = [
  '(half-closed_eyes:0.7)',
  '(wide-eyed:0.6)',
  'one_eye_closed',
  'looking_at_viewer',
  'sideways_glance',
] as const

/** Other — pick 0–2. */
export const EXPRESSION_OTHER = ['tears', 'blush'] as const

// -------------------------------------------------------------------- colours

/** Colour shade — pick 0–1 per colour; merged on as `{shade}_{color}_hair` / `_eyes`. */
export const SHADES = ['light', 'dark'] as const

/** Bare colour names; `draftToCharacter` suffixes the pick into `{color}_eyes`. */
export const EYE_COLORS = [
  'aqua',
  'black',
  'blue',
  'brown',
  'green',
  'grey',
  'orange',
  'pink',
  'purple',
  'red',
  'yellow'
] as const

/** Bare colour names; `draftToCharacter` suffixes the pick into `{color}_hair`. Note: `blonde`, not `yellow`. */
export const HAIR_COLORS = [
  'aqua',
  'black',
  'blonde',
  'blue',
  'brown',
  'green',
  'grey',
  'orange',
  'pink',
  'purple',
  'red',
  'white'
] as const

/** One of the twelve; what `hairColorOf` reads back out of a character's tags. */
export type HairColor = (typeof HAIR_COLORS)[number]

/** One of the eleven; what `eyeColorOf` reads back out of a character's tags. */
export type EyeColor = (typeof EYE_COLORS)[number]

/**
 * The bare colour off a `{shade}_{color}{suffix}` tag in `baseAppearance` — the shade
 * prefix dropped. Null where the tags name none.
 */
function colorTagOf(
  baseAppearance: readonly string[],
  suffix: string,
  colors: readonly string[]
): string | null {
  for (const tag of baseAppearance) {
    if (!tag.endsWith(suffix)) continue
    let stem = tag.slice(0, -suffix.length)
    for (const shade of SHADES) {
      if (stem.startsWith(`${shade}_`)) stem = stem.slice(shade.length + 1)
    }
    // The membership check is what tells a colour from a length, a texture or a style.
    if (colors.includes(stem)) return stem
  }
  return null
}

/**
 * The bare hair colour off a character's `baseAppearance` — the shade prefix dropped, so
 * `dark_blue_hair` and `light_blue_hair` are both `blue`. Null where the tags name none.
 */
export function hairColorOf(baseAppearance: readonly string[]): HairColor | null {
  return colorTagOf(baseAppearance, '_hair', HAIR_COLORS) as HairColor | null
}

/**
 * The bare eye colour off a character's `baseAppearance` — the shade prefix dropped, so
 * `dark_blue_eyes` and `light_blue_eyes` are both `blue`. Null where the tags name none.
 */
export function eyeColorOf(baseAppearance: readonly string[]): EyeColor | null {
  return colorTagOf(baseAppearance, '_eyes', EYE_COLORS) as EyeColor | null
}

// ----------------------------------------------------------------------- body

/** Breast size — pick 0–1; `draftToCharacter` suffixes the pick into `{size}_breasts`. */
export const BREAST_SIZES = ['small', 'big'] as const

/** Skin — pick 0–1. */
export const SKIN_TAGS = ['tan', 'dark-skinned_female', 'freckles'] as const

/** The skin tags read back as prose; no tag means fair skin, which is never written out. */
export type SkinTone = 'tan' | 'dark' | 'freckled'

/** The bare skin tone off a character's `baseAppearance`, or null for fair skin. */
export function skinToneOf(baseAppearance: readonly string[]): SkinTone | null {
  if (baseAppearance.includes('dark-skinned_female')) return 'dark'
  if (baseAppearance.includes('tan')) return 'tan'
  if (baseAppearance.includes('freckles')) return 'freckled'
  return null
}

/** Makeup — pick 0–2. */
export const MAKEUP_TAGS = ['eyeshadow', 'eyelashes'] as const

// ----------------------------------------------------------------------- hair

/** Head accessories — optional, any number. Everything worn above the neck. */
export const HEAD_ACCESSORIES = [
  'hairband',
  'headband',
  'hair_ribbon',
  'hair_bow',
  'hairclip',
  'hair_flower',
  'hair_ornament',
  'glasses',
  'earrings',
  'ear_piercing'
] as const

/** Hair length — pick 1; `draftToCharacter` suffixes the pick into `{length}_hair`. */
export const HAIR_LENGTHS = ['very_short', 'short', 'medium', 'long'] as const

/** Hair style — pick 1 or more. */
export const HAIR_STYLES = [
  'bob_cut',
  'hime_cut',
  'pixie_cut',
  'wolf_cut',
  'inverted_bob',
  'high_ponytail',
  'low_ponytail',
  'side_ponytail',
  'twintails',
  'low_twintails',
  'single_braid',
  'twin_braids',
  'double_bun',
  'single_hair_bun',
  'one_side_up',
  'two_side_up',
  'drill_hair'
] as const

/** Bangs — pick 1 or more. */
export const HAIR_BANGS = [
  'blunt_bangs',
  'swept_bangs',
  'parted_bangs',
  'crossed_bangs',
  'hair_between_eyes',
  'hair_over_one_eye',
  'sidelocks',
  'long sidelocks'
] as const

/** Hair texture — pick 1; `draftToCharacter` suffixes the pick into `{texture}_hair`. */
export const HAIR_TEXTURES = ['straight', 'wavy', 'curly', 'messy'] as const

// --------------------------------------------------------------------- outfit

/** Skin exposure — pick any. */
export const OUTFIT_SKIN_EXPOSURE = [
  'navel',
  'bare_legs',
  'thighs',
  'bare_arms',
  'bare_shoulders',
  'cleavage',
  'clothing_cutout',
] as const

