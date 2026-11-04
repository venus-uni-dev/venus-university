import type {
  Character,
  CustomOutfit,
  CustomOutfitSlot,
  Emotion,
  ExpressionTarget,
  OutfitSet,
  SeededSet,
  SpriteRef,
  StockOutfitSet
} from './types'
import { EMOTIONS, isEmotion } from './emotions'
import { withoutRegenEdits } from './regenTags'

/** The three wardrobes every character has, in a stable order. */
export const STOCK_OUTFIT_SETS: readonly StockOutfitSet[] = ['pe', 'swim', 'nude'] as const

/** A custom wardrobe slot's id: `custom` and a whole number from one, with no zero in front. */
const CUSTOM_OUTFIT_SLOT_ID = /^custom([1-9]\d*)$/

/** The slot holding the custom wardrobe numbered `n`, counted from one. */
export function customOutfitSlotAt(n: number): CustomOutfitSlot {
  return `custom${n}`
}

/** The custom wardrobe slots among some keys, each once and in slot-number order. */
export function customOutfitSlotsIn(keys: Iterable<string>): CustomOutfitSlot[] {
  const slots = new Set<CustomOutfitSlot>()
  for (const key of keys) if (isCustomOutfitSlot(key)) slots.add(key)
  return [...slots].sort((a, b) => customSlotNumber(a) - customSlotNumber(b))
}

/** The longest a player-authored wardrobe's name may be. */
export const CUSTOM_OUTFIT_NAME_MAX = 20

/** The longest a player-authored wardrobe's instructions may be. */
export const CUSTOM_OUTFIT_INSTRUCTIONS_MAX = 200

/**
 * A custom wardrobe's name as it is kept and shown: lowercase, every space taken out, cut to
 * {@link CUSTOM_OUTFIT_NAME_MAX}; empty for anything that is not a string.
 */
export function customOutfitName(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw.toLowerCase().replace(/\s+/g, '').slice(0, CUSTOM_OUTFIT_NAME_MAX)
}

/**
 * A custom wardrobe's instructions as they are kept: one line, trimmed, cut to
 * {@link CUSTOM_OUTFIT_INSTRUCTIONS_MAX}; empty for anything that is not a string.
 */
export function customOutfitInstructions(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw.replace(/\s+/g, ' ').trim().slice(0, CUSTOM_OUTFIT_INSTRUCTIONS_MAX).trim()
}

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

/** Type guard narrowing an arbitrary string to {@link OutfitSet}: a stock set or a custom slot. */
export function isOutfitSet(value: string): value is OutfitSet {
  return (STOCK_OUTFIT_SETS as readonly string[]).includes(value) || isCustomOutfitSlot(value)
}

/**
 * Type guard narrowing an arbitrary string to {@link CustomOutfitSlot}: the id's shape, with a
 * number small enough to be counted exactly.
 */
export function isCustomOutfitSlot(value: string): value is CustomOutfitSlot {
  const match = CUSTOM_OUTFIT_SLOT_ID.exec(value)
  return match !== null && Number.isSafeInteger(Number(match[1]))
}

