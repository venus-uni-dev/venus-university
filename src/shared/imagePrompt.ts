import type { Character, Emotion, OutfitSet, Position } from './types'
import { customCgTagsFor, withAfterTag } from './customCgs'
import type { DefaultTags } from './defaultTags'
import { negativeTagsFor, outfitTagsFor } from './outfits'
import {
  customCgSlotOf,
  isAfterPosition,
  isStockPosition,
  POSITION_TAGS
} from './positions'
import { EXPRESSION_EYES, EXPRESSION_MOUTH } from './tags'

/**
 * Builds the production prompt strings for `comfyService`, out of the tag groups one render
 * may be regenerated with its own edit of.
 */

/** The two eye tags {@link neutralTags} trades between, typed off the eyes list so they spell as it does. */
const SIDEWAYS_GLANCE: (typeof EXPRESSION_EYES)[number] = 'sideways_glance'
const LOOKING_AT_VIEWER: (typeof EXPRESSION_EYES)[number] = 'looking_at_viewer'

/** One group's tags in order, a tag listed twice kept where it first stands. */
function unique(tags: readonly string[]): string[] {
  return tags.filter((tag, i) => tags.indexOf(tag) === i)
}

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

/**
 * The part of a sprite or CG edit's two shared groups the default tags make up, at the front of
 * each; null for an expression, which has neither group.
 */
export function defaultsOfGroups(
  kind: PromptEdit['kind'],
  tags: DefaultTags
): { base: string[]; negative: string[] } | null {
  if (kind === 'expression') return null
  if (kind === 'sprite') {
    return {
      base: unique([...tags.quality, ...tags.sprite]),
      negative: unique([...tags.negative, ...tags.spriteNegative])
    }
  }
  return { base: unique([...tags.quality, ...tags.cg]), negative: unique([...tags.negative]) }
}

/** The groups one sprite render is drawn from; `set` is null for the default wardrobe. */
export function spriteDraft(
  character: Character,
  poseTags: readonly string[],
  set: OutfitSet | null,
  tags: DefaultTags
): Extract<PromptEdit, { kind: 'sprite' }> {
  const defaults = defaultsOfGroups('sprite', tags)
  return {
    kind: 'sprite',
    set,
    base: [...(defaults?.base ?? [])],
    appearance: [...character.baseAppearance],
    outfit: set === null ? [...character.outfit] : [...outfitTagsFor(character, set)],
    pose: [...poseTags],
    // Her own negatives come last, after the default ones and the set's own.
    negative: unique([
      ...(defaults?.negative ?? []),
      ...(set ? negativeTagsFor(set) : []),
      ...(character.negativeTags ?? [])
    ])
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
export function cgSetDraft(
  character: Character,
  tags: DefaultTags
): Extract<PromptEdit, { kind: 'cgs' }> {
  const defaults = defaultsOfGroups('cgs', tags)
  return {
    kind: 'cgs',
    base: [...(defaults?.base ?? [])],
    appearance: [...character.baseAppearance],
    negative: unique([...(defaults?.negative ?? []), ...(character.negativeTags ?? [])])
  }
}

/**
 * The expression a CG wears: her own `happy` after an act, stock or custom, her own `aroused`
 * during one.
 */
function cgExpressionTags(character: Character, position: Position): readonly string[] {
  const tags = character.expressionTags[isAfterPosition(position) ? 'happy' : 'aroused']
  if (position !== 'fellatio' && position !== 'fellatio_after') return tags
  return tags.filter((tag) => !(EXPRESSION_MOUTH as readonly string[]).includes(tag))
}

/** The position group one CG renders from: a stock one's tags, or a custom pair's plus its after tag. */
function cgPositionTags(character: Character, position: Position): string[] {
  if (isStockPosition(position)) return tagsOf(POSITION_TAGS[position])
  const slot = customCgSlotOf(position)
  const tags = slot ? customCgTagsFor(character, slot) : []
  return isAfterPosition(position) ? withAfterTag(tags) : [...tags]
}

/** The groups one CG is drawn from: what her CGs share, plus the position and the face it wears. */
export function cgDraft(
  character: Character,
  position: Position,
  tags: DefaultTags
): Extract<PromptEdit, { kind: 'cg' }> {
  const { base, appearance, negative } = cgSetDraft(character, tags)
  return {
    kind: 'cg',
    base,
    appearance,
    position: cgPositionTags(character, position),
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
  tags: DefaultTags,
  edit?: PromptEdit
): ImagePrompts {
  const draft = spriteDraft(character, poseTags, null, tags)

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
  tags: DefaultTags,
  edit?: PromptEdit
): ImagePrompts {
  const draft = spriteDraft(character, poseTags, null, tags)
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
  tags: DefaultTags,
  edit?: PromptEdit
): CgPrompts {
  const draft = cgDraft(character, position, tags)
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
    { ...spriteDraft(character, poseTags, null, tags), appearance: groups.appearance },
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
  tags: DefaultTags,
  edit?: PromptEdit
): OutfitPrompts {
  const draft = spriteDraft(character, poseTags, set, tags)
  const groups = edit?.kind === 'sprite' ? edit : draft

  return { positive: spritePositive(groups, []), negative: groups.negative.join(', ') }
}
