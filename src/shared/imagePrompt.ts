import type { Character, Emotion, OutfitSet, Position } from './types'
import { negativeTagsFor, outfitTagsFor } from './outfits'
import { CG_BASE_PROMPT, POSITION_TAGS } from './positions'
import { EXPRESSION_EYES, EXPRESSION_MOUTH } from './tags'

/**
 * Builds the production prompt strings for `comfyService`, out of the tag groups one render
 * may be regenerated with its own edit of.
 */

/** The two eye tags {@link neutralTags} trades between, typed off the eyes list so they spell as it does. */
const SIDEWAYS_GLANCE: (typeof EXPRESSION_EYES)[number] = 'sideways_glance'
const LOOKING_AT_VIEWER: (typeof EXPRESSION_EYES)[number] = 'looking_at_viewer'

/** Quality tag preamble, lowercase with underscores like every booru tag. */
const QUALITY_TAGS: readonly string[] = ['masterpiece', 'best_quality', 'very_aesthetic']

/** Composition preamble: standing full-body figure on a removable white background. */
const BASE_TAGS: readonly string[] = [
  'solo',
  'full_body',
  'standing',
  'simple_background',
  'white_background'
]

/** Shared negative, reused by every sampling and detailer stage. */
const NEGATIVE_TAGS: readonly string[] = [
  'worst_quality',
  'bad_quality',
  'lowres',
  'holding',
  'backlighting',
  'cum'
]

/** The CG negative: quality tags only. */
const CG_NEGATIVE_TAGS: readonly string[] = ['worst_quality', 'bad_quality', 'lowres']

/** Splits one of the comma-joined tag lists `positions.ts` holds back into its tags. */
function tagsOf(list: string): string[] {
  return list.split(', ')
}

/**
 * One render's tag groups as the player may rewrite them for that render alone. Each member is
 * the scope one regenerate opens in; a builder reads only its own kind and falls back to the
 * character for every other.
 */
export type PromptEdit =
  | {
      kind: 'sprite'
      /** The wardrobe the sprite is of; null is the default one, her main outfit. */
      set: OutfitSet | null
      base: string[]
      appearance: string[]
      outfit: string[]
      pose: string[]
      negative: string[]
    }
  | { kind: 'expression'; expression: string[] }
  | { kind: 'cgs'; base: string[]; appearance: string[]; negative: string[] }
  | {
      kind: 'cg'
      base: string[]
      appearance: string[]
      position: string[]
      expression: string[]
      negative: string[]
    }

/**
 * The neutral sprite is the portrait's source, so it always faces the viewer whatever eye
 * tag she was written with.
 */
function neutralTags(tags: readonly string[]): string[] {
  const dropped = tags.filter((tag) => tag !== SIDEWAYS_GLANCE)
  return dropped.includes(LOOKING_AT_VIEWER) ? dropped : [...dropped, LOOKING_AT_VIEWER]
}

/** The groups one sprite render is drawn from; `set` is null for the default wardrobe. */
export function spriteDraft(
  character: Character,
  poseTags: readonly string[],
  set: OutfitSet | null
): Extract<PromptEdit, { kind: 'sprite' }> {
  return {
    kind: 'sprite',
    set,
    base: [...QUALITY_TAGS, ...BASE_TAGS],
    appearance: [...character.baseAppearance],
    outfit: set === null ? [...character.outfit] : [...outfitTagsFor(character, set)],
    pose: [...poseTags],
    // Her own negatives come last, after the shared ones and the set's own.
    negative: [
      ...NEGATIVE_TAGS,
      ...(set ? negativeTagsFor(set) : []),
      ...(character.negativeTags ?? [])
    ]
  }
}

/** The expression group a face pass writes for one emotion. */
export function expressionDraft(
  character: Character,
  emotion: Emotion
): Extract<PromptEdit, { kind: 'expression' }> {
  return {
    kind: 'expression',
    expression:
      emotion === 'neutral'
        ? neutralTags(character.expressionTags.neutral)
        : [...character.expressionTags[emotion]]
  }
}

/** The groups every one of a character's CGs shares, whichever position it is in. */
export function cgSetDraft(character: Character): Extract<PromptEdit, { kind: 'cgs' }> {
  return {
    kind: 'cgs',
    base: [...QUALITY_TAGS, ...tagsOf(CG_BASE_PROMPT)],
    appearance: [...character.baseAppearance],
    negative: [...CG_NEGATIVE_TAGS, ...(character.negativeTags ?? [])]
  }
}

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

