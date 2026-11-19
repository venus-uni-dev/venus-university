import type { Gender, Settings } from './types'

/**
 * The tags every ComfyUI prompt and every new character's appearance open with: the build's own,
 * or the player's from Settings, read the same way by both processes.
 */

/** One group of default tags, as the ComfyUI tab lists them. */
export type DefaultTagGroup =
  | 'quality'
  | 'negative'
  | 'sprite'
  | 'spriteNegative'
  | 'cg'
  | 'subject'
  | 'maleSubject'
  | 'maleNegative'

/** Every group of default tags, resolved. */
export type DefaultTags = Record<DefaultTagGroup, readonly string[]>

/** The groups in the order the ComfyUI tab shows them. */
export const DEFAULT_TAG_GROUPS: readonly DefaultTagGroup[] = [
  'quality',
  'negative',
  'sprite',
  'spriteNegative',
  'cg',
  'subject',
  'maleSubject',
  'maleNegative'
]

/** The tags every new female character's appearance opens with, as the build ships them. */
export const SUBJECT_TAGS: readonly string[] = ['1girl', 'mature_female']

/** The tags every new male character's appearance opens with, as the build ships them. */
export const MALE_SUBJECT_TAGS: readonly string[] = ['1boy', 'male_focus']

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
  subject: SUBJECT_TAGS,
  maleSubject: MALE_SUBJECT_TAGS,
  // Joins the shared negatives on a male character's sprites and CGs alone.
  maleNegative: ['1girl', 'breasts']
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

/** The subject tags one gender's characters open with, out of the default tags in force. */
export function subjectTagsOf(tags: DefaultTags, gender: Gender): readonly string[] {
  return gender === 'male' ? tags.maleSubject : tags.subject
}

/** The subject tags in force for each gender. */
export function subjectTagsByGender(
  tags: DefaultTags
): Readonly<Record<Gender, readonly string[]>> {
  return { female: tags.subject, male: tags.maleSubject }
}

/**
 * Her appearance without its subject tags, the build's own for her gender and the ones `subject`
 * names alike, since those are the renderer's and say nothing about her.
 */
export function withoutSubjectTags(
  appearance: readonly string[],
  gender: Gender,
  subject: readonly string[]
): string[] {
  const shipped = gender === 'male' ? MALE_SUBJECT_TAGS : SUBJECT_TAGS
  return appearance.filter((tag) => !shipped.includes(tag) && !subject.includes(tag))
}
