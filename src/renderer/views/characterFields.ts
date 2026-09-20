import { STAT_KEYS, STAT_LABELS } from '@shared/playerStats'
import { GIFT_CATEGORIES } from '@shared/shop'
import { CHARACTER_TRAITS } from '@shared/traits'
import type { CharacterBehavior, OutfitSet, SetTarget } from '@shared/types'

/**
 * What a character panel shows, and in what order — shared by the editor and the read-only
 * panel.
 */

/** The behaviour fields under "More settings", in relationship order. */
export const BEHAVIOR_FIELDS: ReadonlyArray<{ key: keyof CharacterBehavior; label: string }> = [
  { key: 'withStrangers', label: 'With strangers' },
  { key: 'withFriends', label: 'With friends' },
  { key: 'withCrush', label: 'With a crush' },
  { key: 'withLover', label: 'With a lover' },
  { key: 'withEnemy', label: 'With someone she dislikes' }
]

/**
 * The character's tag lists, in the order the wardrobes above them are shown. Each is a
 * `Character` field holding booru tags and is edited as chips.
 */
export const TAG_FIELDS: ReadonlyArray<{
  key: 'baseAppearance' | 'outfit' | 'peOutfit' | 'swimOutfit'
  id: string
  label: string
}> = [
  { key: 'baseAppearance', id: 'edit-appearance', label: 'Appearance' },
  { key: 'outfit', id: 'edit-outfit', label: 'Outfit' },
  { key: 'peOutfit', id: 'edit-pe-outfit', label: 'PE Outfit' },
  { key: 'swimOutfit', id: 'edit-swim-outfit', label: 'Swimwear' }
]

/** The four wardrobes in the order they are shown, named as the player sees them. */
export const WARDROBES: ReadonlyArray<{ target: SetTarget; set: OutfitSet | null; title: string }> =
  [
    { target: 'default', set: null, title: 'Default Outfit' },
    { target: 'pe', set: 'pe', title: 'PE Outfit' },
    { target: 'swim', set: 'swim', title: 'Swimsuit' },
    { target: 'nude', set: 'nude', title: 'Nude Outfit' }
  ]

/** The trait vocabulary as picker options (`shared/traits.ts`, authoritative). */
export const TRAIT_OPTIONS = CHARACTER_TRAITS.map((trait) => ({
  value: trait,
  label: trait
}))

/**
 * The three stats as the attraction picker's options (`shared/playerStats.ts`,
 * authoritative), labelled as the status panel labels them.
 */
export const PREFERRED_STAT_OPTIONS = STAT_KEYS.map((key) => ({
  value: key,
  label: STAT_LABELS[key]
}))

/** The gift vocabulary as picker options (`shared/shop.ts`, authoritative). */
export const GIFT_CATEGORY_OPTIONS = GIFT_CATEGORIES.map((category) => ({
  value: category,
  label: category
}))

/** Likes and dislikes are edited one per line; an entry is a phrase and may hold a comma. */
export function listText(values: readonly string[]): string {
  return values.join('\n')
}

export function textList(value: string): string[] {
  return value
    .split('\n')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}
