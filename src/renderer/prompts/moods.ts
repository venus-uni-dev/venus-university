import { genderOf } from '@shared/gender'
import { seededRand } from '@shared/hash'
import {
  GUY_CARRY_SHIFT,
  GUY_DAY_WEIGHT,
  GUY_DREAD_WEIGHT,
  GUY_STAY_IN_DAYS,
  GUY_SWINGS_DELTA,
  GUY_WEEKDAY_SHIFT,
  type GuyDayKind
} from '@shared/odds'
import { hasTrait } from '@shared/traits'
import type { Character } from '@shared/types'

/**
 * What kind of day a character is having: a girl's on a fixed thirty-day cycle she is somewhere
 * inside of, a guy's drawn afresh each day. Only the per-character offset is save data, on
 * {@link CharInfo}; the days are derived from it and the date, and their lines are the prompt
 * layer's alone.
 */

/** Whose day it is: the gender picks the cycle or the draw, Mood-swings the harder column. */
export type MoodHolder = Pick<Character, 'gender' | 'traits'>

/** One day of the cycle. Either column may be `''` — an ordinary day. */
interface MoodDay {
  normal: string
  moodSwings: string
}

/** The cycle, index 0 = day one; its length is the cycle length. */
const MOOD_CYCLE: readonly MoodDay[] = [
  // MENSTRUATION
  {
    normal: '{name} woke up with bad cramps today but is doing a good job of hiding it.',
    moodSwings: '{name} woke up with terrible cramps today and wants to be left alone.'
  },
  {
    normal: '{name} is a little frustrated that her cramps are still bothering her, but she\'s mostly acting normal.',
    moodSwings: '{name} is cramping hard and is exceptionally irritable.'
  },
  {
    normal: '{name} woke up with less pain today and is monitoring her hygiene.',
    moodSwings: '{name} woke up with less pain today but feels anxious and self-conscious about her hygiene.'
  },
  {
    normal: '{name} woke up with no pain and is in a good mood today.',
    moodSwings: '{name} woke up with no pain but still feels a bit anxious today.'
  },
  // FOLLICULAR PHASE
  {
    normal: '',
    moodSwings: '{name} is in an exceptionally good mood.'
  },
  {
    normal: '{name} feels focused and productive today.',
    moodSwings: '{name} feels motivated and gung-ho today.'
  },
  {
    normal: '',
    moodSwings: ''
  },
  {
    normal: '{name} woke up with good energy and mood.',
    moodSwings: '{name} feels restless today and wants to be around people.'
  },
  {
    normal: '',
    moodSwings: ''
  },
  {
    normal: '',
    moodSwings: ''
  },
  {
    normal: '{name} is feeling a little lonely today.',
    moodSwings: '{name} is chatty and craving attention today.'
  },
  {
    normal: '{name} is unusually chatty today.',
    moodSwings: '{name} is having occasional indecent thoughts.'
  },
  {
    normal: '{name} is craving company today.',
    moodSwings: '{name} is feeling a little sexually frustrated today.'
  },
  {
    normal: '{name} is a little sexually frustrated today.',
    moodSwings: '{name} can\'t stop thinking indecent thoughts today.'
  },
  // OVULATION
  {
    normal: '{name} feels an aching lust in her stomach today.',
    moodSwings: '{name} woke up intensely sexually frustrated today.'
  },
  // POST OVULATION
  {
    normal: '{name} feels happy today.',
    moodSwings:
      '{name} is a little sexually frustrated today.'
  },
  {
    normal: '{name} is in a good mood today.',
    moodSwings: '{name} is feeling happy today.'
  },
  {
    normal: '{name} is a little sleepy today.',
    moodSwings: '{name} is in a good mood today.'
  },
  {
    normal: '',
    moodSwings: '{name} is sleepy and sluggish today.'
  },
  {
    normal: '',
    moodSwings: ''
  },
  {
    normal: '',
    moodSwings: ''
  },
  {
    normal: '{name} is hungrier than usual today.',
    moodSwings: '{name} woke up starving today and can\'t stop eating.'
  },
  {
    normal: '',
    moodSwings: ''
  },
  // PMS ZONE
  {
    normal: '',
    moodSwings: '{name} is a bit anxious and moody today.'
  },
  {
    normal: '{name} is a little tired today.',
    moodSwings: '{name} has a headache today and is a little irritable.'
  },
  {
    normal: '{name} is a little stressed today.',
    moodSwings: '{name} is quite irritable today.'
  },
  {
    normal: '{name} is tense today.',
    moodSwings: '{name} woke up feeling stressed and overwhelmed today.'
  },
  {
    normal: '{name} is feeling down on herself today.',
    moodSwings: '{name} had bad sleep and is feeling bad about herself today.'
  },
  {
    normal: '{name} is feeling a bit bloated today.',
    moodSwings: '{name} is bloated, sore, and irritable today.'
  },
  {
    normal: '{name} feels achy today and is dreading tomorrow.',
    moodSwings: '{name} feels achy and terrible today and is dreading tomorrow.'
  }
]

