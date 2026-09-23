/** Types for `supporters.mjs`, so the test beside it type-checks. */

/** The hand-kept ledger: one entry per donation, and who playtested. */
export interface SupportersLedger {
  donors: readonly { name: string; dollars: number }[]
  playtesters: readonly string[]
}

/** The shipped list the ledger derives to. */
export interface DerivedSupporters {
  donors: string[]
  playtesters: string[]
  handles: { name: string; marbles: number }[]
}

/** How many marbles a contribution of `dollars` puts in the feed's handle bag. */
export declare function marblesFor(dollars: number): number

/** The shipped list for one ledger. */
export declare function deriveSupporters(ledger: SupportersLedger): DerivedSupporters
