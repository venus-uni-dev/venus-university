import { describe, expect, it } from 'vitest'
import {
  affectionFor,
  affectionOf,
  ALL_ROMANCE,
  applyEvent,
  attractionInPlay,
  npcAttractionOf,
  attractionOf,
  breakPenaltyAt,
  crushChance,
  crushHintUpdate,
  DEFAULT_ROMANCE,
  dispositionOf,
  emptyFlags,
  foldRelationshipEvents,
  initialFlags,
  isNegative,
  isPositive,
  isRomanceable,
  memoriesFor,
  memoryStatusLine,
  mergedMemories,
  meetsCrushStandards,
  milestoneEmotionOf,
  milestoneMarkOf,
  milestoneSoured,
  milestoneStatusLines,
  observedUpperHalves,
  readerStandingOf,
  refreshedFlags,
  rollsCrush,
  romanceOf,
  romanceScenesAfter,
  withBreakPenaltiesStepped,
  withMemoryReplaced,
  withRomanceScenes
} from '@shared/relationship'
import { pointsForTier, type PlayerStats } from '@shared/playerStats'
import type { CharInfo, CharMemory, CrushHint, MemoryType, SocialPost } from '@shared/types'
import { character, charInfo } from './fixtures'

/**
 * Affection, disposition tiers and flag transitions: a wrong tier boundary or a dropped flag
 * writes a character into the save who behaves subtly wrong for the rest of the playthrough,
 * and nothing throws.
 */

function mem(date: number, type: MemoryType, desc = 'x'): CharMemory {
  return { date, type, desc }
}

describe('affectionOf', () => {
  it('applies the recency weights at their exact boundaries', () => {
    const today = 100
    // liked = 1 point; weight is 4 through day 7, 2 through day 30, 1 after.
    expect(affectionOf([mem(today - 7, 'liked')], today)).toBe(4)
    expect(affectionOf([mem(today - 8, 'liked')], today)).toBe(2)
    expect(affectionOf([mem(today - 30, 'liked')], today)).toBe(2)
    expect(affectionOf([mem(today - 31, 'liked')], today)).toBe(1)
  })

  it('scores each memory type at its own polarity and magnitude', () => {
    const today = 0
    expect(affectionOf([mem(0, 'loved')], today)).toBe(8)
    expect(affectionOf([mem(0, 'liked')], today)).toBe(4)
    expect(affectionOf([mem(0, 'disliked')], today)).toBe(-4)
    expect(affectionOf([mem(0, 'hated')], today)).toBe(-8)
  })

  it('skips a memory whose type is not in the vocabulary rather than scoring NaN', () => {
    const junk = { date: 0, type: 'bewildered', desc: 'x' } as unknown as CharMemory
    expect(affectionOf([junk, mem(0, 'liked')], 0)).toBe(4)
  })

  it('clamps a future-dated memory to the strongest weight instead of going negative', () => {
    // today - date < 0 would fall through every threshold; Math.max(0, …) pins it.
    expect(affectionOf([mem(50, 'liked')], 10)).toBe(4)
  })
})

/**
 * The whole affection read: memories plus what his likes on her recent posts are worth. A bonus
 * that lands here rather than in `affectionOf` is invisible to the NPC↔NPC bonding read, which
 * sums raw memory lists directly.
 */
describe('affectionFor', () => {
  type Info = Pick<CharInfo, 'memories' | 'textMemory' | 'feed'>

  const posts = (...liked: boolean[]): SocialPost[] =>
    liked.map((flag, i) => ({
      id: `p${i}`,
      text: 'hi',
      date: 0,
      time: 0,
      likes: 0,
      ...(flag ? { liked: true, likedOn: 0 } : {})
    }))

  const infoWith = (feed: SocialPost[], memories: CharMemory[] = []): Info => ({ memories, feed })

  const online = character({ traits: ['Terminally Online'] })

  it('adds a point for each like among her last three posts', () => {
    expect(affectionFor(infoWith(posts(true, true, true)), 0, undefined)).toBe(3)
  })

  it('stops counting a like the newer posts have pushed past three', () => {
    // The oldest of four is outside the window, so his like on it is spent.
    expect(affectionFor(infoWith(posts(true, false, false, false)), 0, undefined)).toBe(0)
  })

  it('reads five deep for somebody who lives on the app', () => {
    const feed = posts(true, true, false, false, false)
    expect(affectionFor(infoWith(feed), 0, undefined)).toBe(0)
    expect(affectionFor(infoWith(feed), 0, online)).toBe(2)
  })

  // The tiers are calibrated against the slot budget, so the one thing a
  // bounded bonus must still be able to do is carry a girl already sitting on
  // the edge of a band over it. Old memories, so each is worth its weight of 1.
  it('can tip a girl sitting exactly on the friendly floor across it', () => {
    const today = 100
    const onTheFloor = Array.from({ length: 15 }, () => mem(0, 'liked'))
    expect(affectionOf(onTheFloor, today)).toBe(15)
    // The floors are exclusive, so 15 is not yet friendly and 16 is.
    expect(dispositionOf(affectionOf(onTheFloor, today))).toBe('neutral')
    const info = infoWith(posts(true), onTheFloor)
    expect(dispositionOf(affectionFor(info, today, undefined))).toBe('friendly')
  })

  it('ignores stored memories older than the newest 20', () => {
    const older = Array.from({ length: 10 }, (_, i) => mem(i, 'hated'))
    const recent = Array.from({ length: 20 }, (_, i) => mem(10 + i, 'liked'))
    const withOlder = infoWith([], [...older, ...recent])
    const onlyRecent = infoWith([], recent)
    expect(affectionFor(withOlder, 100, undefined)).toBe(affectionFor(onlyRecent, 100, undefined))
  })
})

describe('dispositionOf', () => {
  it('treats every floor as exclusive — the tier boundary is strictly above it', () => {
    expect(dispositionOf(50)).toBe('trusted')
    expect(dispositionOf(51)).toBe('devoted')
    expect(dispositionOf(30)).toBe('friendly')
    expect(dispositionOf(31)).toBe('trusted')
    expect(dispositionOf(15)).toBe('neutral')
    expect(dispositionOf(16)).toBe('friendly')
    expect(dispositionOf(-15)).toBe('annoyed')
    expect(dispositionOf(-14)).toBe('neutral')
    expect(dispositionOf(-30)).toBe('hostile')
    expect(dispositionOf(-29)).toBe('annoyed')
  })
})