/** The groups one CG is drawn from: what her CGs share, plus the position and the face it wears. */
export function cgDraft(
  character: Character,
  position: Position
): Extract<PromptEdit, { kind: 'cg' }> {
  const { base, appearance, negative } = cgSetDraft(character)
  return {
    kind: 'cg',
    base,
    appearance,
    position: tagsOf(POSITION_TAGS[position]),
    expression: [...cgExpressionTags(character, position)],
    negative
  }
}

/** Writes tag groups as one prompt: tags by comma, groups by a blank line, blanks dropped. */
function joinGroups(groups: readonly (readonly string[])[]): string {
  return groups
    .map((group) => group.filter((tag) => tag.length > 0).join(', '))
    .filter((group) => group.length > 0)
    .join(',\n\n')
}

/** The positive groups every sprite prompt opens with, before whatever tail its graph adds. */
type SpriteGroups = Pick<
  Extract<PromptEdit, { kind: 'sprite' }>,
  'base' | 'appearance' | 'outfit' | 'pose'
>

/**
 * The full-body sprite prompt shared by the sprite, outfit and expression graphs: four groups
 * and a tail, which carries the expression where the graph writes one.
 */
function spritePositive(groups: SpriteGroups, tail: readonly string[]): string {
  return joinGroups([groups.base, groups.appearance, groups.outfit, groups.pose, tail])
}

/** The two strings one `generateExpression` job needs. */
export interface ImagePrompts {
  /** Every stage of whichever graph runs except its Face Detailer. */
  positive: string
  /** Every sampling and detailer stage; set-specific for swimsuits. */
  negative: string
}

/** Assembles image prompts for one character/emotion pair from resolved pose tags. */
export function buildImagePrompt(
  character: Character,
  poseTags: readonly string[],
  emotion: Emotion,
  edit?: PromptEdit
): ImagePrompts {
  const draft = spriteDraft(character, poseTags, null)

  // A face pass prompts with her main outfit whichever wardrobe the sprite is of, so only the
  // default set's edit reaches the outfit group.
  const groups: SpriteGroups =
    edit?.kind === 'sprite'
      ? {
          base: edit.base,
          appearance: edit.appearance,
          outfit: edit.set === null ? edit.outfit : draft.outfit,
          pose: edit.pose
        }
      : draft
  const negative = edit?.kind === 'sprite' ? edit.negative : draft.negative

  const tail =
    edit?.kind === 'expression' ? edit.expression : expressionDraft(character, emotion).expression

  return { positive: spritePositive(groups, tail), negative: negative.join(', ') }
}

/** The default set's base frame: her main outfit, no expression group. */
export function buildBasePrompt(
  character: Character,
  poseTags: readonly string[],
  edit?: PromptEdit
): ImagePrompts {
  const draft = spriteDraft(character, poseTags, null)
  const groups = edit?.kind === 'sprite' ? edit : draft

  return { positive: spritePositive(groups, []), negative: groups.negative.join(', ') }
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
const CG_FACE_TAGS: readonly string[] = ['after_sex', 'after_fellatio', 'facial']

/**
 * Assembles the CG prompts for one character/position pair. The base positive describes the
 * whole illustrated frame: nude, in position, at that moment. A `cgs` edit rewrites only what
 * every CG of hers shares.
 */
export function buildCgPrompt(
  character: Character,
  position: Position,
  poseTags: readonly string[],
  edit?: PromptEdit
): CgPrompts {
  const draft = cgDraft(character, position)
  const groups =
    edit?.kind === 'cg'
      ? edit
      : edit?.kind === 'cgs'
        ? { ...draft, base: edit.base, appearance: edit.appearance, negative: edit.negative }
        : draft

  // Appearance, position and expression only: the base pass has no ControlNet.
  const positive = joinGroups([groups.base, groups.appearance, groups.position, groups.expression])

  // The detailer repaints the face on a sprite frame, so its base group is the sprite preamble
  // and never the CG one.
  const detailerPositive = spritePositive(
    { ...spriteDraft(character, poseTags, null), appearance: groups.appearance },
    [
      ...groups.position.filter((tag) => CG_FACE_TAGS.includes(tag)),
      ...groups.expression,
      ...(position === 'fellatio_after' ? ['open_mouth'] : [])
    ]
  )

  const negative = groups.negative.join(', ')

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
  set: OutfitSet,
  edit?: PromptEdit
): OutfitPrompts {
  const draft = spriteDraft(character, poseTags, set)
  const groups = edit?.kind === 'sprite' ? edit : draft

  return { positive: spritePositive(groups, []), negative: groups.negative.join(', ') }
}
