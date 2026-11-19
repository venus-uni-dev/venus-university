import { PRONOUNS } from '@shared/gender'
import { isPositive } from '@shared/relationship'
import type { CharInfo, Gender, Season, TimeSlot } from '@shared/types'
import { HOMECOMING_DATE } from './occasions'

/** Which graduate comes back to campus for the fall's Homecoming, and what is said about it. */

/** Whether `date` is Homecoming, the one day a graduate may be back in town. */
export function isHomecomingVisit(season: Season, date: number): boolean {
  return season === 'fall' && date === HOMECOMING_DATE
}

/** Whether the slot is Homecoming morning, the one whose opening settles who visits. */
export function isHomecomingPickSlot(season: Season, date: number, time: TimeSlot): boolean {
  return isHomecomingVisit(season, date) && time === 0
}

/**
 * Who visits: of the graduates who gave him their number, have not blocked him and are friendly
 * or warmer, a lover before anybody else, then the most affection, a tie going to whoever
 * graduated first. Null when nobody qualifies.
 */
export function pickHomecomingVisitor(
  alumni: readonly string[],
  infoOf: (charId: string) => CharInfo | undefined,
  affectionOf: (charId: string) => number,
  exclude: ReadonlySet<string> = new Set()
): string | null {
  const ranked = alumni
    .flatMap((charId, index) => {
      const flags = infoOf(charId)?.flags
      if (!flags?.gaveContactInfo || flags.blocked || exclude.has(charId)) return []
      const affection = affectionOf(charId)
      if (!isPositive(affection)) return []
      return [{ charId, index, affection, lover: flags.isLover ? 1 : 0 }]
    })
    .sort((a, b) => b.lover - a.lover || b.affection - a.affection || a.index - b.index)
  return ranked[0]?.charId ?? null
}

/** What a graduate's entry says in place of being out of town while back for the day. */
export function homecomingVisitSentence(g: Gender): string {
  return `${PRONOUNS[g].They} is back in town to visit campus for Homecoming and leaves again tomorrow morning.`
}