describe('isPositive / isNegative', () => {
  it('are deliberately asymmetric at ±15', () => {
    // 15 is neutral (not positive); -15 is already annoyed (negative).
    expect(isPositive(15)).toBe(false)
    expect(isPositive(16)).toBe(true)
    expect(isNegative(-15)).toBe(true)
    expect(isNegative(-14)).toBe(false)
  })
})

describe('applyEvent', () => {
  it('never mutates the flags it was handed', () => {
    const before = emptyFlags()
    applyEvent(before, 'sex')
    expect(before).toEqual(emptyFlags())
  })

  it('implies the kiss and the arrangement when they are not together', () => {
    const next = applyEvent(emptyFlags(), 'sex')
    expect(next.hadSex).toBe(true)
    expect(next.hasKissed).toBe(true)
    expect(next.benefits).toBe(true)
  })

  it('does not set benefits for a couple', () => {
    const next = applyEvent({ ...emptyFlags(), isLover: true }, 'sex')
    expect(next.benefits).toBe(false)
  })

  it('voids every lesser arrangement when they get together, in either order', () => {
    // The ledger applies a scene's events in the order it reported them,
    // so `sex` then `became_lovers` must not leave `benefits` set behind.
    const sexFirst = applyEvent(applyEvent(emptyFlags(), 'sex'), 'became_lovers')
    expect(sexFirst.isLover).toBe(true)
    expect(sexFirst.benefits).toBe(false)
    expect(sexFirst.hadSex).toBe(true)

    const loversFirst = applyEvent(applyEvent(emptyFlags(), 'became_lovers'), 'sex')
    expect(loversFirst.isLover).toBe(true)
    expect(loversFirst.benefits).toBe(false)
  })

  it('clears the crush and both friendzones when they get together', () => {
    const before = {
      ...emptyFlags(),
      hasCrush: true,
      friendZoned: true,
      friendZonedBy: true
    }
    const next = applyEvent(before, 'became_lovers')
    expect(next).toMatchObject({
      isLover: true,
      hasCrush: false,
      friendZoned: false,
      friendZonedBy: false,
      benefits: false
    })
  })

  it('counts break-ups cumulatively and ends the relationship', () => {
    let flags = applyEvent({ ...emptyFlags(), isLover: true }, 'broke_up')
    expect(flags.isLover).toBe(false)
    expect(flags.brokenUp).toBe(1)
    flags = applyEvent(applyEvent(flags, 'became_lovers'), 'broke_up')
    expect(flags.brokenUp).toBe(2)
  })

  it('ends the relationship from either side of a friendzone', () => {
    const byReader = applyEvent({ ...emptyFlags(), isLover: true }, 'friendzoned_by_reader')
    expect(byReader).toMatchObject({ friendZoned: true, isLover: false })
    const byHer = applyEvent({ ...emptyFlags(), isLover: true }, 'friendzoned_reader')
    expect(byHer).toMatchObject({ friendZonedBy: true, isLover: false })
  })

  // It clears rather than sets, and the contact info she gave
  // him is deliberately not handed back with it.
  it('clears a block and leaves the contact info she already gave', () => {
    const blocked = { ...emptyFlags(), gaveContactInfo: true, blocked: true }
    expect(applyEvent(blocked, 'unblocked')).toEqual({
      ...emptyFlags(),
      gaveContactInfo: true,
      blocked: false
    })
  })

  // Her stance on the other girls, not an arrangement with her, so the event
  // that voids every lesser one leaves it standing — the cast-block line is written
  // for a lover too.
  it('leaves the sharing agreement standing when they get together', () => {
    const shared = applyEvent(emptyFlags(), 'agreed_to_harem')
    expect(applyEvent(shared, 'became_lovers').harem).toBe(true)
  })
})

describe('milestoneSoured', () => {
  it('is false for a set that only ever escalated', () => {
    const after = applyEvent(applyEvent(emptyFlags(), 'kissed'), 'became_lovers')
    expect(milestoneSoured(emptyFlags(), after)).toBe(false)
  })

  it('is true for either friendzoning and for a breakup', () => {
    expect(milestoneSoured(emptyFlags(), applyEvent(emptyFlags(), 'friendzoned_reader'))).toBe(true)
    expect(
      milestoneSoured(emptyFlags(), applyEvent(emptyFlags(), 'friendzoned_by_reader'))
    ).toBe(true)
    const together = { ...emptyFlags(), isLover: true }
    expect(milestoneSoured(together, applyEvent(together, 'broke_up'))).toBe(true)
  })

  // Broken wins: a scene that reached a first time and then ended it is not a good evening.
  it('is true when a loss rides along with something the scene also reached', () => {
    const before = emptyFlags()
    const after = applyEvent(applyEvent(before, 'sex'), 'broke_up')
    expect(after.hadSex).toBe(true)
    expect(milestoneSoured(before, after)).toBe(true)
  })

  // A standing loss is not this scene's: the diff is what is announced, not the flag.
  it('is false when the breakup was already on the record', () => {
    const before = applyEvent({ ...emptyFlags(), isLover: true }, 'broke_up')
    expect(milestoneSoured(before, applyEvent(before, 'kissed'))).toBe(false)
  })
})

/**
 * What the milestone screen reads off the same flag diff as the sentences: the phrase each
 * line is marked on, and the face she is drawn with. A mark whose offsets drift paints the wrong
 * words and says nothing about it.
 */
