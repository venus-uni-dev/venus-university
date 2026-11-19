import { genderOf, PRONOUNS, readerWords, type ReaderPronouns } from '@shared/gender'
import { describeReaderToPlayer, statsMaxed, type PlayerStats } from '@shared/playerStats'
import type { Character, SceneLine, TimeSlot } from '@shared/types'
import { formatDatePart } from './gameDate'
import { readerAmongCast } from './setting'

/**
 * The authored opening of a playthrough: the arrival scroll and the
 * orientation scene that follows it, then the four lines that welcome him home that night.
 */

/**
 * The playthrough's first slot — the arrival scroll and freshman orientation. A later
 * semester's first slot is an ordinary one.
 */
export function isOrientationSlot(date: number, time: TimeSlot, semesterIndex: number): boolean {
  return semesterIndex === 0 && date === 0 && time === 0
}

/**
 * The playthrough's second slot — the welcome home, in place of the slot-opening narration. It
 * is the first ordinary hour of the game: four authored lines and then the landing, which is
 * the screen every slot after it opens on. A later semester has none.
 */
export function isTutorialSlot(date: number, time: TimeSlot, semesterIndex: number): boolean {
  return semesterIndex === 0 && date === 0 && time === 1
}

/**
 * The arrival scroll, one line per click: the tram in, the walk through the city, the gates,
 * the dorm room, and back out to orientation.
 */
export function introScrollLines(stats: PlayerStats, date: number): SceneLine[] {
  return [
    {
      bg: 'train_stop',
      text: `${formatDatePart(date, 'spring')}. Today is move-in day and freshman orientation at Venus University.`
    },
    {
      text: `You step off the air-conditioned tram into the crisp Veridan air. A colorful map of the Loop's route greets you, the stop for VU highlighted in bright pink.`
    },
    { text: `You decided to get off a stop early to walk around a bit.` },
    {
      text: `The weather is incredible. When you left your hometown, it was still completely frozen over there. But the air here is pleasantly cool, and the smell of blooming flowers is everywhere.`
    },
    {
      text: `You read that it may have something to do with the Silk River, which runs through the city, but you skipped the meteorologist explanation.`
    },
    {
      bg: 'downtown_street',
      text: `You pass a sign that says "Welcome to Downtown Veridan." You make your way through the narrow, weathered streets, eye on the statue of Jupiter in the distance that marks the VU campus gate.`
    },
    {
      bg: 'stanchion_street',
      text: `You pass old buildings that look like they were built decades ago, still hanging onto their old charm. Behind the squat buildings, you spot skyscrapers and highway overpasses in the distance: new developments.`
    },
    {
      bg: 'campus_road',
      text: `You finally make it to the gardens that block off the campus from the city and head through the gates. The noise from the city seems to just disappear.`
    },
    {
      bg: 'quad',
      text: `You follow the Gold Road to the quad, passing several familiar locations where "Love Between Gods" was shot. The lush gardens, classical stone, and expensive glass are even more beautiful than they were on screen.`
    },
    {
      text: `Everyone around you is someone who also won the lottery draw to get in here, and they're all moving in one eager wave towards the dorms to unpack.`
    },
    {
      bg: 'lowrise_dorm_room',
      text: `You find your room. Located in number 4 out of the five Lowrise buildings, you slide the glass door open into a spacious single-occupancy unit that overlooks a courtyard garden.`
    },
    {
      text: `Your bags have already been delivered. As you see your future classmates milling about the campus, you start to feel pretty pumped.`
    },
    { text: describeReaderToPlayer(stats) },
    {
      text: statsMaxed(stats)
        ? `There's nothing left for this place to teach you. The question for you is how you'll turn this place into your personal playground.`
        : `Still, you're determined to improve yourself over the long semester.`
    },
    {
      bg: 'campus_road',
      text: `You finish unpacking and head down to find your orientation group.`
    }
  ].map((line) => ({ speaker: '', ...line }))
}

/** Who the orientation scene is cast with, as its premise reads them. */
export interface OrientationPick {
  /** The character the scene is cast with: the name, and the pronouns the premise uses. */
  who: Pick<Character, 'firstName' | 'gender'>
  /** A freshman too; otherwise the upperclassman leading his group. */
  freshman: boolean
  /** The reader knew them before he came here. */
  met: boolean
  /** The reader knew somebody on the roster before he came here, them or another. */
  knowsSomebody: boolean
}

