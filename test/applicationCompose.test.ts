import { describe, expect, it, vi } from 'vitest'
import {
  emptyCatalog,
  incompleteOf,
  type ApplicationContinuation,
  type ApplicationDraft,
  type NewGameCall,
  type PlannedOccasion
} from '@shared/application'
import type { CharProfile, SemesterCarry } from '@shared/types'
import {
  composeApplication,
  majorsOf,
  needOf,
  type CallPart,
  type RequestWorld
} from '../src/renderer/stores/applicationCompose'
import {
  decidedProfileOf,
  validateProfileDraft,
  type ProfileGenReply
} from '../src/renderer/prompts/profilePrompt'
import { character, charInfo } from './fixtures'

/**
 * What New Game composes out of its banked parts and the player's own values, and when a banked
 * part still answers its call: a value of the player's lost at the merge, or a part kept for a
 * request it no longer answers, is a semester quietly unlike the one set up.
 */

const SARAH = character({ charId: 'sarah', firstName: 'Sarah', lastName: 'Rose' })
const MIA = character({ charId: 'mia', firstName: 'Mia', lastName: 'Park' })
const ROSTER = [SARAH, MIA]
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

/** An application with every screen passed and nothing written. */
function draftOf(over: Partial<ApplicationDraft> = {}): ApplicationDraft {
  return {
    screen: 'loading',
    season: 'spring',
    chars: ROSTER.map((c) => c.charId),
    plan: [GALA, FILLER],
    occasions: {},
    catalog: emptyCatalog(),
    girls: {},
    pairs: {},
    replies: {},
    ...over
  }
}

/** The schema a request carries, loosely typed for reading back. */
type Schema = { properties: Record<string, any>; required: string[] }
const schemaOf = (part: CallPart): Schema => part.request.schema.schema as unknown as Schema

/** The parts a call needs as `draft` stands, on `roster` in `world`. */
function partsOf(
  call: NewGameCall,
  draft: ApplicationDraft,
  roster = ROSTER,
  world = WORLD
): CallPart[] {
  const need = needOf(call, draft, roster, world)
  return need === 'none' ? [] : need.parts
}

/** The occasion ids a draft's occasions call asks the model to write. */
function askedIds(draft: ApplicationDraft): string[] {
  return schemaOf(partsOf('occasions', draft)[0]).properties.events.required
}

/** What a student's or a later semester's part answers in each field it asks. */
const FIELDS: Record<string, unknown> = {
  year: 2,
  classesTaken: 4,
  majorClassesTaken: 2,
  dorm: 'lowrise',
  job: '',
  jobShifts: 0,
  homeSlots: 2,
  study: '',
  fun: [],
  activity: '',
  activityLocation: '',
  meal: '',
  handle: 'handle',
  winterPosts: ['home'],
  springBreakPlans: 'Go home.',
  breakPosts: ['home'],
  pursuing: '',
  friendly: 'She sings.',
  trusted: 'She cried.',
  devoted: 'She ran.'
}

/** Two courses a pool's or a major's part writes, coded off the part so no two parts share one. */
function coursesOf(part: CallPart, count = 2): Record<string, unknown>[] {
  const prefix = part.id.split(':').slice(1).join('').slice(-4).toUpperCase()
  return Array.from({ length: count }, (_, i) => ({
    code: `${prefix} ${200 + i}`,
    name: `${prefix} ${i}`,
    description: 'Study.',
    kind: 'lecture'
  }))
}

/** The plain answer to any part: every field filled, every major Art. */
function answerOf(part: CallPart): unknown {
  const { properties, required } = schemaOf(part)
  switch (part.request.schema.name) {
    case 'calendar_occasions':
      return {
        events: Object.fromEntries(
          properties.events.required.map((id: string) => [id, { title: id, description: 'On.' }])
        )
      }
    case 'student_majors':
      return {
        characters: properties.characters.items.properties.key.enum.map((key: string) => ({
          key,
          major: 'Art'
        }))
      }
    case 'pool_classes':
    case 'major_classes':
      return { classes: coursesOf(part) }
    case 'interest_class':
      return { interestClass: { ...coursesOf(part, 1)[0], kind: 'project' } }
    default:
      return Object.fromEntries(required.map((field) => [field, FIELDS[field]]))
  }
}

