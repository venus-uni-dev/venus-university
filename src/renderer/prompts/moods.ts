/**
 * The mood cycle: what kind of day a character is having, on a fixed thirty-day loop she
 * is somewhere inside of. Only the per-character offset is save data, on {@link CharInfo}; the
 * table is read by the prompt layer alone.
 */

/** One day of the cycle. Either column may be `''` — an ordinary day. */
interface MoodDay {
  normal: string
  moodSwings: string
}

/** The cycle, index 0 = day one; its length is the cycle length. */
const MOOD_CYCLE: readonly MoodDay[] = [
  // MENSTRUATION
  {
    normal: '{name} woke up with bad cramps today but is doing her best to ignore it.',
    moodSwings: '{name} woke up with terrible cramps today and wants to be left alone.'
  },
  {
    normal: '{name} is a little frustrated that her cramps are still bothering her.',
    moodSwings: '{name} is cramping hard and is exceptionally irritable.'
  },
  {
    normal: '{name} woke up with less pain today but is feeling stressed about her hygiene.',
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

/** Where a character is in her cycle on a date; a bigger offset means further along. */
export function moodIndexOf(date: number, offset: number): number {
  return (((date + offset) % MOOD_CYCLE_LENGTH) + MOOD_CYCLE_LENGTH) % MOOD_CYCLE_LENGTH
}

/** Whether this is a day she stays in: the first three days of the cycle and the last. */
export function isMoodHomebound(date: number, offset: number): boolean {
  const index = moodIndexOf(date, offset)
  return index <= 2 || index === MOOD_CYCLE_LENGTH - 1
}

/** Whether this is a day she is down to fuck: the run of days around ovulation, by column. */
export function isMoodLustful(date: number, offset: number, moodSwings: boolean): boolean {
  const [first, last] = moodSwings ? LUST_DAYS.moodSwings : LUST_DAYS.normal
  const index = moodIndexOf(date, offset)
  return index >= first && index <= last
}

/**
 * The one line said about a character's mood on a day, filled with her name.
 * `moodSwings` picks the harder-felt column.
 */
export function moodLine(
  firstName: string,
  date: number,
  offset: number,
  moodSwings: boolean
): string {
  const day = MOOD_CYCLE[moodIndexOf(date, offset)]
  return (moodSwings ? day.moodSwings : day.normal).replace('{name}', firstName)
}
