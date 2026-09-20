import type { BackgroundSets } from './types'

/** Which of the shipped backgrounds are usable: a base name with both a day and a night render. */

/** The two folders the backgrounds are split into, and the order a collision resolves in. */
const BG_CATEGORIES = ['interior', 'exterior'] as const

/** The extension every background render is shipped under. */
const BG_EXTENSION = '.png'

/** Pairs one category's `_day`/`_night` renders, warning on the orphans it excludes. */
function pairedIn(names: readonly string[], category: string): string[] {
  const day = new Set<string>()
  const night = new Set<string>()
  for (const name of names) {
    if (!name.toLowerCase().endsWith(BG_EXTENSION)) continue
    const stem = name.slice(0, -BG_EXTENSION.length)
    // A rain render is a variant of the slot's own picture and never a base of its own.
    if (stem.endsWith('_rain')) continue
    if (stem.endsWith('_day')) day.add(stem.slice(0, -4))
    else if (stem.endsWith('_night')) night.add(stem.slice(0, -6))
    else console.warn(`[assets] bg/${category}/${name} has no _day/_night suffix — ignoring it.`)
  }

  const available: string[] = []
  for (const base of day) {
    if (night.has(base)) available.push(base)
    else console.warn(`[assets] bg "${base}" has a _day render but no _night — excluding it.`)
  }
  for (const base of night) {
    if (!day.has(base)) {
      console.warn(`[assets] bg "${base}" has a _night render but no _day — excluding it.`)
    }
  }

  return available.sort()
}

/**
 * The sorted base names that have both renders, one list per category, from the shipped file
 * names grouped by the folder they sit in. Interior wins a cross-folder name collision.
 */
export function pairBackgrounds(
  byCategory: Readonly<Record<string, readonly string[]>>
): BackgroundSets {
  for (const category of Object.keys(byCategory)) {
    if (!(BG_CATEGORIES as readonly string[]).includes(category)) {
      console.warn(`[assets] bg/${category} is not a category folder — ignoring it.`)
    }
  }

  const [interior, exterior] = BG_CATEGORIES.map((category) =>
    pairedIn(byCategory[category] ?? [], category)
  )

  const taken = new Set(interior)
  const uniqueExterior = exterior.filter((base) => {
    if (!taken.has(base)) return true
    console.warn(`[assets] bg "${base}" exists in both interior/ and exterior/ — using interior.`)
    return false
  })

  return { interior, exterior: uniqueExterior }
}
