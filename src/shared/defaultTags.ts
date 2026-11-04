import type { Settings } from './types'

/**
 * The tags every ComfyUI prompt and every new character's appearance open with: the build's own,
 * or the player's from Settings, read the same way by both processes.
 */

/** One group of default tags, as the ComfyUI tab lists them. */
export type DefaultTagGroup = 'quality' | 'negative' | 'sprite' | 'spriteNegative' | 'cg' | 'subject'

/** Every group of default tags, resolved. */
export type DefaultTags = Record<DefaultTagGroup, readonly string[]>

/** The groups in the order the ComfyUI tab shows them. */
export const DEFAULT_TAG_GROUPS: readonly DefaultTagGroup[] = [
  'quality',
  'negative',
  'sprite',
  'spriteNegative',
  'cg',
  'subject'
]

/** The tags every new character's appearance opens with, as the build ships them. */
export const SUBJECT_TAGS: readonly string[] = ['1girl', 'mature_female']

/** Every group as the build ships it, lowercase with underscores like every booru tag. */
export const SHIPPED_DEFAULT_TAGS: DefaultTags = {
  // Opens every sprite and CG prompt.
  quality: ['masterpiece', 'best_quality', 'very_aesthetic'],
  // Opens every sprite and CG negative.
  negative: ['worst_quality', 'bad_quality', 'lowres'],
  // A standing full-body figure on a removable white background.
  sprite: ['solo', 'full_body', 'standing', 'simple_background', 'white_background'],
  spriteNegative: ['holding', 'backlighting', 'cum'],
  cg: ['sweat', 'breath', 'blush', 'looking_at_viewer'],
  subject: SUBJECT_TAGS
}

/** Whether two tag lists hold the same tags in the same order. */
export function sameTags(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((tag, i) => tag === b[i])
}

/** Whether a value read off a hand-editable record is a list of tags. */
export function isTagList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((tag) => typeof tag === 'string')
}

/**
 * The default tags the settings name: each group stored as a list of tags, blanks dropped, and
 * the build's own wherever it is absent or is not one.
 */
export function defaultTagsOf(settings: Pick<Settings, 'comfyTags'> | null): DefaultTags {
  const stored: Partial<Record<DefaultTagGroup, unknown>> = settings?.comfyTags ?? {}
  const tags = { ...SHIPPED_DEFAULT_TAGS }
  for (const group of DEFAULT_TAG_GROUPS) {
    const held = stored[group]
    if (isTagList(held)) tags[group] = held.map((tag) => tag.trim()).filter((tag) => tag !== '')
  }
  return tags
}

/**
 * The default tags as the settings keep them: a group the build ships as it stands is left out,
 * and nothing is kept where every group is, so a later build's tags reach a player who never
 * changed them.
 */
export function defaultTagsToStore(tags: DefaultTags): Settings['comfyTags'] {
  const stored: NonNullable<Settings['comfyTags']> = {}
  for (const group of DEFAULT_TAG_GROUPS) {
    if (!sameTags(tags[group], SHIPPED_DEFAULT_TAGS[group])) stored[group] = [...tags[group]]
  }
  return Object.keys(stored).length > 0 ? stored : undefined
}

/**
 * Her appearance without its subject tags, the build's and the ones `subject` names alike, since
 * those are the renderer's and say nothing about her.
 */
export function withoutSubjectTags(
  appearance: readonly string[],
  subject: readonly string[]
): string[] {
  return appearance.filter((tag) => !SUBJECT_TAGS.includes(tag) && !subject.includes(tag))
}
