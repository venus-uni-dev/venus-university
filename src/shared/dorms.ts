/**
 * The dorm vocabulary: every place a character can live, and the one label ever
 * printed for each. The two options are the lorebook's own.
 */

import { locationDefOf, LOWRISE_LOCATION } from './locations'

/** Every dorm id the profile call may assign, sorted for a stable schema enum. */
export const DORM_IDS = [
  'elysium',
  'lowrise_1',
  'lowrise_2',
  'lowrise_3',
  'lowrise_4',
  'lowrise_5'
] as const

export type DormId = (typeof DORM_IDS)[number]

export function isDorm(value: string): value is DormId {
  return (DORM_IDS as readonly string[]).includes(value)
}

/** The repair target for a reply naming a dorm that does not exist. */
export const FALLBACK_DORM: DormId = 'lowrise_2'

/** What a dorm id is called everywhere it is printed. */
export function dormLabel(dorm: DormId): string {
  return dorm === 'elysium' ? 'Elysium Village' : `Lowrise ${dorm.slice(-1)}`
}

/** What the map calls the building a room is in: the five Lowrises are one place there. */
export function dormGroupLabel(dorm: DormId): string {
  return dorm === 'elysium' ? 'Elysium Village' : 'the Lowrises'
}

/** The glyph the map draws that building with. */
export function dormIcon(dorm: DormId): string {
  return dorm === 'elysium' ? '🏡' : '🏘️'
}

/**
 * The one line the map says about the building a room is in. The Lowrises have a location of
 * their own to say it; Elysium, which no week is ever dealt, says it here.
 */
export function dormGroupBlurb(dorm: DormId): string {
  return dorm === 'elysium'
    ? 'a row of coveted upperclassman townhouses with private patios, backed by woodland'
    : (locationDefOf(LOWRISE_LOCATION)?.blurb ?? '')
}

/** The ` Dorm: …` tail of a cast block's labeled facts line. */
export function dormClause(dorm: DormId): string {
  return ` | She has a single room at ${dormLabel(dorm)}.`
}

/** The same fact as lorebook prose. */
export function dormSentence(dorm: DormId): string {
  return ` She lives in ${dormLabel(dorm)}.`
}

/** Which of the two buildings a room is in: the five Lowrises are one of them. */
export type DormBuilding = 'lowrise' | 'elysium'

/** The building a dorm belongs to, or null for a character who has not been given one. */
export function dormBuildingOf(dorm: DormId | undefined): DormBuilding | null {
  if (dorm === undefined) return null
  return dorm === 'elysium' ? 'elysium' : 'lowrise'
}

/** One shared room inside a building, and the one label ever printed for it. */
export interface DormSpot {
  id: string
  label: string
  building: DormBuilding
}

/** Every shared room a resident can be run into in, in id order. */
const DORM_SPOTS: readonly DormSpot[] = [
  { id: 'elysium_lounge', label: 'an Elysium lounge', building: 'elysium' },
  { id: 'lowrise_kitchen', label: 'the Lowrise kitchen', building: 'lowrise' },
  { id: 'lowrise_lounge', label: 'the Lowrise lounge', building: 'lowrise' }
]

/** The shared rooms one building has. */
export function dormSpotsOf(building: DormBuilding): readonly DormSpot[] {
  return DORM_SPOTS.filter((spot) => spot.building === building)
}

/** What a shared room is called where it is printed; an unknown id answers itself. */
export function dormSpotLabel(id: string): string {
  return DORM_SPOTS.find((spot) => spot.id === id)?.label ?? id
}
