import {
  dormGroupBlurb,
  dormGroupLabel,
  dormIcon,
  FALLBACK_DORM,
  type DormId
} from '@shared/dorms'
import { jobDefOf, shiftSlotOf } from '@shared/jobs'
import {
  ELYSIUM_LOCATION,
  LOCATIONS,
  LOWRISE_LOCATION,
  NARRATIVE_LOCATIONS,
  ROOM_LOCATION,
  locationDefOf,
  locationLabel
} from '@shared/locations'
import type { TimeSlot } from '@shared/types'
import { shiftWeekdayOf } from '../prompts/gameDate'
import { useGameStore } from './gameStore'
import {
  charAwayNow,
  charClassNow,
  charHiddenLocationNow,
  charJobNow,
  charRoomDormNow,
  charStandingHauntAt
} from './timetable'

/**
 * Where the player believes everybody is this hour; `timetable.ts` answers what is *true*.
 * **told** (a contact) reads `charHiddenLocationNow`; **remembered** reads the raw standing
 * haunt, only for a slot he's run into her on. An away contact is named, not placed.
 */

/** How the player comes to know it, and the only thing that decides what he sees. */
type WhereaboutsSource = 'told' | 'remembered'

/** What kind of answer a row is, which is what the view's furniture branches on. */
type WhereaboutsKind = 'place' | 'room' | 'class' | 'away' | 'unknown'

/** The section every class fills — one bucket, not one per class. */
export const CLASS_PLACE_KEY = 'class'

/** The section a contact the app cannot place falls into. */
export const UNKNOWN_PLACE_KEY = 'unknown'

/** The section a contact who has left the city for the week falls into. */
export const AWAY_PLACE_KEY = 'away'

/** The glyph over the out-of-town line. */
const AWAY_ICON = '✈️'

/** The glyph over the class bucket. */
const CLASS_ICON = '📖'

export interface Whereabouts {
  charId: string
  kind: WhereaboutsKind
  source: WhereaboutsSource
  /** A location id, or null for a room, a class and an unknown. */
  location: string | null
  /** The class code she is sitting in, set only for `'class'`. */
  classCode?: string
  /** The section she files under. */
  placeKey: string
  placeLabel: string
  placeIcon: string
  /** The one line the map's Go says about the place; empty where there is none. */
  placeBlurb: string
  /** Which pane of the map the section belongs to. */
  onCampus: boolean
}

/** What a section carries besides its people — the five fields a heading is. */
type Section = Pick<
  Whereabouts,
  'placeKey' | 'placeLabel' | 'placeIcon' | 'placeBlurb' | 'onCampus'
>

/** The one place a dorm becomes a section key. */
function dormPlaceKey(dorm: DormId): string {
  return dorm === 'elysium' ? 'dorm:elysium' : 'dorm:lowrise'
}

/**
 * Where a section sorts: the class bucket, then places in catalog order, then the two dorms,
 * then the two lines under them.
 */
const PLACE_ORDER: readonly string[] = [
  CLASS_PLACE_KEY,
  ...LOCATIONS.map((def) => def.id),
  ...NARRATIVE_LOCATIONS.map((def) => def.id),
  dormPlaceKey(FALLBACK_DORM),
  dormPlaceKey('elysium'),
  AWAY_PLACE_KEY,
  UNKNOWN_PLACE_KEY
]

/** The section a room in `dorm` files under — **building, not occupant**. */
function roomSection(dorm: DormId): Section {
  return {
    placeKey: dormPlaceKey(dorm),
    placeLabel: dormGroupLabel(dorm),
    placeIcon: dormIcon(dorm),
    placeBlurb: dormGroupBlurb(dorm),
    onCampus: true
  }
}

/** The section a location id fills. */
function placeSection(id: string): Section {
  if (id === LOWRISE_LOCATION) return roomSection(FALLBACK_DORM)
  const def = locationDefOf(id)
  return {
    placeKey: id,
    placeLabel: locationLabel(id),
    placeIcon: def?.icon ?? '📍',
    placeBlurb: def?.blurb ?? '',
    onCampus: def?.onCampus === true
  }
}

/** The dorm recorded for `charId`. */
function dormOf(charId: string): DormId {
  return useGameStore.getState().charInfo[charId].dorm
}

