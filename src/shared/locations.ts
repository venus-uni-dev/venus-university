/**
 * The location vocabulary: every place a character can be found in, and the one blurb
 * ever written about each. The ids are the lorebook's own; `lorebook.test.ts` asserts
 * every one resolves to an entry.
 */

import type { ShiftSlot } from './types'

/** The sentinel a home slot stores for her own room. */
export const ROOM_LOCATION = 'room'

/** Where the weekly grocery run goes. */
export const GROCERY_LOCATION = 'spring_mart'

/**
 * The dorms as a place: a character home in a Lowrise is findable in its shared kitchens and
 * lounges, never in her room.
 */
export const LOWRISE_LOCATION = 'lowrise_dorms'

/**
 * The senior housing as the same kind of place as a Lowrise: run into on its porches and paths
 * exactly as a Lowrise resident is. **Only the Lowrises are in {@link LOCATIONS}**, though —
 * Elysium is somewhere people only live, so a resident there is found by her home slot instead.
 */
export const ELYSIUM_LOCATION = 'elysium_village'

/** One place a character can be scheduled at, or found working at. */
export interface LocationDef {
  /** A `LoreEntry.id`, which is what ties the place to its paragraph. */
  id: string
  /** What the place is called in the one sentence that says where she is. */
  label: string
  /**
   * The single line both the profile call and the classifier read it by, and what the map's Go
   * says about the place on a hover.
   */
  blurb: string
  /** The one glyph the map ever draws this place with. */
  icon: string
  /** The place is on university grounds, which is the pane of the map it sits in. */
  onCampus?: true
  /** Emptied on a day an occasion closes campus, like `JobDef.closesWithUniversity`. */
  closesWithUniversity?: true
  /**
   * The shift-week slots the place is open (`weekday * 2 + time`, Monday 0, nights odd); absent,
   * it is open every half of every day. Read through {@link isLocationOpen}.
   */
  hours?: readonly ShiftSlot[]
}

/** The night half of every day. */
const EVERY_NIGHT: readonly ShiftSlot[] = [1, 3, 5, 7, 9, 11, 13]

/** Tuesday through Saturday nights: a club dark on Sunday and Monday. */
const TUESDAY_TO_SATURDAY_NIGHTS: readonly ShiftSlot[] = [3, 5, 7, 9, 11]

/** Dinner service every night, and the Saturday and Sunday brunch sittings on top of it. */
const NIGHTS_AND_WEEKEND_DAYS: readonly ShiftSlot[] = [1, 3, 5, 7, 9, 10, 11, 12, 13]

