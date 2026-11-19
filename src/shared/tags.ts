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

/** A tag with any `(tag:1.2)` weight it was written with taken off. */
function bareTag(tag: string): string {
  const weighted = /^\((.+):[\d.]+\)$/.exec(tag.trim())
  return weighted ? weighted[1] : tag.trim()
}

/**
 * A colour off a character's `baseAppearance`: the first `{shade}_{color}{suffix}` tag naming a
 * colour of the vocabulary, its shade dropped; else the first tag with the suffix that is not
 * one of `notColors`, its stem read as words (`silver_hair` is `silver`). Null where none is.
 */
function colorTagOf(
  baseAppearance: readonly string[],
  suffix: string,
  colors: readonly string[],
  notColors: readonly string[]
): string | null {
  const tags = baseAppearance.map(bareTag).filter((tag) => tag.endsWith(suffix))
  for (const tag of tags) {
    let stem = tag.slice(0, -suffix.length)
    for (const shade of SHADES) {
      if (stem.startsWith(`${shade}_`)) stem = stem.slice(shade.length + 1)
    }
    // The membership check is what tells a colour from a length, a texture or a style.
    if (colors.includes(stem)) return stem
  }
  const other = tags.find((tag) => !notColors.includes(tag) && tag.length > suffix.length)
  return other ? other.slice(0, -suffix.length).replace(/_/g, ' ') : null
}

/** Eye tags that say something other than their colour. */
const NOT_EYE_COLORS: readonly string[] = [
  'hair_between_eyes',
  'closed_eyes',
  'half-closed_eyes',
  'empty_eyes',
  'glowing_eyes',
  'sparkling_eyes',
  'multicolored_eyes',
  'gradient_eyes',
  'bags_under_eyes',
  'rolling_eyes'
]

/**
 * Her hair colour off her `baseAppearance` — the shade prefix dropped, so `dark_blue_hair` and
 * `light_blue_hair` are both `blue` — or the words of another colour she was tagged with, like
 * `silver`. Null where the tags name none.
 */
export function hairColorOf(baseAppearance: readonly string[]): string | null {
  return colorTagOf(baseAppearance, '_hair', HAIR_COLORS, NOT_HAIR_COLORS)
}

/**
 * Her eye colour off her `baseAppearance`, on {@link hairColorOf}'s terms. Null where the tags
 * name none.
 */
export function eyeColorOf(baseAppearance: readonly string[]): string | null {
  return colorTagOf(baseAppearance, '_eyes', EYE_COLORS, NOT_EYE_COLORS)
}

// ----------------------------------------------------------------------- body

/** Breast size — pick 0–1; `draftToCharacter` suffixes the pick into `{size}_breasts`. */
export const BREAST_SIZES = ['small', 'big'] as const

/** Build for a male character — pick 0–1; none is slim. */
export const MALE_BUILDS = ['muscular_male', 'bishounen'] as const

/** Skin — pick 0–1. */
export const SKIN_TAGS = ['tan', 'dark-skinned_female', 'freckles'] as const

/** Skin for a male character — pick 0–1. */
export const MALE_SKIN_TAGS = ['tan', 'dark-skinned_male', 'freckles'] as const

/** Every skin tag of either vocabulary, each once. */
const ALL_SKIN_TAGS = [...new Set([...SKIN_TAGS, ...MALE_SKIN_TAGS])]

/** The words each skin tag of the vocabulary is read back as; fair skin is never written out. */
const SKIN_WORDS: Readonly<
  Record<(typeof SKIN_TAGS)[number] | (typeof MALE_SKIN_TAGS)[number], string>
> = {
  'dark-skinned_female': 'dark',
  'dark-skinned_male': 'dark',
  tan: 'tan',
  freckles: 'freckled'
}

/** Skin tags that say something other than its colour. */
const NOT_SKIN_COLORS: readonly string[] = ['shiny_skin', 'colored_skin']

/**
 * Her skin off her `baseAppearance`, as words: every skin tag of either vocabulary she carries,
 * or else the first other `_skin` tag's colour (`blue_skin` is `blue`); empty for fair skin.
 */
export function skinTonesOf(baseAppearance: readonly string[]): string[] {
  const tags = baseAppearance.map(bareTag)
  const known = ALL_SKIN_TAGS.filter((tag) => tags.includes(tag)).map((tag) => SKIN_WORDS[tag])
  if (known.length > 0) return known
  const other = tags.find(
    (tag) => tag.endsWith('_skin') && tag.length > '_skin'.length && !NOT_SKIN_COLORS.includes(tag)
  )
  return other ? [other.slice(0, -'_skin'.length).replace(/_/g, ' ')] : []
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

/** Head accessories for a male character — optional, any number. */
export const MALE_HEAD_ACCESSORIES = [
  'headband',
  'hairclip',
  'hair_ornament',
  'glasses',
  'earrings',
  'ear_piercing'
] as const

/** Facial hair for a male character — pick 0–1. */
export const FACIAL_HAIR = ['stubble', 'beard', 'goatee', 'mustache'] as const

/** Hair length — pick 1; `draftToCharacter` suffixes the pick into `{length}_hair`. */
export const HAIR_LENGTHS = ['very_short', 'short', 'medium', 'long'] as const

/** Hair style — pick 1 or more. */
export const HAIR_STYLES = [
  'bob_cut',
  'bowl_cut',
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

/** Hair style for a male character — pick 1 or more. */
export const MALE_HAIR_STYLES = [
  'undercut',
  'parted_hair',
  'bowl_cut',
  'pixie_cut',
  'buzz_cut',
  'crew_cut',
  'hair_slicked_back',
  'ponytail',
  'wolf_cut',
  'mullet'
] as const

/** Bangs — pick 0 or more. */
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

/** Hair texture for a male character — pick 1, suffixed as {@link HAIR_TEXTURES} is. */
export const MALE_HAIR_TEXTURES = [...HAIR_TEXTURES, 'spiked'] as const

/** Hair tags that say something other than its colour. */
const NOT_HAIR_COLORS: readonly string[] = [
  ...HAIR_LENGTHS.map((length) => `${length}_hair`),
  ...MALE_HAIR_TEXTURES.map((texture) => `${texture}_hair`),
  'drill_hair',
  'parted_hair',
  'very_long_hair',
  'absurdly_long_hair',
  'multicolored_hair',
  'two-tone_hair',
  'streaked_hair',
  'gradient_hair',
  'colored_inner_hair',
  'floating_hair',
  'wet_hair',
  'big_hair'
]

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

