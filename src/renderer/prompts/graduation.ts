import type { Disposition } from '@shared/relationship'
import { markedLine } from '@shared/statusMark'
import type { SceneLine, TimeSlot } from '@shared/types'
import { formatDatePart, formatGameDate } from './gameDate'
import { FINALS_WEEK, GRADUATION_DATE, SUMMER_VACATION } from './occasions'

/**
 * The end of the semester: the last fortnight's dates, and every sentence said about a
 * term running out.
 */

/**
 * The Monday summer vacation's own week starts, which is what the NPC-relationship
 * outing roll reads.
 */
const SUMMER_BREAK_START = SUMMER_VACATION.startDate + 2

/** Whether `date` is one of the empty weekdays after finals. */
export function isSummerOutingWeek(date: number): boolean {
  return date >= SUMMER_BREAK_START && date <= SUMMER_VACATION.endDate
}

/** Graduation morning — the slot the game ends in. */
export function isGraduationSlot(date: number, time: TimeSlot): boolean {
  return date === GRADUATION_DATE && time === 0
}

/**
 * Whether the epilogue's own evening has fallen — the graduation slot, once the ceremony
 * has been read.
 */
export function isEpilogueNight(
  date: number,
  time: TimeSlot,
  graduationSeen: boolean
): boolean {
  return graduationSeen && isGraduationSlot(date, time)
}

/**
 * The one thing a cast member says about the end of term, from the Monday of finals week to
 * the day before the ceremony.
 */
export function graduationCastLines(firstName: string, date: number): string[] {
  if (date < FINALS_WEEK.startDate || date >= GRADUATION_DATE) return []
  return [
    `${firstName} isn't leaving campus until after the graduation ceremony on ${formatDatePart(GRADUATION_DATE)}.`
  ]
}

/** `"A, B, C, and D"` — the ceremony's own list, and the only one written this way. */
function graduateList(names: readonly string[]): string {
  if (names.length < 2) return names.join('')
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`
}

/**
 * The scripted graduation morning, one line per click — the arrival scroll's bookend, with `bg`
 * named only where the camera moves.
 */
export function graduationScrollLines(seniors: readonly string[]): SceneLine[] {
  return [
    {
      bg: 'lowrise_dorm_room',
      text: `${formatDatePart(GRADUATION_DATE)}. You wake up in an empty room, all of your stuff packed in neat little boxes.`
    },
    {
      bg: 'campus_road',
      text: `Outside, the campus is at double its usual capacity, with cars lining the streets. From your window, you see students chatting with their parents as they haul boxes into trunks.`
    },
    {
      bg: 'quad',
      text: `You follow the Gold road to the quad, which has been turned into a makeshift amphitheater overnight, filled with white folding chairs shaded by trees.`
    },
    {
      text: `You find a seat near the back. For hours, black-gowned students filter up on stage to get their handshake and diploma.`
    },
    {
      text:
        seniors.length > 0
          ? `You sit patiently, waving when you see ${graduateList(seniors)} get on stage to receive their diploma.`
          : `You sit patiently through a long procession of names you have never heard, clapping along with everybody else as each one crosses the stage.`
    },
    {
      text: `This year's graduation speech is by some tech CEO warning that AI could end the world, followed up by Thorne cracking a few jokes in poor taste afterwards.`
    },
    {
      text: `Finally, the caps go up, and the after-ceremony begins: hugs, laughter, weeping, the whole shebang. You know the deal.`
    },
    {
      bg: 'campus_road',
      text: `You head home. With that, the semester is finally over. Some are leaving campus sooner, some later.`
    },
    {
      bg: 'lowrise_dorm_room',
      text: `Over the next few days, you say your final goodbyes to your friends before heading home yourself.`
    }
  ].map((line) => ({ speaker: '', ...line }))
}

/**
 * The action a goodbye scene is written from — written *about* the reader, like the
 * orientation premise, so it is never classified.
 */
export function farewellAction(firstName: string): string {
  return `The reader is saying goodbye to ${firstName} some time after graduation day.`
}

/** The two `NOW` lines a goodbye scene replaces the date banner and the semester line with. */
export function farewellNowLines(firstName: string, senior: boolean): string[] {
  return [
    `An unspecified night a few days after ${formatGameDate(GRADUATION_DATE)}, graduation day...`,
    senior
      ? `This is the last time that the reader will be seeing ${firstName} for a while.`
      : `This is the last time the reader will be seeing ${firstName} until after summer vacation.`
  ]
}

/**
 * What the player is left with when a goodbye ends — the one status line an epilogue
 * scene gets in place of the ledger's. How she took it is the coloured run, and the line rings
 * positive whichever tier she is on.
 */
export function farewellStatusLine(firstName: string, disposition: Disposition): SceneLine {
  if (disposition === 'devoted') {
    return markedLine(
      `${firstName} will `,
      'remember the memories you made together forever.',
      ' She can\'t wait to see you again.',
      'gain'
    )
  }
  if (disposition === 'trusted') {
    return markedLine(
      `${firstName} seems to `,
      'trust you deeply',
      ', and will miss you a lot.',
      'gain'
    )
  }
  return markedLine(
    `${firstName} seems `,
    'glad she got to know you',
    ', and will miss you.',
    'gain'
  )
}

/** What one goodbye button says. */
export function farewellButtonText(firstName: string): string {
  return `Say goodbye to ${firstName}`
}

/** The one button on that menu that is always there, and the last one on it. */
export const GO_HOME_TEXT = 'Go home (End Game)'

/** What Load Game's card calls a save taken inside the epilogue, in place of the date. */
export const GOODBYES_SAVE_LABEL = 'Goodbyes'

/** What the curtain announces the goodbye menu with, in place of a date. */
export const GOODBYES_SPLASH = { word: 'Goodbyes', meta: 'Sometime after graduation...' } as const
