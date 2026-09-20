import { CLASS_SLOTS, FINAL_DATE } from '@shared/classes'
import { slotFromId } from '@shared/jobs'
import { shuffle } from '@shared/shuffle'
import type { Occasion, StructuredRequest, TimeSlot } from '@shared/types'
import { formatDatePart } from './gameDate'
import { LOREBOOK } from './lorebook'
import {
  occasionsOn,
  SEMESTER_WEEKS,
  SPRING_BREAK,
  STATIC_OCCASIONS,
  weekOf
} from './occasions'
import { objectSchema } from './schema'
import { SETTING } from './setting'

/**
 * The one-shot occasion-generation request; pure, no IO. Runs once per save, beside
 * the class catalog and in the same window.
 */

/** One occasion the model is asked to write, already placed on the calendar. */
export interface OccasionRequest {
  /** Schema property name, and the id the resulting occasion carries. */
  id: string
  startDate: number
  endDate: number
  time: TimeSlot
  /** What kind of thing this is, given to the model verbatim; only the four named events carry one. */
  brief?: string
  /** A half-day small thing rather than one of the four named events. */
  filler?: true
  /** This filler falls inside spring break, and the prompt says so. */
  springBreak?: true
  /** This occasion's inspiration word — the whole point of the call varying. */
  seed: string
}

/** A request before {@link planOccasionSlots} deals the inspiration words out. */
type PlacedOccasion = Omit<OccasionRequest, 'seed'>


/** Saturday of a semester week, as a date index. Day 0 is a Monday. */
function saturdayOf(week: number): number {
  return week * 7 + 5
}

/** The weeks anything in `over` touches — occasions and requests alike. */
function weeksTouchedBy(over: readonly { startDate: number; endDate: number }[]): Set<number> {
  const weeks = new Set<number>()
  for (const occasion of over) {
    for (let date = occasion.startDate; date <= occasion.endDate; date++) weeks.add(weekOf(date))
  }
  return weeks
}

/** Every week of the semester whose Monday is inside it, in calendar order. */
function semesterWeeks(): number[] {
  const weeks: number[] = []
  for (let week = 0; week < SEMESTER_WEEKS; week++) if (week * 7 <= FINAL_DATE) weeks.push(week)
  return weeks
}

/** The weeks with no fixed occasion anywhere in them: the pool the four named events draw from. */
function unclaimedWeeks(): number[] {
  const claimed = weeksTouchedBy(STATIC_OCCASIONS)
  return semesterWeeks().filter((week) => !claimed.has(week))
}

/** The weeks a filler may go in: all but those a multi-day fixed occasion owns. */
function fillerWeeks(): number[] {
  const blocked = weeksTouchedBy(STATIC_OCCASIONS.filter((o) => o.endDate > o.startDate))
  return semesterWeeks().filter((week) => !blocked.has(week))
}

/** Draws one week off `pool`, removing it, or null when the pool is spent. */
function takeWeek(pool: number[], need: number): number | null {
  const eligible = pool.filter((week) => week * 7 + need <= FINAL_DATE)
  if (eligible.length === 0) return null
  const week = shuffle(eligible)[0]
  pool.splice(pool.indexOf(week), 1)
  return week
}