/** Every location a character can be placed at, in id order. */
export const LOCATIONS: readonly LocationDef[] = [
  {
    id: 'agora',
    label: 'the Agora',
    blurb: 'a student center with a tutoring office, app-booked study pods and a food court',
    icon: '🏛️',
    onCampus: true,
    closesWithUniversity: true
  },
  {
    id: 'apogee_club',
    label: 'Club Apogee',
    blurb: 'an expensive nightclub at the top of a Promenade skyscraper',
    icon: '🪩',
    hours: TUESDAY_TO_SATURDAY_NIGHTS
  },
  {
    id: 'bobbys_diner',
    label: "Bobby's Diner",
    blurb:
      'a cozy Downtown diner with a menu unchanged since the war and waitresses in period costume',
    icon: '🥞'
  },
  {
    id: 'btb_arcade',
    label: 'BTB Arcade',
    blurb: 'a popular warehouse-sized arcade with retro cabinets and dance machines',
    icon: '🕹️'
  },
  {
    id: 'cutetea',
    label: 'CuteTea',
    blurb: 'a campus-favorite bubble tea shop with borrow-able board games',
    icon: '🧋'
  },
  {
    id: 'eastern_buffet',
    label: 'Eastern Buffet',
    blurb: 'an absurdly cheap Korean, Japanese and Chinese buffet open around the clock',
    icon: '🥡'
  },
  {
    id: 'fast_eats',
    label: 'Fast Eats',
    blurb: 'a fast food chain with an eclectic menu the size of a newspaper',
    icon: '🍔'
  },
  {
    id: 'freights_books',
    label: 'Freights Books & Records',
    blurb:
      'a two-floor labyrinth of bargain books, manga and records in an old freight warehouse on Stanchion',
    icon: '💿'
  },
  {
    id: 'green_hill_park',
    label: 'Green Hill Park',
    blurb: 'a big public park at the center of Downtown with hills and cobbled paths',
    icon: '🌳'
  },
  {
    id: 'kendall_library',
    label: 'Kendall Library',
    blurb: 'a sprawling, high-tech library with computer terminals',
    icon: '📚',
    onCampus: true,
    closesWithUniversity: true
  },
  {
    id: 'lowrise_dorms',
    label: 'her dorm',
    blurb: 'a multi-building student dorm complex with shared kitchens, lounges and courtyards',
    icon: '🏘️',
    onCampus: true
  },
  {
    id: 'lumiere_fusion',
    label: 'Lumiere Fusion',
    blurb: 'a reservations-only fine dining restaurant',
    icon: '🍽️',
    hours: NIGHTS_AND_WEEKEND_DAYS
  },
  {
    id: 'palaestra_stadium',
    label: 'Palaestra Stadium',
    blurb: 'an athletics complex with a track, pool, weight rooms, sports fields and courts',
    icon: '🏟️',
    onCampus: true,
    closesWithUniversity: true
  },
  {
    id: 'pino_cola_lounge',
    label: 'Pino-Cola Lounge',
    blurb: 'a lively student lounge with study desks, game consoles, ping pong and old arcade machines',
    icon: '🏓',
    onCampus: true,
    closesWithUniversity: true
  },
  {
    id: 'reserve_bank_cafe',
    label: 'Reserve Bank Cafe',
    blurb: 'an expensive cafe with fast wi-fi, popular with VU students',
    icon: '☕'
  },
  {
    id: 'spring_mart',
    label: 'SpringMart',
    blurb: "a one-stop groceries and everyday goods shop unique to Veridan",
    icon: '🛒'
  },
  {
    id: 'stalestein_bar',
    label: 'Stalestein Bar',
    blurb: 'a grungy underground dive bar with a small stage',
    icon: '🍺',
    hours: EVERY_NIGHT
  },
  {
    id: 'thorne_auditorium',
    label: 'Thorne Auditorium',
    blurb: 'a concert hall with practice rooms and recording studios in its basement',
    icon: '🎼',
    onCampus: true,
    closesWithUniversity: true
  },
  {
    id: 'venus_quad',
    label: 'Venus Quad',
    blurb: 'a landscaped park at the center of campus: fire pits, gazebos and the Concord Fountain',
    icon: '⛲',
    onCampus: true,
    closesWithUniversity: true
  },
  {
    id: 'whitman_greenhouse',
    label: 'Whitman Greenhouse',
    blurb: 'a botanical greenhouse managed by the CAPC and a relaxing hangout spot for students',
    icon: '🌿',
    onCampus: true,
    closesWithUniversity: true
  }
]

/** The places with a def that no week is ever dealt. */
export const NARRATIVE_LOCATIONS: readonly LocationDef[] = [
  {
    id: 'future_cinema',
    label: 'Future Cinema',
    blurb: 'a fancy chain cinema attached to the Riverside Mall, showing both modern and classic films',
    icon: '🎬'
  },
  {
    id: 'hotel_dreams',
    label: 'Hotel DREAMS',
    blurb: 'a shady boutique hotel with themed rooms booked by the hour, and a massage parlor attached',
    icon: '🏨'
  },
  {
    id: 'lotterdale_market',
    label: 'Lotterdale Market',
    blurb: "a barnhouse farmer's and flea market carrying hand-made goods, antiques and trinkets",
    icon: '🧺'
  },
  {
    id: 'pastel_palace',
    label: 'Pastel Palace',
    blurb: 'a trendy sweets shop with viral limited-run pastries and seating built for couples',
    icon: '🧁'
  },
  {
    id: 'pier_44',
    label: 'Pier 44',
    blurb: 'a riverside amusement park and boardwalk with an antique carousel, cheap rides, and a ferris wheel',
    icon: '🎡'
  },
  {
    id: 'riverside_aquarium',
    label: 'Aquarium at Riverside',
    blurb: 'an aquarium with an under-river glass tunnel, a giant octopus and a dim jellyfish room',
    icon: '🐙'
  },
  {
    id: 'riverside_mall',
    label: 'Riverside Mall',
    blurb: 'a four-story mall with brand-name stores and fun activities like laser tag',
    icon: '🏬'
  },
  {
    id: 'selkie_beach',
    label: 'Selkie Beach',
    blurb: 'a riverside beach resort with cabanas, jet skis and boats for rent',
    icon: '🏖️'
  },
  {
    id: 'veridan_museum',
    label: 'Veridan Museum',
    blurb: 'an art museum featuring an upside-down ceiling garden and historic works by Veridan artists',
    icon: '🖼️'
  }
]

