import { charJobAt, formatDateBanner, formatDatePart, slotHalf } from './gameDate'
import { classSlotOf, jobClosedOn } from './occasions'
import { isAwayForSpringBreak } from './springBreak'
import { FINAL_DATE } from '@shared/classes'
import { globalSlotOf, slotFromId } from '@shared/jobs'
import { charKeyOf, fullNameOf, READER_SPEAKER } from '@shared/types'
import type {
  CalendarEvent,
  Character,
  CharInfo,
  ChatMessage,
  EventCancellation,
  LedgerResponse,
  Occasion,
  SceneLine,
  TimeSlot
} from '@shared/types'
import { stampedStubs } from './textingPrompt'

/**
 * The scheduling question — what the reader has now agreed to do later — and the two
 * pure passes that file the answer.
 */

/** How far ahead a plan may be placed. Past this the offered list is noise. */
export const SCHEDULE_HORIZON_DAYS = 14

/** One slot the model may place a plan in, as the prompt offers it. */
interface SlotOption {
  id: number
  date: number
  time: TimeSlot
}

/** Everything the `PLANS` half of the ledger request reads. */
export interface SchedulePromptInput {
  /** The slot being read — what "tonight" is measured against. */
  date: number
  time: TimeSlot
  /** Every message sent this slot, grouped by character; empty groups are dropped. */
  threads: ReadonlyArray<{
    charKey: string
    firstName: string
    messages: readonly ChatMessage[]
  }>
  /** The whole roster, keyed by charId — the keys `chars` may name. */
  characters: Record<string, Character>
  /** Plans already on the calendar inside the horizon, so none is placed twice. */
  planned: readonly CalendarEvent[]
}

/**
 * Every slot the reply may place a plan in: from the one after `date`/`time` through
 * {@link SCHEDULE_HORIZON_DAYS} days out, capped at the semester's end.
 */
function slotOptions(date: number, time: TimeSlot): SlotOption[] {
  const options: SlotOption[] = []
  // Start on the slot *after* the one being read: the slot itself is over.
  let cursor = globalSlotOf(date, time) + 1
  const last = Math.min(FINAL_DATE, date + SCHEDULE_HORIZON_DAYS)
  for (; cursor <= globalSlotOf(last, 1); cursor++) {
    options.push({ id: cursor, ...slotFromId(cursor) })
  }
  return options
}

/** `"391 — Thursday, February 5, night"` — one offered slot, as the prompt lists it. */
function slotOptionLine(option: SlotOption): string {
  const half = slotHalf(option.time)
  return `${option.id} — ${formatDatePart(option.date)}, ${half}`
}

/**
 * The charKeys of whoever the reader actually texted this slot — the texting ledger's gate and
 * the enum its `textMemories` and `events` are scoped to.
 */
export function textLedgerCharKeys(input: SchedulePromptInput): string[] {
  return input.threads
    .filter((t) => t.messages.some((m) => m.sender !== 'system'))
    .map((t) => t.charKey)
}

/** The roster's charKeys, in the order the `CHARACTERS` block lists them. */
export function scheduleCharKeys(characters: Record<string, Character>): string[] {
  return Object.values(characters).map((c) => charKeyOf(c.firstName, c.lastName))
}

/**
 * A transcript as a prompt block reads it: `NAME:`, `NARRATOR:` or `READER:` per line, with
 * the speaker key resolved against the cast.
 */
export function transcriptStubs(
  scene: readonly SceneLine[],
  cast: readonly Character[],
  keepReader: boolean
): string[] {
  const nameOf = new Map(
    cast.map((c) => [charKeyOf(c.firstName, c.lastName), c.firstName.toUpperCase()])
  )
  return scene
    .filter((line) => keepReader || line.speaker !== READER_SPEAKER)
    .map((line) => {
      if (line.speaker === READER_SPEAKER) return `READER: ${line.text}`
      if (!line.speaker) return `NARRATOR: ${line.text}`
      return `${nameOf.get(line.speaker) ?? line.speaker}: ${line.text}`
    })
}

/**
 * The rules half of a `PLANS` section, worded for whichever material the call reads.
 */