/** How many days the cycle runs — the range every offset is drawn from. */
export const MOOD_CYCLE_LENGTH = MOOD_CYCLE.length

/** The ovulation-adjacent days counted lustful, as indices into `MOOD_CYCLE`, by column. */
const LUST_DAYS = { normal: [13, 14], moodSwings: [12, 15] } as const

/** Where a girl is in her cycle on a date; a bigger offset means further along. */
export function moodIndexOf(date: number, offset: number): number {
  return (((date + offset) % MOOD_CYCLE_LENGTH) + MOOD_CYCLE_LENGTH) % MOOD_CYCLE_LENGTH
}

/** The lines each kind of day a guy can be having may be said in; an ordinary day says nothing. */
const GUY_DAY_LINES: Readonly<Record<Exclude<GuyDayKind, 'ordinary'>, readonly MoodDay[]>> = {
  upbeat: [
    {
      normal: '{name} slept well and woke up in a good mood.',
      moodSwings: '{name} is in an exceptionally good mood today.'
    }
  ],
  pumped: [
    {
      normal: '{name} got a good workout in this morning and feels great.',
      moodSwings: '{name} crushed a workout this morning and feels unstoppable.'
    },
    {
      normal: '{name} is in high spirits after his team won last night.',
      moodSwings: "{name} is still riding the high of his team's big win last night."
    },
    {
      normal: '{name} is feeling competitive today.',
      moodSwings: '{name} is fired up and itching to beat somebody at something today.'
    }
  ],
  social: [
    {
      normal: '{name} is craving company today.',
      moodSwings: '{name} is chatty and craving attention today.'
    }
  ],
  restless: [
    {
      normal: '{name} is restless and wants to get out and do something today.',
      moodSwings: '{name} is bouncing off the walls today and itching to go out.'
    }
  ],
  hangry: [
    {
      normal: '{name} skipped breakfast and is short-tempered until he eats.',
      moodSwings: '{name} woke up starving and is snapping at people until he gets some food.'
    }
  ],
  tired: [
    {
      normal: '{name} stayed up too late and is running on little sleep today.',
      moodSwings: '{name} barely slept and is exhausted and irritable today.'
    },
    {
      normal: '{name} was up late gaming and is a little sluggish today.',
      moodSwings: '{name} pulled an all-nighter and is a zombie today.'
    }
  ],
  irritable: [
    {
      normal: '{name} is a little irritable today.',
      moodSwings: '{name} woke up in a foul mood and everything is getting on his nerves.'
    }
  ],
  stressed: [
    {
      normal: '{name} is a little stressed about everything he has to get done.',
      moodSwings: '{name} woke up feeling stressed and overwhelmed today.'
    }
  ],
  down: [
    {
      normal: '{name} is feeling down on himself today.',
      moodSwings: '{name} is feeling bad about himself today and hiding it badly.'
    }
  ],
  dread: [
    {
      normal: '{name} is dreading the week ahead.',
      moodSwings: "{name} can't relax today for dreading the week ahead."
    }
  ],
  lustful: [
    {
      normal: '{name} is a little sexually frustrated today.',
      moodSwings: '{name} woke up intensely sexually frustrated today.'
    },
    {
      normal: '{name} keeps having indecent thoughts today.',
      moodSwings: "{name} can't stop thinking about sex today."
    }
  ],
  hungover: [
    {
      normal: '{name} is nursing a hangover today.',
      moodSwings: "{name} is horribly hungover today and swearing he'll never drink again."
    }
  ],
  funk: [
    {
      normal: "{name} is in a funk and doesn't feel like seeing anyone today.",
      moodSwings: '{name} is in a deep funk today and wants to be left alone.'
    }
  ],
  drained: [
    {
      normal: '{name} is worn out and would rather stay in today.',
      moodSwings: "{name} is completely drained today and doesn't want to leave his room."
    }
  ]
}

/** The day of the week, Monday 0, as both seasons' day 0 is a Monday. */
function weekdayOf(date: number): number {
  return ((date % 7) + 7) % 7
}

