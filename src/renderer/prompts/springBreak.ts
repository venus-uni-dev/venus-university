import { genderOf, PRONOUNS, readerWords, type ReaderPronouns } from '@shared/gender'
import { isPositive } from '@shared/relationship'
import type { CharInfo, Character } from '@shared/types'
import { formatDatePart } from './gameDate'
import { breakWeekOf } from './occasions'

/** Who spends a spring's break where, and every sentence said about it. */

/** The week off a spring semester has; a fall's Thanksgiving break sends nobody away. */
const SPRING_BREAK = breakWeekOf('spring')

/** The Monday of midterms week — the pick fires and the notice starts. */
export const SPRING_BREAK_NOTICE = SPRING_BREAK.startDate - 7

/** The Saturday the leavers go. The break as a student lives it starts here. */
export const SPRING_BREAK_LEAVE = SPRING_BREAK.startDate - 2

/** The Sunday morning they are back, the day before classes resume. */
export const SPRING_BREAK_RETURN = SPRING_BREAK.endDate + 2

/** The Saturday it stops being worth saying. */
const SPRING_BREAK_FORGET = SPRING_BREAK_RETURN + 6

/** How much of the roster leaves — half, rounded down. */
const AWAY_SHARE = 2

/** Who goes: the highest half by the affection the reader has earned, ties broken by roster order. */
export function pickSpringBreakLeavers(
  charIds: readonly string[],
  affectionOf: (charId: string) => number
): string[] {
  const ranked = charIds
    .map((charId, index) => ({ charId, index, affection: affectionOf(charId) }))
    .sort((a, b) => b.affection - a.affection || a.index - b.index)
  return ranked.slice(0, Math.floor(charIds.length / AWAY_SHARE)).map((entry) => entry.charId)
}

/** True while `charId` is off campus — Saturday through Saturday. */
export function isAwayForSpringBreak(
  away: readonly string[] | null | undefined,
  charId: string,
  date: number
): boolean {
  if (!away) return false
  return date >= SPRING_BREAK_LEAVE && date < SPRING_BREAK_RETURN && away.includes(charId)
}

/**
 * Whether a leaver texts the reader that she is going: a contact who has not blocked him and is
 * friendly or warmer.
 */
export function sendsSpringBreakNotice(info: CharInfo | undefined, affection: number): boolean {
  const flags = info?.flags
  return Boolean(flags?.gaveContactInfo) && !flags?.blocked && isPositive(affection)
}

/**
 * The one sentence a character's spring break earns, from the notice through to the Saturday
 * after they are back, naming the reader outright where the reader's pronoun would read as theirs.
 */
export function springBreakLines(
  who: Pick<Character, 'firstName' | 'gender'>,
  plans: string | undefined,
  away: readonly string[] | null | undefined,
  charId: string,
  date: number,
  reader: ReaderPronouns
): string[] {
  const { firstName } = who
  const g = genderOf(who)
  const p = PRONOUNS[g]
  if (!away) return []
  if (date < SPRING_BREAK_NOTICE || date >= SPRING_BREAK_FORGET) return []

  if (!away.includes(charId)) {
    return date <= SPRING_BREAK_RETURN
      ? [`${firstName} is staying on campus for spring break.`]
      : [`${firstName} stayed on campus for spring break.`]
  }

  // Plans end in a full stop; a blank plan takes one in place of the colon.
  const tail = plans && plans.trim() !== '' ? `: ${plans.trim()}` : '.'

  if (date < SPRING_BREAK_LEAVE) {
    return [
      `${firstName} has spring break plans next week${tail}` +
        ` ${p.They}'s leaving campus on Saturday without the reader, who is staying in Veridan for` +
        ' the break, and is fully committed.'
    ]
  }
  if (date < SPRING_BREAK_RETURN) {
    return [
      `${firstName} left campus for spring break on ${formatDatePart(SPRING_BREAK_LEAVE, 'spring')}` +
        ` and can't hang out. What ${p.they}'s currently doing${tail}` +
        (g === 'male'
          ? ' The reader stayed in Veridan and is not with him.'
          : ` The reader is not with her: ${readerWords(reader, g).he} stayed in Veridan.`)
    ]
  }
  return [`${firstName} came back from ${p.their} spring break vacation on Sunday morning${tail}`]
}