/** Places every occasion this save will invent. */
export function planOccasionSlots(pickWords: (count: number) => string[]): OccasionRequest[] {
  const pool = unclaimedWeeks()
  const requests: PlacedOccasion[] = []

  const gala = takeWeek(pool, 6)
  if (gala !== null) {
    requests.push({
      id: 'gala',
      startDate: saturdayOf(gala),
      endDate: saturdayOf(gala) + 1,
      time: 1,
      brief:
        'A two-night formal gala thrown by the SEB, Saturday and Sunday — the most expensive, most photographed thing the student government does all year. Give it a name students would actually use.'
    })
  }

  const dance = takeWeek(pool, 6)
  if (dance !== null) {
    // Either weekend night; the gala already owns a Saturday somewhere else.
    const day = saturdayOf(dance) + Math.floor(Math.random() * 2)
    requests.push({
      id: 'dance',
      startDate: day,
      endDate: day,
      time: 1,
      brief:
        'A one-night formal dance, smaller and cheaper than the gala — a themed dance students dress up for, run in one of the campus venues.'
    })
  }

  const fair = takeWeek(pool, 4)
  if (fair !== null) {
    // Two consecutive weekdays: Monday through Thursday can start one.
    const start = fair * 7 + Math.floor(Math.random() * 4)
    requests.push({
      id: 'career-fair',
      startDate: start,
      endDate: start + 1,
      time: 0,
      brief:
        'A two-day career fair held during the day — recruiters at tables, free branded junk, and students in interview clothes they own one of. Give it a name and say who is recruiting.'
    })
  }

  const concert = takeWeek(pool, 4)
  if (concert !== null) {
    requests.push({
      id: 'concert',
      startDate: concert * 7 + 4,
      endDate: concert * 7 + 4,
      time: 1,
      brief:
        'A Friday night concert in Thorne Auditorium — one booked act plus student openers, run by the SEB. Say who is playing and what they sound like.'
    })
  }

  // Every week not already spoken for gets one half-day thing.
  const spoken = weeksTouchedBy(requests)
  const rotation = shuffle(CLASS_SLOTS)
  let turn = 0
  for (const week of fillerWeeks()) {
    if (spoken.has(week)) continue
    const placed = fillerDate(week, rotation, turn)
    if (!placed) continue
    turn = placed.turn + 1
    requests.push({
      id: `filler-${week}`,
      startDate: placed.date,
      endDate: placed.date,
      time: placed.time,
      filler: true
    })
  }

  requests.push(...breakFillers())

  const words = pickWords(requests.length)
  return requests.map((request, index) => ({ ...request, seed: words[index] }))
}

/** How many half-day things spring break gets. */
const BREAK_FILLERS = 4

/** The fillers inside spring break. */
function breakFillers(): PlacedOccasion[] {
  const days: number[] = []
  for (let date = SPRING_BREAK.startDate; date <= SPRING_BREAK.endDate; date++) days.push(date)

  return shuffle(days)
    .slice(0, BREAK_FILLERS)
    .sort((a, b) => a - b)
    .map((date, index) => ({
      id: `filler-break-${index}`,
      startDate: date,
      endDate: date,
      time: Math.floor(Math.random() * 2) as TimeSlot,
      filler: true,
      springBreak: true
    }))
}

/** Where in `week` a filler lands, or null when nothing in it is free. */
function fillerDate(
  week: number,
  rotation: readonly number[],
  turn: number
): { date: number; time: TimeSlot; turn: number } | null {
  for (let step = 0; step < rotation.length; step++) {
    const at = turn + step
    const { date: weekday, time } = slotFromId(rotation[at % rotation.length])
    const date = week * 7 + weekday
    if (date > FINAL_DATE) continue
    if (occasionsOn(date).length > 0) continue
    return { date, time, turn: at }
  }
  return null
}

/** The mark on a filler line that falls inside spring break. */
const BREAK_TAG = '[spring break]'

/** `"Friday, March 27"`, or `"Saturday, May 9 through Monday, May 11"` for a run. */
function whenLine(span: { startDate: number; endDate: number }): string {
  const start = formatDatePart(span.startDate)
  if (span.endDate === span.startDate) return start
  return `${start} through ${formatDatePart(span.endDate)}`
}

/** The same span with the half of the day it occupies — how a request is briefed. */
function requestWhenLine(request: Pick<OccasionRequest, 'startDate' | 'endDate' | 'time'>): string {
  return `${whenLine(request)}, ${request.time === 0 ? 'during the day' : 'at night'}`
}

/** How a fixed occasion is listed to the model, so it cannot reinvent one. */
function existingLine(occasion: Occasion): string {
  return `- ${whenLine(occasion)} — ${occasion.title}`
}