describe('the milestone screen', () => {
  it('marks every sentence it writes, and only the losses in loss', () => {
    const before = { ...emptyFlags(), isLover: true, blocked: true }
    const after = {
      ...before,
      gaveContactInfo: true,
      hasKissed: true,
      hadSex: true,
      harem: true,
      friendZoned: true,
      friendZonedBy: true,
      brokenUp: before.brokenUp + 1,
      blocked: false
    }
    // `isLover` is false either side of a set that also broke up, so the lovers line
    // is written from a before that never got there.
    const lines = milestoneStatusLines('Sarah', { ...before, isLover: false }, after, 'female')
    expect(lines).toHaveLength(9)

    const losses: string[] = []
    for (const line of lines) {
      const mark = milestoneMarkOf(line)
      expect(mark, line).not.toBeNull()
      if (!mark) continue
      expect(line.slice(mark.start, mark.end).length).toBeGreaterThan(0)
      expect(line).toContain(line.slice(mark.start, mark.end))
      if (mark.tone === 'loss') losses.push(line)
    }
    expect(losses).toEqual([
      'You friendzoned Sarah.',
      'Sarah friendzoned you.',
      'You and Sarah broke up.'
    ])
  })

  it('draws her by the worst of it, then the biggest of it', () => {
    const together = { ...emptyFlags(), isLover: true }
    const dumped = applyEvent(applyEvent(together, 'sex'), 'broke_up')
    expect(milestoneEmotionOf(together, dumped)).toBe('sad')

    expect(milestoneEmotionOf(emptyFlags(), applyEvent(emptyFlags(), 'sex'))).toBe('aroused')
    expect(milestoneEmotionOf(emptyFlags(), applyEvent(emptyFlags(), 'kissed'))).toBe('happy')
    expect(milestoneEmotionOf(emptyFlags(), applyEvent(emptyFlags(), 'gave_contact_info'))).toBe(
      'neutral'
    )
  })
})

/**
 * The verb she remembers him by, and the run the status box paints it as. The offsets are
 * silent when wrong — a mark on the wrong characters still draws.
 */
describe('memoryStatusLine', () => {
  const cases: [MemoryType, 'gain' | 'loss'][] = [
    ['loved', 'gain'],
    ['liked', 'gain'],
    ['disliked', 'loss'],
    ['hated', 'loss']
  ]

  it.each(cases)('paints %s in the colour of which way it went', (type, tone) => {
    const line = memoryStatusLine(
      'Sarah',
      { type, desc: 'the reader walked her home' },
      'Seth',
      'female',
      'he'
    )

    expect(line.text).toBe(`Sarah ${type} that Seth walked her home.`)
    const marks = line.status?.marks ?? []
    expect(marks).toHaveLength(1)
    expect(line.text.slice(marks[0].start, marks[0].end)).toBe(type)
    expect(marks[0].tone).toBe(tone)
  })

  it('marks the verb of a memory that punctuates itself', () => {
    const line = memoryStatusLine(
      'Mina',
      { type: 'hated', desc: 'the reader ignored her all night!' },
      'Seth',
      'female',
      'he'
    )

    expect(line.text).toBe('Mina hated that Seth ignored her all night!')
    const mark = (line.status?.marks ?? [])[0]
    expect(line.text.slice(mark.start, mark.end)).toBe('hated')
  })

  it('shows an older save’s second-person memory with the reader’s name, the verb agreeing', () => {
    const line = memoryStatusLine(
      'Sarah',
      { type: 'liked', desc: 'you were nice to her' },
      'Seth',
      'female',
      'he'
    )

    expect(line.text).toBe('Sarah liked that Seth was nice to her.')
    const mark = (line.status?.marks ?? [])[0]
    expect(line.text.slice(mark.start, mark.end)).toBe('liked')
  })
})

describe('mergedMemories', () => {
  it('never mutates the array it was handed', () => {
    const memories = [mem(1, 'liked')]
    mergedMemories(memories, mem(2, 'hated'))
    expect(memories).toHaveLength(1)
  })

  // The whole reason it is merged rather than kept apart: a texting memory
  // moves affection exactly as much as the scene memory beside it does.
  it('is scored by affectionOf like any other memory', () => {
    expect(affectionOf(mergedMemories([], mem(0, 'loved')), 0)).toBe(8)
  })

  it('scores a jealousy memory like any other', () => {
    expect(affectionOf(mergedMemories([], undefined, [mem(0, 'hated')]), 0)).toBe(-8)
  })
})

describe('memoriesFor', () => {
  it('picks up every list kept beside the memories', () => {
    const merged = memoriesFor({
      memories: [mem(1, 'liked', 'scene')],
      textMemory: mem(2, 'liked', 'text'),
      jealousyMemories: [mem(3, 'disliked', 'heard')],
      giftMemories: [mem(4, 'loved', 'gift')]
    })
    expect(merged.map((m) => m.desc)).toEqual(['scene', 'text', 'heard', 'gift'])
  })
})

/**
 * The player's edit of one memory: a copy left behind in any of the four lists, or a
 * same-worded memory from another day caught with it, is scored and prompted from then on.
 */
describe('withMemoryReplaced', () => {
  const match = mem(3, 'liked', 'the reader was late')
  const other = mem(5, 'liked', 'the reader was late')
  const holders = () => ({
    memories: [mem(1, 'loved', 'first'), match, other],
    textMemory: match,
    jealousyMemories: [match],
    giftMemories: [other, match]
  })

  it('rewrites every copy in all four lists and leaves the same words on another day alone', () => {
    const next = mem(3, 'disliked', 'the reader was very late')
    const info = holders()
    expect(withMemoryReplaced(info, match, next)).toEqual({
      memories: [mem(1, 'loved', 'first'), next, other],
      textMemory: next,
      jealousyMemories: [next],
      giftMemories: [other, next]
    })
  })

  it('drops every copy for null and takes the texting memory off her', () => {
    const forgotten = withMemoryReplaced(holders(), match, null)
    expect(forgotten).toEqual({
      memories: [mem(1, 'loved', 'first'), other],
      jealousyMemories: [],
      giftMemories: [other]
    })
    expect(forgotten && 'textMemory' in forgotten).toBe(false)
  })

  it('keeps an untouched list as it was', () => {
    const info = { memories: [match], giftMemories: [other] }
    expect(withMemoryReplaced(info, match, null)?.giftMemories).toBe(info.giftMemories)
  })

  it('answers null for a memory she does not hold and for an edit that changes nothing', () => {
    expect(withMemoryReplaced({ memories: [other] }, match, null)).toBeNull()
    expect(withMemoryReplaced(holders(), match, { ...match })).toBeNull()
  })

  it('never mutates what it was handed', () => {
    const info = holders()
    const before = structuredClone(info)
    withMemoryReplaced(info, match, mem(3, 'hated', 'gone'))
    withMemoryReplaced(info, match, null)
    expect(info).toEqual(before)
  })
})

