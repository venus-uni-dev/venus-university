import { CLASS_SLOTS, FINAL_DATE } from '@shared/classes'
import { slotFromId } from '@shared/jobs'
import { shuffle } from '@shared/shuffle'
import type { SemesterCalendar } from '@shared/semesters'
import { withOccasionWords, type OccasionEntry, type PlannedOccasion } from '@shared/application'
import {
  halfOrder,
  NAMED_OCCASION_KINDS,
  type NamedOccasionKind,
  type OccasionKind,
  type OccasionsFileEntry
} from '@shared/occasionsFile'
import type { Occasion, Season, StructuredRequest, TimeSlot } from '@shared/types'
import { formatDatePart } from './gameDate'
import { breakWeekOf, fixedOccasionsOf, occasionsOn, SEMESTER_WEEKS, weekOf } from './occasions'
import { objectSchema } from './schema'

/**
 * The one-shot occasion-generation request; pure, no IO. Asks only for the planned occasions
 * nobody has written yet.
 */

/** A planned occasion before {@link planOccasionSlots} deals the inspiration words out. */
type PlacedOccasion = Omit<PlannedOccasion, 'seed'>

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
function unclaimedWeeks(fixed: readonly Occasion[]): number[] {
  const claimed = weeksTouchedBy(fixed)
  return semesterWeeks().filter((week) => !claimed.has(week))
}

