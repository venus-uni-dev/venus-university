import { describe, expect, it } from 'vitest'
import {
  affinityUpChance,
  areNpcFriends,
  inHoneymoon,
  MAX_AFFINITY,
  MIN_AFFINITY,
  listenersOf,
  newCouples,
  newFriendships,
  npcFriendsOf,
  pairKeyOf,
  readerCrushFactorOf,
  rollInitialNpcRelationships,
  rollMeetingAffinity,
  settleNpcPairs,
  settleNpcPairsFull,
  withAffairsFound,
  withCouplesLeft,
  zoneOf,
  type NpcAdvice,
  type NpcRelationshipMap
} from '@shared/npcRelationships'
import { seededRand } from '@shared/hash'
import { HONEYMOON_DAYS } from '@shared/odds'
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
    expect(up[pairKeyOf('a', 'b')].encounter).toMatchObject({ positive: true })

    const down = settle({ relationships: before, groups }, () => 0.999999)
    expect(down[pairKeyOf('a', 'b')].affinity).toBe(1)
    expect(down[pairKeyOf('a', 'b')].encounter).toMatchObject({ positive: false })
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
    expect(map[pairKeyOf('a', 'b')].encounter).toMatchObject({ ref: 'selkie_beach' })
  })

  it('records whose room a room hangout was in, so the line can name her', () => {
    const map = settle({
      groups: [{ kind: 'hangout', ref: 'room', members: ['a', 'b'], host: 'a' }]
    })
    expect(map[pairKeyOf('a', 'b')].encounter).toMatchObject({ roomOf: 'a' })
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

/** The couples log, which the feed and her page read: one row per time a pair got together. */
describe('newCouples', () => {
  const AB = pairKeyOf('a', 'b')

  it('reports a pair the settle has just put together, under the date it did', () => {
    expect(newCouples({ [AB]: { affinity: 2 } }, { [AB]: { affinity: 3, dating: 8 } }, [])).toEqual([
      { a: 'a', b: 'b', date: 8 }
    ])
  })

  it('says nothing of a couple that was already together, or one already logged', () => {
    const together = { [AB]: { affinity: 3, dating: 8 } }
    expect(newCouples(together, together, [])).toEqual([])
    expect(newCouples({}, together, [{ a: 'a', b: 'b', date: 8 }])).toEqual([])
  })

  it('reports a pair that broke up and got back together again', () => {
    const fresh = newCouples(
      { [AB]: { affinity: 3, ended: 20 } },
      { [AB]: { affinity: 4, ended: 20, dating: 30 } },
      [{ a: 'a', b: 'b', date: 8 }]
    )
    expect(fresh).toEqual([{ a: 'a', b: 'b', date: 30 }])
  })
})

/**
 * Who falls for whom, gets together and breaks up, checked as invariants over many seeded slots,
 * since every slot's settle is frozen into the save it lands on.
 */
describe('the settle with love lives', () => {
  const bi = { female: true, male: true }
  const roster = [
    character({ charId: 'a', firstName: 'Ana', attractedTo: bi }),
    character({ charId: 'b', firstName: 'Bea' }),
    character({ charId: 'c', firstName: 'Cleo', traits: ['Promiscuous'], attractedTo: bi }),
    character({ charId: 'd', firstName: 'Dee', traits: ['Good-natured'] }),
    character({ charId: 'm', firstName: 'Max', gender: 'male' }),
    character({ charId: 'n', firstName: 'Ned', gender: 'male', traits: ['High Standards'] }),
    character({ charId: 'o', firstName: 'Oli', gender: 'male', attractedTo: bi }),
    character({ charId: 'p', firstName: 'Pip', gender: 'male', traits: ['Disagreeable'] })
  ]
  const graduate = character({ charId: 'g', firstName: 'Gus', gender: 'male' })
  const characters = charactersById(...roster, graduate)
  const ids = roster.map((c) => c.charId)
  const attraction = Object.fromEntries(
    [...roster, graduate].map((c) => [
      c.charId,
      c.attractedTo ?? { female: c.gender === 'male', male: c.gender !== 'male' }
    ])
  )
  const open = new Set(['c'])
  const lovers = ['b']

  /** Everyone dating `charId` on `map`. */
  const partners = (map: NpcRelationshipMap, charId: string): string[] =>
    [...ids, 'g'].filter((other) => other !== charId && map[pairKeyOf(charId, other)]?.dating !== undefined)

  /** One slot's groups: the roster shuffled and cut into twos and threes. */
  const groupsOf = (rand: () => number) => {
    const order = [...ids].sort(() => rand() - 0.5)
    const groups = []
    for (let i = 0; i + 1 < order.length; i += 2 + Math.floor(rand() * 2)) {
      groups.push({ kind: 'hangout' as const, ref: 'pier_44', members: order.slice(i, i + 3) })
    }
    return groups
  }

  it('holds every rule of who may love whom over many slots', () => {
    // What the runs saw, so the rules below are known to have been put to the test.
    const seen = { crush: 0, together: 0, brokeUp: 0, jealous: 0 }
    for (let run = 0; run < 12; run++) {
      const rand = seededRand(`love:${run}`)
      // Everybody knows everybody and gets on, and Gus has graduated with a girlfriend on campus.
      let map: NpcRelationshipMap = {}
      for (const x of ids) for (const y of ids) if (x < y) map[pairKeyOf(x, y)] = { affinity: 2 }
      map[pairKeyOf('d', 'g')] = { affinity: 5, dating: -40 }

      for (let slot = 0; slot < 240; slot++) {
        const date = Math.floor(slot / 2)
        const before = map
        map = settleNpcPairs(
          {
            date,
            relationships: before,
            cast: [],
            groups: groupsOf(rand),
            characters,
            roster: ids,
            alumni: ['g'],
            attraction,
            readerCrush: ['d'],
            readerLovers: lovers,
            night: slot % 2 === 1
          },
          rand
        )

        for (const charId of [...ids, 'g']) {
          if (!open.has(charId)) expect(partners(map, charId).length).toBeLessThanOrEqual(1)
        }
        for (const [key, pair] of Object.entries(map)) {
          const [x, y] = key.split('|')
          const was = before[key]
          if (pair.crush && !was?.crush) seen.crush++
          if (pair.encounter !== was?.encounter && pair.encounter?.kind === 'together') seen.together++
          if (pair.encounter !== was?.encounter && pair.encounter?.kind === 'brokeUp') seen.brokeUp++
          if (pair.encounter !== was?.encounter && pair.encounter?.kind === 'jealous') seen.jealous++
          // Absent rather than empty, sorted, and only between two on the roster attracted to
          // each other, standing at 0 or above.
          if (pair.crush) {
            expect(pair.crush.length).toBeGreaterThan(0)
            expect(pair.crush).toEqual([...pair.crush].sort())
            expect(ids).toContain(x)
            expect(ids).toContain(y)
            expect(pair.affinity).toBeGreaterThanOrEqual(0)
            const gx = characters[x].gender === 'male' ? 'male' : 'female'
            const gy = characters[y].gender === 'male' ? 'male' : 'female'
            expect(attraction[x][gy] && attraction[y][gx]).toBe(true)
            // The reader's lover, not being open, has nobody else in mind.
            for (const lover of lovers) expect(pair.crush).not.toContain(lover)
          }
          // A couple only ever parts by breaking up, and a honeymoon neither parts nor lowers one.
          if (was?.dating !== undefined && pair.dating === undefined) {
            expect(pair.ended).toBe(date)
            expect(pair.encounter?.kind).toBe('brokeUp')
            expect(date - was.dating).toBeGreaterThanOrEqual(HONEYMOON_DAYS)
          }
          const longDistance = x === 'g' || y === 'g'
          if (was?.dating !== undefined && inHoneymoon(was, date) && !longDistance) {
            expect(pair.dating).toBe(was.dating)
            expect(pair.affinity).toBeGreaterThanOrEqual(was.affinity)
          }
          if (was?.ended !== undefined) expect(pair.ended).toBeGreaterThanOrEqual(was.ended)
          if (pair.dating !== undefined && was?.dating === undefined) {
            expect(pair.dating).toBe(date)
            expect(pair.encounter?.kind).toBe('together')
          }
        }
      }
    }
    expect(seen.crush).toBeGreaterThan(0)
    expect(seen.together).toBeGreaterThan(0)
    expect(seen.brokeUp).toBeGreaterThan(0)
    expect(seen.jealous).toBeGreaterThan(0)
  })

  it('rolls nothing new where no roster is given, so a save with no love life settles as before', () => {
    const before = {
      [pairKeyOf('a', 'b')]: { affinity: 2, crush: ['a', 'b'] },
      [pairKeyOf('a', 'c')]: { affinity: 3 }
    }
    const groups = [{ kind: 'hangout' as const, ref: 'pier_44', members: ['a', 'b', 'c'] }]
    const map = settleNpcPairs({ date: 10, relationships: before, cast: [], groups, characters }, () => 0)
    // Every pair stepped up, the crush kept and nobody got together.
    expect(map[pairKeyOf('a', 'b')]).toMatchObject({ affinity: 3, crush: ['a', 'b'] })
    expect(map[pairKeyOf('a', 'b')].dating).toBeUndefined()
  })

  it("lands each of the reader's answers before anybody meets", () => {
    const AM = pairKeyOf('a', 'm')
    const AO = pairKeyOf('a', 'o')
    const settle = (relationships: NpcRelationshipMap, advice: NpcAdvice[], rand: () => number) =>
      settleNpcPairsFull(
        { date: 40, relationships, cast: [], groups: [], characters, roster: ids, attraction, advice },
        rand
      )

    // A mutual crush he says yes to is a couple, whatever the dice.
    const mutual = settle({ [AM]: { affinity: 2, crush: ['a', 'm'], crushAsked: ['a'] } }, [{ charId: 'a', about: 'm', answer: 'yes' }], () => 0.99)
    expect(mutual.relationships[AM]).toEqual({ affinity: 2, dating: 40, encounter: { date: 40, kind: 'together' } })
    expect(mutual.outcomes).toEqual([{ charId: 'a', about: 'm', result: 'together' }])

    // One he does not return turns her down: her crush ends and the pair drops a step.
    const refused = settle({ [AM]: { affinity: 2, crush: ['a'], crushAsked: ['a'] } }, [{ charId: 'a', about: 'm', answer: 'yes' }], () => 0.99)
    expect(refused.relationships[AM]).toEqual({ affinity: 1, encounter: { date: 40, kind: 'turnedDown', by: 'm' } })
    expect(refused.outcomes).toEqual([{ charId: 'a', about: 'm', result: 'turnedDown' }])

    // A yes to somebody no longer free to date comes to nothing, and "Definitely not." ends her crush.
    const taken = settle(
      { [AM]: { affinity: 2, crush: ['a', 'm'] }, [pairKeyOf('b', 'm')]: { affinity: 5, dating: 0 } },
      [{ charId: 'a', about: 'm', answer: 'yes' }],
      () => 0
    )
    expect(taken.relationships[AM]).toEqual({ affinity: 2, crush: ['a', 'm'] })
    expect(taken.outcomes).toEqual([])
    expect(settle({ [AM]: { affinity: 2, crush: ['a', 'm'] } }, [{ charId: 'a', about: 'm', answer: 'no' }], () => 0).relationships[AM]).toEqual({ affinity: 2, crush: ['m'] })

    // Talking it out is a step up; breaking up a step down that may part a couple below friends.
    const couple = { [AO]: { affinity: 4, dating: 0 } }
    expect(settle(couple, [{ charId: 'a', about: 'o', answer: 'talk' }], () => 0).relationships[AO].affinity).toBe(5)
    const parted = settle(couple, [{ charId: 'a', about: 'o', answer: 'breakUp' }], () => 0)
    expect(parted.relationships[AO]).toEqual({ affinity: 3, ended: 40, encounter: { date: 40, kind: 'brokeUp' } })
    expect(parted.outcomes).toEqual([{ charId: 'a', about: 'o', result: 'brokeUp' }])
    const stayed = settle(couple, [{ charId: 'a', about: 'o', answer: 'breakUp' }], () => 0.99)
    expect(stayed.relationships[AO]).toEqual({ affinity: 3, dating: 0 })
    expect(stayed.outcomes).toEqual([])
    // Inside a honeymoon it costs them nothing.
    expect(settle({ [AO]: { affinity: 1, dating: 35 } }, [{ charId: 'a', about: 'o', answer: 'breakUp' }], () => 0).relationships[AO]).toEqual({ affinity: 1, dating: 35 })
  })

  it('holds every rule with his advice fed in, and reports only couples who argued and stayed together', () => {
    const seen = { argued: 0, together: 0, turnedDown: 0, brokeUp: 0 }
    const answers = ['breakUp', 'talk', 'yes', 'no'] as const
    for (let run = 0; run < 12; run++) {
      const rand = seededRand(`advice:${run}`)
      let map: NpcRelationshipMap = {}
      for (const x of ids) for (const y of ids) if (x < y) map[pairKeyOf(x, y)] = { affinity: 2 }

      for (let slot = 0; slot < 240; slot++) {
        const date = Math.floor(slot / 2)
        // A few answers a slot, to whatever pair the dice land on, standing or not.
        const advice: NpcAdvice[] = []
        for (let i = 0; i < 3; i++) {
          const charId = ids[Math.floor(rand() * ids.length)]
          const about = ids[Math.floor(rand() * ids.length)]
          if (charId !== about) advice.push({ charId, about, answer: answers[Math.floor(rand() * 4)] })
        }
        const before = map
        const settled = settleNpcPairsFull(
          {
            date,
            relationships: before,
            cast: [],
            groups: groupsOf(rand),
            characters,
            roster: ids,
            attraction,
            readerLovers: lovers,
            advice,
            night: slot % 2 === 1
          },
          rand
        )
        map = settled.relationships

        for (const charId of ids) {
          if (!open.has(charId)) expect(partners(map, charId).length).toBeLessThanOrEqual(1)
        }
        // Nobody the reader is dating, not being open, is put with anybody.
        for (const lover of lovers) expect(partners(map, lover)).toEqual([])
        for (const pair of Object.values(map)) {
          for (const holder of pair.crushAsked ?? []) expect(pair.crush).toContain(holder)
        }
        for (const { a, b } of settled.argued) {
          seen.argued++
          expect(map[pairKeyOf(a, b)].dating).toBeDefined()
          expect(a < b).toBe(true)
        }
        for (const { charId, about, result } of settled.outcomes) {
          seen[result]++
          const pair = map[pairKeyOf(charId, about)]
          if (result === 'together') expect(advice).toContainEqual({ charId, about, answer: 'yes' })
          if (result === 'turnedDown') expect(pair.crush ?? []).not.toContain(charId)
          if (result === 'brokeUp') expect(before[pairKeyOf(charId, about)].dating).toBeDefined()
        }
      }
    }
    expect(seen.argued).toBeGreaterThan(0)
    expect(seen.together).toBeGreaterThan(0)
    expect(seen.turnedDown).toBeGreaterThan(0)
    expect(seen.brokeUp).toBeGreaterThan(0)
  })

  it("keeps a couple's dates and crushes through a meeting that only moves the number", () => {
    const before = {
      [pairKeyOf('a', 'm')]: { affinity: 2, dating: 1, ended: 0, crush: ['a'] }
    }
    const groups = [{ kind: 'class' as const, ref: 'HUM101', members: ['a', 'm'] }]
    const map = settleNpcPairs(
      { date: 40, relationships: before, cast: [], groups, characters, roster: ids, attraction },
      () => 0.99
    )
    expect(map[pairKeyOf('a', 'm')]).toMatchObject({ dating: 1, ended: 0, crush: ['a'] })
  })
})

/** What being taken does to her odds of falling for the reader. */
describe('readerCrushFactorOf', () => {
  const AM = pairKeyOf('a', 'm')

  it('stops a crush while she is happy, cuts it while rocky, and leaves the single and the open alone', () => {
    const happy = { [AM]: { affinity: 5, dating: 0 } }
    const rocky = { [AM]: { affinity: 1, dating: 0 } }
    const honeymoon = { [AM]: { affinity: 1, dating: 30 } }
    expect(readerCrushFactorOf({}, 'a', character(), 40)).toBe(1)
    expect(readerCrushFactorOf(happy, 'a', character(), 40)).toBe(0)
    expect(readerCrushFactorOf(honeymoon, 'a', character(), 40)).toBe(0)
    expect(readerCrushFactorOf(rocky, 'a', character(), 40)).toBeCloseTo(0.1)
    expect(readerCrushFactorOf(happy, 'a', character({ traits: ['Promiscuous'] }), 40)).toBe(1)
  })
})

/** What the reader's affairs and new lovers do to the couples the map holds. */
describe('affairs and couples left', () => {
  const AM = pairKeyOf('a', 'm')
  const AF = pairKeyOf('a', 'f')
  const FM = pairKeyOf('f', 'm')

  it('drops a couple found out, records who cheated, ends its honeymoon and leaves a later one its own', () => {
    const map: NpcRelationshipMap = {
      [AM]: { affinity: 5, dating: 20, crush: ['a'] },
      [AF]: { affinity: 0, crush: ['f'] },
      [FM]: { affinity: 5 }
    }
    const found = withAffairsFound(
      map,
      [{ cheater: 'a', partner: 'm', saw: true }],
      [{ by: 'f', cheater: 'a', partner: 'm' }],
      24
    )

    expect(found[AM]).toEqual({
      affinity: 1,
      dating: 20,
      crush: ['a'],
      cheated: { a: 24 },
      encounter: { date: 24, kind: 'foundOut', by: 'm' }
    })
    expect(inHoneymoon(found[AM], 25)).toBe(false)
    // Below nothing, a pair holds no crush.
    expect(found[AF]).toEqual({
      affinity: -1,
      encounter: { date: 24, kind: 'sided', by: 'f', of: 'm' }
    })
    // Heard rather than seen, a second time costs it less.
    expect(
      withAffairsFound(found, [{ cheater: 'a', partner: 'm', saw: false }], [], 25)[AM].affinity
    ).toBe(-1)
    // Back together after it, the couple has a honeymoon again.
    expect(inHoneymoon({ ...found[AM], dating: 40 }, 45)).toBe(true)
    // An affair the map holds no couple for, and nobody siding who knows her, move nothing.
    expect(
      withAffairsFound(
        map,
        [{ cheater: 'a', partner: 'f', saw: true }],
        [{ by: 'x', cheater: 'a', partner: 'm' }],
        24
      )
    ).toBe(map)
  })

  it('ends a couple left for the reader at no cost, and leaves the map alone where none was', () => {
    const map: NpcRelationshipMap = { [AM]: { affinity: 5, dating: 20, crush: ['a'] } }
    expect(withCouplesLeft(map, [{ charId: 'a', partner: 'm' }], 30)[AM]).toEqual({
      affinity: 5,
      crush: ['a'],
      ended: 30,
      encounter: { date: 30, kind: 'brokeUp' }
    })
    expect(withCouplesLeft(map, [{ charId: 'a', partner: 'f' }], 30)).toBe(map)
  })
})