function planRules(source: string): string[] {
  return [
    'PLANS',
    `Report one entry in "plans" for every plan ${source} settled on that happens at one of the times in SLOTS.`,
    'A plan counts when the reader and at least one other person agreed to do a specific thing at a time you can point at in SLOTS.',
    '',
    '"slot" is the id from SLOTS, copied exactly. Work out which line it is from what was said and when this part of the day was.',
    '"title" is a few plain words for the calendar, like "Dinner with Mina" or "Study session".',
    '"description" is one sentence: who is going, where, and what they are doing.',
    '"chars" lists who is going apart from the reader, as the keys on the left of the CHARACTERS lines, copied exactly. Never invent one.',
    '',
    'Report no plan at all when:',
    '- nobody named a time you can find in SLOTS — "sometime", "soon", "we should do this again", "let\'s hang out more"',
    '- somebody was enthusiastic but agreed to nothing specific',
    '- the plan is already in ALREADY PLANNED',
    '- the plan was called off, moved or refused later in what you are reading',
    '- it is a class, a shift, an exam or anything else that is simply on a timetable',
    '- the reader is not part of it — two other characters making plans with each other is not the reader\'s event',
    '- the plan was for this part of the day, which is now over',
    '',
    'One plan is one entry, however many times it comes up.',
    'A standing arrangement — "let\'s study every Tuesday" — is the next occurrence only.',
    '',
    'An empty "plans" list is the ordinary answer and it is always allowed.',
    '',
    'Examples, for CHARACTERS of "mina_okafor — Mina Okafor", "hazel_kim — Hazel Kim" and "colette_dubois — Colette Dubois", with SLOTS of 71 (Wednesday night), 72 (Thursday day) and 73 (Thursday night):',
    ''
  ]
}

/**
 * The scene ledger's `PLANS` instructions and worked examples — the invariant half.
 */
export const PLANS_INSTRUCTIONS: readonly string[] = [
  ...planRules('THE SCENE'),
  'SCENE "MINA: come to the river with me thursday night, after your lecture" / "READER: sounds good"',
  '{"plans":[{"slot":73,"title":"River walk with Mina","description":"The reader walks along the river with Mina on Thursday night.","chars":["mina_okafor"]}]}',
  '',
  'SCENE "HAZEL: we should get dinner sometime!" / "READER: totally"',
  '{"plans":[]}',
  '',
  'SCENE "MINA: movie tomorrow night?" / "READER: yes" then later "MINA: actually i have to cancel, sorry"',
  '{"plans":[]}',
  '',
  'SCENE "HAZEL: colette and i are going climbing thursday" / "READER: nice, have fun"',
  '{"plans":[]}',
  '',
  // A goodbye naming a day reads like an agreement about a lecture; this example defeats that.
  'SCENE "MINA: see you thursday for class!" / "READER: see you then"',
  '{"plans":[]}'
]

/**
 * The texting ledger's `PLANS` instructions: the same rules read against THE
 * MESSAGES, with the worked examples in texting grammar.
 */
export const TEXT_PLANS_INSTRUCTIONS: readonly string[] = [
  ...planRules('THE MESSAGES'),
  'MESSAGES "YOU: brunch tomorrow with you and colette?" / "HAZEL: yesss 11am" (read on Wednesday night)',
  '{"plans":[{"slot":72,"title":"Brunch with Hazel and Colette","description":"The reader has brunch with Hazel and Colette on Thursday.","chars":["hazel_kim","colette_dubois"]}]}',
  '',
  'MESSAGES "MINA: we should do something soon!!" / "YOU: definitely"',
  '{"plans":[]}',
  '',
  'MESSAGES "HAZEL: gotta run, see you thursday" / "YOU: later"',
  '{"plans":[]}'
]

/**
 * The per-call half: who the reader knows, when a plan may fall, and what is on the calendar
 * already.
 */
export function scheduleBlocks(input: SchedulePromptInput, wantPlans: boolean): string[] {
  const planned = input.planned.map(
    (event) => `${globalSlotOf(event.date, event.time)} — ${event.title}: ${event.description}`
  )

  const now = [
    // What "tomorrow" in a transcript is measured against; the scene never says what day it is.
    'NOW',
    `The part of the day you are reading has just ended. It was ${formatDateBanner(input.date, input.time)}`
  ]
  if (!wantPlans) return now

  return [
    ...now,
    '',
    // The keys the reply copies; without it the model invents one that resolves to nobody.
    'CHARACTERS — everyone the reader knows. Each line is the key for that person, then who she is.',
    "'''",
    ...scheduleRosterLines(input.characters),
    "'''",
    '',
    'SLOTS — the only times a plan may be placed in. Each line is an id, then when it is.',
    "'''",
    ...slotOptions(input.date, input.time).map(slotOptionLine),
    "'''",
    '',
    'ALREADY PLANNED — plans that are on the calendar already.',
    'Never report one of these again, however often it is talked about.',
    "'''",
    ...(planned.length > 0 ? planned : ['(none)']),
    "'''"
  ]
}

/**
 * `THE MESSAGES` — the slot's texts, grouped by character, fenced. The texting
 * ledger's whole payload and its last block, below the cache seam.
 */
export function messagesBlock(input: SchedulePromptInput): string[] {
  const threads = threadBlocks(input)
  return [
    'THE MESSAGES — the texts sent during this part of the day, grouped by who they are with.',
    "'''",
    ...(threads.length > 0 ? threads : ['(none)']),
    "'''"
  ]
}

