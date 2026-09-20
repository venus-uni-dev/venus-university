import { describe, expect, it } from 'vitest'
import {
  likedPostBonus,
  LIKED_POST_WINDOW,
  LIKED_POST_WINDOW_ONLINE,
  requestAcceptChance
} from '../src/shared/feed'
import { TIER_THRESHOLDS } from '../src/shared/playerStats'
import {
  FEED_MIN_UPDATES,
  MAX_SUGGESTIONS,
  pickFeedFill,
  pickSlotPosters,
  pickSuggestions,
  pickTeaser
} from '../src/renderer/stores/feedRolls'
import { updatesFeed } from '../src/renderer/stores/feedView'
import { GRADUATION_DATE } from '../src/renderer/prompts/occasions'
import { emptyFlags } from '../src/shared/relationship'
import type { CharInfo, SocialPost } from '../src/shared/types'
import { character, charactersById, charInfo } from './fixtures'

/**
 * The feed's arithmetic: the accept chance whose endpoints decide whether
 * a request can ever land, the like bonus affection is read from, and the
 * poster roll — each written into a save with nothing on screen to say it drifted.
 */

function post(over: Partial<SocialPost> = {}): SocialPost {
  return { id: 'p1', text: 'hi', date: 5, time: 0, likes: 0, ...over }
}

/** Somebody who lives on the app, and somebody who does not. */
const online = character({ traits: ['Terminally Online'] })
const offline = character({ traits: [] })

describe('requestAcceptChance', () => {
  it('never accepts at no Heart at all', () => {
    expect(requestAcceptChance(0)).toBe(0)
  })

  it('tops out at Godly and does not climb past it', () => {
    const godly = TIER_THRESHOLDS[TIER_THRESHOLDS.length - 1]
    expect(requestAcceptChance(godly)).toBeCloseTo(0.8)
    // Stats keep accumulating past the last threshold; the odds must not.
    expect(requestAcceptChance(godly * 4)).toBeCloseTo(0.8)
  })

  it('doubles for somebody who adds anyone who asks', () => {
    const godly = TIER_THRESHOLDS[TIER_THRESHOLDS.length - 1]
    expect(requestAcceptChance(godly / 2, online)).toBeCloseTo(0.8)
    expect(requestAcceptChance(godly / 2, offline)).toBeCloseTo(0.4)
  })

  it('is still a probability at the top of the range', () => {
    const godly = TIER_THRESHOLDS[TIER_THRESHOLDS.length - 1]
    // 0.8 doubled is 1.6, which would accept more often than always.
    expect(requestAcceptChance(godly, online)).toBe(1)
  })
})

// What his likes are worth. The bound is the whole point — a like that paid
// without one would be a like the player farms.
describe('likedPostBonus', () => {
  /** `liked` reading true on every post but the ones named, oldest first, each liked the day it went up. */
  const feedOf = (...liked: boolean[]): SocialPost[] =>
    liked.map((flag, i) => post(flag ? { id: `p${i}`, liked: true, likedOn: 5 } : { id: `p${i}` }))

  // The feed is oldest-first, so a fourth post pushes the first out of a
  // three-deep window: the bonus decays as she keeps posting, which is what
  // stops it accumulating without bound.
  it('drops a like the newer posts have pushed out of the window', () => {
    expect(likedPostBonus(feedOf(true, false, false, false), LIKED_POST_WINDOW)).toBe(0)
  })

  it('never pays more than the window is deep', () => {
    const everything = feedOf(true, true, true, true, true, true)
    expect(likedPostBonus(everything, LIKED_POST_WINDOW)).toBe(LIKED_POST_WINDOW)
    expect(likedPostBonus(everything, LIKED_POST_WINDOW_ONLINE)).toBe(LIKED_POST_WINDOW_ONLINE)
  })

  // The freshness half of the rule: a like pays only when it came within a
  // day of the post, which is what closes the backlog on a contact's feed tab.
  it('pays a like made the day of the post, and the whole day after', () => {
    expect(likedPostBonus([post({ liked: true, likedOn: 5 })], LIKED_POST_WINDOW)).toBe(1)
    expect(likedPostBonus([post({ liked: true, likedOn: 6 })], LIKED_POST_WINDOW)).toBe(1)
  })

  it('pays nothing for a like two days late, however deep the window', () => {
    const stale = [post({ liked: true, likedOn: 7 })]
    expect(likedPostBonus(stale, LIKED_POST_WINDOW)).toBe(0)
    expect(likedPostBonus(stale, LIKED_POST_WINDOW_ONLINE)).toBe(0)
  })
})

