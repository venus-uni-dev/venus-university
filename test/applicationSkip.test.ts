import { describe, expect, it, vi } from 'vitest'
import {
  emptyCatalog,
  NEW_GAME_CALLS,
  type ApplicationContinuation,
  type ApplicationDraft,
  type PlannedOccasion
} from '@shared/application'
import { MAX_CLASS_SIZE, scheduleComplaint } from '@shared/classes'
import { fillPronouns } from '@shared/gender'
import { drawManyFromBag } from '@shared/grabBag'
import { secretText } from '@shared/secrets'
import { shuffle } from '@shared/shuffle'
import type { Character, CharProfile, SemesterCarry } from '@shared/types'
import {
  composeApplication,
  majorsOf,
  type RequestWorld
} from '../src/renderer/stores/applicationCompose'
import {
  dealMajors,
  dealSkips,
  majorsLacking,
  type Deal
} from '../src/renderer/stores/applicationSkip'
import { CLASS_POOLS } from '../src/renderer/prompts/classPool'
import {
  poolLineText,
  PURSUITS,
  SPRING_BREAK_PLANS,
  type PoolLine
} from '../src/renderer/prompts/profilePool'
import { SECRET_POOLS, secretFor } from '../src/renderer/prompts/secretPool'
import { character, charInfo, legalPick } from './fixtures'

/**
 * What a skipped New Game call is filled with: a value of the player's lost under a pool's, a
 * major spelt one way for the catalog and another for the girl, or a dealt catalog that leaves a
 * roster without a legal timetable, is a semester quietly unlike the one set up.
 */

const WORLD: RequestWorld = { setting: 'A campus.', book: [] }

const GALA: PlannedOccasion = { id: 'gala', startDate: 12, endDate: 13, time: 1, seed: 'lantern' }
const FILLER: PlannedOccasion = {
  id: 'filler-3',
  startDate: 22,
  endDate: 22,
  time: 0,
  filler: true,
  seed: 'kite'
}

/** Each pool's first items, in authored order. */
const firstOf: Deal = (_bag, items, count) => items.slice(0, count)

/** Each pool's items at random. */
const anyOf: Deal = (_bag, items, count) => shuffle(items).slice(0, count)

/** Each pool's items off a fresh grab bag, those `accept` passes first. */
const bagged: Deal = (_bag, items, count, keyOf, accept) =>
  drawManyFromBag(items, [], keyOf ?? String, count, Math.random, accept).items

/** A pool's lines as a girl is dealt them. */
const saidOfAGirl = (pool: readonly PoolLine[]): string[] =>
  pool.map((line) => fillPronouns(poolLineText(line), 'female'))

/** An application with every screen passed, every call skipped and nothing written. */
function skippedDraft(roster: readonly Character[], over: Partial<ApplicationDraft> = {}): ApplicationDraft {
  return {
    screen: 'loading',
    season: 'spring',
    chars: roster.map((c) => c.charId),
    plan: [GALA, FILLER],
    occasions: {},
    catalog: emptyCatalog(),
    girls: {},
    pairs: {},
    replies: {},
    skipped: [...NEW_GAME_CALLS],
    ...over
  }
}

/** A skipped draft with its missing majors dealt as Skip deals them, and the fill dealt for it. */
function dealtSkips(
  draft: ApplicationDraft,
  roster: readonly Character[],
  deal: Deal,
  world: RequestWorld = WORLD
) {
  const dealtMajors = { ...draft.dealtMajors, ...dealMajors(majorsLacking(draft, roster), deal) }
  const dealt = { ...draft, dealtMajors }
  return { dealt, fill: dealSkips(dealt, roster, world, deal) }
}

/** The semester a skipped draft composes into, its missing majors dealt first as Skip deals them. */
function composeSkipped(
  draft: ApplicationDraft,
  roster: readonly Character[],
  deal: Deal,
  world: RequestWorld = WORLD
) {
  const { dealt, fill } = dealtSkips(draft, roster, deal, world)
  return composeApplication(dealt, roster, world, fill)
}

