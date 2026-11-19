import { pronounsOf } from '@shared/gender'
import type { Disposition } from '@shared/relationship'
import { markedLine } from '@shared/statusMark'
import type { Character, SceneLine, Season, TimeSlot } from '@shared/types'
import { formatDatePart, formatGameDate } from './gameDate'
import { FINALS_WEEK, GRADUATION_DATE } from './occasions'

/**
 * The end of the semester: the last fortnight's dates, and every sentence said about a
 * term running out.
 */

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
 * What a cast member's lines say about the end of term: that she graduates at it, all semester
 * long where she does, and from the Monday of finals week to the day before the ceremony, that
 * she is staying for it.
 */
export function graduationCastLines(
  firstName: string,
  date: number,
  season: Season,
  graduating: boolean
): string[] {
  const ceremony = formatDatePart(GRADUATION_DATE, season)
  const lines = graduating
    ? [`${firstName} graduates at the end of this semester, at the ceremony on ${ceremony}.`]
    : []
  if (date < FINALS_WEEK.startDate || date >= GRADUATION_DATE) return lines
  return [
    ...lines,
    `${firstName} isn't leaving campus until after the graduation ceremony on ${ceremony}.`
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
 * named only where the camera moves. A fall's ceremony is under a tent, and on the reader's own
 * graduation he crosses the stage too.
 */
export function graduationScrollLines(
  graduates: readonly string[],
  season: Season,
  readerGraduates: boolean
): SceneLine[] {
  const fall = season === 'fall'
  const lines: { bg?: string; text: string }[] = [
    {
      bg: 'lowrise_dorm_room',
      text: `${formatDatePart(GRADUATION_DATE, season)}. You wake up in an empty room, all of your stuff packed in neat little boxes.`
    },
    {
      bg: 'campus_road',
      text: `Outside, the campus is at double its usual capacity, with cars lining the streets. From your window, you see students chatting with their parents as they haul boxes into trunks.`
    },
    {
      bg: 'quad',
      text: fall
        ? `You follow the Gold road to the quad, where heaters have been set up near the rows of folding chairs to combat the colder weather.`
        : `You follow the Gold road to the quad, which has been turned into a makeshift amphitheater overnight, filled with white folding chairs shaded by trees.`
    },
    {
      text: readerGraduates
        ? `You take your seat among the black-gowned graduates. For hours, they filter up on stage one by one to get a handshake and a little piece of paper.`
        : `You find a seat near the back. For hours, black-gowned students filter up on stage to get a handshake and a little piece of paper.`
    },
    {
      text:
        graduates.length > 0
          ? `You sit patiently, waving when you see ${graduateList(graduates)} get on stage to receive their diploma.`
          : `You sit patiently through a long procession of names you have never heard, clapping along with everybody else as each one crosses the stage.`
    },
    ...(readerGraduates
      ? [{ text: `Then they call your name, and you cross the stage for a little piece of paper of your own.` }]
      : []),
    {
      text: fall
        ? `The fall graduation speech is by some alumna who founded a dating app, followed up by Thorne cracking a few jokes in poor taste afterwards.`
        : `This year's graduation speech is by some tech CEO warning that AI could end the world, followed up by Thorne cracking a few jokes in poor taste afterwards.`
    },
    {
      text: readerGraduates
        ? `Finally, the caps go up, yours among them, and the after-ceremony begins: hugs, laughter, weeping, the whole shebang.`
        : `Finally, the caps go up, and the after-ceremony begins: hugs, laughter, weeping, the whole shebang. You know the deal.`
    },
    {
      bg: 'campus_road',
      text: readerGraduates
        ? `You head home. With that, your time at Venus University is over. Some are leaving campus sooner, some later.`
        : `You head home. With that, the semester is finally over. Some are leaving campus sooner, some later.`
    },
    {
      bg: 'lowrise_dorm_room',
      text: readerGraduates
        ? `Over the next few days, you say your final goodbyes to your friends before leaving Veridan yourself.`
        : `Over the next few days, you say your final goodbyes to your friends before heading home yourself.`
    }
  ]
  return lines.map((line) => ({ speaker: '', ...line }))
}

/**
 * The action a goodbye scene is written from — written *about* the reader, like the
 * orientation premise, so it is never classified.
 */
export function farewellAction(firstName: string): string {
  return `The reader is saying goodbye to ${firstName} some time after graduation day.`
}

/**
 * The two `NOW` lines a goodbye scene replaces the date banner and the semester line with;
 * `forAWhile` where one of them is graduating, so no vacation brings them back.
 */
export function farewellNowLines(firstName: string, forAWhile: boolean, season: Season): string[] {
  const vacation = season === 'spring' ? 'summer vacation' : 'winter vacation'
  return [
    `An unspecified night a few days after ${formatGameDate(GRADUATION_DATE, season)}, graduation day...`,
    forAWhile
      ? `This is the last time that the reader will be seeing ${firstName} for a while.`
      : `This is the last time the reader will be seeing ${firstName} until after ${vacation}.`
  ]
}

/**
 * What the player is left with when a goodbye ends — the one status line an epilogue
 * scene gets in place of the ledger's. How they took it is the coloured run, and the line rings
 * positive whichever tier they are on.
 */
export function farewellStatusLine(
  who: Pick<Character, 'firstName' | 'gender'>,
  disposition: Disposition
): SceneLine {
  const { firstName } = who
  const p = pronounsOf(who)
  if (disposition === 'devoted') {
    return markedLine(
      `${firstName} will `,
      'remember the memories you made together forever.',
      ` ${p.They} can't wait to see you again.`,
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
    `glad ${p.they} got to know you`,
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
