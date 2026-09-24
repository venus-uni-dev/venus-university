import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { feedHandlePool } from '../src/shared/supporters'
import { deriveSupporters, marblesFor } from '../scripts/supporters.mjs'

/**
 * The pure supporter rules: how a name earns its marbles, how the private ledger is reduced to
 * the shipped list, and how those marbles are spread through the feed's handle bag.
 */

const REPO = fileURLToPath(new URL('..', import.meta.url))
const LEDGER = join(REPO, 'private/supporters.json')
const SHIPPED = join(REPO, 'assets/supporters.json')

describe('feedHandlePool', () => {
  const generated = Array.from({ length: 20 }, (_, i) => `g${i}`)
  const handles = [
    { name: 'Alpha', marbles: 4 },
    { name: 'Beta', marbles: 2 }
  ]

  it('spreads every supporter across both halves of the bag', () => {
    const pool = feedHandlePool(generated, handles)
    const split = Math.ceil(pool.length / 2)
    for (const one of handles) {
      const at = pool.flatMap((entry, index) => (entry.handle === one.name ? [index] : []))
      expect(at).toHaveLength(one.marbles)
      expect(at.some((index) => index < split)).toBe(true)
      expect(at.some((index) => index >= split)).toBe(true)
    }
    expect(pool).toHaveLength(generated.length + 4 + 2)
  })

  it('keys a generated handle by its own text and drops one a supporter has taken', () => {
    const pool = feedHandlePool([...generated, 'ALPHA'], handles)
    const plain = pool.filter((entry) => !entry.supporter)
    expect(plain.map((entry) => entry.key)).toEqual(generated)
    expect(plain.map((entry) => entry.handle)).toEqual(generated)
    expect(pool).toHaveLength(generated.length + 4 + 2)
  })
})

describe('marblesFor', () => {
  it('starts at two and adds one every tripling', () => {
    expect(marblesFor(0)).toBe(2)
    expect(marblesFor(1)).toBe(2)
    expect(marblesFor(2)).toBe(2)
    expect(marblesFor(3)).toBe(3)
    expect(marblesFor(15)).toBe(4)
    expect(marblesFor(70)).toBe(5)
    expect(marblesFor(243)).toBe(7)
    expect(marblesFor(5000)).toBe(9)
  })
})

describe('deriveSupporters', () => {
  const derived = deriveSupporters({
    donors: [
      { name: 'zoe', dollars: 5 },
      { name: 'Banana', dollars: 10 },
      { name: 'zoe', dollars: 10 },
      { name: 'apple', dollars: 15 }
    ],
    playtesters: ['Quinn', 'apple']
  })

  it('lists donors largest gift first and playtesters by name', () => {
    expect(derived.donors).toEqual(['apple', 'zoe', 'Banana'])
    expect(derived.playtesters).toEqual(['apple', 'Quinn'])
  })

  it('sums a repeat donor and counts a playtester as one dollar more', () => {
    const marbles = Object.fromEntries(derived.handles.map((one) => [one.name, one.marbles]))
    expect(marbles).toEqual({
      apple: marblesFor(16),
      Banana: marblesFor(10),
      Quinn: marblesFor(1),
      zoe: marblesFor(15)
    })
  })
})

describe('the shipped list', () => {
  const current = existsSync(LEDGER) ? it : it.skip

  current('is what the ledger reduces to', () => {
    const ledger = JSON.parse(readFileSync(LEDGER, 'utf8'))
    expect(deriveSupporters(ledger)).toEqual(JSON.parse(readFileSync(SHIPPED, 'utf8')))
  })
})
