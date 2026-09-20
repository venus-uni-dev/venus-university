import { pairBackgrounds } from '@shared/backgroundSets'
import type { BackgroundSets } from '@shared/types'

/**
 * Every shipped background and its thumbnail, resolved to bundled URLs at build time. A glob
 * because the base name is only known at runtime, which a `new URL(...)` cannot follow.
 */
const BG_URLS = import.meta.glob<string>('../../../assets/bg/*/*.png', {
  eager: true,
  query: '?url',
  import: 'default'
})

/** The full renders' quarter-scale WebP stand-ins, shipped so a grid of them draws small. */
const BG_THUMB_URLS = import.meta.glob<string>('../../../assets/bg_thumbs/*/*.webp', {
  eager: true,
  query: '?url',
  import: 'default'
})

/** The glob's URLs re-keyed by bare `{base}_{day|night}` stem; bg ids carry no category. */
const BG_BY_STEM: Record<string, string> = Object.fromEntries(
  Object.entries(BG_URLS).map(([path, url]) => [path.slice(path.lastIndexOf('/') + 1, -4), url])
)

/** The thumbnail glob's URLs, re-keyed the same way. */
const BG_THUMB_BY_STEM: Record<string, string> = Object.fromEntries(
  Object.entries(BG_THUMB_URLS).map(([path, url]) => [
    path.slice(path.lastIndexOf('/') + 1, -5),
    url
  ])
)

/** The shipped file names grouped by the category folder they sit in. */
const BG_NAMES_BY_CATEGORY: Record<string, string[]> = {}
for (const path of Object.keys(BG_URLS)) {
  const parts = path.split('/')
  const category = parts[parts.length - 2]
  ;(BG_NAMES_BY_CATEGORY[category] ??= []).push(parts[parts.length - 1])
}

/** Which base names have both renders, by category — what the scene prompt may name. */
export function shippedBackgrounds(): BackgroundSets {
  return pairBackgrounds(BG_NAMES_BY_CATEGORY)
}

/** The category folder each base name is shipped under; a pair's two halves share one entry. */
const BG_KIND_BY_BASE: Record<string, 'interior' | 'exterior'> = {}
for (const path of Object.keys(BG_URLS)) {
  const parts = path.split('/')
  const kind = parts[parts.length - 2]
  const stem = parts[parts.length - 1].slice(0, -4)
  // A rain render is the slot's own picture in another sky, so it names no base of its own.
  if (stem.endsWith('_rain')) continue
  if (kind === 'interior' || kind === 'exterior') {
    BG_KIND_BY_BASE[stem.slice(0, stem.lastIndexOf('_'))] = kind
  }
}

/** Which of the two folders a background base name is shipped in, or null if it is neither's. */
export function bgKindOf(base: string): 'interior' | 'exterior' | null {
  return BG_KIND_BY_BASE[base] ?? null
}

/** What the background layer falls back to between scenes — the reader's own dorm. */
export const SLOT_BG = 'lowrise_dorm_room'

/**
 * Bundled URL for a background base name at the current slot, or null if absent. A wet slot
 * takes the place's rain render where one is shipped and the dry picture where none is, so
 * every caller says which sky it is asking for.
 */
export function bgUrl(base: string, suffix: 'day' | 'night', wet: boolean): string | null {
  const stem = `${base}_${suffix}`
  return (wet ? BG_BY_STEM[`${stem}_rain`] : undefined) ?? BG_BY_STEM[stem] ?? null
}

/**
 * The small picture a grid draws for a background, or the full one where no thumbnail is
 * shipped. Always the dry one: a grid of these is a picker of places.
 */
export function bgThumbUrl(base: string, suffix: 'day' | 'night'): string | null {
  return BG_THUMB_BY_STEM[`${base}_${suffix}`] ?? bgUrl(base, suffix, false)
}
