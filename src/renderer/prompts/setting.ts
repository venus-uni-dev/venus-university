import { describePlayer, describeReaderProfile, type PlayerStats } from '@shared/playerStats'
import { acedExamsLine, gradesBadLine, GRADES_GOOD_LINE } from '@shared/academics'
import { yearLabel } from '@shared/classes'
import { readerWords, type ReaderPronouns, type ReaderWords } from '@shared/gender'
import { andList } from '@shared/sentences'
import { readerStandingOf, type ReaderStanding } from '@shared/relationship'
import {
  LAST_SEMESTER,
  readerYearOf,
  semesterOrdinal,
  type SemesterCalendar
} from '@shared/semesters'
import { globalSlotOf } from '@shared/jobs'
import type {
  CharInfo,
  Character,
  ClassEntry,
  ClassRecord,
  ColdCase,
  Season,
  TimeSlot,
  Transcript
} from '@shared/types'
import { handedBackAcedCount } from './classProgress'
import { readerColdLine } from './colds'
import { formatShortGameDate } from './gameDate'

/**
 * Dev-authored setting text injected into every scene prompt. This is the always-on half
 * of the world: the two entries every scene needs whatever it is about. A playthrough's own
 * lorebook may rewrite it.
 */
export const SETTING = `VENUS UNIVERSITY (VU)
Motto: Concordia et Prosperitas | Founded 2014 by Frederic Thorne | 6k Student Population.

Venus University is a private megacampus built to maximize social connection. It admits students by a controversial lottery draw and funds a robust financial aid program off a seemingly bottomless endowment. The campus blends classical and ultra-modern architecture and walls itself off from the noisy city with lush gardens. Towering statues of Roman gods mark it: Venus in the quad, Jupiter at the North Entrance, Pluto at the South. Roads are paved with colored stone for navigation and purpose-built to be long and winding. The two major roads are the Gold Road, which links Jupiter and Pluto, and the Rose Road, which passes Venus and links the academic and residential areas. "Meet me where Gold crosses Rose" was cemented in national lingo by a romance film shot here called "Love Between Gods".

Campus: Venus Quad (Concord Fountain), Agora (food court, study pods), Pino-Cola Lounge (games, study desks), Kendall Library, Whitman Greenhouse, Thorne Auditorium (concert hall, practice rooms, recording studios), Palaestra Stadium (gym, pool, turf, track).
Housing: Elysium Village (upperclassmen townhouses), Lowrises 1 to 5 (anyone). All rooms are single-occupancy with shared facilities: no roommates.
Student government: VSA, split into CAPC (decor, plants) and SEB (events, mixers).
Social App: Bunnyboard.

VERIDAN, USA
River City (the Silk River) | Always Spring | 300k Population | Transit: The Loop electric tram.

Nineteenth-century textile money built Veridan, but its mills died in the 1970s and it coasted downhill until Thorne planted VU here in 2014, triggering an investment boom that delighted some longtime residents and enraged others. Sheltered by the river valley, it sits in a near-perpetual spring that meteorologists still can't explain properly.

Districts: Stanchion Street ($), Downtown ($$), Promenade ($$$).
Stanchion: BTB Arcade, Stalestein Bar (and stage), Hotel DREAMS (love hotel), Freights Books & Records, Pastel Palace (sweets), CuteTea, Eastern Buffet.
Downtown: Green Hill Park, Lotterdale Market, Reserve Bank Cafe, Bobby's Diner, SpringMart, Fast Eats, Pier 44 Amusement Park.
Promenade: Riverside Mall, Aquarium at Riverside, Future Cinema, Selkie Beach, Club Apogee, Lumiere Fusion (fine dining), Veridan Museum of Art.`

/**
 * The reader's words in a line about the characters at large: he, him and his for a he/him
 * reader, and the reader named outright otherwise, since a she or they pronoun could be read as
 * a character's.
 */
export function readerAmongCast(reader: ReaderPronouns): ReaderWords {
  const words = reader === 'he' ? readerWords('he', 'female') : readerWords('he', 'male')
  return { ...words, list: readerWords(reader).list }
}

