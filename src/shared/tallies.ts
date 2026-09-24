import type { IntimateAct } from './types'

/**
 * What one playthrough counts up about the reader: the money he has earned, the kisses and
 * nights behind him, the shifts he has worked, and the output tokens the cloud writer has
 * generated for it. Points on a save, never a tier.
 */

/**
 * Lifetime counts the save keeps about the reader. The first four move only in a boundary pass;
 * the tokens count moves on every cloud text reply, thinking included — retries and failed
 * replies too — and never on a picture.
 */
export interface ReaderTallies {
  moneyEarned: number
  kisses: number
  sex: number
  shiftsWorked: number
  tokensGenerated: number
}

/** The tallies a playthrough opens on: nothing earned, nothing done. */
export function emptyTallies(): ReaderTallies {
  return { moneyEarned: 0, kisses: 0, sex: 0, shiftsWorked: 0, tokensGenerated: 0 }
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

/** `tallies` with one cloud reply's output tokens added. Never mutates its input. */
export function talliesAfterTokens(tallies: ReaderTallies, generated: number): ReaderTallies {
  return { ...tallies, tokensGenerated: tallies.tokensGenerated + generated }
}

/** Compact US-English numbers of at most three significant digits. */
const TOKENS_FORMAT = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumSignificantDigits: 3
})

/** A count in at most three significant digits and a magnitude letter: "436", "1.23K", "43M". */
export function formatTokens(count: number): string {
  return TOKENS_FORMAT.format(count)
}
