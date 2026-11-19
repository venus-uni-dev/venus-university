import { isCustomOutfitSlot, parseSpriteRef, spriteRef } from '@shared/outfits'
import { customCgSlotOf, isPosition } from '@shared/positions'
import { sfwCgRefOf } from '@shared/sfw'
import type {
  CgLock,
  CustomCgSlot,
  OutfitLock,
  OutfitSet,
  Position,
  SpriteRef
} from '@shared/types'

/** The stage as it is *rendered*, which is not always the stage as the scene was written. */

/**
 * `slots` with the player's overrides applied: anybody he hid is blanked out of her cell,
 * anybody he showed fills a cell the scene left empty.
 */
export function displaySlotsOf(
  slots: readonly (string | null)[],
  stageOverride: Record<string, boolean>
): Array<string | null> {
  const shown = [...slots]
  for (const [charId, want] of Object.entries(stageOverride)) {
    if (want) continue
    const at = shown.indexOf(charId)
    if (at !== -1) shown[at] = null
  }
  for (const [charId, want] of Object.entries(stageOverride)) {
    if (!want || shown.includes(charId)) continue
    const free = shown.indexOf(null)
    if (free === -1) continue
    shown[free] = charId
  }
  return shown
}

/** The one CG drawn over the whole stage, and whose it is. */
export interface DisplayedCg {
  charId: string
  position: Position
}

/** What the stage knows of which CGs are on disk, by charId; an absent entry is not read yet. */
export interface CgReadiness {
  cgReady: Record<string, boolean>
  customCgReady: Record<string, readonly CustomCgSlot[]>
  /** Whether the stock eight are in play for this reader at all (`stockCgsInPlay`). */
  stockCgs: boolean
}

/**
 * Whether one of her CGs is known not to be on disk: a custom one whose pair her readiness, once
 * read, does not list. A stock CG counts as there while the stock eight are in play, as does any
 * CG before her readiness is read.
 */
export function cgKnownMissing(charId: string, position: Position, ready: CgReadiness): boolean {
  const slot = customCgSlotOf(position)
  if (!slot) return !ready.stockCgs
  const held = ready.customCgReady[charId]
  return held !== undefined && !held.includes(slot)
}

/**
 * The CG on screen, the one definition the stage, the sound and the save's picture share: the
 * player's lock while it names a CG of somebody who exists, not known missing and not withheld,
 * else the first shown occupant standing in a CG not known missing, else none.
 */
export function displayedCgOf(input: {
  shown: readonly (string | null)[]
  emotions: Record<string, SpriteRef>
  lock: CgLock | null | undefined
  hasCharacter: (charId: string) => boolean
  ready: CgReadiness
  noNsfwImages: boolean
}): DisplayedCg | null {
  const { lock, ready } = input
  if (
    lock &&
    !input.noNsfwImages &&
    isPosition(lock.position) &&
    input.hasCharacter(lock.charId) &&
    !cgKnownMissing(lock.charId, lock.position, ready)
  ) {
    return { charId: lock.charId, position: lock.position }
  }
  for (const charId of input.shown) {
    if (!charId || !input.hasCharacter(charId)) continue
    const ref = input.emotions[charId]
    if (ref && isPosition(ref) && !cgKnownMissing(charId, ref, ready)) {
      return { charId, position: ref }
    }
  }
  return null
}

/**
 * The sprite reference actually drawn for a character under a wardrobe lock. A custom wardrobe
 * no longer whole on disk — deleted under a save that has her in it — draws her default one,
 * a custom CG known missing (`customCgs` read and lacking its pair) the sprite it retires to, and
 * so does a stock CG while the stock eight are out of play.
 */
export function displaySpriteRef(
  ref: SpriteRef,
  lock: OutfitLock | undefined,
  ready: readonly OutfitSet[] | undefined,
  customCgs: readonly CustomCgSlot[] | undefined,
  stockCgs: boolean
): SpriteRef {
  if (isPosition(ref)) {
    const slot = customCgSlotOf(ref)
    const missing = slot ? customCgs !== undefined && !customCgs.includes(slot) : !stockCgs
    if (!missing) return ref
    const retired = cgRetiredRef(ref, ready?.includes('nude') === true, false)
    return displaySpriteRef(retired, lock, ready, customCgs, stockCgs)
  }
  const parsed = parseSpriteRef(ref)
  if (!parsed) return ref
  const worn =
    parsed.set && isCustomOutfitSlot(parsed.set) && ready && !ready.includes(parsed.set)
      ? spriteRef(parsed.emotion, null)
      : ref
  if (!lock) return worn
  if (lock === 'default') return spriteRef(parsed.emotion, null)
  return ready?.includes(lock) ? spriteRef(parsed.emotion, lock) : worn
}

/** Whether a change of sprite is a change of wardrobe, and so of her silhouette. */
export function wardrobeChanged(from: SpriteRef, to: SpriteRef): boolean {
  return (parseSpriteRef(from)?.set ?? null) !== (parseSpriteRef(to)?.set ?? null)
}

/**
 * What a girl wears once her CG ends: the mood the CG was for — aroused mid-sex, happy for an
 * `_after` — in the nude set when she has one rendered and images are not withheld.
 */
function cgRetiredRef(
  position: Position,
  nudeReady: boolean,
  noNsfwImages: boolean
): SpriteRef {
  const base = sfwCgRefOf(position, undefined)
  const parsed = parseSpriteRef(base)
  if (!parsed || !nudeReady || noNsfwImages) return base
  return spriteRef(parsed.emotion, 'nude')
}

/** What {@link retireCgs} needs about the characters it is retiring. */
export interface CgRetireContext {
  /** Which alternate wardrobes each character has fully rendered, by charId. */
  outfitReady: Record<string, readonly OutfitSet[]>
  /** The player's `noNsfwImages` setting. */
  noNsfwImages: boolean
}

/**
 * The same sticky references with every named occupant's CG swapped for the sprite it retires
 * to. The record itself is returned untouched when nobody was in one.
 */
export function retireCgs(
  emotions: Record<string, SpriteRef>,
  occupants: readonly string[],
  ctx: CgRetireContext
): Record<string, SpriteRef> {
  let next = emotions
  for (const charId of occupants) {
    const ref = emotions[charId]
    if (!ref || !isPosition(ref)) continue
    if (next === emotions) next = { ...emotions }
    next[charId] = cgRetiredRef(
      ref,
      ctx.outfitReady[charId]?.includes('nude') === true,
      ctx.noNsfwImages
    )
  }
  return next
}
