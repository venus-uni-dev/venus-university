import { describe, expect, it } from 'vitest'
import {
  affinityUpChance,
  areNpcFriends,
  MAX_AFFINITY,
  MIN_AFFINITY,
  listenersOf,
  newFriendships,
  npcFriendsOf,
  pairKeyOf,
  rollInitialNpcRelationships,
  rollMeetingAffinity,
  settleNpcPairs,
  zoneOf,
  type NpcRelationshipMap
} from '@shared/npcRelationships'
import { character, charactersById } from './fixtures'

/**
 * The pair map and every roll that moves one. The initial deal and the settle pass are frozen
 * into a save the moment they run, so the randomised ones are checked as invariants over many
 * runs, with the extremes pinned by an injected `rand`.
 */

const RUNS = 60

describe('pairKeyOf', () => {
  it('is symmetric, so a pair can never be stored twice', () => {
    expect(pairKeyOf('b', 'a')).toBe(pairKeyOf('a', 'b'))
  })
})

describe('zoneOf', () => {
  it('bands on 4 and -4, so 3 is still neutral', () => {
    expect(zoneOf(4)).toBe('friends')
    expect(zoneOf(3)).toBe('neutral')
    expect(zoneOf(-3)).toBe('neutral')
    expect(zoneOf(-4)).toBe('enemies')
    expect(zoneOf(MAX_AFFINITY)).toBe('friends')
    expect(zoneOf(MIN_AFFINITY)).toBe('enemies')
  })
})

describe('friend lookups', () => {
  const map: NpcRelationshipMap = {
    [pairKeyOf('a', 'b')]: { affinity: 5 },
    [pairKeyOf('a', 'c')]: { affinity: 3 },
    [pairKeyOf('a', 'd')]: { affinity: -6 }
  }

  it('reads friendship off the zone, not off the entry existing', () => {
    expect(areNpcFriends(map, 'a', 'b')).toBe(true)
    expect(areNpcFriends(map, 'b', 'a')).toBe(true)
    expect(areNpcFriends(map, 'a', 'c')).toBe(false)
    expect(areNpcFriends(map, 'a', 'd')).toBe(false)
  })

  it('lists friends in roster order and never herself', () => {
    expect(npcFriendsOf(map, 'a', ['a', 'b', 'c', 'd'])).toEqual(['b'])
  })
})

describe('listenersOf', () => {
  it('lists everybody else a shared member met, and never herself', () => {
    const listeners = listenersOf([
      { kind: 'class', ref: 'HUM101', members: ['a', 'b'] },
      { kind: 'hangout', ref: 'pier_44', members: ['b', 'c'] }
    ])
    expect(listeners.b.sort()).toEqual(['a', 'c'])
    expect(listeners.a).toEqual(['b'])
    expect(listeners.c).toEqual(['b'])
  })
})

describe('rollInitialNpcRelationships', () => {
  const roster = [
    { charId: 'fresh-1', year: 1 },
    { charId: 'fresh-2', year: 1 },
    { charId: 'soph', year: 2 },
    { charId: 'junior', year: 3 },
    { charId: 'senior', year: 4 }
  ]

  it('leaves every freshman a stranger to everybody, however the dice fall', () => {
    for (let run = 0; run < RUNS; run++) {
      const map = rollInitialNpcRelationships(roster)
      for (const key of Object.keys(map)) {
        expect(key).not.toContain('fresh-')
      }
    }
  })

  it('keeps every affinity an integer inside the range', () => {
    for (let run = 0; run < RUNS; run++) {
      for (const pair of Object.values(rollInitialNpcRelationships(roster))) {
        expect(Number.isInteger(pair.affinity)).toBe(true)
        expect(pair.affinity).toBeGreaterThanOrEqual(MIN_AFFINITY)
        expect(pair.affinity).toBeLessThanOrEqual(MAX_AFFINITY)
      }
    }
  })

  it('rolls nobody a stranger at the top of the range and everybody at the bottom', () => {
    // The stranger test is `rand() < 0.5`, so a high roll always passes it and a
    // low one never does; the affinity draw that follows takes the same value.
    expect(Object.keys(rollInitialNpcRelationships(roster, () => 0.999999))).toHaveLength(3)
    expect(rollInitialNpcRelationships(roster, () => 0)).toEqual({})
  })

  it('deals no entry to anybody twice', () => {
    const map = rollInitialNpcRelationships(roster, () => 0.9)
    expect(Object.keys(map).sort()).toEqual(
      [pairKeyOf('soph', 'junior'), pairKeyOf('soph', 'senior'), pairKeyOf('junior', 'senior')].sort()
    )
  })
})

