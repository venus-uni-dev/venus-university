import { afterEach, describe, expect, it, vi } from 'vitest'
import { emptyFlags } from '@shared/relationship'
import type { CharInfo } from '@shared/types'
import {
  admitLocals,
  admitWorkers,
  injectPasserby,
  localsAtLocation,
  pickCast,
  pickFirstNightCast,
  resolveAttendance,
  resolveLocationId,
  workersAtLocation,
  workingHereNote
} from '../src/renderer/stores/loop/casting'
import { PORTRAIT_SLOTS, useGameStore } from '../src/renderer/stores/gameStore'
import { SPRING_BREAK_LEAVE } from '../src/renderer/prompts/springBreak'
import { character, charactersById, charInfo } from './fixtures'

/**
 * Who ends up on screen. Every answer the casting ladder gives
 * is written into the save the scene produces — a girl cast into a shift she was
 * rostered for elsewhere earns memories from a scene she could not have been in.
 */

/** A Monday well inside the semester, with nothing on the occasion calendar. */
const MONDAY = 35

/** Three characters, none of them met, on a slot with no classes scheduled. */
function seed(over: Record<string, Partial<CharInfo>> = {}): void {
  useGameStore.getState().reset()
  const sarah = character({ charId: 'a' })
  const mina = character({ charId: 'b', firstName: 'Mina', lastName: 'Okafor' })
  const kira = character({ charId: 'c', firstName: 'Kira', lastName: 'Weber' })
  const chloe = character({ charId: 'd', firstName: 'Chloe', lastName: 'Dupont' })

  const info: Record<string, CharInfo> = {}
  for (const charId of ['a', 'b', 'c', 'd']) {
    info[charId] = charInfo({ nameKnown: true, ...over[charId] })
  }

  useGameStore.setState({
    date: MONDAY,
    time: 0,
    chars: ['a', 'b', 'c', 'd'],
    characters: charactersById(sarah, mina, kira, chloe),
    charKeyToId: { sarah_rose: 'a', mina_okafor: 'b', kira_weber: 'c', chloe_dupont: 'd' },
    charInfo: info
  })
}

/** Marks everyone met, which is what takes the unmet rungs off the ladder. */
function met(): Partial<CharInfo> {
  return { nameKnown: true, flags: { ...emptyFlags(), hasMet: true } }
}

/**
 * Puts `members` in one another's company at `location`, optionally hosted by one of them, for
 * the seeded slot; an overlay stamped with another slot is inert.
 */
