import { describe, expect, it } from 'vitest'
import type { SocialPost } from '../src/shared/types'
import { GRADUATION_DATE } from '../src/renderer/prompts/occasions'
import { ENDING_POST_DAYS, rollEndingPostStamp } from '../src/renderer/stores/feedRolls'
import { endingPostsDelivered } from '../src/renderer/stores/feedView'
import { charInfo } from './fixtures'

/**
 * The epilogue's status updates are paid for once and live on the save forever: the roll that
 * dates them past graduation is what tells a reload they are already there. A stamp inside the
 * semester, or a window off by a day, would ask for them again and file the reply twice.
 */

/** A deterministic stand-in for `Math.random`, so a failing run is the same run twice. */
function seeded(): () => number {
  let state = 0x2f6e2b1
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648
    return state / 2147483648
  }
}

/** One post on somebody's feed. */
function post(date: number, time: 0 | 1): SocialPost {
  return { id: `p${date}:${time}`, text: 'hi', date, time, likes: 3 }
}

describe('the ending posts are asked for once', () => {
  it('stamps every post in the week after the ceremony', () => {
    const rand = seeded()
    for (let i = 0; i < 200; i++) {
      const stamp = rollEndingPostStamp(rand)
      expect(stamp.date).toBeGreaterThan(GRADUATION_DATE)
      expect(stamp.date).toBeLessThanOrEqual(GRADUATION_DATE + ENDING_POST_DAYS)
      expect([0, 1]).toContain(stamp.time)
    }
  })

  it('reads a post past graduation as the whole answer to whether they have been filed', () => {
    // A semester's worth of feed, the winter break's negative dates included.
    const chars = ['a', 'b']
    const played = {
      a: charInfo({ feed: [post(-4, 1), post(12, 0)] }),
      b: charInfo({ feed: [post(GRADUATION_DATE, 0)] })
    }
    expect(endingPostsDelivered(chars, played)).toBe(false)

    const stamp = rollEndingPostStamp(seeded())
    const filed = {
      ...played,
      b: charInfo({ feed: [...(played.b.feed ?? []), post(stamp.date, stamp.time)] })
    }
    expect(endingPostsDelivered(chars, filed)).toBe(true)
  })
})
