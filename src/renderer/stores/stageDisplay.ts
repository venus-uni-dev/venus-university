import { parseSpriteRef, spriteRef } from '@shared/outfits'
import { isPosition } from '@shared/positions'
import { sfwCgRefOf } from '@shared/sfw'
import type { OutfitLock, OutfitSet, Position, SpriteRef } from '@shared/types'

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

/** The sprite reference actually drawn for a character under a wardrobe lock. */
export function displaySpriteRef(
  ref: SpriteRef,
  lock: OutfitLock | undefined,
  ready: readonly OutfitSet[] | undefined
): SpriteRef {
  if (!lock || isPosition(ref)) return ref
  const parsed = parseSpriteRef(ref)
  if (!parsed) return ref
  if (lock === 'default') return spriteRef(parsed.emotion, null)
  return ready?.includes(lock) ? spriteRef(parsed.emotion, lock) : ref
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