function grouped(members: string[], location: string, host?: string): void {
  useGameStore.setState({
    npcOverlay: {
      date: MONDAY,
      time: 0,
      groups: [{ location, members, ...(host ? { host } : {}) }],
      wentOut: []
    }
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('resolveAttendance', () => {
  it('drops anyone the roster does not have, silently', () => {
    // A charId that is not on the roster is not a character the player could
    // have been told about, so there is nothing to narrate.
    seed()
    expect(resolveAttendance(['a', 'ghost'])).toEqual({ cast: ['a'], notes: [] })
  })

  it('names each character once however often the action named her', () => {
    seed()
    expect(resolveAttendance(['a', 'a', 'b'])).toEqual({ cast: ['a', 'b'], notes: [] })
  })

  it('narrates a busy character out rather than leaving her silently missing', () => {
    seed({ b: { schedule: { 0: 'BIO 210' } } })
    expect(resolveAttendance(['a', 'b'])).toEqual({
      cast: ['a'],
      notes: ["Mina is busy and couldn't come."]
    })
  })

  it('narrates a character away for spring break out, and says which it is', () => {
    // Two different pieces of news: a busy girl is somewhere on campus, and one
    // on spring break is not reachable at all this week.
    seed()
    useGameStore.setState({ date: SPRING_BREAK_LEAVE, springBreakAway: ['b'] })
    expect(resolveAttendance(['a', 'b'])).toEqual({
      cast: ['a'],
      notes: ["Mina is away for spring break and couldn't come."]
    })
  })

  it('stops at the portrait slots and accounts for whoever did not fit', () => {
    seed()
    const { cast, notes } = resolveAttendance(['a', 'b', 'c', 'd'])
    expect(cast).toHaveLength(PORTRAIT_SLOTS)
    expect(notes).toEqual(["Chloe is busy and couldn't come."])
  })

  it('pins the required character to the front, past both tests', () => {
    // She is the reason the scene exists: a hangout without her is not the one
    // that was agreed to, so neither her shift nor a full stage may drop her.
    seed({ d: { schedule: { 0: 'BIO 210' } } })
    const { cast, notes } = resolveAttendance(['a', 'b', 'c'], 'd')
    expect(cast).toEqual(['d', 'a', 'b'])
    expect(notes).toEqual(["Kira is busy and couldn't come."])
  })

  it('lets a workplace visit through the busy test but not past the stage', () => {
    // Being at work is what makes her findable; it does not make room.
    seed({ b: { schedule: { 0: 'BIO 210' } }, c: { schedule: { 0: 'BIO 210' } } })
    expect(resolveAttendance(['a', 'b', 'c'], undefined, ['b'])).toEqual({
      cast: ['a', 'b'],
      notes: ["Kira is busy and couldn't come."]
    })
  })
})

describe('workersAtLocation', () => {
  /** Sarah behind the counter of Cutetea for the slot the seed sits on. */
  function seedWorker(): void {
    seed({ a: { job: { jobId: 'cutetea', shifts: [0] } } })
  }

  it('normalizes case, punctuation and a leading article off both sides', () => {
    seedWorker()
    for (const spelling of ['cutetea', 'CuteTea', 'the CuteTea!', '  CUTETEA  ']) {
      expect(workersAtLocation(spelling), spelling).toHaveLength(1)
    }
  })

  it('reads the employer, its id and its lorebook key as the same place', () => {
    // Three spellings of one workplace, and the classifier reports whichever the
    // sentence used — the employer's name, the catalog id or the lorebook key.
    seed({ a: { job: { jobId: 'kendall_library', shifts: [0] } } })
    for (const spelling of ['Kendall Library', 'kendall_library', 'Kendall']) {
      expect(workersAtLocation(spelling), spelling).toEqual([
        { charId: 'a', jobId: 'kendall_library' }
      ])
    }
  })

  it('matches the whole name and not a word inside it', () => {
    // "Club" and "library" turn up in sentences with nothing to do with Club
    // Apogee or Kendall, and a girl teleporting in on a common noun is a worse
    // failure than one who has to be named.
    seedWorker()
    expect(workersAtLocation('a tea shop downtown')).toEqual([])
    expect(workersAtLocation('club')).toEqual([])
    expect(workersAtLocation('')).toEqual([])
  })

  it('leaves her off the clock outside her own shift', () => {
    seed({ a: { job: { jobId: 'cutetea', shifts: [0] } } })
    useGameStore.setState({ time: 1 })
    expect(workersAtLocation('Cutetea')).toEqual([])
  })
})

describe('admitWorkers', () => {
  it('puts her in the scene whether or not the classifier named her', () => {
    seed({ a: { job: { jobId: 'cutetea', shifts: [0] } } })
    const result = admitWorkers(['b'], 'Cutetea')
    expect(result.cast).toEqual(['b', 'a'])
    expect(result.jobId).toBe('cutetea')
    expect(result.notes).toEqual([workingHereNote('a', 'cutetea')])
  })

  it('drops her silently off a full stage but still reports the workplace', () => {
    // Three people he arranged to meet outrank the girl on shift where they are
    // meeting, and she is standing right there — narrating her absent would be
    // the one thing that reads as a bug.
    seed({ a: { job: { jobId: 'cutetea', shifts: [0] } } })
    const result = admitWorkers(['b', 'c', 'd'], 'Cutetea')
    expect(result.cast).toEqual(['b', 'c', 'd'])
    expect(result.notes).toEqual([])
    expect(result.jobId).toBe('cutetea')
  })
})

describe('pickCast', () => {
  it('draws nobody into a private scene, whoever is free', () => {
    seed()
    expect(pickCast(false)).toEqual([])
  })

  it('draws nobody when everybody is somewhere they have to be', () => {
    seed({
      a: { schedule: { 0: 'BIO 210' } },
      b: { schedule: { 0: 'BIO 210' } },
      c: { schedule: { 0: 'BIO 210' } },
      d: { job: { jobId: 'cutetea', shifts: [0] } }
    })
    expect(pickCast(true)).toEqual([])
  })

  it('draws nobody who has left campus for spring break', () => {
    seed()
    useGameStore.setState({
      date: SPRING_BREAK_LEAVE,
      springBreakAway: ['a', 'b', 'c', 'd']
    })
    vi.spyOn(Math, 'random').mockReturnValue(0)
    expect(pickCast(true)).toEqual([])
  })

  it('never draws more bodies than the stage holds', () => {
    seed()
    // Every roll succeeds, so the loop is bounded only by the stage and the pool.
    vi.spyOn(Math, 'random').mockReturnValue(0)
    expect(pickCast(true)).toHaveLength(PORTRAIT_SLOTS)
  })

  it('meets a stranger first while anyone on the roster is unmet', () => {
    // The first body is drawn at the higher chance and off the unmet rung, which
    // is what stops a playthrough stalling with people he never runs into.
    seed({ a: met(), b: met(), c: met() })
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    expect(pickCast(true)).toEqual(['d'])
  })
})

describe('pickFirstNightCast', () => {
  it('guarantees one stranger, whatever the roll would have said', () => {
    seed()
    vi.spyOn(Math, 'random').mockReturnValue(0.99)
    expect(pickFirstNightCast(true)).toHaveLength(1)
  })

  it('is still private when the scene is', () => {
    seed()
    expect(pickFirstNightCast(false)).toEqual([])
  })
})

describe('injectPasserby', () => {
  it('never walks anyone into a private scene or onto a full stage', () => {
    seed()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    expect(injectPasserby(['a'], false)).toBeNull()
    expect(injectPasserby(['a', 'b', 'c'], true)).toBeNull()
  })

  it('never walks in somebody the scene already has', () => {
    seed()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const walked = injectPasserby(['a', 'b'], true)
    expect(['c', 'd']).toContain(walked)
  })
})

describe('resolveLocationId', () => {
  it('takes a workplace the way the job catalog spells it', () => {
    // The reply is free text, so a model may equally answer with the employer's
    // own name; both roads reach the one id.
    expect(resolveLocationId('CuteTea')).toBe('cutetea')
    expect(resolveLocationId('Kendall Library')).toBe('kendall_library')
    expect(resolveLocationId('the Agora Tutoring Center')).toBe('agora')
  })

  it('is null for a place that is nowhere, and never a substring match', () => {
    expect(resolveLocationId('the beach')).toBeNull()
    expect(resolveLocationId('')).toBeNull()
    expect(resolveLocationId(null)).toBeNull()
    // "club" and "library" turn up in sentences with nothing to do with either.
    expect(resolveLocationId('club')).toBeNull()
    expect(resolveLocationId('a tea shop downtown')).toBeNull()
  })
})

describe('the hidden schedule and the encounter pool', () => {
  it('takes a character at her haunt out of the draw everywhere else', () => {
    // She is at the arcade, so crossing campus does not run into her: that
    // coincidence is exactly what a standing haunt replaces.
    seed({
      a: { ...met(), hiddenSchedule: { 0: { location: 'btb_arcade', kind: 'fun' } } },
      b: { ...met(), hiddenSchedule: { 0: { location: 'cutetea', kind: 'fun' } } },
      c: met(),
      d: met()
    })
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const cast = pickCast(true)
    expect(cast).not.toContain('a')
    expect(cast).not.toContain('b')
    expect(cast.sort()).toEqual(['c', 'd'])
  })

  it('finds a Lowrise resident in her own building, in its shared rooms', () => {
    // Home is not "gone": a public scene in the dorms she lives in can still
    // run into her, and it is a draw rather than a certainty.
    seed({
      a: { ...met(), dorm: 'lowrise_2', hiddenSchedule: { 0: { location: 'room', kind: 'room' } } },
      b: { ...met(), schedule: { 0: 'BIO 210' } },
      c: { ...met(), schedule: { 0: 'BIO 210' } },
      d: { ...met(), schedule: { 0: 'BIO 210' } }
    })
    vi.spyOn(Math, 'random').mockReturnValue(0)
    expect(pickCast(true, 'lowrise_dorms')).toEqual(['a'])
    // Anywhere else, she is simply in for the night.
    expect(pickCast(true, 'btb_arcade')).toEqual([])
    expect(pickCast(true)).toEqual([])
  })

  it('finds an Elysium resident in the village, on the same terms', () => {
    // The townhouses are the second building the reader can walk into, which is
    // what the map's own Go on that bubble now lands on.
    seed({
      a: { ...met(), dorm: 'elysium', hiddenSchedule: { 0: { location: 'room', kind: 'room' } } },
      b: { ...met(), schedule: { 0: 'BIO 210' } },
      c: { ...met(), schedule: { 0: 'BIO 210' } },
      d: { ...met(), schedule: { 0: 'BIO 210' } }
    })
    vi.spyOn(Math, 'random').mockReturnValue(0)
    expect(pickCast(true, 'elysium_village')).toEqual(['a'])
  })

  it('keeps the two buildings apart: each finds only the people who live in it', () => {
    seed({
      a: { ...met(), dorm: 'elysium', hiddenSchedule: { 0: { location: 'room', kind: 'room' } } },
      b: { ...met(), dorm: 'lowrise_2', hiddenSchedule: { 0: { location: 'room', kind: 'room' } } },
      c: { ...met(), schedule: { 0: 'BIO 210' } },
      d: { ...met(), schedule: { 0: 'BIO 210' } }
    })
    vi.spyOn(Math, 'random').mockReturnValue(0)
    expect(pickCast(true, 'elysium_village')).toEqual(['a'])
    expect(pickCast(true, 'lowrise_dorms')).toEqual(['b'])
  })

  it('finds a girl pulled into a room by the building that room is in, not her own', () => {
    seed({
      a: { ...met(), dorm: 'lowrise_2', hiddenSchedule: { 0: { location: 'room', kind: 'room' } } },
      b: { ...met(), dorm: 'elysium', hiddenSchedule: { 0: { location: 'room', kind: 'room' } } },
      c: { ...met(), schedule: { 0: 'BIO 210' } },
      d: { ...met(), schedule: { 0: 'BIO 210' } }
    })
    grouped(['b', 'a'], 'room', 'b')
    vi.spyOn(Math, 'random').mockReturnValue(0)
    expect(pickCast(true, 'elysium_village').sort()).toEqual(['a', 'b'])
    expect(pickCast(true, 'lowrise_dorms')).toEqual([])
  })

  it('ignores a haunt on a slot she is not in it', () => {
    // Her week is sparse: Monday Day is slot 0, and an entry on Tuesday Night
    // says nothing about right now.
    seed({
      a: { ...met(), hiddenSchedule: { 3: { location: 'btb_arcade', kind: 'fun' } } },
      b: met(),
      c: met(),
      d: met()
    })
    vi.spyOn(Math, 'random').mockReturnValue(0)
    expect(pickCast(true)).toContain('a')
  })
})

describe('localsAtLocation', () => {
  it('finds nobody at a place nobody is at, and nobody in a room', () => {
    seed({ a: { hiddenSchedule: { 0: { location: 'room', kind: 'room' } } } })
    expect(localsAtLocation('btb_arcade')).toEqual([])
    expect(localsAtLocation('room')).toEqual([])
    expect(localsAtLocation('')).toEqual([])
  })

  it('does not count somebody a class or a shift outranks', () => {
    seed({
      a: {
        hiddenSchedule: { 0: { location: 'btb_arcade', kind: 'fun' } },
        schedule: { 0: 'BIO 210' }
      },
      b: {
        hiddenSchedule: { 0: { location: 'btb_arcade', kind: 'fun' } },
        job: { jobId: 'cutetea', shifts: [0] }
      }
    })
    expect(localsAtLocation('btb_arcade')).toEqual([])
  })
})

describe('admitLocals', () => {
  it('casts the girl who is there when the reader named nobody', () => {
    seed({ a: { nameKnown: true, hiddenSchedule: { 0: { location: 'btb_arcade', kind: 'fun' } } } })
    const out = admitLocals([], 'btb_arcade', { named: false, inPublic: true })
    expect(out.cast).toEqual(['a'])
    expect(out.notes).toEqual(['They happen to run into Sarah.'])
    expect(out.jobId).toBeNull()
  })

  it('names what the local admitted is doing, at her own haunt', () => {
    seed({
      a: {
        nameKnown: true,
        hiddenSchedule: {
          0: { location: 'btb_arcade', kind: 'activity', doing: 'playing the claw machines at BTB Arcade' }
        }
      }
    })
    const out = admitLocals([], 'btb_arcade', { named: false, inPublic: true })
    expect(out.cast).toEqual(['a'])
    expect(out.notes).toEqual([
      'They happen to run into Sarah. Sarah is playing the claw machines at BTB Arcade.'
    ])
  })

  it('rolls for her when he named somebody, and usually loses', () => {
    seed({ a: { nameKnown: true, hiddenSchedule: { 0: { location: 'btb_arcade', kind: 'fun' } } } })
    vi.spyOn(Math, 'random').mockReturnValue(0.99)
    const missed = admitLocals(['b'], 'btb_arcade', { named: true, inPublic: true })
    expect(missed.cast).toEqual(['b'])
    // A roll that fails is nothing at all — she was never part of the plan, so
    // there is no absence to narrate.
    expect(missed.notes).toEqual([])
  })

  it('leaves the worker rule exactly as it was', () => {
    // She is behind the counter of a public scene, so she joins whether or not he
    // named anyone and whatever the roll says.
    seed({ a: { nameKnown: true, job: { jobId: 'cutetea', shifts: [0] } } })
    vi.spyOn(Math, 'random').mockReturnValue(0.99)
    const out = admitLocals(['b'], 'cutetea', { named: true, inPublic: true })
    expect(out.cast).toEqual(['b', 'a'])
    expect(out.notes).toEqual(['Sarah is here, working a shift at CuteTea.'])
    expect(out.jobId).toBe('cutetea')
  })

  it('drops a local off a full stage, and says nothing about her', () => {
    seed({ d: { nameKnown: true, hiddenSchedule: { 0: { location: 'btb_arcade', kind: 'fun' } } } })
    const out = admitLocals(['a', 'b', 'c'], 'btb_arcade', { named: false, inPublic: true })
    expect(out.cast).toEqual(['a', 'b', 'c'])
    expect(out.notes).toEqual([])
  })

  it('pulls the group-mate of a cast member in past the roll', () => {
    // The overlay has already said these two are spending the hour together,
    // so the girl he asked for cannot be seated without the friend she
    // is out with — whatever the crash roll would have said.
    seed({ a: { nameKnown: true, hiddenSchedule: { 0: { location: 'btb_arcade', kind: 'fun' } } } })
    grouped(['a', 'b'], 'btb_arcade')
    vi.spyOn(Math, 'random').mockReturnValue(0.99)
    const out = admitLocals(['b'], 'btb_arcade', { named: true, inPublic: true })
    expect(out.cast).toEqual(['b', 'a'])
    expect(out.notes).toEqual(['They happen to run into Sarah.'])
  })

  it('still rolls for a local whose group holds nobody in the cast', () => {
    // Being out with somebody is not being out with *him*: a group that shares
    // nothing with the cast is a party to crash, at the ordinary odds.
    seed({ a: { nameKnown: true, hiddenSchedule: { 0: { location: 'btb_arcade', kind: 'fun' } } } })
    grouped(['a', 'c'], 'btb_arcade')
    vi.spyOn(Math, 'random').mockReturnValue(0.99)
    const out = admitLocals(['b'], 'btb_arcade', { named: true, inPublic: true })
    expect(out.cast).toEqual(['b'])
    expect(out.notes).toEqual([])
  })

  it('does not let a crasher pull her own group in behind her', () => {
    // The pull is measured against the cast as the scene arrived at it, so the
    // one seat a won roll buys is hers alone.
    seed({
      a: { nameKnown: true, hiddenSchedule: { 0: { location: 'btb_arcade', kind: 'fun' } } },
      c: { nameKnown: true, hiddenSchedule: { 0: { location: 'btb_arcade', kind: 'fun' } } }
    })
    grouped(['a', 'c'], 'btb_arcade')
    // First local wins her roll, second loses hers: without the snapshot the
    // second would ride in on the first instead of rolling at all.
    const rolls = [0, 0.99]
    vi.spyOn(Math, 'random').mockImplementation(() => rolls.shift() ?? 0.99)
    const out = admitLocals(['b'], 'btb_arcade', { named: true, inPublic: true })
    expect(out.cast).toEqual(['b', 'a'])
  })

  it('drops a group-mate off a full stage, and says nothing about her', () => {
    // A companion is admitted without a roll, not without a seat: the cap is
    // still per body.
    seed({ d: { nameKnown: true, hiddenSchedule: { 0: { location: 'btb_arcade', kind: 'fun' } } } })
    grouped(['d', 'a'], 'btb_arcade')
    const out = admitLocals(['a', 'b', 'c'], 'btb_arcade', { named: true, inPublic: true })
    expect(out.cast).toEqual(['a', 'b', 'c'])
    expect(out.notes).toEqual([])
  })

  it('seats the companion ahead of the crasher on the last free slot', () => {
    seed({
      c: { nameKnown: true, hiddenSchedule: { 0: { location: 'btb_arcade', kind: 'fun' } } },
      d: { nameKnown: true, hiddenSchedule: { 0: { location: 'btb_arcade', kind: 'fun' } } }
    })
    // Chloe is out with Mina, who is cast; Kira is out with nobody in the room
    // but would win her roll. The stage has one slot left, and it is Chloe's.
    grouped(['d', 'b'], 'btb_arcade')
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const out = admitLocals(['a', 'b'], 'btb_arcade', { named: true, inPublic: true })
    expect(out.cast).toEqual(['a', 'b', 'd'])
    expect(out.notes).toEqual(['They happen to run into Chloe.'])
  })

  it('admits nobody at all into a private scene', () => {
    // The reported failure: an evening in a Lowrise room collected the girls who
    // were home in the building, findable through its shared rooms. A
    // private scene's cast is who the classifier put in it and nobody else.
    seed({
      a: {
        nameKnown: true,
        dorm: 'lowrise_2',
        hiddenSchedule: { 0: { location: 'room', kind: 'room' } }
      }
    })
    vi.spyOn(Math, 'random').mockReturnValue(0)
    expect(admitLocals(['b'], 'lowrise_dorms', { named: true, inPublic: false })).toEqual({
      cast: ['b'],
      notes: [],
      jobId: null
    })
    // The same building in public is the draw it always was.
    expect(
      admitLocals(['b'], 'lowrise_dorms', { named: true, inPublic: true }).cast
    ).toEqual(['b', 'a'])
  })

  it('leaves the girl behind the counter out of one too', () => {
    // A workplace read as private is the classifier misfiring, and one rule
    // answers that better than an exception to it: no body, no note, and no
    // employer for the workplace paragraph to describe.
    seed({ a: { nameKnown: true, job: { jobId: 'cutetea', shifts: [0] } } })
    expect(admitLocals(['b'], 'cutetea', { named: true, inPublic: false })).toEqual({
      cast: ['b'],
      notes: [],
      jobId: null
    })
  })
})