describe('pickSlotPosters', () => {
  it('takes the girl who lives on the app at a roll her neighbor sits out', () => {
    // 0.15 is over the flat chance and under the doubled one, so this roll
    // separates the two and nothing else about them does.
    const roster = { a: offline, b: online }
    expect(pickSlotPosters(['a', 'b'], roster, () => 0.15)).toEqual(['b'])
  })
})

describe('pickTeaser', () => {
  // Without the empty guard the draw is `undefined`, and the slot's
  // `feedExtras` is written with no `teaser` key at all.
  it('draws nobody when no stranger posted this slot', () => {
    expect(pickTeaser([], () => 0)).toBeNull()
  })
})

// What the tab is padded out with when there is too little on it to read. The rule the
// save has to keep is the one nothing on screen would say had drifted: one post per girl,
// and never a girl the feed is already showing.
describe('pickFeedFill', () => {
  /** One candidate post: by whom, and when she made it. */
  const made = (charId: string, id: string, date: number, time: 0 | 1 = 0) => ({
    charId,
    post: post({ id, date, time })
  })

  it('fills nothing into a feed that already reads', () => {
    const fill = pickFeedFill(
      {
        showing: FEED_MIN_UPDATES,
        showingCharIds: [],
        candidates: [made('a', 'a1', 5)],
        date: 5
      },
      () => 0
    )
    expect(fill).toEqual([])
  })

  it("takes today's newest from everybody who posted today, and nobody twice", () => {
    const fill = pickFeedFill(
      {
        showing: 2,
        showingCharIds: ['e'],
        candidates: [
          made('a', 'a1', 5, 0),
          made('a', 'a2', 5, 1),
          made('a', 'a0', 1),
          made('b', 'b1', 5),
          made('c', 'c1', 5, 1),
          made('d', 'd0', 2),
          made('e', 'e1', 5)
        ],
        date: 5
      },
      () => 0
    )
    // 'd' has nothing from today and the row is full without her; 'e' is on the feed already.
    expect(fill).toEqual([
      { charId: 'a', postId: 'a2' },
      { charId: 'b', postId: 'b1' },
      { charId: 'c', postId: 'c1' }
    ])
  })

  it('fills the rest out of older posts, one girl apiece', () => {
    const fill = pickFeedFill(
      {
        showing: 1,
        showingCharIds: ['x'],
        candidates: [
          made('a', 'a0', 1),
          made('a', 'a1', 2),
          made('b', 'b0', 1),
          made('c', 'c0', 1),
          made('d', 'd0', 1),
          made('e', 'e0', 1),
          made('x', 'x0', 1)
        ],
        date: 5
      },
      () => 0
    )
    const authors = fill.map((entry) => entry.charId)
    expect(fill).toHaveLength(FEED_MIN_UPDATES - 1)
    expect(new Set(authors).size).toBe(authors.length)
    expect(authors).not.toContain('x')
  })
})

// What the Friends tab writes into the save every boundary. The tiers are the whole
// rule: a girl he has met outranks one he only has a request out to, and the friends
// of his contacts are there to fill a row he could not otherwise fill.
describe('pickSuggestions', () => {
  /** Met, friends of a contact, requested — the three tiers in their order. */
  const met = ['a', 'b', 'c', 'd']
  const mutual = ['e', 'f']
  const requested = ['g']

  it('leaves a later tier out entirely while an earlier one fills the row', () => {
    const offered = pickSuggestions([met, mutual, requested], () => 0)
    expect(offered).toHaveLength(MAX_SUGGESTIONS)
    expect(offered.every((charId) => met.includes(charId))).toBe(true)
  })

  it('fills the rest from the friends of a contact before anyone already asked', () => {
    expect(pickSuggestions([['a'], mutual, requested], () => 0)).toEqual(['a', 'f', 'e'])
  })

  it('offers somebody in two tiers once, at the higher one', () => {
    // 'a' vouched for by a contact as well; a repeat would show her card twice.
    expect(pickSuggestions([['a'], ['a'], requested], () => 0)).toEqual(['a', 'g'])
  })
})