/**
 * The orientation scene's action text, written *about* the reader rather than by him; the loop
 * does not log it as one of his lines. Somebody he already knows is a familiar face rather than
 * somebody new, and a premise names the reader outright where the reader's pronoun would read as
 * theirs.
 */
export function orientationPremise(pick: OrientationPick, reader: ReaderPronouns): string {
  const { firstName } = pick.who
  const g = genderOf(pick.who)
  const male = g === 'male'
  const p = PRONOUNS[g]
  const alone = readerWords(reader)
  const beside = readerWords(reader, g)
  const amongGirls = readerAmongCast(reader)
  if (pick.freshman && pick.met) {
    return `The reader is standing with ${alone.his} orientation group in the Venus Quad, and ${firstName}, another freshman, turns out to be in it too. The two of them already knew each other before either came here — write the scene with that feeling: a familiar face on the first day, everything here still ahead of them both.`
  }
  if (pick.met) {
    return `The reader's orientation group is short of half its people. ${firstName}, the upperclassman leading the group, is somebody ${beside.he} already knows from before ${amongGirls.he} came here, and the two of them talk while the stragglers turn up. ${male ? firstName : 'She'} knows ${p.their} way around and is in no hurry. Write the scene with that first-day feeling: a familiar face in a new place, and everything here still ahead of ${beside.him}.`
  }
  if (pick.freshman) {
    const strangers = pick.knowsSomebody
      ? 'The two of them have never met'
      : 'Neither of them knows anybody here yet'
    return `The reader is standing with ${alone.his} orientation group in the Venus Quad. One of the other freshmen stands out to ${amongGirls.him}. ${strangers} and neither knows whether this is the start of anything at all — write the scene with that feeling: first day, everything still ahead, nothing decided.`
  }
  const him = pick.knowsSomebody ? `${beside.he} is new here` : `${beside.he} knows nobody at all`
  return `The reader's orientation group is short of half its people. ${firstName}, the upperclassman leading the group, introduces ${p.themself} to ${beside.him}, and the two of them talk while the stragglers turn up. ${male ? firstName : 'She'} already knows ${p.their} way around and is in no hurry; ${him}. Write the scene with that first-day feeling: an easy, unhurried conversation between two people who have just met, and the open question of whether it leads anywhere.`
}

/**
 * A piece of Game View chrome an authored screen can withhold. The arrival scroll and the
 * endings keep only {@link BASE_REVEAL}; every other screen reveals all of it.
 */
export type RevealKey =
  | 'settings'
  | 'calendar'
  | 'bunnyboard'
  | 'cast'
  | 'background'
  | 'hideui'
  | 'chatlog'

/** What an authored screen leaves standing, the arrival scroll included. */
export const BASE_REVEAL: ReadonlySet<RevealKey> = new Set<RevealKey>([
  'settings',
  'cast',
  'background',
  'hideui',
  'chatlog'
])

/**
 * The epilogue's own set while its menu is up: `BASE_REVEAL` minus the eye, plus the phone —
 * the log holds the ceremony or the last goodbye, and the phone is read there, never written.
 */
export const EPILOGUE_REVEAL: ReadonlySet<RevealKey> = new Set<RevealKey>([
  'settings',
  'cast',
  'background',
  'bunnyboard',
  'chatlog'
])

/**
 * A replay from the calendar's set: the menu, the eye and the log, and nothing that would act on
 * a scene already played or reach the game held behind it.
 */
export const REPLAY_REVEAL: ReadonlySet<RevealKey> = new Set<RevealKey>([
  'settings',
  'hideui',
  'chatlog'
])

/** Every key — what a slot the player holds the turn on shows, which is every slot but the first. */
export const ALL_REVEALED: ReadonlySet<RevealKey> = new Set<RevealKey>([
  'settings',
  'calendar',
  'bunnyboard',
  'cast',
  'background',
  'hideui',
  'chatlog'
])

/**
 * The welcome home: the last authored narration before the game is the player's. Four lines
 * covering what the landing can't say: the semester's length, two slots to a day, and a nudge out.
 */
const WELCOME_LINES: readonly string[] = [
  'You finally make it back to your room, exhausted after a lively morning.',
  "This is it... you're officially a student. Welcome to Venus University!",
  "The semester runs from January to May. Each day, you'll decide how to spend your morning and evening.",
  "Classes don't start until tomorrow, so you're free to do whatever you want tonight. Why not explore the campus or the city?"
]

/** The first night's lines, in order; the landing arrives as the last one is turned. */
export function tutorialLines(): string[] {
  return [...WELCOME_LINES]
}