/** `"mina_okafor — Mina Okafor"` — one roster line, the classifier's shape. */
function scheduleRosterLines(characters: Record<string, Character>): string[] {
  const lines = Object.values(characters).map(
    (c) => `${charKeyOf(c.firstName, c.lastName)} — ${fullNameOf(c)}`
  )
  return lines.length > 0 ? lines : ['(nobody)']
}

/** The messages sent this slot, one block per character. */
function threadBlocks(input: SchedulePromptInput): string[] {
  const lines: string[] = []
  for (const { firstName, messages } of input.threads) {
    if (messages.length === 0) continue
    // Blank line between blocks only; the first sits flush against the caller's header.
    if (lines.length > 0) lines.push('')
    lines.push(`— texts with ${firstName} —`, ...stampedStubs(messages, firstName))
  }
  return lines
}

/** The `plans` schema fragment, roster-scoped. */
export function plansSchema(charKeys: readonly string[]): Record<string, unknown> {
  // An empty `enum` is invalid JSON Schema, so a roster of nobody degrades to a free string.
  const chars =
    charKeys.length > 0
      ? { type: 'array', items: { type: 'string', enum: [...charKeys] } }
      : { type: 'array', items: { type: 'string' } }

  return {
    type: 'array',
    items: {
      type: 'object',
      additionalProperties: false,
      // The slot first, so the time is settled before the plan is written.
      required: ['slot', 'title', 'description', 'chars'],
      properties: {
        slot: { type: 'integer' },
        title: { type: 'string' },
        description: { type: 'string' },
        chars
      }
    }
  }
}

/**
 * Turns a parsed reply's `plans` into calendar events, dropping everything that cannot be
 * filed.
 */
export function normalizeSchedule(
  parsed: unknown,
  charKeyToId: Record<string, string>,
  madeOn: { date: number; time: TimeSlot }
): CalendarEvent[] {
  const reply = (parsed ?? {}) as Partial<LedgerResponse>
  const first = globalSlotOf(madeOn.date, madeOn.time) + 1
  const last = globalSlotOf(Math.min(FINAL_DATE, madeOn.date + SCHEDULE_HORIZON_DAYS), 1)

  const events: CalendarEvent[] = []
  for (const entry of reply.plans ?? []) {
    const id = entry?.slot
    if (typeof id !== 'number' || !Number.isInteger(id) || id < first || id > last) continue

    const title = typeof entry.title === 'string' ? entry.title.trim() : ''
    const description = typeof entry.description === 'string' ? entry.description.trim() : ''
    // A plan with no label and no sentence is nothing the calendar can draw.
    if (!title || !description) continue

    const charIds = (entry.chars ?? [])
      .map((charKey) => charKeyToId[charKey])
      .filter((charId, index, all): charId is string => Boolean(charId) && all.indexOf(charId) === index)

    events.push({
      id: crypto.randomUUID(),
      ...slotFromId(id),
      title,
      description,
      charIds,
      madeOn
    })
  }
  return events
}

/**
 * Drops from each event whoever is busy when it falls, and drops outright an event that leaves
 * nobody.
 */
export function filterEventsByAttendance(
  events: readonly CalendarEvent[],
  charInfo: Record<string, CharInfo>,
  occasions: readonly Occasion[] = [],
  springBreakAway: readonly string[] | null = null
): { events: CalendarEvent[]; cancellations: EventCancellation[] } {
  const kept: CalendarEvent[] = []
  const cancellations: EventCancellation[] = []

  for (const event of events) {
    // Null on a weekend or a cancelled day: no class meets, so nobody is in class.
    const slot = classSlotOf(event.date, event.time, occasions)
    const free: string[] = []
    for (const charId of event.charIds) {
      const inClass = slot !== null && Boolean(charInfo[charId]?.schedule?.[slot])
      const shiftJob = charJobAt(charInfo[charId]?.job, event.date, event.time)
      const onShift = shiftJob !== null && !jobClosedOn(shiftJob, event.date, occasions)
      // In precedence: away outranks both timetables, class beats a shift; the job
      // rides along so the message can name the employer.
      if (isAwayForSpringBreak(springBreakAway, charId, event.date)) {
        cancellations.push({ charId, date: event.date, time: event.time, reason: 'away' })
      } else if (inClass) {
        cancellations.push({ charId, date: event.date, time: event.time, reason: 'class' })
      } else if (onShift && shiftJob !== null) {
        cancellations.push({
          charId,
          date: event.date,
          time: event.time,
          reason: 'shift',
          jobId: shiftJob
        })
      } else {
        free.push(charId)
      }
    }

    // Nobody left to meet, including an event whose every charKey resolved to nobody.
    if (free.length === 0) continue
    kept.push(free.length === event.charIds.length ? event : { ...event, charIds: free })
  }

  return { events: kept, cancellations }
}