/**
 * The draft with every part of `call` not yet banked banked, `answers` standing over the plain
 * answer by part id.
 */
function banked(
  call: NewGameCall,
  draft: ApplicationDraft,
  answers: Record<string, unknown> = {},
  roster = ROSTER,
  world = WORLD
): ApplicationDraft {
  const replies = { ...draft.replies }
  for (const part of partsOf(call, draft, roster, world)) {
    if (replies[part.id]?.key === part.key) continue
    const reply = part.id in answers ? answers[part.id] : answerOf(part)
    part.check(reply)
    replies[part.id] = { key: part.key, reply }
  }
  return { ...draft, replies }
}

/** A whole profile row as the model wrote one before profiles went in parts. */
function profileRow(key: string, major: string): Record<string, unknown> {
  return {
    key,
    year: 2,
    major,
    classesTaken: 4,
    majorClassesTaken: 2,
    dorm: 'lowrise_2',
    job: '',
    jobShifts: 0,
    homeSlots: 2,
    study: '',
    fun: [],
    activity: '',
    activityLocation: '',
    meal: '',
    handle: key,
    winterPosts: ['home'],
    springBreakPlans: 'Go home.'
  }
}

describe('composeApplication', () => {
  it("lays the player's values over every part and seats every girl", () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    let draft = draftOf({
      occasions: { gala: { title: 'The Lantern Ball', description: 'In the Quad.' } },
      catalog: {
        ...emptyCatalog(),
        major: {
          Biology: [{ code: 'BIO 210', title: 'Cells', description: 'Cells.', kind: 'lecture' }]
        }
      },
      girls: {
        sarah: {
          profile: { major: 'Biology', majorClassesTaken: 1, year: 3 },
          secrets: { friendly: 'Sarah knits' },
          memories: [],
          notes: '  Sarah is pre-med. '
        },
        mia: { profile: {}, secrets: {}, memories: [], notes: '   ' }
      }
    })

    // The gala is the player's, so only the filler is asked for.
    expect(askedIds(draft)).toEqual([FILLER.id])
    draft = banked('occasions', draft, {
      occasions: { events: { 'filler-3': { title: 'Kite Day', description: 'Kites on the Quad.' } } }
    })
    // Only Mia's major is left to the majors part, and her part waits on it.
    expect(partsOf('profiles', draft).map((part) => part.id)).toEqual([
      'profiles:majors',
      'profiles:student:sarah'
    ])
    draft = banked('profiles', draft, {
      'profiles:majors': { characters: [{ key: 'mia_park', major: 'Chemistry' }] },
      'profiles:student:sarah': { ...answerOf(partsOf('profiles', draft)[1]) as object, trusted: 'Sarah lied.', devoted: 'Sarah left.' }
    })
    draft = banked('profiles', draft)
    // Biology is the player's but for three, so its part writes those; Chemistry is whole.
    const classParts = partsOf('classes', draft)
    expect(classParts.map((part) => part.id)).toEqual([
      'classes:pool:pe',
      'classes:pool:humanities',
      'classes:pool:arts',
      'classes:pool:misc',
      'classes:major:Biology',
      'classes:major:Chemistry',
      'classes:interest:sarah',
      'classes:interest:mia'
    ])
    expect(classParts[4].request.user).toContain('Create 3 classes for the Biology major.')
    draft = banked('classes', draft, {
      'classes:major:Biology': {
        classes: [{ code: 'BIO 210', name: 'Genes', description: 'Genes.', kind: 'lecture' }]
      }
    })

    const semester = composeApplication(draft, ROSTER, WORLD)

    expect(semester.occasions.map((o) => o.title)).toEqual(['The Lantern Ball', 'Kite Day'])
    expect(semester.schedules.perChar.sarah).toMatchObject({ year: 3, major: 'Biology' })
    expect(semester.schedules.perChar.mia.major).toBe('Chemistry')
    // One Biology class, the player's load; the player's kept its code over the part's repeat.
    const sarahs = Object.values(semester.schedules.perChar.sarah.schedule)
    const majorClasses = sarahs.filter(
      (code) => semester.schedules.classes[code]?.category === 'major'
    )
    expect(majorClasses).toHaveLength(1)
    const named = { 'BIO 210': 'Cells', 'BIO 211': 'Genes' } as Record<string, string>
    expect(semester.schedules.classes[majorClasses[0]].name).toBe(named[majorClasses[0]])
    expect(semester.secrets.sarah).toEqual([
      { text: 'Sarah knits.', tier: 'friendly' },
      { text: 'Sarah lied.', tier: 'trusted' },
      { text: 'Sarah left.', tier: 'devoted' }
    ])
    // Her notes are carried trimmed without making her met; blank ones are not carried.
    expect(semester.notes).toEqual({ sarah: 'Sarah is pre-med.' })
    expect(semester.starts.sarah).toBeUndefined()
    for (const c of ROSTER) {
      expect(Object.keys(semester.schedules.perChar[c.charId].schedule).length).toBeGreaterThan(0)
    }
    vi.restoreAllMocks()
  })

  it('keeps every part as it was while the others bank, spells a generated major as the player did, and deals the Lowrises evenly', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const five = ['ana', 'bea', 'cat', 'dee', 'eve'].map((name) =>
      character({ charId: name, firstName: name[0].toUpperCase() + name.slice(1), lastName: 'Lowe' })
    )
    const world: RequestWorld = { setting: 'A campus.', book: [] }
    let draft = draftOf({
      chars: five.map((c) => c.charId),
      girls: {
        cat: { profile: { major: 'Biology' }, secrets: {}, memories: [] },
        eve: { profile: { dorm: 'lowrise_1' }, secrets: {}, memories: [] }
      }
    })
    const keys = (call: NewGameCall): Record<string, string> =>
      Object.fromEntries(partsOf(call, draft, five, world).map((part) => [part.id, part.key]))

    // Cat's major is hers, so her part goes at once; the rest wait on the majors part.
    expect(Object.keys(keys('profiles'))).toEqual(['profiles:majors', 'profiles:student:cat'])
    const pools = keys('classes')
    draft = banked('profiles', draft, {
      'profiles:majors': {
        characters: ['ana_lowe', 'bea_lowe', 'dee_lowe', 'eve_lowe'].map((key, i) => ({
          key,
          major: i === 0 ? 'biology' : 'Art'
        }))
      }
    }, five, world)
    expect(majorsOf(draft, five, world)).toEqual({
      ana: 'Biology',
      bea: 'Art',
      cat: 'Biology',
      dee: 'Art',
      eve: 'Art'
    })
    const students = keys('profiles')
    // The pools never waited on the majors, and keep their requests now they are known.
    expect(Object.fromEntries(Object.entries(keys('classes')).filter(([id]) => id in pools))).toEqual(pools)
    expect(Object.keys(keys('classes')).filter((id) => id.startsWith('classes:major:'))).toEqual([
      'classes:major:Art',
      'classes:major:Biology'
    ])

    // Banking one student's part changes nobody else's.
    const [ana] = partsOf('profiles', draft, five, world).filter((p) => p.id === 'profiles:student:ana')
    draft = { ...draft, replies: { ...draft.replies, [ana.id]: { key: ana.key, reply: answerOf(ana) } } }
    expect(keys('profiles')).toEqual(students)

    draft = banked('occasions', draft, {}, five, world)
    draft = banked('profiles', draft, {}, five, world)
    draft = banked('classes', draft, {}, five, world)
    const semester = composeApplication(draft, five, world)
    expect(five.map((c) => semester.schedules.perChar[c.charId].dorm)).toEqual([
      'lowrise_2',
      'lowrise_3',
      'lowrise_4',
      'lowrise_5',
      'lowrise_1'
    ])
    expect(semester.schedules.perChar.ana.major).toBe('Biology')
    vi.restoreAllMocks()
  })

  it('lifts a generated year to what her decided dorm allows', () => {
    const decided = {
      mia_park: decidedProfileOf({ dorm: 'elysium' })
    }
    const reply = {
      characters: [
        { ...profileRow('sarah_rose', 'Art'), year: 1 },
        { ...profileRow('mia_park', 'Art'), year: 1 }
      ]
    }
    const profiles = validateProfileDraft(reply as unknown as ProfileGenReply, ROSTER, decided)
    expect(profiles.characters.mia_park).toMatchObject({ year: 3, dorm: 'elysium' })
    expect(profiles.characters.sarah_rose).toMatchObject({ year: 1 })
  })

  it('generates a half-written entry whole and names it as incomplete', () => {
    const draft = draftOf({ occasions: { gala: { title: 'The Lantern Ball', description: ' ' } } })
    expect(askedIds(draft)).toEqual([GALA.id, FILLER.id])
    expect(incompleteOf(draft, 'occasions')).toEqual([{ kind: 'occasion', id: 'gala' }])
  })
})

