import type { Character, Emotion, OutfitSet, SeededSet, SpriteRef } from './types'
import { EMOTIONS, isEmotion } from './emotions'

/**
 * The three alternate wardrobes, in a stable order (used for status grids, job counts and the
 * scene schema's emotion enum).
 */
export const OUTFIT_SETS: readonly OutfitSet[] = ['pe', 'swim', 'nude'] as const

/**
 * The keys of `Character.seedFollowsMain` — every optional set whose next render
 * either follows the character's main seed or rerolls.
 */
const SEEDED_SETS: readonly SeededSet[] = [...OUTFIT_SETS, 'cg'] as const

/** Every optional set armed to follow the main seed — a character's starting state. */
export function allFollowMain(): Record<SeededSet, boolean> {
  const flags = {} as Record<SeededSet, boolean>
  for (const set of SEEDED_SETS) flags[set] = true
  return flags
}

/** Type guard narrowing an arbitrary string to {@link OutfitSet}. */
export function isOutfitSet(value: string): value is OutfitSet {
  return (OUTFIT_SETS as readonly string[]).includes(value)
}

/** Human label for a set, for status lines and job cards. */
export const OUTFIT_SET_LABELS: Record<OutfitSet, string> = {
  pe: 'PE outfit',
  swim: 'swimsuit',
  nude: 'nude'
}

/** The nude set's tags, fixed; `Character` carries no field for them. */
const NUDE_OUTFIT_TAGS: readonly string[] = [
  'nude',
  'nipples',
  'navel',
  'pussy',
  'bare_arms',
  'bare_legs',
  'bare_shoulders',
  'barefoot'
] as const

/** Extra negatives the swimsuit set renders under: garments that survive the re-dressing. */
const SWIM_NEGATIVE_TAGS: readonly string[] = [
  'pantyhose',
  'thighhighs',
  'pants',
  'gloves'
] as const

/** The booru tags one outfit set renders from. */
export function outfitTagsFor(character: Character, set: OutfitSet): readonly string[] {
  if (set === 'pe') return character.peOutfit
  if (set === 'swim') return character.swimOutfit
  return NUDE_OUTFIT_TAGS
}

/** The tags one outfit set adds to the shared negative, if any. */
export function negativeTagsFor(set: OutfitSet): readonly string[] {
  return set === 'swim' ? SWIM_NEGATIVE_TAGS : []
}

/**
 * `happy` + `pe` -> `happy_pe`; a null set is the default wardrobe and stays a bare emotion. The
 * one definition of the suffix grammar — never re-split or re-join one by hand.
 */
export function spriteRef(emotion: Emotion, set: OutfitSet | null): SpriteRef {
  return set ? `${emotion}_${set}` : emotion
}

/**
 * The inverse of {@link spriteRef}, or `null` for anything that is not a sprite reference.
 * Relies on no `Emotion` ending in `_pe`/`_swim`/`_nude`.
 */
export function parseSpriteRef(
  value: string
): { emotion: Emotion; set: OutfitSet | null } | null {
  if (isEmotion(value)) return { emotion: value, set: null }

  const cut = value.lastIndexOf('_')
  if (cut < 0) return null

  const emotion = value.slice(0, cut)
  const set = value.slice(cut + 1)
  if (!isEmotion(emotion) || !isOutfitSet(set)) return null
  return { emotion, set }
}

/**
 * The name `chars:readWardrobeImage` asks for a set's one kept paint layer by, where every
 * other value it takes is an {@link Emotion}. It is the `'fix'` `WardrobeLayer`; the
 * hand repair's layer is never kept, so it is never read.
 */
export const FIX_IMAGE = 'fix'

/** Every sprite reference for one set — what the scene prompt offers RITA in the enum. */
export function spriteRefsFor(set: OutfitSet): SpriteRef[] {
  return EMOTIONS.map((emotion) => spriteRef(emotion, set))
}