/** The one reading of who the reader is with and was with, for the READER block's lines. */
describe('readerStandingOf', () => {
  it('dates every relationship, names who he left for whom, and leaves the nameless out', () => {
    const standing = readerStandingOf(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
      {
        a: charInfo({ flags: { ...emptyFlags(), isLover: true }, datingSince: 8 }),
        b: charInfo({ flags: { ...emptyFlags(), isLover: true, harem: true }, datingSince: 3 }),
        // Dating with no date at all: a save written before the date was kept.
        c: charInfo({ flags: { ...emptyFlags(), isLover: true } }),
        d: charInfo({ flags: { ...emptyFlags(), brokenUp: 1 }, datingSince: 1, brokeUpOn: 8, leftFor: 'a' }),
        e: charInfo({ flags: { ...emptyFlags(), brokenUp: 1 }, brokeUpOn: 5 }),
        // Back together, so she is a lover rather than an ex however it ended before.
        f: charInfo({ flags: { ...emptyFlags(), brokenUp: 2, isLover: true }, datingSince: 9 }),
        g: charInfo({ flags: { ...emptyFlags(), brokenUp: 1 }, brokeUpOn: 6, leftFor: 'a' })
      },
      { a: 'Zoe', b: 'Mina', c: 'Ana', d: 'Risa', e: 'Eve', f: 'Tess' }
    )

    expect(standing).toEqual({
      lovers: [
        { name: 'Mina', since: 3, harem: true, leftFor: [] },
        { name: 'Zoe', since: 8, harem: false, leftFor: ['Risa'] },
        { name: 'Tess', since: 9, harem: false, leftFor: [] },
        { name: 'Ana', harem: false, leftFor: [] }
      ],
      exes: [
        { name: 'Eve', to: 5 },
        { name: 'Risa', from: 1, to: 8 }
      ]
    })
  })
})

describe('refreshedFlags', () => {
  it('returns the very same object when nothing changed', () => {
    // gameStore.refreshDerivedFlags skips on `flags === existing.flags`; losing
    // identity here rewrites charInfo on every scene start for no reason.
    const before = emptyFlags()
    expect(refreshedFlags(before, 0)).toBe(before)
  })

  it('holds a crush above 0 and clears it below', () => {
    const crushing = { ...emptyFlags(), hasCrush: true }
    expect(refreshedFlags(crushing, 0)).toBe(crushing) // holds — no change, same object
    expect(refreshedFlags(crushing, 30).hasCrush).toBe(true)
    expect(refreshedFlags(crushing, -1).hasCrush).toBe(false)
  })

  it('never invents a crush, however high the score', () => {
    // A crush is rolled at the ending now; this pass only ever takes
    // one away. Asserted as an absence so the old threshold cannot come back.
    expect(refreshedFlags(emptyFlags(), 1000).hasCrush).toBe(false)
    expect(refreshedFlags(emptyFlags(), 31).hasCrush).toBe(false)
  })

  it('keeps benefits until she is hostile', () => {
    const withBenefits = { ...emptyFlags(), benefits: true }
    expect(refreshedFlags(withBenefits, -30).benefits).toBe(false)
    expect(refreshedFlags(withBenefits, -29).benefits).toBe(true)
  })

  it('does not invent benefits she never had', () => {
    expect(refreshedFlags(emptyFlags(), 100).benefits).toBe(false)
  })

  it('reveals her traits at friendly and her backstory at trusted', () => {
    expect(refreshedFlags(emptyFlags(), 16).knowsTraits).toBe(true)
    expect(refreshedFlags(emptyFlags(), 15).knowsTraits).toBe(false)
    expect(refreshedFlags(emptyFlags(), 31).knowsBackstory).toBe(true)
    expect(refreshedFlags(emptyFlags(), 30).knowsBackstory).toBe(false)
    // Friendly is short of the backstory's floor — the two reveals are separate.
    expect(refreshedFlags(emptyFlags(), 16).knowsBackstory).toBe(false)
  })

  it('never takes a reveal back once it has been shown', () => {
    // The whole point of persisting them: what he learned about her he keeps,
    // however far the relationship falls afterwards.
    const known = { ...emptyFlags(), knowsTraits: true, knowsBackstory: true, knowsLoveLife: true }
    const after = refreshedFlags(known, -100)
    expect(after.knowsTraits).toBe(true)
    expect(after.knowsBackstory).toBe(true)
    expect(after.knowsLoveLife).toBe(true)
    expect(after).toBe(known) // nothing moved, so no rewrite
  })

  it('reveals her love life to a lover whatever the score says', () => {
    const lover = { ...emptyFlags(), isLover: true }
    expect(refreshedFlags(lover, -100).knowsLoveLife).toBe(true)
    expect(refreshedFlags(emptyFlags(), 100).knowsLoveLife).toBe(false)
  })
})