describe('a skipped composition', () => {
  const SARAH = character({ charId: 'sarah', firstName: 'Sarah', lastName: 'Rose' })
  const MIA = character({ charId: 'mia', firstName: 'Mia', lastName: 'Park' })
  const ROSTER = [SARAH, MIA]

  it("keeps every value the player set and fills the rest from the pools", () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const draft = skippedDraft(ROSTER, {
      occasions: { gala: { title: 'The Lantern Ball', description: 'In the Quad.' } },
      girls: {
        sarah: {
          profile: { job: { jobId: 'cutetea', count: 2 }, handle: 'sarah.r', dorm: 'elysium' },
          secrets: { friendly: 'Sarah knits' },
          memories: []
        },
        mia: { profile: { major: 'biology' }, secrets: {}, memories: [] }
      },
      // Dealt to the earlier girl in the spelling the player's later one differs from.
      dealtMajors: { sarah: 'Biology' }
    })

    const semester = composeSkipped(draft, ROSTER, firstOf)

    expect(semester.occasions.map((o) => o.id)).toEqual(['gala', 'filler-3'])
    expect(semester.occasions[0].title).toBe('The Lantern Ball')
    // The catalog's call and the girls read the one spelling the player wrote.
    expect(majorsOf(draft, ROSTER, WORLD)).toEqual({ sarah: 'biology', mia: 'biology' })
    expect(semester.schedules.perChar.sarah.major).toBe('biology')
    expect(semester.schedules.perChar.mia.major).toBe('biology')
    // Her Elysium dorm makes her at least a junior.
    expect(semester.schedules.perChar.sarah.dorm).toBe('elysium')
    expect(semester.schedules.perChar.sarah.year).toBeGreaterThanOrEqual(3)
    expect(semester.jobs.sarah).toEqual({ jobId: 'cutetea', count: 2 })
    expect(semester.feeds.sarah.handle).toBe('sarah.r')
    expect(semester.secrets.sarah.map((s) => s.tier)).toEqual(['friendly', 'trusted', 'devoted'])
    expect(semester.secrets.sarah[0].text).toBe('Sarah knits.')
    expect(semester.secrets.sarah[1].text).toContain('Sarah')
    expect(semester.secrets.mia).toHaveLength(3)
    vi.restoreAllMocks()
  })

  it('rolls every blank inside the rules a profile keeps', () => {
    for (let run = 0; run < 200; run++) {
      const semester = composeSkipped(skippedDraft(ROSTER), ROSTER, anyOf)
      for (const c of ROSTER) {
        const { year, dorm } = semester.schedules.perChar[c.charId]
        expect(year).toBeGreaterThanOrEqual(1)
        expect(year).toBeLessThanOrEqual(4)
        if (dorm === 'elysium') expect(year).toBeGreaterThanOrEqual(3)
        const job = semester.jobs[c.charId]
        if (job) expect([1, 2]).toContain(job.count)
        expect(semester.feeds[c.charId].winterPosts).toEqual([])
        expect(semester.feeds[c.charId].handle).not.toBe('')
        expect(semester.springBreakPlans[c.charId]).toMatch(/\.$/)
      }
    }
  })
})

describe('a skipped catalog', () => {
  const NAMES = [
    'Ada', 'Bea', 'Cleo', 'Dina', 'Eve', 'Fay', 'Gia', 'Hana', 'Iris', 'June', 'Kira', 'Lena'
  ]
  const ROSTER = NAMES.map((firstName, i) =>
    character({ charId: `c${i}`, firstName, lastName: 'Vale' })
  )

  it('gives a whole roster a legal timetable, whatever loads the player set', () => {
    for (let run = 0; run < 60; run++) {
      // A third of the girls at the heaviest load there is, the rest left to the pools.
      const girls = Object.fromEntries(
        ROSTER.filter((_c, i) => i % 3 === 0).map((c) => [
          c.charId,
          { profile: { classesTaken: 6, majorClassesTaken: 3 }, secrets: {}, memories: [] }
        ])
      )
      const { schedules } = composeSkipped(skippedDraft(ROSTER, { girls }), ROSTER, anyOf)

      expect(scheduleComplaint(legalPick(schedules.classes), schedules.classes)).toBeNull()
      const seats = new Map<string, number>()
      for (const c of ROSTER) {
        const codes = Object.values(schedules.perChar[c.charId].schedule)
        const load = c.charId in girls ? 6 : 4
        expect(codes.length).toBeLessThanOrEqual(load)
        const taken = codes.map((code) => schedules.classes[code])
        expect(taken.every(Boolean)).toBe(true)
        expect(taken.some((entry) => entry.category === 'pe')).toBe(true)
        expect(taken.some((entry) => entry.category === 'interest')).toBe(true)
        for (const code of codes) seats.set(code, (seats.get(code) ?? 0) + 1)
      }
      for (const count of seats.values()) expect(count).toBeLessThanOrEqual(MAX_CLASS_SIZE)
      // Her own interest class is seated before anything else, so every girl's is kept.
      const interests = Object.values(schedules.classes).filter((entry) => entry.category === 'interest')
      expect(interests).toHaveLength(ROSTER.length)
    }
  })
})