describe('rollMeetingAffinity', () => {
  it('spans -4 to 4, so a first meeting can land anywhere but the extremes', () => {
    expect(rollMeetingAffinity(() => 0)).toBe(-4)
    expect(rollMeetingAffinity(() => 0.999999)).toBe(4)
    for (let run = 0; run < RUNS; run++) {
      const value = rollMeetingAffinity()
      expect(value).toBeGreaterThanOrEqual(-4)
      expect(value).toBeLessThanOrEqual(4)
    }
  })
})

describe('affinityUpChance', () => {
  const plain = character({ charId: 'plain' })
  const mean = character({ charId: 'mean', traits: ['Disagreeable'] })
  const kind = character({ charId: 'kind', traits: ['Good-natured'] })

  it('drops to a coin flip when either of them is disagreeable', () => {
    expect(affinityUpChance(mean, plain, 0)).toBe(0.5)
    expect(affinityUpChance(plain, mean, 0)).toBe(0.5)
  })

  it('lifts to 70% when either of them is good-natured', () => {
    expect(affinityUpChance(kind, plain, 0)).toBe(0.7)
    expect(affinityUpChance(plain, kind, 0)).toBe(0.7)
  })

  it('cancels back to the ordinary number when one is each', () => {
    expect(affinityUpChance(mean, kind, 0)).toBe(0.6)
    expect(affinityUpChance(kind, mean, 0)).toBe(0.6)
  })

  it('leans towards patching up a bad pair and away from holding a friendship', () => {
    expect(affinityUpChance(plain, plain, -1)).toBeGreaterThan(affinityUpChance(plain, plain, 0))
    expect(affinityUpChance(plain, plain, 4)).toBeLessThan(affinityUpChance(plain, plain, 0))
  })
})