/**
 * The one list the Updates tab draws: the cap that keeps a full roster from burying what the
 * day actually said, and a slot that must deal the same rows into the same places every time
 * it reopens.
 */
describe('updatesFeed', () => {
  const TODAY = 5
  const NOW = 1 as const

  /** Somebody whose feed the tab reads outright: he has her number and he can name her. */
  const reader = (feed: SocialPost[]): CharInfo =>
    charInfo({ nameKnown: true, flags: { ...emptyFlags(), gaveContactInfo: true }, feed })

  const ann = character({ charId: 'a', firstName: 'Ann' })
  const bea = character({ charId: 'b', firstName: 'Bea' })
  const cass = character({ charId: 's', firstName: 'Cass' })

  /** Five girls the slot has somewhere to put, none of them posting about it herself. */
  const candidates = ['c1', 'c2', 'c3', 'c4', 'c5'].map((charId) => ({
    charId,
    name: charId,
    label: 'The Quad'
  }))

  /**
   * A slot with three posts on it — one from this morning, one from now, one by a stranger the
   * teaser surfaced — the day two of them became friends, a post the epilogue filed above all
   * of it, and the day's own student.
   */
  const feed = (over: Partial<Parameters<typeof updatesFeed>[0]> = {}) =>
    updatesFeed({
      chars: ['a', 'b', 's'],
      characters: charactersById(ann, bea, cass),
      charInfo: {
        a: reader([
          post({ id: 'a0', date: TODAY, time: 0 }),
          post({ id: 'ep', date: GRADUATION_DATE + 1, time: 0 })
        ]),
        b: reader([post({ id: 'b1', date: TODAY, time: NOW })]),
        s: charInfo({ nameKnown: true, feed: [post({ id: 's1', date: TODAY, time: NOW })] })
      },
      npcFriendships: [{ a: 'a', b: 'b', date: TODAY, time: NOW }],
      feedExtras: {
        date: TODAY,
        time: NOW,
        teaser: { charId: 's', postId: 's1' },
        randomPost: { handle: '@campusowl', emoji: '🦉', text: 'anyway', likes: 3 }
      },
      checkIns: candidates,
      date: TODAY,
      time: NOW,
      ...over
    })

  it("weaves one more check-in than the day's posts into the slot's own rows", () => {
    const entries = feed()
    // Three posts today, so four of the five girls check in; the friendship row and the
    // day's student are not posts and buy nobody a place.
    expect(entries.filter((entry) => entry.kind === 'checkIn')).toHaveLength(4)

    // The epilogue's post is dated past graduation and sorts above everything, so the slot's
    // run starts under it and ends where this morning's post begins.
    const ends = entries.findIndex((entry) => entry.kind === 'post' && entry.post.id === 'a0')
    entries.forEach((entry, at) => {
      if (entry.kind !== 'checkIn' && entry.kind !== 'random') return
      expect(at).toBeGreaterThan(0)
      expect(at).toBeLessThan(ends)
    })
    expect(entries[ends - 1].kind).toBe('random')
  })

  it('draws the same girls into the same places on a second read of the same slot', () => {
    const placed = (entries: ReturnType<typeof feed>): string[] =>
      entries.flatMap((entry, at) => (entry.kind === 'checkIn' ? [`${at}:${entry.charId}`] : []))
    expect(placed(feed())).toEqual(placed(feed()))
  })

  it('still deals one check-in into a day nobody posted on', () => {
    const entries = feed({
      charInfo: { a: reader([post({ id: 'a0', date: 2, time: 0 })]), b: reader([]) },
      npcFriendships: [],
      feedExtras: null,
      checkIns: candidates.slice(0, 3)
    })
    expect(entries.filter((entry) => entry.kind === 'checkIn')).toHaveLength(1)
  })
})