describe('a skipped later semester', () => {
  const ANNA = character({ charId: 'anna', firstName: 'Anna', lastName: 'Bell' })
  const LIV = character({ charId: 'liv', firstName: 'Liv', lastName: 'Dunn' })
  const OLIVE = character({ charId: 'olive', firstName: 'Olive', lastName: 'Gray' })
  const GRACE = character({ charId: 'grace', firstName: 'Grace', lastName: 'Ivy' })
  const ROSTER = [ANNA, LIV]
  const LATER_WORLD: RequestWorld = { ...WORLD, graduates: [OLIVE, GRACE] }

  /** A settled profile from the semester before. */
  const prior = (over: Partial<CharProfile>): CharProfile => ({
    year: 4,
    dorm: 'lowrise_1',
    major: 'History',
    schedule: {},
    ...over
  })

  /** Every devoted secret but the last, which Anna has already told. */
  const TOLD = SECRET_POOLS.devoted
    .slice(0, -1)
    .map((line) => secretFor(poolLineText(line), 'Anna', 'female'))

  /** A later spring, every call skipped, the classes the semesters before it ran as `taken`. */
  function laterDraft(taken: ApplicationContinuation['taken'] = []): ApplicationDraft {
    return skippedDraft(ROSTER, {
      continued: {
        id: 'later',
        index: 2,
        continuing: ['anna'],
        graduated: ['grace'],
        alumni: ['olive', 'grace'],
        priorProfiles: {
          anna: prior({ year: 2, major: 'Biology', schedule: { 0: 'BIO 101' }, handle: 'anna.b' }),
          olive: prior({ major: 'Art', pursuing: 'teaching in Seoul' }),
          grace: prior({})
        },
        jobs: {},
        haunts: {
          anna: { homeSlots: 2, study: null, fun: [], activity: null, meal: null }
        },
        majorLoads: { anna: 1 },
        carry: { charInfo: { anna: charInfo({ toldSecrets: TOLD }) } } as unknown as SemesterCarry,
        taken
      }
    })
  }

  it('composes with no break posts, a returning girl dealt her spring break', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const semester = composeSkipped(laterDraft(), ROSTER, anyOf, LATER_WORLD)
    for (const charId of ['anna', 'liv', 'olive', 'grace']) {
      expect(semester.feeds[charId].winterPosts).toEqual([])
    }
    expect(semester.feeds.anna.handle).toBe('anna.b')
    expect(saidOfAGirl(SPRING_BREAK_PLANS)).toContain(semester.springBreakPlans.anna)
    vi.restoreAllMocks()
  })

  it('never deals a returning girl a secret she already holds', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const last = secretFor(
      poolLineText(SECRET_POOLS.devoted[SECRET_POOLS.devoted.length - 1]),
      'Anna',
      'female'
    )
    for (let run = 0; run < 20; run++) {
      const semester = composeSkipped(laterDraft(), ROSTER, bagged, LATER_WORLD)
      expect(semester.secrets.anna).toEqual([{ text: secretText(last), tier: 'devoted' }])
    }
    vi.restoreAllMocks()
  })

  it("deals a life to the girl just graduated and leaves an older graduate's as it was", () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { fill } = dealtSkips(laterDraft(), ROSTER, anyOf, LATER_WORLD)
    expect(Object.keys(fill.pursuits)).toEqual(['grace'])
    const semester = composeSkipped(laterDraft(), ROSTER, anyOf, LATER_WORLD)
    expect(saidOfAGirl(PURSUITS)).toContain(semester.pursuits?.grace)
    expect(semester.pursuits?.olive).toBe('teaching in Seoul')
    vi.restoreAllMocks()
  })

  it('keeps a dealt catalog off the classes already run while a pool has others', () => {
    // Half of every pool already run.
    const taken = Object.values(CLASS_POOLS).flatMap((pool) =>
      pool
        .slice(0, Math.floor(pool.length / 2))
        .map((entry) => ({ code: entry.code, name: entry.title }))
    )
    const takenCodes = new Set(taken.map((entry) => entry.code))
    for (let run = 0; run < 20; run++) {
      const classes = dealtSkips(laterDraft(taken), ROSTER, bagged, LATER_WORLD).fill.classes
      const dealt = [
        ...Object.values(classes?.pools ?? {}).flat(),
        ...(classes?.open ?? []),
        ...Object.values(classes?.interest ?? {})
      ]
      expect(dealt.length).toBeGreaterThan(0)
      for (const entry of dealt) expect(takenCodes.has(entry.code)).toBe(false)
    }
  })
})