/** The weights a guy's day is drawn from: the week's shift, then yesterday's, then Mood-swings. */
function guyDayWeights(
  date: number,
  yesterday: GuyDayKind | null,
  moodSwings: boolean
): Record<GuyDayKind, number> {
  const weights: Record<GuyDayKind, number> = { ...GUY_DAY_WEIGHT }
  const weekday = weekdayOf(date)
  if (weekday === 6) weights.dread = GUY_DREAD_WEIGHT
  const shifts = [GUY_WEEKDAY_SHIFT[weekday], yesterday ? GUY_CARRY_SHIFT[yesterday] : undefined]
  for (const shift of shifts) {
    for (const [kind, by] of Object.entries(shift ?? {}) as [GuyDayKind, number][]) {
      weights[kind] *= by
    }
  }
  if (moodSwings) {
    for (const [kind, by] of Object.entries(GUY_SWINGS_DELTA) as [GuyDayKind, number][]) {
      weights[kind] = Math.max(0, weights[kind] + by)
    }
  }
  return weights
}

/** The rolls one guy's day is drawn with, off his offset and the date alone. */
function guyDayRand(date: number, offset: number): () => number {
  return seededRand(`guy-day:${offset}:${date}`)
}

/** One weighted pick off a roll in [0, 1). */
function pickKind(weights: Record<GuyDayKind, number>, roll: number): GuyDayKind {
  const kinds = Object.keys(weights) as GuyDayKind[]
  const total = kinds.reduce((sum, kind) => sum + weights[kind], 0)
  let left = roll * total
  for (const kind of kinds) {
    left -= weights[kind]
    if (left < 0) return kind
  }
  return 'ordinary'
}

/** Each guy's days drawn so far, by offset and column, day 0 first. */
const guyDays = new Map<string, GuyDayKind[]>()

/**
 * The kind of day a guy is having: drawn off his offset and the date, leaning on the day of the
 * week and on the day before, the chain starting afresh at every semester's day 0.
 */
export function guyDayOf(date: number, offset: number, moodSwings: boolean): GuyDayKind {
  if (date < 0) return pickKind(guyDayWeights(date, null, moodSwings), guyDayRand(date, offset)())
  const key = `${offset}:${moodSwings}`
  const days = guyDays.get(key) ?? []
  guyDays.set(key, days)
  for (let day = days.length; day <= date; day++) {
    const weights = guyDayWeights(day, day > 0 ? days[day - 1] : null, moodSwings)
    days.push(pickKind(weights, guyDayRand(day, offset)()))
  }
  return days[date]
}

/** The guy's day for a holder on a date, or null for a girl. */
function guyDayFor(holder: MoodHolder | undefined, date: number, offset: number): GuyDayKind | null {
  if (genderOf(holder) !== 'male') return null
  return guyDayOf(date, offset, hasTrait(holder, 'Mood-swings'))
}

/**
 * Whether this is a day they stay in: a girl's first three days of the cycle and its last, a
 * guy's hangover, funk or drained day.
 */
export function isMoodHomebound(holder: MoodHolder | undefined, date: number, offset: number): boolean {
  const guyDay = guyDayFor(holder, date, offset)
  if (guyDay !== null) return GUY_STAY_IN_DAYS.includes(guyDay)
  const index = moodIndexOf(date, offset)
  return index <= 2 || index === MOOD_CYCLE_LENGTH - 1
}

/**
 * Whether this is a day they are down to fuck: a girl's run of days around ovulation, by column,
 * or a guy's lustful day.
 */
export function isMoodLustful(holder: MoodHolder | undefined, date: number, offset: number): boolean {
  const guyDay = guyDayFor(holder, date, offset)
  if (guyDay !== null) return guyDay === 'lustful'
  const [first, last] = hasTrait(holder, 'Mood-swings') ? LUST_DAYS.moodSwings : LUST_DAYS.normal
  const index = moodIndexOf(date, offset)
  return index >= first && index <= last
}

/**
 * The one line said about a character's mood on a day, filled with their name; Mood-swings picks
 * the harder-felt column.
 */
export function moodLine(
  holder: MoodHolder & Pick<Character, 'firstName'>,
  date: number,
  offset: number
): string {
  const moodSwings = hasTrait(holder, 'Mood-swings')
  const guyDay = guyDayFor(holder, date, offset)
  let day: MoodDay
  if (guyDay === null) {
    day = MOOD_CYCLE[moodIndexOf(date, offset)]
  } else if (guyDay === 'ordinary') {
    return ''
  } else {
    const lines = GUY_DAY_LINES[guyDay]
    // The day's second roll picks the wording, so the same day always reads the same.
    const rand = guyDayRand(date, offset)
    rand()
    day = lines[Math.floor(rand() * lines.length)]
  }
  return (moodSwings ? day.moodSwings : day.normal).replace('{name}', holder.firstName)
}
