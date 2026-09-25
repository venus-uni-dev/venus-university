import type { Character, RegenTarget } from './types'
import type { PromptEdit } from './imagePrompt'

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

/** Whether a value read off a hand-editable record is a list of tags. */
function isTagList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((tag) => typeof tag === 'string')
}

/**
 * What a regenerate opens on: the edit its button last sent, where that is of the draft's kind
 * and wardrobe, group by group where each is a list of tags; the draft's group otherwise.
 */
export function withRegenTags(draft: PromptEdit, stored: unknown): PromptEdit {
  if (typeof stored !== 'object' || stored === null) return draft
  const held = stored as Partial<Record<PromptGroup | 'kind' | 'set', unknown>>
  if (held.kind !== draft.kind) return draft
  if (draft.kind === 'sprite' && held.set !== draft.set) return draft
  const next: PromptEdit = { ...draft }
  const groups = next as unknown as Record<PromptGroup, string[]>
  for (const group of PROMPT_GROUPS[draft.kind]) {
    const tags = held[group]
    if (isTagList(tags)) groups[group] = [...tags]
  }
  return next
}

/** The record with what one regenerate button sent kept under it, over whatever it kept before. */
export function withRegenEdit(
  character: Character,
  target: RegenTarget,
  edit: PromptEdit
): Character {
  return { ...character, regenTags: { ...character.regenTags, [target]: edit } }
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
