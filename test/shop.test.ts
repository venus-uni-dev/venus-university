import { describe, expect, it } from 'vitest'
import {
  giftReactionOf,
  giftStatusMarkedLine,
  GIFT_MEMORY_CAP,
  MATERIALIST_PRICE_FLOOR,
  withGiftMemory,
  type GiftCategory
} from '@shared/shop'
import type { CharMemory } from '@shared/types'
import { character, item } from './fixtures'

/**
 * The gift verdict and the memory it leaves are both stamped onto the save: a wrong verdict or
 * a wrong eviction from the capped gift list writes a save that looks valid and is quietly wrong.
 */

describe('giftReactionOf', () => {
  const orchid = item({ categories: ['cozy'], price: 70 }) // cozy — one tag, under the Materialist floor
  const nightlight = item({ categories: ['cozy', 'cute'], price: 44 })
  const flask = item({ categories: ['edgy', 'practical'], price: 52 })
  const coat = item({ categories: ['luxury', 'cozy'], price: MATERIALIST_PRICE_FLOOR * 2 }) // well above the floor

  const girl = (liked: GiftCategory[], disliked: GiftCategory[] = [], materialist = false) =>
    character({
      giftPreferences: { liked, disliked },
      traits: materialist ? ['Materialist'] : []
    })

  it('loves a present whose every tag she likes', () => {
    expect(giftReactionOf(nightlight, girl(['cozy', 'cute']), false)).toBe('loved')
  })

  it('loves a one-tag present off a single liked category', () => {
    expect(giftReactionOf(orchid, girl(['cozy']), false)).toBe('loved')
  })

  it('only likes a present she is half sold on', () => {
    expect(giftReactionOf(nightlight, girl(['cozy']), false)).toBe('liked')
  })

  it('still likes it when the other half is a category she dislikes', () => {
    expect(giftReactionOf(nightlight, girl(['cozy'], ['cute']), false)).toBe('liked')
  })

  it('is unimpressed by a present that only hits what she dislikes', () => {
    expect(giftReactionOf(flask, girl(['cozy'], ['edgy']), false)).toBe('unimpressed')
    expect(giftReactionOf(orchid, girl(['cute'], ['cozy']), false)).toBe('unimpressed')
  })

  it('appreciates a present her taste says nothing about', () => {
    expect(giftReactionOf(flask, girl(['cozy'], ['cute']), false)).toBe('neutral')
  })

  describe('a Materialist', () => {
    it('loves an expensive present that is entirely her taste', () => {
      expect(giftReactionOf(coat, girl(['luxury', 'cozy'], [], true), false)).toBe('loved')
    })

    it('likes anything expensive, even against her taste', () => {
      expect(giftReactionOf(coat, girl(['cute'], ['luxury', 'cozy'], true), false)).toBe('liked')
    })

    it('cannot be pleased below the floor, however well chosen', () => {
      expect(giftReactionOf(orchid, girl(['cozy'], [], true), false)).toBe('neutral')
      expect(giftReactionOf(flask, girl(['cozy'], ['edgy'], true), false)).toBe('unimpressed')
    })

    /** The floor is inclusive, and both sides of it are pinned deliberately. */
    it('counts the floor itself as expensive enough', () => {
      const cheap = { ...orchid, price: MATERIALIST_PRICE_FLOOR - 1 }
      const dear = { ...orchid, price: MATERIALIST_PRICE_FLOOR }
      expect(giftReactionOf(cheap, girl(['cozy'], [], true), false)).toBe('neutral')
      expect(giftReactionOf(dear, girl(['cozy'], [], true), false)).toBe('loved')
    })

    it('is unimpressed by a repeat, whatever the price tag says', () => {
      expect(giftReactionOf(coat, girl(['luxury', 'cozy'], [], true), true)).toBe('unimpressed')
    })
  })

  /**
   * The repeat answer is unconditional and comes first: a present she already
   * owns is one nothing about her taste can redeem.
   */
  it('is unimpressed by a repeat of the present she loved most', () => {
    expect(giftReactionOf(nightlight, girl(['cozy', 'cute']), true)).toBe('unimpressed')
    expect(giftReactionOf(orchid, girl([]), true)).toBe('unimpressed')
  })
})

describe('withGiftMemory', () => {
  const entry = (type: CharMemory['type'], desc: string, date = 1): CharMemory => ({
    date,
    type,
    desc
  })

  // An eviction below the cap would silently drop a stored present; both
  // eviction tests below start at the cap, so this is the only one that says so.
  it('keeps everything while there is room', () => {
    const kept = withGiftMemory([entry('liked', 'a')], entry('loved', 'b'), GIFT_MEMORY_CAP)
    expect(kept.map((m) => m.desc)).toEqual(['a', 'b'])
  })

  it('gives up the earliest merely-liked present first', () => {
    const held = [entry('loved', 'a'), entry('liked', 'b'), entry('liked', 'c')]
    const kept = withGiftMemory(held, entry('loved', 'd'), GIFT_MEMORY_CAP)
    expect(kept.map((m) => m.desc)).toEqual(['a', 'c', 'd'])
  })

  it('only spends a loved present when every place holds one', () => {
    const held = [entry('loved', 'a'), entry('loved', 'b'), entry('loved', 'c')]
    const kept = withGiftMemory(held, entry('liked', 'd'), GIFT_MEMORY_CAP)
    expect(kept.map((m) => m.desc)).toEqual(['b', 'c', 'd'])
  })

  it('never mutates the list it was handed', () => {
    const held = [entry('liked', 'a'), entry('liked', 'b'), entry('liked', 'c')]
    withGiftMemory(held, entry('loved', 'd'), GIFT_MEMORY_CAP)
    expect(held.map((m) => m.desc)).toEqual(['a', 'b', 'c'])
  })
})

/**
 * How the handover reads at the scene's end: the verdict is a run the box paints, and
 * an offset onto the wrong characters still draws.
 */
describe('giftStatusMarkedLine', () => {
  it('paints the verdict where the present landed', () => {
    for (const [reaction, run] of [
      ['loved', 'really love'],
      ['liked', 'like']
    ] as const) {
      const line = giftStatusMarkedLine('Sarah', reaction)
      const marks = line.status?.marks ?? []
      expect(marks, reaction).toHaveLength(1)
      expect(line.text.slice(marks[0].start, marks[0].end)).toBe(run)
      expect(marks[0].tone).toBe('gain')
    }
  })

  it('leaves the two that went nowhere in plain ink', () => {
    expect(giftStatusMarkedLine('Sarah', 'neutral').status).toBeUndefined()
    expect(giftStatusMarkedLine('Sarah', 'unimpressed').status).toBeUndefined()
  })
})
