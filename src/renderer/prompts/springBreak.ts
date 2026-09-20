import { formatDatePart } from './gameDate'
import { SPRING_BREAK } from './occasions'

/** Who spends spring break where, and every sentence said about it. */

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
 * True on the break week itself, Monday to Friday, when the NPC-relationship outing
 * roll runs every slot.
 */
export function isSpringBreakOutingWeek(date: number): boolean {
  return date >= SPRING_BREAK.startDate && date <= SPRING_BREAK.endDate
}

/**
 * The one sentence a character's spring break earns, from the notice through to the Saturday
 * after she is back.
 */
export function springBreakLines(
  firstName: string,
  plans: string | undefined,
  away: readonly string[] | null | undefined,
  charId: string,
  date: number
): string[] {
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
        " She's leaving campus on Saturday and is fully committed."
    ]
  }
  if (date < SPRING_BREAK_RETURN) {
    return [
      `${firstName} left campus for spring break on ${formatDatePart(SPRING_BREAK_LEAVE)}` +
        ` and can't hang out. What she's currently doing${tail}`
    ]
  }
  return [`${firstName} came back from her spring break vacation on Sunday morning${tail}`]
}