/** Builds the invented-occasions request. */
export function buildOccasionPrompt(
  requests: readonly OccasionRequest[]
): StructuredRequest {
  const named = requests.filter((request) => !request.filler)
  const fillers = requests.filter((request) => request.filler)

  const system = [
    'You invent the events on a university calendar: what the campus and the city put on, and what it is called.',
    'You return a single JSON object matching the provided schema exactly.',
    'Everything you invent is set in the world below and nowhere else. Use its real places and institutions by name.',
    '',
    'SETTING',
    SETTING,
    '',
    'PLACES',
    ...LOREBOOK.map((entry) => entry.text)
  ].join('\n')

  const user = [
    'ALREADY ON THE CALENDAR',
    'These are fixed and are not yours to write. Never invent one of them, and never invent anything that would read as a second version of one.',
    ...STATIC_OCCASIONS.map(existingLine),
    '',
    'EVENTS TO WRITE',
    'One entry in "events" for each id below, and nothing else. The dates are already decided — do not restate them.',
    '"title" is a few words, the way it would be printed on a poster or said out loud on campus.',
    '"description" is one or two sentences of what actually happens: who runs it, where on campus or in the city it is, what a student would see. Present tense.',
    'Each id carries an inspiration word. Let it colour that one event, loosely — it is a nudge, not a subject.',
    'Make them different from each other. Spread them across the campus and the city rather than putting everything in the Quad.',
    '',
    ...named.flatMap((request) => [
      `"${request.id}" — ${requestWhenLine(request)} — ${request.seed}`,
      request.brief ?? '',
      ''
    ]),
    ...(fillers.length > 0
      ? [
          'FILLERS',
          'Each id below is something small happening on campus or in the city for half a day — a club running a table, a market, a screening, a tournament, a protest, a food thing. Ordinary scale. Not a dance, not a gala, not a fair.',
          `Ids marked ${BREAK_TAG} fall in spring break: most campus facilities are closed, so these are mostly events put on by the city or remaining students.`,
          '',
          ...fillers.map(
            (request) =>
              `"${request.id}" — ${requestWhenLine(request)} — ${request.seed}${
                request.springBreak ? ` ${BREAK_TAG}` : ''
              }`
          )
        ]
      : [])
  ].join('\n')

  const entrySchema = {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'description'],
    properties: { title: { type: 'string' }, description: { type: 'string' } }
  }

  const ids = requests.map((request) => request.id)
  const schema = objectSchema('calendar_occasions', ['events'], {
    events: {
      type: 'object',
      additionalProperties: false,
      // Enumerated as properties so every requested occasion getting written is a schema guarantee.
      required: ids,
      properties: Object.fromEntries(ids.map((id) => [id, entrySchema]))
    }
  })

  // The requests are in the prompt, so this caches only across retries of the same New Game.
  return { system, user, schema, cacheKey: 'venus-university-occasion-generation' }
}

/** The reply's shape, before any of it is trusted. */
export interface OccasionGenDraft {
  events: Record<string, { title?: string; description?: string }>
}

/** Turns a reply into occasions, dropping whatever cannot be drawn. */
export function normalizeOccasions(
  parsed: unknown,
  requests: readonly OccasionRequest[]
): Occasion[] {
  const reply = (parsed ?? {}) as Partial<OccasionGenDraft>
  const occasions: Occasion[] = []

  for (const request of requests) {
    const entry = reply.events?.[request.id]
    const title = typeof entry?.title === 'string' ? entry.title.trim() : ''
    const description = typeof entry?.description === 'string' ? entry.description.trim() : ''
    if (!title || !description) {
      console.warn(`[occasions] ${request.id} came back unwritable; dropping it.`)
      continue
    }

    occasions.push({
      id: request.id,
      title,
      description,
      startDate: request.startDate,
      endDate: request.endDate,
      time: request.time,
      cancelsClasses: false,
      kind: 'campus'
    })
  }

  return occasions
}