/** The told route: where she actually is, obligations included. */
function toldWhereabouts(charId: string, date: number, time: TimeSlot): Whereabouts {
  const base = { charId, source: 'told' as const }

  // First of everything, on `charHiddenLocationNow`'s own ordering.
  if (charAwayNow(charId, date)) {
    return {
      ...base,
      kind: 'away',
      location: null,
      placeKey: AWAY_PLACE_KEY,
      placeLabel: 'Out of town',
      placeIcon: AWAY_ICON,
      placeBlurb: '',
      onCampus: false
    }
  }

  const classCode = charClassNow(charId, date, time)
  if (classCode !== null) {
    return {
      ...base,
      kind: 'class',
      location: null,
      classCode,
      placeKey: CLASS_PLACE_KEY,
      placeLabel: 'In class',
      placeIcon: CLASS_ICON,
      placeBlurb: '',
      onCampus: true
    }
  }

  // A shift is just a location: she reads like anybody else standing at her employer's place.
  const jobId = charJobNow(charId, date, time)
  const workplace = jobId === null ? undefined : jobDefOf(jobId)?.locationId
  if (workplace !== undefined) {
    return { ...base, kind: 'place', location: workplace, ...placeSection(workplace) }
  }

  const location = charHiddenLocationNow(charId, date, time)
  if (location === null) {
    return {
      ...base,
      kind: 'unknown',
      location: null,
      placeKey: UNKNOWN_PLACE_KEY,
      placeLabel: 'Whereabouts unknown',
      placeIcon: '',
      placeBlurb: '',
      onCampus: false
    }
  }
  if (location === ROOM_LOCATION) {
    return {
      ...base,
      kind: 'room',
      location: null,
      ...roomSection(charRoomDormNow(charId, date, time) ?? dormOf(charId))
    }
  }
  return { ...base, kind: 'place', location, ...placeSection(location) }
}

/** The remembered route: her standing haunt, which is all an encounter bought him. */
function rememberedWhereabouts(charId: string, location: string): Whereabouts {
  const base = { charId, source: 'remembered' as const }
  // A week is never dealt somebody else's room, so this is always her own.
  if (location === ROOM_LOCATION) {
    return { ...base, kind: 'room', location: null, ...roomSection(dormOf(charId)) }
  }
  return { ...base, kind: 'place', location, ...placeSection(location) }
}

/**
 * Where a scene set at this section happens, as a location id both the lorebook and the casting
 * draw resolve — what the map's Go button hands off. **Null means nobody can be sent there**: a
 * lecture the reader may not be enrolled in, or one of the two non-place lines under the map.
 */
export function placeDestination(placeKey: string): string | null {
  if (placeKey === dormPlaceKey(FALLBACK_DORM)) return LOWRISE_LOCATION
  if (placeKey === dormPlaceKey('elysium')) return ELYSIUM_LOCATION
  return locationDefOf(placeKey) ? placeKey : null
}

/** Everyone the player can place this slot, in {@link PLACE_ORDER}. */
export function knownWhereabouts(date?: number, time?: TimeSlot): Whereabouts[] {
  const game = useGameStore.getState()
  const on = date ?? game.date
  const half = time ?? game.time
  const slot = shiftSlotOf(shiftWeekdayOf(on), half)

  const rows: Whereabouts[] = []
  for (const charId of game.chars) {
    const info = game.charInfo[charId]
    if (!info?.nameKnown) continue

    // A block drops her to the remembered route, not off the map. Not `isContact`
    // (`loop/classify.ts`), which ignores a block.
    if (info.flags?.gaveContactInfo && !info.flags?.blocked) {
      rows.push(toldWhereabouts(charId, on, half))
      continue
    }

    if (!info.metSlots?.includes(slot)) continue
    const haunt = charStandingHauntAt(charId, on, half)
    if (haunt === null) continue
    rows.push(rememberedWhereabouts(charId, haunt.location))
  }

  const rankOf = (key: string): number => {
    const rank = PLACE_ORDER.indexOf(key)
    return rank < 0 ? PLACE_ORDER.length : rank
  }
  return rows.sort((a, b) => rankOf(a.placeKey) - rankOf(b.placeKey))
}