/** Who he is dating, one sentence each, or the single sentence an all-sharing set of them earns. */
function loveLifeLines(
  lovers: ReaderStanding['lovers'],
  season: Season,
  reader: ReaderPronouns
): string[] {
  if (lovers.length >= 2 && lovers.every(({ harem }) => harem)) {
    return [`The reader is in an open relationship with ${andList(lovers.map(({ name }) => name))}.`]
  }
  return lovers.map(({ name, since, harem, leftFor }) => {
    const started = harem ? 'entered an open relationship with' : 'started dating'
    const when = since !== undefined ? ` on ${formatShortGameDate(since, season)}` : ''
    const over =
      leftFor.length > 0
        ? ` even though ${readerAmongCast(reader).he} was already dating ${andList(leftFor)}`
        : ''
    return `The reader ${started} ${name}${when}${over}.`
  })
}

/** Who he is not dating any more, with the dates it ran between. */
function exesLine(exes: ReaderStanding['exes'], season: Season): string {
  const parts = exes.map(({ name, from, to }) =>
    from !== undefined
      ? `${name} from ${formatShortGameDate(from, season)} to ${formatShortGameDate(to, season)}`
      : `${name} until ${formatShortGameDate(to, season)}`
  )
  return `The reader's exes: ${parts.join(', ')}.`
}

/**
 * What he wrote about himself, on one line that completes "The reader is": the field asks for
 * the rest of that sentence, so the opening is put in front unless he typed it himself, and a
 * full stop closes it when he left one off. Whitespace is collapsed because a newline typed
 * into the field would break the line the model reads in two. Null when he wrote nothing.
 */
function bioLine(bio: string): string | null {
  const collapsed = bio
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^the reader is\b\s*/i, '')
  if (!collapsed) return null
  const closed = /[.!?]$/.test(collapsed) ? collapsed : `${collapsed}.`
  return `The reader is ${closed}`
}

/** What the reader's name line calls them, by pronouns. */
const READER_KIND: Readonly<Record<ReaderPronouns, string>> = {
  he: 'a male',
  she: 'a female',
  they: 'a nonbinary person (they/them)'
}

/**
 * Who he is at Venus, the paragraph his bio continues: a freshman in his first semester, and
 * from his second on his year and which semester this is, the last of them said to be his last.
 */
export function readerYearLine(
  fullName: string,
  semesterIndex: number,
  reader: ReaderPronouns
): string {
  const name = `${fullName}, ${READER_KIND[reader]} who has a single dorm in Lowrise 4.`
  const his = readerWords(reader).his
  if (semesterIndex === 0) return `The reader is a freshman named ${name}`
  const year = yearLabel(readerYearOf(semesterIndex)).toLowerCase()
  const which =
    semesterIndex === LAST_SEMESTER
      ? `${his} ${semesterOrdinal(semesterIndex)} and final semester`
      : `${his} ${semesterOrdinal(semesterIndex)} semester`
  return `The reader is a ${year} taking ${which}, named ${name}`
}

/** Who the reader is. */
export function readerText(
  firstName: string,
  lastName: string,
  stats: PlayerStats,
  // Which semester he is in, his own words, his reputation and his love life, with the season
  // their dates are read in.
  reputation: {
    semesterIndex: number
    season: Season
    bio?: string
    aced?: number
    standing?: 'good' | 'bad' | null
    lovers?: ReaderStanding['lovers']
    exes?: ReaderStanding['exes']
    /** How his cold stands, where he has one that shows. */
    cold?: string
  },
  reader: ReaderPronouns
): string {
  const bio = bioLine(reputation.bio ?? '')
  return [
    readerYearLine(`${firstName} ${lastName}`, reputation.semesterIndex, reader),
    describePlayer(stats, reader),
    ...(reputation.cold ? [reputation.cold] : []),
    ...(bio ? [bio] : []),
    ...(reputation.aced && reputation.aced > 0 ? [acedExamsLine(reputation.aced)] : []),
    ...(reputation.standing === 'good' ? [GRADES_GOOD_LINE] : []),
    ...(reputation.standing === 'bad' ? [gradesBadLine(reader)] : []),
    ...loveLifeLines(reputation.lovers ?? [], reputation.season, reader),
    ...(reputation.exes?.length ? [exesLine(reputation.exes, reputation.season)] : [])
  ].join(' ')
}