describe('the new-romance scene count', () => {
  // Stepped at every boundary and projected by the ending: a wrong step tells RITA a crush is
  // fresh, or long settled, on every prompt for the rest of the playthrough.
  const crush = { ...emptyFlags(), hasCrush: true }
  const lover = { ...emptyFlags(), isLover: true }

  it('starts what the boundary began at 0, the scene that began it not counting', () => {
    expect(romanceScenesAfter(emptyFlags(), charInfo({ flags: crush }), true)).toBe(0)
    expect(romanceScenesAfter(emptyFlags(), charInfo({ flags: lover }), true)).toBe(0)
    // A crush turned lovers in one scene is a new relationship, whatever the crush had counted.
    expect(romanceScenesAfter(crush, charInfo({ flags: lover, romanceScenes: 1 }), true)).toBe(0)
  })

  it('counts only scenes she was cast in, and drops the count once it settles', () => {
    expect(romanceScenesAfter(crush, charInfo({ flags: crush, romanceScenes: 0 }), false)).toBe(0)
    expect(romanceScenesAfter(crush, charInfo({ flags: crush, romanceScenes: 0 }), true)).toBe(1)
    expect(
      romanceScenesAfter(crush, charInfo({ flags: crush, romanceScenes: 1 }), true)
    ).toBeUndefined()
    expect(
      romanceScenesAfter(lover, charInfo({ flags: lover, romanceScenes: 0 }), true)
    ).toBeUndefined()
  })

  it('keeps an absent count absent, a save from before it reading as settled', () => {
    expect(romanceScenesAfter(crush, charInfo({ flags: crush }), true)).toBeUndefined()
    expect(romanceScenesAfter(lover, charInfo({ flags: lover }), true)).toBeUndefined()
  })

  it('drops the count once she holds neither', () => {
    const brokeUp = charInfo({ flags: { ...emptyFlags(), brokenUp: 1 }, romanceScenes: 0 })
    expect(romanceScenesAfter(lover, brokeUp, true)).toBeUndefined()
    // A crush cleared at scene start as she went negative.
    expect(romanceScenesAfter(emptyFlags(), charInfo({ romanceScenes: 1 }), false)).toBeUndefined()
  })

  it('rewrites only the entries that moved, and deletes a settled count', () => {
    const before = {
      a: charInfo({ flags: crush, romanceScenes: 0 }),
      b: charInfo({ flags: emptyFlags() })
    }
    expect(withRomanceScenes(before, before, [])).toBe(before)

    // b became lovers across this boundary; a sat it out.
    const after = { ...before, b: charInfo({ flags: lover }) }
    const stepped = withRomanceScenes(before, after, ['b'])
    expect(stepped.a).toBe(after.a)
    expect(stepped.b.romanceScenes).toBe(0)

    // a's second scene and b's first settle them both; the key goes, never left as undefined.
    const once = withRomanceScenes(stepped, stepped, ['a'])
    const settled = withRomanceScenes(once, once, ['a', 'b'])
    expect('romanceScenes' in settled.a).toBe(false)
    expect('romanceScenes' in settled.b).toBe(false)
  })
})

describe('observedUpperHalves', () => {
  // Read off her affection at every boundary: a half wrongly marked tells RITA she is growing
  // closer while she is cooling, or never lets the rising line show.
  it('begins the half she is in, every half below it counting as passed', () => {
    const halves = observedUpperHalves(undefined, 25)
    expect(halves).toEqual({ neutral: 'again', friendly: 'first' })
    expect(observedUpperHalves(halves, 28)).toBe(halves)
  })

  it('turns a half again once she drops back under it or climbs past it', () => {
    const inFriendly = { neutral: 'again', friendly: 'first' } as const
    expect(observedUpperHalves(inFriendly, 18)).toEqual({ neutral: 'again', friendly: 'again' })
    expect(observedUpperHalves(inFriendly, 35)).toEqual({ neutral: 'again', friendly: 'again' })
  })

  it('counts a half she jumped over as reached, so decaying back into it is no first stay', () => {
    expect(observedUpperHalves(undefined, 60)).toEqual({
      neutral: 'again',
      friendly: 'again',
      trusted: 'again'
    })
  })

  it('leaves a half she never reached absent, and keeps an again for good', () => {
    expect(observedUpperHalves(undefined, 5)).toBeUndefined()
    const again = { neutral: 'again' } as const
    expect(observedUpperHalves(again, 12)).toBe(again)
    expect(observedUpperHalves(again, -40)).toBe(again)
  })
})

describe('the contact-profile reveals', () => {
  it('start unset', () => {
    const flags = emptyFlags()
    expect(flags.knowsTraits).toBe(false)
    expect(flags.knowsBackstory).toBe(false)
    expect(flags.knowsLoveLife).toBe(false)
  })

  it('survive a scene that makes them lovers and breaks them up at once', () => {
    // refreshedFlags never sees `isLover` true on this path, so `became_lovers`
    // has to do the reveal itself.
    const after = applyEvent(applyEvent(emptyFlags(), 'became_lovers'), 'broke_up')
    expect(after.isLover).toBe(false)
    expect(after.knowsLoveLife).toBe(true)
    expect(refreshedFlags(after, 0).knowsLoveLife).toBe(true)
  })
})

describe('initialFlags', () => {
  it('starts a promiscuous character on harem, and everybody else blank', () => {
    // She never had anything to agree to, so the milestone is true from the
    // first slot rather than waiting on a conversation.
    expect(initialFlags(character({ traits: ['Promiscuous'] }))).toEqual({
      ...emptyFlags(),
      harem: true
    })
    expect(initialFlags(character())).toEqual(emptyFlags())
    expect(initialFlags(character({ traits: ['Materialist'] }))).toEqual(emptyFlags())
    expect(initialFlags(undefined)).toEqual(emptyFlags())
  })
})

/**
 * The one fold both the boundary's apply and the ending's projection of it run.
 * Everything about it is here rather than in the store action,
 * because the projection has no store to run through.
 */