/** Where a group goes when it goes out; filtered by the place's hours at the roll. */
export const OUTING_LOCATIONS: readonly string[] = [
  'future_cinema',
  'lotterdale_market',
  'pastel_palace',
  'pier_44',
  'riverside_aquarium',
  'riverside_mall',
  'selkie_beach',
  'veridan_museum',
  'lumiere_fusion',
  'freights_books',
  'bobbys_diner',
  'eastern_buffet',
  'fast_eats',
  'btb_arcade',
  'cutetea',
  'stalestein_bar',
  'apogee_club',
  'green_hill_park'
]

/** Every place with a def, schedulable or not — what the two accessors resolve against. */
const ALL_LOCATIONS: readonly LocationDef[] = [...LOCATIONS, ...NARRATIVE_LOCATIONS]

/** The catalog entry for an id, or `undefined` for a place that is not one. */
export function locationDefOf(id: string): LocationDef | undefined {
  return ALL_LOCATIONS.find((def) => def.id === id)
}

/** Whether a place is open in a shift-week slot; a place with no hours always is. */
export function isLocationOpen(locationId: string, slot: number): boolean {
  const hours = locationDefOf(locationId)?.hours
  return !hours || hours.includes(slot as ShiftSlot)
}

/** What a location is called in the one sentence that prints it; an unknown id answers itself. */
export function locationLabel(id: string): string {
  return locationDefOf(id)?.label ?? id
}

/**
 * The four menus the profile call offers, each keyed by the short word the reply
 * answers with.
 */
export const STUDY_LOCATIONS: Readonly<Record<string, string>> = {
  agora: 'agora',
  lounge: 'pino_cola_lounge',
  library: 'kendall_library',
  cafe: 'reserve_bank_cafe',
  diner: 'bobbys_diner'
}

/** Where she eats out. */
export const MEAL_LOCATIONS: Readonly<Record<string, string>> = {
  fast_eats: 'fast_eats',
  diner: 'bobbys_diner',
  buffet: 'eastern_buffet',
  lumiere: 'lumiere_fusion',
  agora: 'agora'
}

export const FUN_LOCATIONS: Readonly<Record<string, string>> = {
  lounge: 'pino_cola_lounge',
  cutetea: 'cutetea',
  arcade: 'btb_arcade',
  bar: 'stalestein_bar',
  club: 'apogee_club'
}

export const ACTIVITY_LOCATIONS: Readonly<Record<string, string>> = {
  park: 'green_hill_park',
  stadium: 'palaestra_stadium',
  music_hall: 'thorne_auditorium',
  greenhouse: 'whitman_greenhouse',
  quad: 'venus_quad',
  freights: 'freights_books',
  arcade: 'btb_arcade',
  lounge: 'pino_cola_lounge',
  bar: 'stalestein_bar',
  cutetea: 'cutetea'
}

/** Renders one menu as the prompt prints it: `key: blurb` lines. */
export function locationMenuLines(menu: Readonly<Record<string, string>>): string[] {
  return Object.entries(menu).map(([key, id]) => `${key}: ${locationDefOf(id)?.blurb ?? id}`)
}

/** Resolves one of a menu's short keys onto its location id, or null. */
export function locationForKey(
  menu: Readonly<Record<string, string>>,
  key: string
): string | null {
  return menu[key.trim().toLowerCase()] ?? null
}