/** The store fields the reader's block and his profile line are read from. */
export interface ReaderView {
  playerFirstName: string
  playerLastName: string
  stats: PlayerStats
  bio: string
  classRecords: Readonly<Record<string, ClassRecord>>
  classes: Readonly<Record<string, ClassEntry>>
  calendar: SemesterCalendar
  date: number
  time: TimeSlot
  finalsScoresShown: boolean
  gradesStanding: 'good' | 'bad' | null
  semesterIndex: number
  /** What earlier semesters left him, their aced exams among it. */
  transcript: Transcript | null
  chars: readonly string[]
  alumni: readonly string[]
  charInfo: Readonly<Record<string, CharInfo>>
  characters: Readonly<Record<string, Character>>
  readerCold: ColdCase | null
  /** The pronouns the reader goes by. */
  playerPronouns: ReaderPronouns
}

/** The roster and the graduates: a girl he is dating, or used to, may be either. */
function everyoneOf(view: ReaderView): string[] {
  return [...view.chars, ...view.alumni]
}

/** Every girl the reader's standing might name, by the first name she is known by. */
function firstNamesOf(view: ReaderView): Record<string, string> {
  const firstNames: Record<string, string> = {}
  for (const charId of everyoneOf(view)) {
    const character = view.characters[charId]
    if (character) firstNames[charId] = character.firstName
  }
  return firstNames
}

/**
 * The `READER` block for a playthrough; `override` is the ending's projection of stats and
 * charInfo, and `at` the slot the block is written for where that is not the clock's, which his
 * cold is read at.
 */
export function readerBlockOf(
  view: ReaderView,
  override?: { stats: PlayerStats; charInfo: Readonly<Record<string, CharInfo>> },
  at: { date: number; time: TimeSlot } = view
): string {
  const cold = readerColdLine(view.readerCold, globalSlotOf(at.date, at.time), view.playerPronouns)
  return readerText(
    view.playerFirstName,
    view.playerLastName,
    override?.stats ?? view.stats,
    {
      semesterIndex: view.semesterIndex,
      bio: view.bio,
      aced: acedOf(view),
      standing: view.gradesStanding,
      season: view.calendar.season,
      ...(cold ? { cold } : {}),
      ...readerStandingOf(everyoneOf(view), override?.charInfo ?? view.charInfo, firstNamesOf(view))
    },
    view.playerPronouns
  )
}

/**
 * The exams he is known for acing: every earlier semester's, and this one's once they come
 * back — known for, not merely earned.
 */
function acedOf(view: ReaderView): number {
  return (
    (view.transcript?.aced ?? 0) +
    handedBackAcedCount(
      view.classRecords,
      view.classes,
      view.calendar,
      view.date,
      view.finalsScoresShown
    )
  )
}

/** Who he is with, as his own page says it: the shared sentence, one line each, or nobody. */
function profileLoveLifeLines(lovers: ReaderStanding['lovers']): string[] {
  if (lovers.length === 0) return ['Single.']
  if (lovers.length >= 2 && lovers.every(({ harem }) => harem)) {
    return [`In an open relationship with ${andList(lovers.map(({ name }) => name))}.`]
  }
  return lovers.map(({ name }) => `Dating ${name}.`)
}

/** The profile's one-line description: his stats with no subject, his reputation, then his love life. */
export function profileDescriptionOf(view: ReaderView): string {
  const aced = acedOf(view)
  const { lovers } = readerStandingOf(everyoneOf(view), view.charInfo, firstNamesOf(view))
  return [
    describeReaderProfile(view.stats),
    ...(aced > 0 ? [`Known for acing ${aced} exam${aced === 1 ? '' : 's'}.`] : []),
    ...(view.gradesStanding === 'good' ? ['Exceptionally good grades.'] : []),
    ...(view.gradesStanding === 'bad' ? ['Known for failing every exam.'] : []),
    ...profileLoveLifeLines(lovers)
  ].join(' ')
}
