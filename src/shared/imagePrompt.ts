import type { Character, Emotion, OutfitSet, Position } from './types'
import { negativeTagsFor, outfitTagsFor } from './outfits'
import { CG_BASE_PROMPT, POSITION_TAGS } from './positions'
import { EXPRESSION_EYES, EXPRESSION_MOUTH } from './tags'

/** The two eye tags {@link neutralTags} trades between, typed off the eyes list so they spell as it does. */
const SIDEWAYS_GLANCE: (typeof EXPRESSION_EYES)[number] = 'sideways_glance'
const LOOKING_AT_VIEWER: (typeof EXPRESSION_EYES)[number] = 'looking_at_viewer'

/** Builds the production prompt strings for `comfyService`. */

/** Quality tag preamble, lowercase with underscores like every booru tag. */
const QUALITY_TAGS = 'masterpiece, best_quality, very_aesthetic'

/** Composition preamble: standing full-body figure on a removable white background. */
const BASE_PROMPT =
  '1girl, solo, mature_female, full_body, standing, simple_background, white_background'

/** Shared negative, reused by every sampling and detailer stage. */
const NEGATIVE_PROMPT = 'worst_quality, bad_quality, lowres, holding, backlighting, cum'

/** The CG negative: quality tags only. */
const CG_NEGATIVE_PROMPT = 'worst_quality, bad_quality, lowres'

/** The two strings one `generateExpression` job needs. */
export interface ImagePrompts {
  /** Every stage of whichever graph runs except its Face Detailer. */
  positive: string
  /** Every sampling and detailer stage; set-specific for swimsuits. */
  negative: string
}

/**
 * The full-body sprite prompt shape shared by the sprite, outfit and expression graphs: five
 * groups, differing only in the wardrobe written into the third.
 */
function spritePositive(
  character: Character,
  outfitTags: readonly string[],
  poseTags: readonly string[],
  tailTags: readonly string[]
): string {
  // Blank-line-separated groups, one per kind of tag; the expression group is last.
  return [
    `${QUALITY_TAGS}, ${BASE_PROMPT}`,
    character.baseAppearance.join(', '),
    outfitTags.join(', '),
    poseTags.join(', '),
    tailTags.join(', ')
  ]
    .filter((group) => group.length > 0)
    .join(',\n\n')
}

/**
 * The neutral sprite is the portrait's source, so it always faces the viewer whatever eye
 * tag she was written with.
 */
function neutralTags(tags: readonly string[]): string[] {
  const dropped = tags.filter((tag) => tag !== SIDEWAYS_GLANCE)
  return dropped.includes(LOOKING_AT_VIEWER) ? dropped : [...dropped, LOOKING_AT_VIEWER]
}

/**
 * Assembles one sprite job's prompts; `emotion` is null for the base graph, which has no
 * expression to write.
 */
function assembleSpritePrompts(
  character: Character,
  outfitTags: readonly string[],
  poseTags: readonly string[],
  emotion: Emotion | null,
  extraNegative: readonly string[] = []
): ImagePrompts {
  const tailTags = emotion
    ? emotion === 'neutral'
      ? neutralTags(character.expressionTags.neutral)
      : character.expressionTags[emotion]
    : []

  const positive = spritePositive(character, outfitTags, poseTags, tailTags)

  // Her own negatives come last, at the one seam every sprite job passes through.
  const negative = [NEGATIVE_PROMPT, ...extraNegative, ...(character.negativeTags ?? [])].join(', ')

  return { positive, negative }
}

/** Assembles image prompts for one character/emotion pair from resolved pose tags. */
export function buildImagePrompt(
  character: Character,
  poseTags: readonly string[],
  emotion: Emotion
): ImagePrompts {
  return assembleSpritePrompts(character, character.outfit, poseTags, emotion)
}

/** The default set's base frame: her main outfit, no expression group. */
export function buildBasePrompt(
  character: Character,
  poseTags: readonly string[]
): ImagePrompts {
  return assembleSpritePrompts(character, character.outfit, poseTags, null)
}

/** The three strings one `generateCg` job needs. */
export interface CgPrompts {
  /** The CG workflow's single sampling pass. */
  positive: string
  /** Quality tags plus the character's own negatives. */
  negative: string
  /** The CG workflow's Face Detailer, through its own ControlNet apply. */
  detailerPositive: string
}

/** The aftermath tags a CG's face carries. */
const CG_FACE_TAGS = ['after_sex', 'after_fellatio', 'facial'] as const

/** The four aftermath positions, told from the during four by their suffix alone. */
function isAfterPosition(position: Position): boolean {
  return position.endsWith('_after')
}

/** The expression a CG wears: her own `happy` after, her own `aroused` during. */
function cgExpressionTags(character: Character, position: Position): readonly string[] {
  const tags = character.expressionTags[isAfterPosition(position) ? 'happy' : 'aroused']
  if (position !== 'fellatio' && position !== 'fellatio_after') return tags
  return tags.filter((tag) => !(EXPRESSION_MOUTH as readonly string[]).includes(tag))
}

/**
 * Assembles the CG prompts for one character/position pair. The base positive describes the
 * whole illustrated frame: nude, in position, at that moment.
 */
export function buildCgPrompt(
  character: Character,
  position: Position,
  poseTags: readonly string[]
): CgPrompts {
  const expressionTags = cgExpressionTags(character, position)
  const positionTags = POSITION_TAGS[position].split(', ')

  // Appearance, position and expression only: the base pass has no ControlNet.
  const positive = [
    `${QUALITY_TAGS}, ${CG_BASE_PROMPT}`,
    character.baseAppearance.join(', '),
    POSITION_TAGS[position],
    expressionTags.join(', ')
  ]
    .filter((group) => group.length > 0)
    .join(',\n\n')

  const detailerPositive = spritePositive(character, character.outfit, poseTags, [
    ...positionTags.filter((tag) => (CG_FACE_TAGS as readonly string[]).includes(tag)),
    ...expressionTags,
    ...(position === 'fellatio_after' ? ['open_mouth'] : [])
  ])

  const negative = [
    CG_NEGATIVE_PROMPT,
    ...(character.negativeTags ?? [])
  ].join(', ')

  return { positive, negative, detailerPositive }
}

/** The two strings one wardrobe's base frame needs. */
export interface OutfitPrompts {
  /** The base graph's sampling and hand stages, wearing the alternate set. */
  positive: string
  negative: string
}

/**
 * Assembles the wardrobe base-frame prompt for one character/set pair. Same group layout as
 * {@link buildBasePrompt} with the wardrobe swapped out.
 */
export function buildOutfitBasePrompt(
  character: Character,
  poseTags: readonly string[],
  set: OutfitSet
): OutfitPrompts {
  return assembleSpritePrompts(
    character,
    outfitTagsFor(character, set),
    poseTags,
    null,
    negativeTagsFor(set)
  )
}