describe('foldRelationshipEvents', () => {
  it('applies the events in order and leaves the rest of her entry alone', () => {
    const info = charInfo({ nameKnown: true, dorm: 'elysium' })
    const folded = foldRelationshipEvents(info, ['sex', 'became_lovers'], 7, 'female')
    // `sex` then `became_lovers` must not leave `benefits` set — the whole
    // reason the events are folded as a group rather than one at a time.
    expect(folded.flags).toMatchObject({ hadSex: true, isLover: true, benefits: false })
    expect(folded.nameKnown).toBe(true)
    expect(folded.dorm).toBe('elysium')
  })

  it('writes the two biggest milestones their own memory, dated the slot that ran', () => {
    const folded = foldRelationshipEvents(charInfo(), ['sex'], 7, 'female')
    // Sleeping together implies the kiss, so a first time that is also a first
    // kiss says both — one memory each.
    expect(folded.memories).toEqual([
      { date: 7, type: 'loved', desc: 'the reader kissed her for the first time' },
      { date: 7, type: 'loved', desc: 'the reader slept with her for the first time' }
    ])
  })

  it('writes nothing for a milestone she had already reached', () => {
    const info = charInfo({ flags: { ...emptyFlags(), hasKissed: true, hadSex: true } })
    expect(foldRelationshipEvents(info, ['kissed', 'sex'], 7, 'female').memories).toEqual([])
  })

  it('lets a breakup land on top of the ledger\'s own memory of it', () => {
    const info = charInfo({
      memories: [{ date: 7, type: 'hated', desc: 'he ended it in the middle of dinner' }],
      flags: { ...emptyFlags(), isLover: true }
    })
    const folded = foldRelationshipEvents(info, ['broke_up'], 7, 'female')
    // Stacking is the one mechanism the list has for saying a thing mattered
    // more, and ending it has to outweigh whatever she hears afterwards.
    expect(folded.memories).toHaveLength(2)
    expect(folded.memories[1]).toEqual({
      date: 7,
      type: 'hated',
      desc: 'things ended between the reader and her'
    })
    expect(folded.flags.brokenUp).toBe(1)
  })

  it('appends milestones with nothing dropped', () => {
    const info = charInfo({
      memories: Array.from({ length: 20 }, (_, at) => ({
        date: 1,
        type: 'liked' as const,
        desc: `old ${at}`
      }))
    })
    const folded = foldRelationshipEvents(info, ['kissed'], 7, 'female')
    expect(folded.memories).toHaveLength(21)
    expect(folded.memories[0].desc).toBe('old 0')
    expect(folded.memories.at(-1)?.desc).toBe('the reader kissed her for the first time')
  })

  it('dates the breakup, however the dating ended', () => {
    const info = charInfo({ flags: { ...emptyFlags(), isLover: true } })
    for (const event of ['broke_up', 'friendzoned_by_reader', 'friendzoned_reader'] as const) {
      expect(foldRelationshipEvents(info, [event], 7, 'female').brokeUpOn).toBe(7)
    }
  })

  it('dates the start of dating, and keeps it through the breakup for the exes line', () => {
    const together = foldRelationshipEvents(charInfo(), ['became_lovers'], 9, 'female')
    expect(together.datingSince).toBe(9)
    const apart = foldRelationshipEvents(together, ['broke_up'], 12, 'female')
    expect(apart.datingSince).toBe(9)
    expect(apart.brokeUpOn).toBe(12)
  })

  it('takes the ending off her when they get back together', () => {
    const folded = foldRelationshipEvents(
      charInfo({ brokeUpOn: 5, leftFor: 'other', datingSince: 1 }),
      ['became_lovers'],
      9,
      'female'
    )
    // Gone rather than blanked, which is what the save carries for an absent optional.
    expect('brokeUpOn' in folded).toBe(false)
    expect('leftFor' in folded).toBe(false)
    expect(folded.datingSince).toBe(9)
  })

  it('writes nothing at all, so the projection cannot disturb what it read', () => {
    const info = charInfo()
    foldRelationshipEvents(info, ['sex'], 7, 'female')
    expect(info.memories).toEqual([])
    expect(info.flags.hadSex).toBe(false)
  })
})

/**
 * Whether the reader may romance someone is read off the playthrough's setting and the
 * milestones the two have reached; a wrong answer gates the crush roll and the writer's line for
 * the rest of the playthrough, and nothing throws.
 */
describe('isRomanceable', () => {
  const guy = { gender: 'male' as const }
  const nobody = { female: 'none', male: 'none' } as const
  const lesbian = { ...character(), attractedTo: { female: true, male: false } }
  const bisexual = { ...character(), attractedTo: { female: true, male: true } }

  it("follows her sexuality against the reader's gender while nothing has happened", () => {
    expect(isRomanceable(character(), charInfo(), DEFAULT_ROMANCE, 'he')).toBe(true)
    expect(isRomanceable(character(), charInfo(), DEFAULT_ROMANCE, 'she')).toBe(false)
    expect(isRomanceable(guy, charInfo(), DEFAULT_ROMANCE, 'he')).toBe(false)
    expect(isRomanceable(guy, charInfo(), DEFAULT_ROMANCE, 'she')).toBe(true)
    expect(isRomanceable(lesbian, charInfo(), DEFAULT_ROMANCE, 'she')).toBe(true)
    expect(isRomanceable(lesbian, charInfo(), DEFAULT_ROMANCE, 'he')).toBe(false)
  })

  it('takes everyone for a they/them reader unless the level is none', () => {
    expect(isRomanceable(lesbian, charInfo(), DEFAULT_ROMANCE, 'they')).toBe(true)
    expect(isRomanceable(guy, charInfo(), DEFAULT_ROMANCE, 'they')).toBe(true)
    expect(isRomanceable(guy, charInfo(), nobody, 'they')).toBe(false)
  })

  it('lets all attracted reach past her sexuality, and none bar even a bisexual girl', () => {
    expect(isRomanceable(lesbian, charInfo(), ALL_ROMANCE, 'he')).toBe(true)
    expect(isRomanceable(guy, charInfo(), ALL_ROMANCE, 'he')).toBe(true)
    expect(isRomanceable(bisexual, charInfo(), nobody, 'he')).toBe(false)
    expect(isRomanceable(bisexual, charInfo(), nobody, 'she')).toBe(false)
  })

  it('reads the sexuality the playthrough settled ahead of her record', () => {
    const settledLesbian = charInfo({ attractedTo: { female: true, male: false } })
    const settledStraight = charInfo({ attractedTo: { female: false, male: true } })
    expect(isRomanceable(character(), settledLesbian, DEFAULT_ROMANCE, 'he')).toBe(false)
    expect(isRomanceable(lesbian, settledStraight, DEFAULT_ROMANCE, 'he')).toBe(true)
  })

  it.each<[string, Partial<CharInfo>]>([
    ['a kiss', { flags: { ...emptyFlags(), hasKissed: true } }],
    ['a night together', { flags: { ...emptyFlags(), hadSex: true } }],
    ['dating', { flags: { ...emptyFlags(), isLover: true } }],
    ['friends with benefits', { flags: { ...emptyFlags(), benefits: true } }],
    ['a breakup', { flags: { ...emptyFlags(), brokenUp: 1 } }],
    ['having dated', { datingSince: 3 }]
  ])('stays romanceable for good after %s, whatever the setting', (_, over) => {
    expect(isRomanceable(guy, charInfo(over), nobody, 'he')).toBe(true)
  })
})