describe('a skipped roster of both genders', () => {
  const BEN = character({ charId: 'ben', firstName: 'Ben', lastName: 'Cole', gender: 'male' })
  const MAX = character({ charId: 'max', firstName: 'Max', lastName: 'Hale', gender: 'male' })
  const NORA = character({ charId: 'nora', firstName: 'Nora', lastName: 'Lane' })
  const OWEN = character({ charId: 'owen', firstName: 'Owen', lastName: 'Park', gender: 'male' })
  const ROSTER = [BEN, MAX, NORA]
  const LATER_WORLD: RequestWorld = { ...WORLD, graduates: [OWEN] }

  /** Whether a pooled item is marked as fitting one gender alone. */
  const marked = (item: unknown): boolean =>
    typeof item === 'object' && item !== null && 'gender' in item

  /** Every pooled line that fits a girl alone, said of one guy. */
  const girlsOnly = (firstName: string): Set<string> =>
    new Set(
      [...Object.values(SECRET_POOLS).flat(), ...SPRING_BREAK_PLANS, ...PURSUITS]
        .filter((line) => typeof line !== 'string' && line.gender === 'female')
        .map((line) => fillPronouns(poolLineText(line), 'male', firstName))
    )

  /** Each pool's marked lines first, whatever `accept` passes: the worst a shortfall can deal. */
  const markedFirst: Deal = (_bag, items, count) =>
    [...items.filter(marked), ...items.filter((item) => !marked(item))].slice(0, count)

  /** A later spring, every call skipped: Ben returning and owed every tier, Owen just graduated. */
  const draft = skippedDraft(ROSTER, {
    continued: {
      id: 'later',
      index: 2,
      continuing: ['ben'],
      graduated: ['owen'],
      alumni: ['owen'],
      priorProfiles: {
        ben: { year: 2, dorm: 'lowrise_1', major: 'History', schedule: {}, handle: 'ben.c' },
        owen: { year: 4, dorm: 'lowrise_2', major: 'Art', schedule: {} }
      },
      jobs: {},
      haunts: { ben: { homeSlots: 2, study: null, fun: [], activity: null, meal: null } },
      majorLoads: { ben: 1 },
      carry: { charInfo: { ben: charInfo() } } as unknown as SemesterCarry,
      taken: []
    }
  })

  it('never deals a guy a line that fits a girl alone, and leaves no token in any line', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (const deal of [markedFirst, firstOf, bagged, anyOf]) {
      for (let run = 0; run < 20; run++) {
        const { fill } = dealtSkips(draft, ROSTER, deal, LATER_WORLD)
        /** Every pooled line one character was dealt. */
        const lines = (charId: string): string[] =>
          [
            ...Object.values(fill.secrets[charId] ?? {}),
            fill.profiles[charId]?.springBreakPlans,
            fill.profiles[charId]?.activity?.doing,
            fill.springBreakPlans[charId],
            fill.pursuits[charId]
          ].filter((line): line is string => typeof line === 'string')

        for (const guy of [BEN, MAX, OWEN]) {
          expect(lines(guy.charId).length).toBeGreaterThan(0)
          const banned = girlsOnly(guy.firstName)
          for (const line of lines(guy.charId)) expect(banned.has(line)).toBe(false)
        }
        for (const c of [BEN, MAX, NORA, OWEN]) {
          for (const line of lines(c.charId)) expect(line).not.toMatch(/\{\w+\}/)
        }
      }
    }
    vi.restoreAllMocks()
  })
})
