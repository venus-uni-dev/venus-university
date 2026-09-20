import { FINAL_DATE } from './classes'
import type { TimeSlot } from './types'

/**
 * The semester's sky: one reading per slot, rolled once at New Game onto the playthrough
 * record and read by everything that wants to know whether it is raining — the prompts, the
 * stage, the mix and the marks.
 */

/** What a slot's sky can be; appended, never reordered. */
export const WEATHER_KINDS = ['clear', 'rain', 'storm'] as const
export type Weather = (typeof WEATHER_KINDS)[number]

/** One reading per slot of the semester, day 0's morning first. */
export const WEATHER_SLOTS = (FINAL_DATE + 1) * 2

/** Where a slot's reading sits in the table. */
function weatherIndex(date: number, time: TimeSlot): number {
  return date * 2 + time
}

/**
 * The sky in one slot. A date off either end of the table, or a value the vocabulary does not
 * know, reads clear — so a hand-shortened table is legal and dry past its end.
 */
export function weatherAt(table: readonly Weather[], date: number, time: TimeSlot): Weather {
  if (date < 0) return 'clear'
  const reading = table[weatherIndex(date, time)]
  if (reading === undefined) return 'clear'
  return (WEATHER_KINDS as readonly string[]).includes(reading) ? reading : 'clear'
}

/** Whether a reading is rain or a storm. */
export function isWet(weather: Weather): boolean {
  return weather !== 'clear'
}

/* ---- the roll ------------------------------------------------------------ */

/** How likely a dry half-day is to turn wet: a spell every week or so. */
const WET_AFTER_CLEAR = 0.1
/** How likely rain is to still be falling next half-day: spells of a few half-days. */
const WET_AFTER_RAIN = 0.67
/** How likely a storm is to leave anything behind it; the rest of the time it clears the air. */
const WET_AFTER_STORM = 0.3
/** Of the wet that follows a clear sky, the share that is a storm out of nowhere. */
const STORM_OF_WET_FROM_CLEAR = 0.06
/** Of the wet that follows rain, the share that is the front passing as a storm. */
const STORM_OF_WET_FROM_RAIN = 0.3
/** Of the wet that follows a storm, the share that is the storm still going. */
const STORM_OF_WET_FROM_STORM = 0.35
/** Storms favour the evening about two to one. */
const STORM_HALF_FACTOR: Record<TimeSlot, number> = { 0: 0.67, 1: 1.33 }
/** Storms are rare in January and common by May: the storm share's factor on the first day and the last. */
const STORM_RAMP_START = 0.15
const STORM_RAMP_END = 1.85

const WET_AFTER: Record<Weather, number> = {
  clear: WET_AFTER_CLEAR,
  rain: WET_AFTER_RAIN,
  storm: WET_AFTER_STORM
}

const STORM_OF_WET: Record<Weather, number> = {
  clear: STORM_OF_WET_FROM_CLEAR,
  rain: STORM_OF_WET_FROM_RAIN,
  storm: STORM_OF_WET_FROM_STORM
}

/**
 * The next slot's sky from this one's: one draw, banded storm, then rain, then clear, so the
 * lowest draw is always the wettest answer and the highest is always dry.
 */
function step(last: Weather, date: number, time: TimeSlot, rand: () => number): Weather {
  const wet = WET_AFTER[last]
  const ramp = STORM_RAMP_START + (STORM_RAMP_END - STORM_RAMP_START) * (date / FINAL_DATE)
  const share = Math.min(1, STORM_OF_WET[last] * STORM_HALF_FACTOR[time] * ramp)
  const draw = rand()
  if (draw < wet * share) return 'storm'
  if (draw < wet) return 'rain'
  return 'clear'
}

/**
 * The whole semester's sky, one reading per slot: a chain in which rain tends to keep falling,
 * a storm mostly grows out of rain and then clears the air, and storms lean toward the evening
 * and the end of term. Every date in `dryDates` is clear in both halves, and so is day 0.
 */
export function rollSemesterWeather(
  dryDates: ReadonlySet<number>,
  rand: () => number = Math.random
): Weather[] {
  const table: Weather[] = []
  let last: Weather = 'clear'
  for (let index = 0; index < WEATHER_SLOTS; index++) {
    const date = Math.floor(index / 2)
    const time = (index % 2) as TimeSlot
    const next: Weather =
      date === 0 || dryDates.has(date) ? 'clear' : step(last, date, time, rand)
    table.push(next)
    last = next
  }
  return table
}