/** The setting is read off a record that may predate it or have been edited by hand. */
describe('romanceOf', () => {
  it('reads a record without one as following her sexuality', () => {
    expect(romanceOf({})).toEqual(DEFAULT_ROMANCE)
    expect(romanceOf(undefined)).toEqual(DEFAULT_ROMANCE)
  })

  it('reads a malformed one field by field, each at its default', () => {
    expect(romanceOf({ romance: 'yes' })).toEqual(DEFAULT_ROMANCE)
    expect(romanceOf({ romance: null })).toEqual(DEFAULT_ROMANCE)
    expect(romanceOf({ romance: { female: 0, male: 'true' } })).toEqual(DEFAULT_ROMANCE)
    // The on/off switch the levels replaced.
    expect(romanceOf({ romance: { female: false, male: true } })).toEqual(DEFAULT_ROMANCE)
  })

  it('keeps exactly what the record says', () => {
    expect(romanceOf({ romance: { female: 'none', male: 'all' } })).toEqual({
      female: 'none',
      male: 'all'
    })
  })
})

/** Who she is attracted to in play, which the crush roll and the writer's line both read. */
describe('attraction', () => {
  const straight = { female: false, male: true }

  it('reads an absent or malformed record as the other gender alone', () => {
    expect(attractionOf(character())).toEqual(straight)
    expect(attractionOf({ gender: 'male' })).toEqual({ female: true, male: false })
    expect(attractionOf({ ...character(), attractedTo: { female: false, male: false } })).toEqual(
      straight
    )
    expect(attractionOf({ ...character(), attractedTo: 'both' as never })).toEqual(straight)
  })

  it("adds the reader's gender only under all attracted, and none for they/them", () => {
    const lesbian = { ...character(), attractedTo: { female: true, male: false } }
    const both = { female: true, male: true }
    expect(attractionInPlay(lesbian, undefined, ALL_ROMANCE, 'he')).toEqual(both)
    expect(attractionInPlay(lesbian, undefined, DEFAULT_ROMANCE, 'he')).toEqual(lesbian.attractedTo)
    expect(attractionInPlay(lesbian, undefined, ALL_ROMANCE, 'they')).toEqual(lesbian.attractedTo)
  })

  it('makes her attracted to both genders under all attracted to all, the reader and the roster', () => {
    const lesbian = { ...character(), attractedTo: { female: true, male: false } }
    const both = { female: true, male: true }
    const everyone = { female: 'everyone', male: 'sexuality' } as const
    expect(romanceOf({ romance: everyone })).toEqual(everyone)
    expect(attractionInPlay(lesbian, undefined, everyone, 'they')).toEqual(both)
    expect(npcAttractionOf(lesbian, undefined, everyone)).toEqual(both)
    // All attracted is about the reader alone: it adds nothing between two characters.
    expect(npcAttractionOf(lesbian, undefined, ALL_ROMANCE)).toEqual(lesbian.attractedTo)
  })
})

