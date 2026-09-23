import type { IntimateAct } from './types'

/**
 * What one playthrough counts up about the reader: the money he has earned, the kisses and
 * nights behind him, and the shifts he has worked. Points on a save, never a tier.
 */

/** Lifetime counts the save keeps about the reader; each moves only in a boundary pass. */
export interface ReaderTallies {
  moneyEarned: number
  kisses: number
  sex: number
  shiftsWorked: number
}

/** The tallies a playthrough opens on: nothing earned, nothing done. */
export function emptyTallies(): ReaderTallies {
  return { moneyEarned: 0, kisses: 0, sex: 0, shiftsWorked: 0 }
}

/** `tallies` with one kiss or one night added per act, whoever was in it. Never mutates its input. */
export function talliesAfterActs(
  tallies: ReaderTallies,
  acts: readonly IntimateAct[]
): ReaderTallies {
  let kisses = 0
  let sex = 0
  for (const act of acts) {
    if (act.kind === 'kiss') kisses += 1
    else sex += 1
  }
  return { ...tallies, kisses: tallies.kisses + kisses, sex: tallies.sex + sex }
}
