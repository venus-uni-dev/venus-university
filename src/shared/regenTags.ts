import type { Character, RegenTarget } from './types'
import { isTagList, sameTags, SHIPPED_DEFAULT_TAGS, type DefaultTags } from './defaultTags'
import { defaultsOfGroups, type PromptEdit } from './imagePrompt'

/**
 * What one regenerate button last sent, kept on a character's record so its modal reopens on
 * it rather than a fresh draft.
 */

/** Every tag group any kind of regenerate shows, as one key set. */
export type PromptGroup =
  | 'base'
  | 'appearance'
  | 'outfit'
  | 'pose'
  | 'position'
  | 'expression'
  | 'negative'

/** Which groups each kind of render opens on, in the order the prompt writes them. */
export const PROMPT_GROUPS: Record<PromptEdit['kind'], readonly PromptGroup[]> = {
  sprite: ['base', 'appearance', 'outfit', 'pose', 'negative'],
  expression: ['expression'],
  cgs: ['base', 'appearance', 'negative'],
  cg: ['base', 'appearance', 'position', 'expression', 'negative']
}

/** The default part of an edit's Base and Negative groups, as one kept edit was sent with. */
export interface SentDefaults {
  base: string[]
  negative: string[]
}

/** What one button kept: the edit it sent, and the default part of its two shared groups. */
export type KeptEdit = PromptEdit & { sentDefaults?: SentDefaults }

/** Whether a value read off a hand-editable record is a kept edit's default part. */
function isSentDefaults(value: unknown): value is SentDefaults {
  if (typeof value !== 'object' || value === null) return false
  const held = value as Partial<Record<keyof SentDefaults, unknown>>
  return isTagList(held.base) && isTagList(held.negative)
}

/**
 * One kept group with the default tags it was sent with swapped for the ones in force: every tag
 * the player added stays, and a default taken out stays out. Unchanged defaults leave it as kept.
 */
export function swapDefaults(
  kept: readonly string[],
  before: readonly string[],
  after: readonly string[]
): string[] {
  if (sameTags(before, after)) return [...kept]
  const lead = after.filter((tag) => !(before.includes(tag) && !kept.includes(tag)))
  const rest = kept.filter((tag) => !before.includes(tag) && !lead.includes(tag))
  return [...lead, ...rest]
}

/**
 * What a regenerate opens on: the edit its button last sent, where that is of the draft's kind
 * and wardrobe, group by group where each is a list of tags; the draft's group otherwise. A kept
 * Base or Negative group has its default tags swapped for `tags`, an edit that does not say which
 * it was sent with having been sent with the build's own.
 */
export function withRegenTags(draft: PromptEdit, stored: unknown, tags: DefaultTags): PromptEdit {
  if (typeof stored !== 'object' || stored === null) return draft
  const held = stored as Partial<Record<PromptGroup | 'kind' | 'set' | 'sentDefaults', unknown>>
  if (held.kind !== draft.kind) return draft
  if (draft.kind === 'sprite' && held.set !== draft.set) return draft
  const before = isSentDefaults(held.sentDefaults)
    ? held.sentDefaults
    : defaultsOfGroups(draft.kind, SHIPPED_DEFAULT_TAGS)
  const after = defaultsOfGroups(draft.kind, tags)
  const next: PromptEdit = { ...draft }
  const groups = next as unknown as Record<PromptGroup, string[]>
  for (const group of PROMPT_GROUPS[draft.kind]) {
    const kept = held[group]
    if (!isTagList(kept)) continue
    groups[group] =
      before && after && (group === 'base' || group === 'negative')
        ? swapDefaults(kept, before[group], after[group])
        : [...kept]
  }
  return next
}

/**
 * The record with what one regenerate button sent kept under it, over whatever it kept before,
 * beside the default part of its shared groups as `tags` made them.
 */
export function withRegenEdit(
  character: Character,
  target: RegenTarget,
  edit: PromptEdit,
  tags: DefaultTags
): Character {
  const sentDefaults = defaultsOfGroups(edit.kind, tags)
  const kept: KeptEdit = sentDefaults ? { ...edit, sentDefaults } : edit
  return { ...character, regenTags: { ...character.regenTags, [target]: kept } }
}

/** The record with what these buttons kept forgotten; the field goes once nothing is kept. */
export function withoutRegenEdits(
  character: Character,
  targets: readonly RegenTarget[]
): Character {
  const { regenTags, ...rest } = character
  const kept = { ...regenTags }
  for (const target of targets) delete kept[target]
  return Object.keys(kept).length > 0 ? { ...rest, regenTags: kept } : rest
}