describe('settleNpcPairs', () => {
  const sarah = character({ charId: 'a', firstName: 'Sarah' })
  const mina = character({ charId: 'b', firstName: 'Mina' })
  const chloe = character({ charId: 'c', firstName: 'Chloe' })
  const characters = charactersById(sarah, mina, chloe)

  const settle = (
    over: Partial<Parameters<typeof settleNpcPairs>[0]>,
    rand?: () => number
  ): NpcRelationshipMap =>
    settleNpcPairs(
      { date: 10, relationships: {}, cast: [], groups: [], characters, ...over },
      rand
    )

  it('flips two strangers who shared the scene to a flat zero, with no encounter', () => {
    // How it went is the scene's to say — the dice do not get to contradict it.
    const map = settle({ cast: ['a', 'b'] })
    expect(map[pairKeyOf('a', 'b')]).toEqual({ affinity: 0 })
  })

  it('leaves a cast pair who already knew each other exactly as they were', () => {
    const before = { [pairKeyOf('a', 'b')]: { affinity: 5 } }
    expect(settle({ cast: ['a', 'b'], relationships: before })).toEqual(before)
  })

  it('skips a group pair when either of them was in the scene', () => {
    const before = { [pairKeyOf('a', 'b')]: { affinity: 0 } }
    const map = settle({
      cast: ['a'],
      relationships: before,
      groups: [{ kind: 'class', ref: 'HUM101', members: ['a', 'b'] }]
    })
    expect(map[pairKeyOf('a', 'b')]).toEqual({ affinity: 0 })
  })

  it('starts two strangers who met off-screen somewhere inside the meeting spread', () => {
    for (let run = 0; run < RUNS; run++) {
      const map = settle({ groups: [{ kind: 'class', ref: 'HUM101', members: ['a', 'b'] }] })
      const pair = map[pairKeyOf('a', 'b')]
      expect(pair.affinity).toBeGreaterThanOrEqual(-4)
      expect(pair.affinity).toBeLessThanOrEqual(4)
      expect(pair.encounter).toEqual({
        date: 10,
        kind: 'class',
        ref: 'HUM101',
        positive: pair.affinity >= 0
      })
    }
  })

  it('steps an existing pair up on a passing roll and down on a failing one', () => {
    const before = { [pairKeyOf('a', 'b')]: { affinity: 2 } }
    const groups = [{ kind: 'hangout' as const, ref: 'pier_44', members: ['a', 'b'] }]

    const up = settle({ relationships: before, groups }, () => 0)
    expect(up[pairKeyOf('a', 'b')].affinity).toBe(3)
    expect(up[pairKeyOf('a', 'b')].encounter?.positive).toBe(true)

    const down = settle({ relationships: before, groups }, () => 0.999999)
    expect(down[pairKeyOf('a', 'b')].affinity).toBe(1)
    expect(down[pairKeyOf('a', 'b')].encounter?.positive).toBe(false)
  })

  it('records the encounter even where the affinity is already pinned at the end', () => {
    const before = { [pairKeyOf('a', 'b')]: { affinity: MAX_AFFINITY } }
    const map = settle(
      {
        relationships: before,
        groups: [{ kind: 'hangout', ref: 'selkie_beach', members: ['a', 'b'] }]
      },
      () => 0
    )
    expect(map[pairKeyOf('a', 'b')].affinity).toBe(MAX_AFFINITY)
    expect(map[pairKeyOf('a', 'b')].encounter?.ref).toBe('selkie_beach')
  })

  it('records whose room a room hangout was in, so the line can name her', () => {
    const map = settle({
      groups: [{ kind: 'hangout', ref: 'room', members: ['a', 'b'], host: 'a' }]
    })
    expect(map[pairKeyOf('a', 'b')].encounter?.roomOf).toBe('a')
  })

  it('moves every pair inside a group of three', () => {
    const map = settle({
      groups: [{ kind: 'hangout', ref: 'pier_44', members: ['a', 'b', 'c'] }]
    })
    expect(Object.keys(map).sort()).toEqual(
      [pairKeyOf('a', 'b'), pairKeyOf('a', 'c'), pairKeyOf('b', 'c')].sort()
    )
  })

  it('steps every pair of the girls who liked the scene, and nobody else', () => {
    // Read off the ledger rather than rolled: the player watched the hour, and
    // two people who both enjoyed it got on during it.
    const before = {
      [pairKeyOf('a', 'b')]: { affinity: 3 },
      [pairKeyOf('a', 'c')]: { affinity: 3 }
    }
    const map = settle({ cast: ['a', 'b', 'c'], bonded: ['a', 'b'], relationships: before })
    expect(map[pairKeyOf('a', 'b')].affinity).toBe(4)
    // Chloe took nothing good away, so nothing moves for her — and nothing is
    // taken off her either.
    expect(map[pairKeyOf('a', 'c')].affinity).toBe(3)
    expect(map[pairKeyOf('b', 'c')]).toEqual({ affinity: 0 })
  })

  it('bonds two strangers who both liked the scene off the flat zero they meet at', () => {
    const map = settle({ cast: ['a', 'b'], bonded: ['a', 'b'] })
    expect(map[pairKeyOf('a', 'b')]).toEqual({ affinity: 1 })
  })

  it('keeps the bump inside the range, and keeps the encounter it found', () => {
    const encounter = { date: 9, kind: 'class' as const, ref: 'HUM101', positive: true }
    const before = {
      [pairKeyOf('a', 'b')]: { affinity: MAX_AFFINITY, encounter }
    }
    const map = settle({ cast: ['a', 'b'], bonded: ['a', 'b'], relationships: before })
    expect(map[pairKeyOf('a', 'b')]).toEqual({ affinity: MAX_AFFINITY, encounter })
  })

  it('ignores anybody named who was not in the scene', () => {
    // The whole claim is that they were in the same room; a ledger row for
    // somebody the cast does not hold cannot be one.
    const map = settle({ cast: ['a'], bonded: ['a', 'b'] })
    expect(map[pairKeyOf('a', 'b')]).toBeUndefined()
  })

  it('does not mutate the map it was given', () => {
    const before: NpcRelationshipMap = { [pairKeyOf('a', 'b')]: { affinity: 2 } }
    settle({
      relationships: before,
      groups: [{ kind: 'class', ref: 'HUM101', members: ['a', 'b'] }]
    })
    expect(before[pairKeyOf('a', 'b')]).toEqual({ affinity: 2 })
  })
})

/**
 * The permanent record the feed reads. It is written once per pair and never again, so
 * every way of reporting a pair twice is a bug the save carries for the rest of the playthrough.
 */
describe('newFriendships', () => {
  const AB = pairKeyOf('a', 'b')

  it('reports a pair the settle has just pushed into the friends band', () => {
    const fresh = newFriendships({ [AB]: { affinity: 3 } }, { [AB]: { affinity: 4 } }, [])
    expect(fresh).toEqual([{ a: 'a', b: 'b' }])
  })

  it('reports two strangers who met as friends, having no row before at all', () => {
    expect(newFriendships({}, { [AB]: { affinity: 5 } }, [])).toEqual([{ a: 'a', b: 'b' }])
  })

  // The guard that matters on the day this ships: a save full of standing friendships has an
  // empty record, and reading the record alone would announce every one of them at once.
  it('says nothing about a pair that was already friends before the slot', () => {
    expect(newFriendships({ [AB]: { affinity: 5 } }, { [AB]: { affinity: 6 } }, [])).toEqual([])
  })

  it('never reports a recorded pair again, however far out and back it goes', () => {
    const recorded = [{ a: 'a', b: 'b' }]
    expect(newFriendships({ [AB]: { affinity: 3 } }, { [AB]: { affinity: 4 } }, recorded)).toEqual(
      []
    )
  })

  it('says nothing about a pair that is merely getting on', () => {
    expect(newFriendships({ [AB]: { affinity: 1 } }, { [AB]: { affinity: 3 } }, [])).toEqual([])
  })
})