describe('a later semester', () => {
  const ANNA = character({ charId: 'anna', firstName: 'Anna', lastName: 'Bell' })
  const JUNE = character({ charId: 'june', firstName: 'June', lastName: 'Cole' })
  const LIV = character({ charId: 'liv', firstName: 'Liv', lastName: 'Dunn' })
  const OLIVE = character({ charId: 'olive', firstName: 'Olive', lastName: 'Gray' })
  const PIA = character({ charId: 'pia', firstName: 'Pia', lastName: 'Hart' })
  const GRACE = character({ charId: 'grace', firstName: 'Grace', lastName: 'Ivy' })
  const LATER = [ANNA, JUNE, LIV]
  const LATER_WORLD: RequestWorld = { ...WORLD, graduates: [OLIVE, PIA, GRACE] }

  /** A settled profile from the semester before. */
  const prior = (over: Partial<CharProfile>): CharProfile => ({
    year: 4,
    dorm: 'lowrise_1',
    major: 'History',
    schedule: {},
    ...over
  })

  const CONTINUED: ApplicationContinuation = {
    id: 'later',
    index: 2,
    continuing: ['anna'],
    graduated: ['grace'],
    alumni: ['olive', 'pia', 'grace'],
    priorProfiles: {
      anna: prior({
        year: 2,
        dorm: 'lowrise_3',
        major: 'Biology',
        schedule: { 0: 'BIO 101', 3: 'ENG 101', 5: 'PE 101', 7: 'BIO 102' },
        handle: 'anna.b'
      }),
      olive: prior({ major: 'Art', pursuing: 'teaching in Seoul' }),
      pia: prior({ major: 'Music', pursuing: 'nursing in Ohio' }),
      grace: prior({ major: 'History' })
    },
    jobs: { anna: { jobId: 'cutetea', count: 2 } },
    haunts: {
      anna: { homeSlots: 2, study: 'kendall_library', fun: [], activity: null, meal: null }
    },
    majorLoads: { anna: 2 },
    carry: {
      charInfo: { anna: charInfo({ secrets: [{ text: 'Anna lied.', tier: 'friendly' }] }) }
    } as unknown as SemesterCarry,
    taken: [
      { code: 'BIO 101', name: 'Cells', category: 'major', major: 'Biology' },
      { code: 'ART 101', name: 'Pots', category: 'interest' }
    ]
  }

  /** A later fall with June decided in full and Liv's major alone. */
  function laterDraft(over: Partial<ApplicationDraft> = {}): ApplicationDraft {
    return {
      screen: 'loading',
      season: 'fall',
      chars: LATER.map((c) => c.charId),
      plan: [],
      occasions: {},
      catalog: emptyCatalog(),
      girls: {
        june: {
          profile: {
            year: 1,
            major: 'biology',
            classesTaken: 4,
            majorClassesTaken: 1,
            job: null,
            dorm: 'lowrise_2',
            homeSlots: 2,
            study: null,
            fun: [],
            activity: null,
            meal: null,
            handle: 'june.c'
          },
          secrets: {},
          memories: []
        },
        liv: { profile: { major: 'Physics' }, secrets: {}, memories: [] }
      },
      pairs: {},
      replies: {},
      continued: CONTINUED,
      pursuits: { grace: 'Teaching in Japan.', olive: 'Running for mayor.' },
      ...over
    }
  }

  const later = (call: NewGameCall, draft: ApplicationDraft): CallPart[] =>
    partsOf(call, draft, LATER, LATER_WORLD)
  const bankedLater = (call: NewGameCall, draft: ApplicationDraft, answers = {}) =>
    banked(call, draft, answers, LATER, LATER_WORLD)

  const PROFILE_ANSWERS = {
    'profiles:returning:anna': { breakPosts: ['beach day'], devoted: 'Anna ran away once.' },
    'profiles:graduate:olive': { pursuing: 'Running a gallery in Rome', breakPosts: ['ciao'] },
    'profiles:graduate:pia': { pursuing: '', breakPosts: [] },
    'profiles:graduate:grace': { pursuing: 'selling boats', breakPosts: ['hi'] }
  }

  it("asks a part of each new girl with a blank, each returning girl and each graduate, with a graduate's own words", () => {
    const parts = later('profiles', laterDraft())
    expect(parts.map((part) => part.id)).toEqual([
      'profiles:student:june',
      'profiles:student:liv',
      'profiles:returning:anna',
      'profiles:graduate:olive',
      'profiles:graduate:pia',
      'profiles:graduate:grace'
    ])
    // June decided every field, so her part asks only her secrets.
    expect(schemaOf(parts[0]).required).toEqual(['friendly', 'trusted', 'devoted'])
    // A returning girl who holds a secret is owed only her deepest.
    expect(schemaOf(parts[2]).required).toEqual(['breakPosts', 'devoted'])
    expect(parts[5].request.user).toContain('"Teaching in Japan."')
    // Only a girl who graduated at this ending is the player's to write.
    expect(parts[3].request.user).not.toContain('Running for mayor.')
    // A major's part sees only its own history.
    const biology = later('classes', laterDraft()).find((part) => part.id === 'classes:major:Biology')
    expect(biology?.request.user).toContain('BIO 101 — Cells')
    expect(biology?.request.user).not.toContain('ART 101')
  })

  it("reads the catalog the same before and after the profile parts, a new girl's major spelt as a returning one's", () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    let draft = laterDraft()
    const before = later('classes', draft).map((part) => part.key)
    expect(majorsOf(draft, LATER, LATER_WORLD)).toEqual({
      anna: 'Biology',
      june: 'Biology',
      liv: 'Physics'
    })
    draft = bankedLater('profiles', draft, PROFILE_ANSWERS)
    expect(later('classes', draft).map((part) => part.key)).toEqual(before)
    vi.restoreAllMocks()
  })

  it('keeps what a returning girl carries and gives her and the graduates only what is new', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    let draft = laterDraft()
    draft = bankedLater('profiles', draft, PROFILE_ANSWERS)
    const majorCourses = (part: CallPart) => ({ classes: coursesOf(part, 4) })
    draft = bankedLater(
      'classes',
      draft,
      Object.fromEntries(
        later('classes', draft)
          .filter((part) => part.id.startsWith('classes:major:'))
          .map((part) => [part.id, majorCourses(part)])
      )
    )

    const semester = composeApplication(draft, LATER, LATER_WORLD)

    // Her four classes and the two of them in her major.
    expect(semester.schedules.perChar.anna).toMatchObject({
      year: 2,
      dorm: 'lowrise_3',
      major: 'Biology'
    })
    const annas = Object.values(semester.schedules.perChar.anna.schedule)
    expect(annas).toHaveLength(4)
    const inMajor = annas.filter((code) => semester.schedules.classes[code].category === 'major')
    expect(inMajor).toHaveLength(2)
    expect(semester.jobs.anna).toEqual(CONTINUED.jobs.anna)
    expect(semester.haunts.anna).toEqual(CONTINUED.haunts.anna)
    expect(semester.feeds.anna).toEqual({ handle: 'anna.b', winterPosts: ['beach day'] })
    expect(semester.feeds.olive.winterPosts).toEqual(['ciao'])
    expect(semester.feeds.pia.winterPosts).toEqual([])
    expect(semester.feeds.liv.winterPosts).toEqual([])
    expect(semester.pursuits).toEqual({
      olive: 'running a gallery in Rome',
      pia: 'nursing in Ohio',
      grace: 'teaching in Japan'
    })
    expect(semester.secrets.anna).toEqual([{ text: 'Anna ran away once.', tier: 'devoted' }])
    expect(semester.secrets.june).toEqual([
      { text: 'She sings.', tier: 'friendly' },
      { text: 'She cried.', tier: 'trusted' },
      { text: 'She ran.', tier: 'devoted' }
    ])
    vi.restoreAllMocks()
  })
})
