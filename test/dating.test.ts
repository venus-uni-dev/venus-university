import { describe, expect, it } from 'vitest'
import { settleDating, type DatingPassInput, type DatingPassOutcome } from '@shared/dating'
import { emptyFlags } from '@shared/relationship'
import type { CharFlags, CharInfo } from '@shared/types'
import { charInfo, friends } from './fixtures'

/**
 * What a new relationship does to the one before it. Every field this pass writes lands in the
 * save and is read for the rest of the playthrough: a lover left twice, a breakup nobody texts
 * about or a heartbreak memory on the wrong girl is invisible until it is unfixable.
 */

const DATE = 10
const NAMES: Record<string, string> = {
  a: 'Ana',
  b: 'Bea',
  c: 'Cleo',
  d: 'Dita',
  f: 'Fay',
  h: 'Hana',
  n: 'Nia'
}

/** One girl's entry, her flags spelled out and the rest of the state defaulted. */
function girl(flags: Partial<CharFlags> = {}, over: Partial<CharInfo> = {}): CharInfo {
  return charInfo({ flags: { ...emptyFlags(), ...flags }, ...over })
}

/** Runs the pass over a before/after pair, the roster taken from `after` in its own order. */
function run(
  before: Record<string, CharInfo>,
  after: Record<string, CharInfo>,
  over: Partial<DatingPassInput> = {}
): DatingPassOutcome {
  return settleDating({
    roster: Object.keys(after),
    before,
    after,
    firstNames: NAMES,
    npcRelationships: {},
    date: DATE,
    ...over
  })
}

/** The entry the pass wrote for one girl; a missing one is the failure itself. */
function entryOf(outcome: DatingPassOutcome, charId: string): CharInfo {
  const info = outcome.charInfo[charId]
  if (!info) throw new Error(`the pass wrote nothing for ${charId}`)
  return info
}

describe('settleDating', () => {
  it('settles nothing at all for a scene that started no relationship', () => {
    const outcome = run({ a: girl({ isLover: true }) }, { a: girl({ isLover: true }) })
    expect(outcome).toEqual({ charInfo: {}, breakups: [] })
  })

  it('leaves a first relationship standing and touches nobody', () => {
    const outcome = run({ a: girl(), b: girl() }, { a: girl({ isLover: true }), b: girl() })
    expect(outcome).toEqual({ charInfo: {}, breakups: [] })
  })

  it('brings the new girl into an open relationship the old one had already agreed to', () => {
    const outcome = run(
      { h: girl({ isLover: true, harem: true }), n: girl() },
      { h: girl({ isLover: true, harem: true }), n: girl({ isLover: true }) }
    )

    expect(entryOf(outcome, 'n').flags.harem).toBe(true)
    expect(outcome.charInfo.h).toBeUndefined()
    expect(outcome.breakups).toEqual([])
  })

  it('leaves the lover who wanted him to herself, and tells the girls with a claim', () => {
    const before = {
      a: girl({ isLover: true }),
      n: girl(),
      c: girl({ hasCrush: true }),
      f: girl(),
      d: girl()
    }
    const outcome = run(
      before,
      { ...before, n: girl({ isLover: true }) },
      { npcRelationships: friends(['f', 'a'], ['c', 'a']) }
    )

    const dumped = entryOf(outcome, 'a')
    expect(dumped.flags.isLover).toBe(false)
    expect(dumped.flags.brokenUp).toBe(1)
    expect(dumped.brokeUpOn).toBe(DATE)
    expect(dumped.leftFor).toBe('n')
    expect(outcome.breakups).toEqual([{ charId: 'a', forCharId: 'n' }])

    // Her own hopes outrank a friend's heartbreak, so Cleo hears about herself.
    expect(entryOf(outcome, 'a').jealousyMemories).toEqual([
      {
        date: DATE,
        type: 'hated',
        desc: 'the reader broke her heart by starting to date Nia instead'
      }
    ])
    expect(entryOf(outcome, 'c').jealousyMemories).toEqual([
      {
        date: DATE,
        type: 'hated',
        desc: 'the reader started dating Nia when she had a crush on the reader'
      }
    ])
    expect(entryOf(outcome, 'f').jealousyMemories).toEqual([
      { date: DATE, type: 'disliked', desc: "the reader broke Ana's heart" }
    ])
    expect(outcome.charInfo.d).toBeUndefined()
  })

  it('leaves both lovers at once and counts their friend one heartbreak', () => {
    const before = { a: girl({ isLover: true }), b: girl({ isLover: true }), n: girl(), f: girl() }
    const outcome = run(
      before,
      { ...before, n: girl({ isLover: true }) },
      { npcRelationships: friends(['f', 'a'], ['f', 'b']) }
    )

    expect(outcome.breakups).toEqual([
      { charId: 'a', forCharId: 'n' },
      { charId: 'b', forCharId: 'n' }
    ])
    expect(entryOf(outcome, 'f').jealousyMemories).toEqual([
      { date: DATE, type: 'disliked', desc: 'the reader broke the hearts of Ana and Bea' }
    ])
  })

  it('never lets two new lovers in one scene leave each other', () => {
    const outcome = run(
      { a: girl(), b: girl() },
      { a: girl({ isLover: true }), b: girl({ isLover: true }) }
    )
    expect(outcome).toEqual({ charInfo: {}, breakups: [] })
  })

  it('never leaves the lover the scene itself broke up with a second time', () => {
    const outcome = run(
      { a: girl({ isLover: true }), n: girl() },
      { a: girl({ brokenUp: 1 }), n: girl({ isLover: true }) }
    )
    expect(outcome).toEqual({ charInfo: {}, breakups: [] })
  })

  it('settles the same input the same way twice', () => {
    const before = { a: girl({ isLover: true }), n: girl(), c: girl({ hasCrush: true }) }
    const after = { ...before, n: girl({ isLover: true }) }
    expect(run(before, after)).toEqual(run(before, after))
  })
})
