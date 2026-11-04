import { CG_SFXS, CG_VOICES } from '@shared/customCgs'
import { STAT_KEYS, STAT_LABELS } from '@shared/playerStats'
import { GIFT_CATEGORIES } from '@shared/shop'
import { CHARACTER_TRAITS } from '@shared/traits'
import type { CgSfx, CgVoice, CharacterBehavior, OutfitSet, SetTarget } from '@shared/types'

/**
 * What a character panel shows, and in what order — shared by the editor and the read-only
 * panel.
 */

/**
 * The behaviour fields under "More settings", in relationship order. `around` is the noun each
 * field's placeholder addresses her by.
 */
export const BEHAVIOR_FIELDS: ReadonlyArray<{
  key: keyof CharacterBehavior
  label: string
  around: string
}> = [
  { key: 'withStrangers', label: 'With strangers', around: 'strangers' },
  { key: 'withFriends', label: 'With friends', around: 'friends' },
  { key: 'withCrush', label: 'With a crush', around: 'a crush' },
  { key: 'withLover', label: 'With a lover', around: 'a lover' },
  { key: 'withEnemy', label: 'With someone she dislikes', around: 'someone she dislikes' }
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

/** The line under a custom outfit's Name field. */
export const OUTFIT_NAME_HINT = 'Custom outfit names must be lowercase with no spaces.'

/** The line under a custom outfit's Instructions field, wherever it is written, naming the outfit. */
export function outfitInstructionsHint(outfit: string): string {
  return `Include an optional instruction to the LLM on when to use this outfit, completing this sentence: Use the ${outfit} outfit when...`
}

/** The line under a custom CG's Name field. */
export const CG_NAME_HINT = 'Custom CG names must be lowercase with no spaces.'

/** What her appearance tags must carry for the colours the game reads off them. */
export const APPEARANCE_COLOR_HINT =
  'Gameplay expects a hair and eye color in the format of "_hair" and "_eyes". It also looks for a skin color tag like "_skin", "tan", "dark-skinned_female", or "freckles". LoRA trigger words should go here too.'

/** What Replace model output does with the LoRA's tags on New Character. */
export const LORA_REPLACE_NOTE =
  "Throws away the LLM's appearance and outfit tags and uses yours instead. Uncheck to add yours to the LLM's. A box left empty keeps the LLM's tags."

/** The confirm in front of a render whose character's LoRA ComfyUI does not list. */
export function loraMissingCopy(
  name: string,
  file: string
): { title: string; message: string; confirmText: string } {
  return {
    title: `Generate without ${name ? `${name}'s` : 'her'} LoRA?`,
    message: `ComfyUI can't find ${file}. It stays picked for her, and will be used again once it's back in the LoRA folder.`,
    confirmText: 'Generate without it'
  }
}

/** The line under a custom CG's Position LoRA picker. */
export const POSITION_LORA_HINT = 'LoRA trigger words should go in Position.'

/** The confirm in front of a render whose custom CG's position LoRA ComfyUI does not list. */
export function positionLoraMissingCopy(file: string): {
  title: string
  message: string
  confirmText: string
} {
  return {
    title: 'Generate without the position LoRA?',
    message: `ComfyUI can't find ${file}. It stays picked for this CG, and will be used again once it's back in the LoRA folder.`,
    confirmText: 'Generate without it'
  }
}

/** The line under a custom CG's Instructions field, wherever it is written. */
export const CG_INSTRUCTIONS_HINT =
  'Include an optional instruction to the LLM on when to use this CG, starting with "she", e.g. "she is riding him".'

/** What each breath a custom CG can play is called in its picker. */
const CG_VOICE_LABELS: Record<CgVoice, string> = {
  fast: 'Fast breathing',
  slow: 'Slow breathing',
  none: 'None'
}

/** The breaths as picker options (`shared/customCgs.ts`, authoritative). */
export const CG_VOICE_OPTIONS = CG_VOICES.map((voice) => ({
  value: voice,
  label: CG_VOICE_LABELS[voice]
}))

/** What each act loop a custom CG can play is called in its picker. */
const CG_SFX_LABELS: Record<CgSfx, string> = {
  sex: 'Sex',
  foreplay: 'Foreplay',
  oral: 'Blowjob',
  handjob: 'Handjob',
  none: 'None'
}

/** The act loops as picker options (`shared/customCgs.ts`, authoritative). */
export const CG_SFX_OPTIONS = CG_SFXS.map((sfx) => ({ value: sfx, label: CG_SFX_LABELS[sfx] }))

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

/** What an empty field of the sheet shows: the shape its prose wants, told about her by name. */
export function sheetPlaceholders(name: string): {
  personality: string
  backstory: string
  datingHistory: string
  datingPreference: string
  kinks: string
  likes: string
  dislikes: string
  behavior: (around: string) => string
} {
  return {
    personality: `${name} presents herself as... but actually she's... She wants..., but... keeps her from getting it. She has a habit of...`,
    backstory: `${name} grew up... As a result, she...`,
    datingHistory: `${name} hasn't dated/has dated before... As a result, she...`,
    datingPreference: `${name} prefers hookups/long term relationships...`,
    kinks: `${name} has a thing for...`,
    likes: 'favorite foods\nfavorite beverages\nactivities\nentertainment preferences',
    dislikes: 'disliked foods\nallergies\npet peeves\nsensory experiences',
    behavior: (around: string) => `Around ${around}, ${name}...`
  }
}
