import type { TimeSlot } from '@shared/types'
import { isWet, weatherAt, type Weather } from '@shared/weather'
import { formatRelativeSlot, formatWeekday, prevSlot } from './gameDate'
import { isEpilogueNight } from './graduation'
import { STATIC_OCCASIONS } from './occasions'

/**
 * The sky as the game reads it: which days are authored clear, the one reading every screen
 * and the mix resolve a slot's weather through, and what the prompts are told about it.
 */

/**
 * The occasions held under an open sky, which the roll never rains on: the authored first day,
 * the ceremony, the beach festival and the holidays whose programme is outdoors.
 */
export const DRY_OCCASION_IDS: ReadonlySet<string> = new Set([
  'orientation',
  'graduation',
  'selkie-beach-party',
  'easter',
  'mardi-gras',
  'earth-day',
  'thorne-day'
])

/** Every date a dry occasion covers, for the roll to keep clear. */
export function dryOccasionDates(): Set<number> {
  const dates = new Set<number>()
  for (const occasion of STATIC_OCCASIONS) {
    if (!DRY_OCCASION_IDS.has(occasion.id)) continue
    for (let date = occasion.startDate; date <= occasion.endDate; date++) dates.add(date)
  }
  return dates
}

/**
 * The sky over the slot on screen: the table's reading, except that the epilogue's evening is
 * always clear.
 */
export function slotWeather(
  table: readonly Weather[],
  date: number,
  time: TimeSlot,
  graduationSeen: boolean
): Weather {
  return isEpilogueNight(date, time, graduationSeen) ? 'clear' : weatherAt(table, date, time)
}

/* ---- the NOW line ---------------------------------------------------------- */

/** One slot of the semester, as the walk back through a wet spell names them. */
interface Slot {
  date: number
  time: TimeSlot
}

/**
 * The unbroken run of wet slots ending in this one: where it began, how many half-days it
 * covers, and the latest slot in it that was the other kind of wet, if it held one.
 */
function wetRun(
  table: readonly Weather[],
  date: number,
  time: TimeSlot,
  now: Weather
): { start: Slot; steps: number; other: Slot | null } {
  let start: Slot = { date, time }
  let steps = 1
  let other: Slot | null = null
  for (;;) {
    const back = prevSlot(start.date, start.time)
    const reading = weatherAt(table, back.date, back.time)
    if (!isWet(reading)) return { start, steps, other }
    if (reading !== now && !other) other = back
    start = back
    steps += 1
  }
}

/**
 * How long a spell has been running, as the tail of a sentence: up to a day back is named
 * relatively, a week or less by its weekday, and anything longer by its length in days.
 */
function runningFor(start: Slot, date: number, time: TimeSlot): string {
  const days = date - start.date
  if (days <= 1) return `since ${formatRelativeSlot(start.date, start.time, date, time)}`
  if (days <= 6) {
    return `since ${formatWeekday(start.date)} ${start.time === 0 ? 'morning' : 'night'}`
  }
  return `for ${days} days`
}

/**
 * What the sky is doing in one slot and how long it has been doing it, as the single line the
 * prompts' NOW block carries — and nothing at all for a clear slot that followed a clear one.
 */
export function weatherLines(
  table: readonly Weather[],
  date: number,
  time: TimeSlot
): string[] {
  const now = weatherAt(table, date, time)
  const back = prevSlot(date, time)
  const before = weatherAt(table, back.date, back.time)
  const ago = formatRelativeSlot(back.date, back.time, date, time)

  if (!isWet(now)) {
    if (!isWet(before)) return []
    return [
      before === 'storm'
        ? `There was a thunderstorm ${ago}, but it has cleared up.`
        : `It rained ${ago}, but it has cleared up.`
    ]
  }

  const run = wetRun(table, date, time, now)
  if (run.steps === 1) {
    return [
      now === 'storm'
        ? 'A thunderstorm has just blown in.'
        : `It started raining ${time === 0 ? 'this morning' : 'this evening'}.`
    ]
  }
  if (run.other) {
    const turned = formatRelativeSlot(run.other.date, run.other.time, date, time)
    return [
      now === 'storm'
        ? `It was raining ${turned}, but now there's a thunderstorm.`
        : `There was a thunderstorm ${turned} and it's still lightly raining.`
    ]
  }
  const spell = runningFor(run.start, date, time)
  return [
    now === 'storm'
      ? `A thunderstorm has been going ${spell}.`
      : `It has been raining ${spell}.`
  ]
}