/** The weeks a filler may go in: all but those a multi-day fixed occasion owns. */
function fillerWeeks(fixed: readonly Occasion[]): number[] {
  const blocked = weeksTouchedBy(fixed.filter((o) => o.endDate > o.startDate))
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

/** What each named event is, given to the model verbatim; its when-line says the days. */
export const OCCASION_BRIEFS: Record<NamedOccasionKind, string> = {
  gala:
    'A formal gala thrown by the SEB — the most expensive, most photographed thing the student government does all year. Give it a name students would actually use.',
  dance:
    'A formal dance, smaller and cheaper than the gala — a themed dance students dress up for, run in one of the campus venues.',
  'career-fair':
    'A career fair — recruiters at tables, free branded junk, and students in interview clothes they own one of. Give it a name and say who is recruiting.',
  concert:
    'A concert in Thorne Auditorium — one booked act plus student openers, run by the SEB. Say who is playing and what they sound like.'
}

/** A planned occasion's kind: a small event, or its id's named kind less any `-<n>`. */
export function occasionKindOf(
  planned: Pick<PlannedOccasion, 'id' | 'filler'>
): OccasionKind | null {
  if (planned.filler) return 'small-event'
  const kind = planned.id.replace(/-\d+$/, '')
  return NAMED_OCCASION_KINDS.find((named) => named === kind) ?? null
}

/**
 * Places every occasion a semester will invent, around its fixed occasions as `calendar` has
 * them; its generated occasions are not read.
 */
export function planOccasionSlots(
  pickWords: (count: number) => string[],
  calendar: SemesterCalendar
): PlannedOccasion[] {
  const fixed = fixedOccasionsOf(calendar.season, calendar.fixedEdits)
  const pool = unclaimedWeeks(fixed)
  const requests: PlacedOccasion[] = []

  const gala = takeWeek(pool, 6)
  if (gala !== null) {
    requests.push({
      id: 'gala',
      startDate: saturdayOf(gala),
      endDate: saturdayOf(gala) + 1,
      time: 1,
      brief: OCCASION_BRIEFS.gala
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
      brief: OCCASION_BRIEFS.dance
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
      brief: OCCASION_BRIEFS['career-fair']
    })
  }

  const concert = takeWeek(pool, 4)
  if (concert !== null) {
    requests.push({
      id: 'concert',
      startDate: concert * 7 + 4,
      endDate: concert * 7 + 4,
      time: 1,
      brief: OCCASION_BRIEFS.concert
    })
  }

  // Every week not already spoken for gets one half-day thing.
  const spoken = weeksTouchedBy(requests)
  const rotation = shuffle(CLASS_SLOTS)
  let turn = 0
  for (const week of fillerWeeks(fixed)) {
    if (spoken.has(week)) continue
    const placed = fillerDate(week, rotation, turn, calendar)
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

  requests.push(...breakFillers(calendar))

  const words = pickWords(requests.length)
  return requests.map((request, index) => ({ ...request, seed: words[index] }))
}

/** How many half-day things the week off gets at most. */
const BREAK_FILLERS = 4

/** The fillers inside the week off, on its days no other fixed occasion holds. */
function breakFillers(calendar: SemesterCalendar): PlacedOccasion[] {
  const week = breakWeekOf(calendar.season)
  const days: number[] = []
  for (let date = week.startDate; date <= week.endDate; date++) {
    if (occasionsOn(date, calendar).every((occasion) => occasion.id === week.id)) days.push(date)
  }

  return shuffle(days)
    .slice(0, BREAK_FILLERS)
    .sort((a, b) => a - b)
    .map((date, index) => ({
      id: `filler-break-${index}`,
      startDate: date,
      endDate: date,
      time: Math.floor(Math.random() * 2) as TimeSlot,
      filler: true,
      breakWeek: true
    }))
}

/** The days and half one file entry is placed on. */
function spanOf(entry: OccasionsFileEntry): Pick<PlacedOccasion, 'startDate' | 'endDate' | 'time'> {
  return { startDate: entry.startDate, endDate: entry.endDate, time: entry.time }
}

/** What an occasions file's entries make: the plan, and the words they carry by plan id. */
export interface ImportedPlan {
  plan: PlannedOccasion[]
  occasions: Record<string, OccasionEntry>
}

/**
 * The id a planned occasion of `kind` starting on `startDate` is minted under, the first of its
 * line `taken` leaves free: a named kind's own, then `gala-2` and on; `filler-break-0` and on
 * inside the week off; `filler-<week>`, then `-2` and on, elsewhere.
 */
export function mintPlannedId(
  kind: OccasionKind,
  startDate: number,
  season: Season,
  taken: ReadonlySet<string>
): string {
  if (kind === 'small-event' && startsInBreak(startDate, season)) {
    let n = 0
    while (taken.has(`filler-break-${n}`)) n++
    return `filler-break-${n}`
  }
  const base = kind === 'small-event' ? `filler-${weekOf(startDate)}` : kind
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}-${n}`)) n++
  return `${base}-${n}`
}

/**
 * A planned occasion of `kind` under `id` on `span`: a named event carries its brief, a small one
 * the filler mark, and the week-off mark where it starts inside the week off.
 */
function placedAs(
  id: string,
  kind: OccasionKind,
  span: Pick<PlacedOccasion, 'startDate' | 'endDate' | 'time'>,
  season: Season
): PlacedOccasion {
  if (kind !== 'small-event') return { id, ...span, brief: OCCASION_BRIEFS[kind] }
  const inBreak = startsInBreak(span.startDate, season)
  return { id, ...span, filler: true, ...(inBreak ? { breakWeek: true as const } : {}) }
}

/**
 * The plan an occasions file's entries make, each id minted with {@link mintPlannedId} as the
 * planner would, in its order: named events, weekly fillers, break fillers. Each is seeded afresh,
 * and its words are kept under its id where it carries any.
 */
export function planOfImport(
  entries: readonly OccasionsFileEntry[],
  season: Season,
  pickWords: (count: number) => string[]
): ImportedPlan {
  const byDate = [...entries].sort(
    (a, b) => a.startDate - b.startDate || halfOrder(a.time) - halfOrder(b.time)
  )
  const inBreak = (entry: OccasionsFileEntry): boolean =>
    entry.kind === 'small-event' && startsInBreak(entry.startDate, season)
  const ordered = [
    ...NAMED_OCCASION_KINDS.flatMap((kind) => byDate.filter((entry) => entry.kind === kind)),
    ...byDate.filter((entry) => entry.kind === 'small-event' && !inBreak(entry)),
    ...byDate.filter(inBreak)
  ]
  const taken = new Set<string>()
  const placed = ordered.map((entry) => {
    const id = mintPlannedId(entry.kind, entry.startDate, season, taken)
    taken.add(id)
    return { request: placedAs(id, entry.kind, spanOf(entry), season), entry }
  })

  const words = pickWords(placed.length)
  let occasions: Record<string, OccasionEntry> = {}
  for (const { request, entry } of placed) {
    const { title, description } = entry
    occasions = withOccasionWords(occasions, request.id, { title, description })
  }
  return {
    plan: placed.map(({ request }, index) => ({ ...request, seed: words[index] })),
    occasions
  }
}

/** Whether a small event starting on `startDate` falls in the season's week off. */
function startsInBreak(startDate: number, season: Season): boolean {
  const week = breakWeekOf(season)
  return startDate >= week.startDate && startDate <= week.endDate
}

/** The days a planned occasion covers and the half it takes on each, or null for the whole of each. */
export interface PlannedSpan {
  startDate: number
  endDate: number
  time: TimeSlot | null
}

/**
 * A planned occasion moved onto `span`, its end never before its start. A small event is marked
 * as in the week off by where it now starts; its id stays.
 */
export function plannedAt(
  planned: PlannedOccasion,
  span: PlannedSpan,
  season: Season
): PlannedOccasion {
  const { breakWeek: _breakWeek, ...rest } = planned
  const inBreak = planned.filler === true && startsInBreak(span.startDate, season)
  return {
    ...rest,
    startDate: span.startDate,
    endDate: Math.max(span.endDate, span.startDate),
    time: span.time,
    ...(inBreak ? { breakWeek: true as const } : {})
  }
}

/**
 * A planned occasion made `kind`, on its days and half with its inspiration word, under an id
 * minted afresh around `taken`, which should not hold its own.
 */
export function plannedAs(
  planned: PlannedOccasion,
  kind: OccasionKind,
  season: Season,
  taken: ReadonlySet<string>
): PlannedOccasion {
  const id = mintPlannedId(kind, planned.startDate, season, taken)
  const { startDate, endDate, time, seed } = planned
  return { ...placedAs(id, kind, { startDate, endDate, time }, season), seed }
}

/** A small event added in the day half of `date`, seeded with `seed`, under an id `taken` leaves free. */
export function plannedOn(
  date: number,
  season: Season,
  taken: ReadonlySet<string>,
  seed: string
): PlannedOccasion {
  const id = mintPlannedId('small-event', date, season, taken)
  const span = { startDate: date, endDate: date, time: 0 as const }
  return { ...placedAs(id, 'small-event', span, season), seed }
}

/** Where in `week` a filler lands, or null when nothing in it is free. */
function fillerDate(
  week: number,
  rotation: readonly number[],
  turn: number,
  calendar: SemesterCalendar
): { date: number; time: TimeSlot; turn: number } | null {
  for (let step = 0; step < rotation.length; step++) {
    const at = turn + step
    const { date: weekday, time } = slotFromId(rotation[at % rotation.length])
    const date = week * 7 + weekday
    if (date > FINAL_DATE) continue
    if (occasionsOn(date, calendar).length > 0) continue
    return { date, time, turn: at }
  }
  return null
}

/** The mark on a filler line that falls inside the week off. */
const BREAK_TAG: Record<Season, string> = {
  spring: '[spring break]',
  fall: '[Thanksgiving break]'
}

/** What the week off is like, for the fillers that fall in it. */
const BREAK_NOTE: Record<Season, string> = {
  spring:
    'fall in spring break: most campus facilities are closed, so these are mostly events put on by the city or remaining students.',
  fall: "fall in Thanksgiving break: classes are off but everybody is still on campus for VU's Friendsgiving, so these are holiday-week things put on by the campus, the city or the students."
}

/** `"Friday, March 27"`, or `"Saturday, May 9 through Monday, May 11"` for a run. */
function whenLine(span: { startDate: number; endDate: number }, season: Season): string {
  const start = formatDatePart(span.startDate, season)
  if (span.endDate === span.startDate) return start
  return `${start} through ${formatDatePart(span.endDate, season)}`
}

/** The same span with the half of the day it occupies, or all of it — how a request is briefed. */
function requestWhenLine(
  request: Pick<PlannedOccasion, 'startDate' | 'endDate' | 'time'>,
  season: Season
): string {
  const half = request.time === null ? 'all day' : request.time === 0 ? 'during the day' : 'at night'
  return `${whenLine(request, season)}, ${half}`
}

/** How an occasion already on the calendar is listed to the model, so it cannot reinvent one. */
function existingLine(occasion: Occasion, season: Season): string {
  return `- ${whenLine(occasion, season)} — ${occasion.title}`
}

/** What the occasion call is built from. */
export interface OccasionPromptInput {
  season: Season
  /** The planned occasions left for the model to write. */
  asked: readonly PlannedOccasion[]
  /** The planned occasions the player wrote, listed beside the fixed ones. */
  written: readonly Occasion[]
  /** The semester's fixed occasions, as the player changed them. */
  fixed: readonly Occasion[]
  setting: string
  /** The lorebook's entries, every one printed as a place the events may use. */
  book: readonly { text: string }[]
}

/** Builds the invented-occasions request for a semester. */
export function buildOccasionPrompt(input: OccasionPromptInput): StructuredRequest {
  const { season, asked } = input
  const named = asked.filter((request) => !request.filler)
  const fillers = asked.filter((request) => request.filler)
  const onCalendar = [...input.fixed, ...input.written].sort(
    (a, b) => a.startDate - b.startDate
  )

  const system = [
    'You invent the events on a university calendar: what the campus and the city put on, and what it is called.',
    'You return a single JSON object matching the provided schema exactly.',
    'Everything you invent is set in the world below and nowhere else. Use its real places and institutions by name.',
    '',
    'SETTING',
    input.setting,
    '',
    'PLACES',
    ...input.book.map((entry) => entry.text)
  ].join('\n')

  const user = [
    'ALREADY ON THE CALENDAR',
    'These are fixed and are not yours to write. Never invent one of them, and never invent anything that would read as a second version of one.',
    ...onCalendar.map((occasion) => existingLine(occasion, season)),
    '',
    'EVENTS TO WRITE',
    'One entry in "events" for each id below, and nothing else. The dates are already decided — do not restate them.',
    '"title" is a few words, the way it would be printed on a poster or said out loud on campus.',
    '"description" is one or two sentences of what actually happens: who runs it, where on campus or in the city it is, what a student would see. Present tense.',
    'Each id carries an inspiration word. Let it colour that one event, loosely — it is a nudge, not a subject.',
    'Make them different from each other. Spread them across the campus and the city rather than putting everything in the Quad.',
    '',
    ...named.flatMap((request) => [
      `"${request.id}" — ${requestWhenLine(request, season)} — ${request.seed}`,
      request.brief ?? '',
      ''
    ]),
    ...(fillers.length > 0
      ? [
          'FILLERS',
          'Each id below is something small happening on campus or in the city — a club running a table, a market, a screening, a tournament, a protest, a food thing. Ordinary scale. Not a dance, not a gala, not a fair.',
          `Ids marked ${BREAK_TAG[season]} ${BREAK_NOTE[season]}`,
          '',
          ...fillers.map(
            (request) =>
              `"${request.id}" — ${requestWhenLine(request, season)} — ${request.seed}${
                request.breakWeek ? ` ${BREAK_TAG[season]}` : ''
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

  const ids = asked.map((request) => request.id)
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
  return {
    system,
    user,
    schema,
    cacheKey: 'venus-university-occasion-generation',
    thinking: 'newGame'
  }
}

/** The reply's shape, before any of it is trusted. */
export interface OccasionGenDraft {
  events: Record<string, { title?: string; description?: string }>
}

/** A planned occasion with its words: a generated occasion, which never cancels a class. */
export function occasionOf(
  planned: PlannedOccasion,
  words: { title: string; description: string }
): Occasion {
  return {
    id: planned.id,
    title: words.title.trim(),
    description: words.description.trim(),
    startDate: planned.startDate,
    endDate: planned.endDate,
    time: planned.time,
    cancelsClasses: false,
    kind: 'campus'
  }
}

/** Turns a reply into occasions, dropping whatever cannot be drawn. */
export function normalizeOccasions(
  parsed: unknown,
  requests: readonly PlannedOccasion[]
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
    occasions.push(occasionOf(request, { title, description }))
  }

  return occasions
}
