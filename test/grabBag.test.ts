import { describe, expect, it } from 'vitest'
import { drawFromBag, drawManyFromBag } from '../src/shared/grabBag'
import { lcg } from './fixtures'

/**
 * The grab bag's shuffle-and-deal rule: nothing repeats until at least half of the
 * pool has been seen, and a pool edited between builds only loses keys it no longer has.
 */

const identity = (item: string): string => item

describe('drawFromBag', () => {
  it('deals the first half of the pool before any of the second half', () => {
    const pool = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    const firstHalf = new Set(pool.slice(0, 4))
    const rand = lcg(1)
    let drawn: string[] = []
    const seen: string[] = []
    for (let i = 0; i < 4; i++) {
      const result = drawFromBag(pool, drawn, identity, rand)
      seen.push(result.item)
      drawn = result.drawn
    }
    expect(new Set(seen)).toEqual(firstHalf)
  })

  it('never repeats a key within 5 draws of itself over a long run on a pool of 10', () => {
    const pool = Array.from({ length: 10 }, (_, i) => `k${i}`)
    const rand = lcg(7)
    let drawn: string[] = []
    const history: string[] = []
    for (let i = 0; i < 40; i++) {
      const result = drawFromBag(pool, drawn, identity, rand)
      const recent = history.slice(-5)
      expect(recent).not.toContain(result.item)
      history.push(result.item)
      drawn = result.drawn
    }
  })

  it('drops set-aside keys the pool no longer carries', () => {
    const pool = ['a', 'b', 'c']
    const drawn = ['a', 'ghost']
    const result = drawFromBag(pool, drawn, identity, lcg(2))
    expect(result.drawn).not.toContain('ghost')
  })

  it('never deals an item the filter rejects, and leaves it in the bag for a plain draw', () => {
    const pool = ['a', 'b', 'c', 'd']
    const rand = lcg(11)
    let drawn: string[] = []
    for (let i = 0; i < 12; i++) {
      const result = drawFromBag(pool, drawn, identity, rand, (item) => item !== 'a')
      expect(result.item).not.toBe('a')
      expect(result.drawn).not.toContain('a')
      drawn = result.drawn
    }
    const seen: string[] = []
    for (let i = 0; i < 6; i++) {
      const result = drawFromBag(pool, drawn, identity, rand)
      seen.push(result.item)
      drawn = result.drawn
    }
    expect(seen).toContain('a')
  })

  it('returns the one item every time on a single-item pool', () => {
    const pool = ['only']
    let drawn: string[] = []
    const rand = lcg(3)
    for (let i = 0; i < 5; i++) {
      const result = drawFromBag(pool, drawn, identity, rand)
      expect(result.item).toBe('only')
      drawn = result.drawn
    }
  })
})

describe('drawManyFromBag', () => {
  it('returns 8 distinct items from a pool of 10 nearly spent', () => {
    const pool = Array.from({ length: 10 }, (_, i) => `k${i}`)
    const drawn = pool.slice(0, 7)
    const result = drawManyFromBag(pool, drawn, identity, 8, lcg(5))
    expect(result.items).toHaveLength(8)
    expect(new Set(result.items).size).toBe(8)
  })
})
