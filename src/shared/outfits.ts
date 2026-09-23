import type {
  Character,
  CustomOutfit,
  CustomOutfitSlot,
  Emotion,
  OutfitSet,
  SeededSet,
  SpriteRef,
  StockOutfitSet
} from './types'
import { EMOTIONS, isEmotion } from './emotions'

/** The three wardrobes every character has, in a stable order. */
export const STOCK_OUTFIT_SETS: readonly StockOutfitSet[] = ['pe', 'swim', 'nude'] as const

/** The five slots a player-authored wardrobe can occupy, in slot order. */
export const CUSTOM_OUTFIT_SLOTS: readonly CustomOutfitSlot[] = [
  'custom1',
  'custom2',
  'custom3',
  'custom4',
  'custom5'
] as const

/**
 * Every alternate wardrobe, in a stable order (used for status grids, job counts and the
 * scene schema's emotion enum).
 */
export const OUTFIT_SETS: readonly OutfitSet[] = [
  ...STOCK_OUTFIT_SETS,
  ...CUSTOM_OUTFIT_SLOTS
] as const

/** The longest a player-authored wardrobe's name may be. */
export const CUSTOM_OUTFIT_NAME_MAX = 20

/**
 * The keys of `Character.seedFollowsMain` — every optional set whose next render
 * either follows the character's main seed or rerolls.
 */
const SEEDED_SETS: readonly SeededSet[] = [...STOCK_OUTFIT_SETS, 'cg'] as const

/** Every optional set armed to follow the main seed — a character's starting state. */
export function allFollowMain(): Partial<Record<SeededSet, boolean>> {
  const flags: Partial<Record<SeededSet, boolean>> = {}
  for (const set of SEEDED_SETS) flags[set] = true
  return flags
}

/** Whether one optional set's next render follows the character's main seed. */
export function followsMain(character: Character, key: SeededSet): boolean {
  return character.seedFollowsMain[key] ?? true
}

/** Type guard narrowing an arbitrary string to {@link OutfitSet}. */
export function isOutfitSet(value: string): value is OutfitSet {
  return (OUTFIT_SETS as readonly string[]).includes(value)
}

/** Type guard narrowing an arbitrary string to {@link CustomOutfitSlot}. */
export function isCustomOutfitSlot(value: string): value is CustomOutfitSlot {
  return (CUSTOM_OUTFIT_SLOTS as readonly string[]).includes(value)
}

/** Which of the five slots this is, 1 to 5 — what an unnamed wardrobe is called by. */
export function customSlotNumber(slot: CustomOutfitSlot): number {
  return CUSTOM_OUTFIT_SLOTS.indexOf(slot) + 1
}

/** Human label for a stock set, for status lines and job cards. */
export const OUTFIT_SET_LABELS: Record<StockOutfitSet, string> = {
  pe: 'PE wear',
  swim: 'swimsuit',
  nude: 'nude'
}

/** What one of a character's sets is called on screen: her own name for a custom slot. */
export function outfitLabelOf(character: Character, set: OutfitSet): string {
  if (!isCustomOutfitSlot(set)) return OUTFIT_SET_LABELS[set]
  const name = character.customOutfits?.[set]?.name
  return name ? name : `Custom outfit ${customSlotNumber(set)}`
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

/**
 * The booru tags one outfit set renders from. A custom slot's are read defensively, since a
 * hand-edited record reaches the prompt builder unvalidated.
 */
export function outfitTagsFor(character: Character, set: OutfitSet): readonly string[] {
  if (set === 'pe') return character.peOutfit
  if (set === 'swim') return character.swimOutfit
  if (set === 'nude') return NUDE_OUTFIT_TAGS
  const tags = character.customOutfits?.[set]?.tags
  return Array.isArray(tags) ? tags.filter((tag) => typeof tag === 'string') : []
}

/**
 * The record with one player-authored wardrobe written into it; a blank name is dropped
 * rather than stored, and a long one is cut to {@link CUSTOM_OUTFIT_NAME_MAX}.
 */
export function withCustomOutfit(
  character: Character,
  slot: CustomOutfitSlot,
  entry: CustomOutfit
): Character {
  const name = (entry.name ?? '').trim().slice(0, CUSTOM_OUTFIT_NAME_MAX)
  return {
    ...character,
    customOutfits: {
      ...character.customOutfits,
      [slot]: { tags: entry.tags, ...(name ? { name } : {}) }
    }
  }
}

/**
 * The record with one player-authored wardrobe gone, seed provenance included: the next run
 * in that slot is a fresh set, armed to follow her main seed.
 */
export function withoutCustomOutfit(character: Character, slot: CustomOutfitSlot): Character {
  const { [slot]: _gone, ...rest } = character.customOutfits ?? {}
  const { [slot]: _seed, ...setSeeds } = character.setSeeds
  const { [slot]: _flag, ...seedFollowsMain } = character.seedFollowsMain
  const { customOutfits: _all, ...without } = character
  return {
    ...without,
    setSeeds,
    seedFollowsMain,
    ...(Object.keys(rest).length > 0 ? { customOutfits: rest } : {})
  }
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
 * Relies on no `Emotion` ending in an underscore and an outfit set's id.
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