/** Which slot this is, counted from one — what an unnamed wardrobe is called by. */
export function customSlotNumber(slot: CustomOutfitSlot): number {
  return Number(slot.slice('custom'.length))
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
  const name = customOutfitName(character.customOutfits?.[set]?.name)
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
 * The record with a write merged into one player-authored wardrobe: a field the patch leaves
 * `undefined` keeps what the slot holds, and a name or instructions left blank are dropped.
 */
export function withCustomOutfit(
  character: Character,
  slot: CustomOutfitSlot,
  patch: Partial<CustomOutfit>
): Character {
  const held = character.customOutfits?.[slot]
  const tags = patch.tags ?? held?.tags ?? []
  const name = customOutfitName(patch.name !== undefined ? patch.name : held?.name)
  const instructions = customOutfitInstructions(
    patch.instructions !== undefined ? patch.instructions : held?.instructions
  )
  return {
    ...character,
    customOutfits: {
      ...character.customOutfits,
      [slot]: { tags, ...(name ? { name } : {}), ...(instructions ? { instructions } : {}) }
    }
  }
}

/** One custom wardrobe the writer is offered, under the suffix it writes her into it with. */
export interface OfferedOutfit {
  slot: CustomOutfitSlot
  /** Her name for it, or the slot id where that name is blank or already answers to a set. */
  suffix: string
  tags: readonly string[]
  instructions: string
}

/**
 * The custom wardrobes the writer may put her in, in slot order: those rendered whole and given
 * instructions. Each suffix is unique to her and never a set id.
 */
export function offeredCustomOutfits(
  character: Character,
  ready: readonly OutfitSet[] | undefined
): OfferedOutfit[] {
  const taken = new Set<string>()
  const offered: OfferedOutfit[] = []
  for (const slot of customOutfitSlotsIn(ready ?? [])) {
    const entry = character.customOutfits?.[slot]
    const instructions = customOutfitInstructions(entry?.instructions)
    if (!instructions) continue
    const name = customOutfitName(entry?.name)
    const suffix = name && !isOutfitSet(name) && !taken.has(name) ? name : slot
    taken.add(suffix)
    offered.push({ slot, suffix, tags: outfitTagsFor(character, slot), instructions })
  }
  return offered
}

/**
 * The sprite reference a written one stands for — `happy_bunnygirl` -> `happy_custom1` — or
 * `null` where it names no offered wardrobe. Cut at the first underscore: no `Emotion` holds one.
 */
export function storedRefOf(written: string, offered: readonly OfferedOutfit[]): SpriteRef | null {
  const cut = written.indexOf('_')
  if (cut < 0) return null
  const emotion = written.slice(0, cut)
  if (!isEmotion(emotion)) return null
  const hit = offered.find((outfit) => outfit.suffix === written.slice(cut + 1))
  return hit ? spriteRef(emotion, hit.slot) : null
}

/**
 * A stored sprite reference as the writer reads it: an offered wardrobe under its suffix, a
 * custom one not offered as the bare emotion, anything else as it is.
 */
export function writtenRefOf(ref: SpriteRef, offered: readonly OfferedOutfit[]): string {
  const parsed = parseSpriteRef(ref)
  if (!parsed?.set || !isCustomOutfitSlot(parsed.set)) return ref
  const hit = offered.find((outfit) => outfit.slot === parsed.set)
  return hit ? `${parsed.emotion}_${hit.suffix}` : parsed.emotion
}

/**
 * The record with one player-authored wardrobe gone, seed provenance included, and the tags
 * its button and its sprites' buttons last sent: the next run in that slot is a fresh set,
 * armed to follow her main seed.
 */
export function withoutCustomOutfit(character: Character, slot: CustomOutfitSlot): Character {
  const { [slot]: _gone, ...rest } = character.customOutfits ?? {}
  const { [slot]: _seed, ...setSeeds } = character.setSeeds
  const { [slot]: _flag, ...seedFollowsMain } = character.seedFollowsMain
  const { customOutfits: _all, ...without } = character
  return withoutRegenEdits(
    {
      ...without,
      setSeeds,
      seedFollowsMain,
      ...(Object.keys(rest).length > 0 ? { customOutfits: rest } : {})
    },
    [slot, ...EMOTIONS.map((emotion) => expressionTargetFor(emotion, slot))]
  )
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

/** The target naming one sprite of one wardrobe, as its own control and its kept tags address it. */
export function expressionTargetFor(emotion: Emotion, set: OutfitSet | null): ExpressionTarget {
  return `expression:${spriteRef(emotion, set)}`
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

/**
 * The name `chars:readWardrobeImage` asks for a set's base frame by — what Erase artifacts cuts
 * beside the sprites, so a single re-roll keeps the erase.
 */
export const BASE_IMAGE = 'base'

/** Every sprite reference for one set — what the scene prompt offers RITA in the enum. */
export function spriteRefsFor(set: OutfitSet): SpriteRef[] {
  return EMOTIONS.map((emotion) => spriteRef(emotion, set))
}