describe('the crush roll', () => {
  /** The three tier floors the gate and the weights are written against. */
  const DECENT = pointsForTier(2)
  const GOOD = pointsForTier(3)
  const EXCEPTIONAL = pointsForTier(4)
  const GODLY = pointsForTier(5)

  /** A stat block with one stat set and the other two on the floor. */
  function stats(over: Partial<PlayerStats> = {}): PlayerStats {
    return { brain: 0, body: 0, heart: 0, ...over }
  }

  const ordinary = character({ preferredStat: 'brain' })
  const picky = character({ preferredStat: 'brain', traits: ['High Standards'] })

  describe('meetsCrushStandards', () => {
    it('asks for Good in what she goes for, and nothing else', () => {
      expect(meetsCrushStandards(ordinary, stats({ brain: GOOD - 1 }))).toBe(false)
      expect(meetsCrushStandards(ordinary, stats({ brain: GOOD }))).toBe(true)
    })

    it('reads her own stat, not the highest one he has', () => {
      expect(meetsCrushStandards(ordinary, stats({ body: GODLY }))).toBe(false)
    })

    it('asks High Standards for Decent in everything else on top of it', () => {
      expect(meetsCrushStandards(picky, stats({ brain: GOOD - 1, body: DECENT, heart: DECENT }))).toBe(false)
      expect(meetsCrushStandards(picky, stats({ brain: GOOD, body: DECENT }))).toBe(false)
      expect(meetsCrushStandards(picky, stats({ brain: GOOD, body: DECENT, heart: DECENT }))).toBe(true)
    })
  })

  describe('crushChance', () => {
    it('leaves a stranger the stat share alone to draw against', () => {
      expect(crushChance(ordinary, stats({ brain: GODLY }), 0)).toBeCloseTo(0.4)
    })

    it('pays nothing for a stat sitting exactly on her floor', () => {
      expect(crushChance(ordinary, stats({ brain: GOOD }), 0)).toBe(0)
      expect(crushChance(ordinary, stats({ brain: GOOD }), 50)).toBeCloseTo(0.6)
    })

    it('normalizes each half against the top of its own scale', () => {
      // The trait costs her nothing in the odds: both read the one floor, so the
      // stat share ramps from zero at Good to the whole of it at Godly.
      expect(crushChance(picky, stats({ brain: GODLY, body: DECENT, heart: DECENT }), 0)).toBeCloseTo(0.4)
      expect(crushChance(picky, stats({ brain: GOOD, body: DECENT, heart: DECENT }), 0)).toBe(0)
      expect(crushChance(ordinary, stats({ brain: EXCEPTIONAL }), 0)).toBeCloseTo(
        (0.4 * (EXCEPTIONAL - GOOD)) / (GODLY - GOOD)
      )
    })

    it('clamps both halves, so neither can pay past its share', () => {
      expect(crushChance(ordinary, stats({ brain: GODLY * 4 }), 500)).toBe(1)
      expect(crushChance(ordinary, stats({ brain: GODLY }), -500)).toBeCloseTo(0.4)
    })

    it('is zero whatever she feels when her standards are not met', () => {
      expect(crushChance(ordinary, stats({ brain: GOOD - 1 }), 500)).toBe(0)
    })
  })

  /**
   * The roll itself is never reported, so these lines are the only way the player can see the
   * gate at all — the state machine exists to *not* repeat advice, since advice given every
   * scene is advice he stops reading.
   */
  describe('crushHintUpdate', () => {
    const update = (
      char: Parameters<typeof crushHintUpdate>[1],
      block: PlayerStats,
      hint?: CrushHint
    ): ReturnType<typeof crushHintUpdate> => crushHintUpdate('Sarah', char, block, hint)

    it('names the one stat to spend the next hour on, and remembers its tier', () => {
      expect(update(ordinary, stats())).toEqual({
        line: "Your Brain needs to be at least Good to catch Sarah's interest.",
        hint: { stat: 'brain', tier: 1 }
      })
    })

    it('says nothing again until that stat buys a tier', () => {
      const held: CrushHint = { stat: 'brain', tier: 1 }
      const still = update(ordinary, stats({ brain: DECENT - 1 }), held)
      expect(still.line).toBeNull()
      // The same object back, which is what lets the caller skip the write.
      expect(still.hint).toBe(held)
    })

    // A tier bought is news whether or not it cleared her bar, because it is the
    // one moment the advice can be re-read as progress.
    it('says it again, of whatever is short now, when the tier moves', () => {
      expect(update(picky, stats({ brain: GOOD, body: DECENT }), { stat: 'brain', tier: 2 })).toEqual({
        line: "Your Heart needs to be at least Decent to catch Sarah's interest.",
        hint: { stat: 'heart', tier: 1 }
      })
    })

    it('tells him he made it, naming what she was waiting on', () => {
      expect(update(ordinary, stats({ brain: GOOD }), { stat: 'brain', tier: 1 })).toEqual({
        line: "Your Brain seems to have caught Sarah's interest...",
        hint: { met: true }
      })
      expect(
        update(picky, stats({ brain: GOOD, body: DECENT, heart: DECENT }), {
          stat: 'heart',
          tier: 1
        }).line
      ).toBe("Your Brain, Body, and Heart seem to have caught Sarah's interest...")
    })

    it('says it once and never takes it back', () => {
      const met: CrushHint = { met: true }
      expect(update(ordinary, stats({ brain: GODLY }), met)).toEqual({ line: null, hint: met })
      // Not even if the stat it was about falls away again.
      expect(update(ordinary, stats(), met).line).toBeNull()
    })

    // Nothing was ever promised, so there is no payoff owed: a reader who was
    // within her bar before she was ever mentioned is simply within it.
    it('says nothing at all to a reader who was never short of her', () => {
      expect(update(ordinary, stats({ brain: GODLY }))).toEqual({ line: null, hint: undefined })
    })

    // Interest is what the roll is about, and a couple holds that down; a crush settles it.
    it('keeps the payoff owed while she is taken, and pays it once she has a crush', () => {
      const held: CrushHint = { stat: 'brain', tier: 1 }
      const taken = crushHintUpdate('Sarah', ordinary, stats({ brain: GOOD }), held, 'taken')
      expect(taken.line).toBeNull()
      expect(taken.hint).toBe(held)
      expect(crushHintUpdate('Sarah', ordinary, stats({ brain: GOOD }), held, 'crush')).toEqual({
        line: "Your Brain seems to have caught Sarah's interest...",
        hint: { met: true }
      })
      // Short of her bar again, a girl with a crush is told nothing she is waiting on.
      expect(crushHintUpdate('Sarah', ordinary, stats(), undefined, 'crush').line).toBeNull()
      // While what she is waiting on is still said to a taken girl.
      expect(crushHintUpdate('Sarah', ordinary, stats(), undefined, 'taken').line).toBe(
        "Your Brain needs to be at least Good to catch Sarah's interest."
      )
    })
  })

  describe('rollsCrush', () => {
    it('draws against the chance', () => {
      const chance = crushChance(ordinary, stats({ brain: GODLY }), 0)
      expect(rollsCrush(ordinary, stats({ brain: GODLY }), 0, () => chance - 0.001)).toBe(true)
      expect(rollsCrush(ordinary, stats({ brain: GODLY }), 0, () => chance)).toBe(false)
    })

    it('never hands one out at a score `refreshedFlags` would clear it at', () => {
      expect(rollsCrush(ordinary, stats({ brain: GODLY }), -1, () => 0)).toBe(false)
      expect(rollsCrush(ordinary, stats({ brain: GODLY }), 0, () => 0)).toBe(true)
    })
  })
})

describe('the break penalty', () => {
  it('is taken off her affection whole, then by its half rounded up', () => {
    // Twenty old loves, each worth 2 at a weight of 1: an affection of 40.
    const memories = Array.from({ length: 20 }, () => mem(0, 'loved'))
    expect(affectionFor({ memories, breakPenalty: { points: 9 } }, 100, undefined)).toBe(31)
    expect(
      affectionFor({ memories, breakPenalty: { points: 9, halved: true } }, 100, undefined)
    ).toBe(35)
  })

  it('lands devoted on the bottom of trusted, trusted on friendly’s and friendly on zero', () => {
    for (const [affection, landing] of [
      [80, 31],
      [51, 31],
      [40, 16],
      [31, 16],
      [22, 0],
      [16, 0]
    ]) {
      const penalty = breakPenaltyAt(affection, undefined)
      expect(penalty).toEqual({ points: affection - landing })
    }
    expect(breakPenaltyAt(15, undefined)).toBeNull()
    expect(breakPenaltyAt(-20, { points: 5, halved: true })).toBeNull()
  })

  it('replaces a penalty she still holds, counted off her affection without it', () => {
    // Raw 40, a halved 10 still held: she opens on 35, trusted, and lands on 16.
    expect(breakPenaltyAt(35, { points: 10, halved: true })).toEqual({ points: 24 })
  })

  it('halves at her first cast scene, goes at her second, and waits out scenes she is not in', () => {
    const whole = charInfo({ breakPenalty: { points: 30 } })
    const before = { a: whole, b: charInfo({ breakPenalty: { points: 8 } }) }
    const once = withBreakPenaltiesStepped(before, ['a'])
    expect(once.a.breakPenalty).toEqual({ points: 30, halved: true })
    expect(once.b).toBe(before.b)
    const twice = withBreakPenaltiesStepped(once, ['a'])
    expect(twice.a).not.toHaveProperty('breakPenalty')
    expect(withBreakPenaltiesStepped(twice, ['a', 'c'])).toBe(twice)
  })

  it('leaves a graduate’s entry alone', () => {
    const before = { g: charInfo({ breakPenalty: { points: 30 }, pursuing: 'law school' }) }
    expect(withBreakPenaltiesStepped(before, ['g'])).toBe(before)
  })
})
