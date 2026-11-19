import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  emptyCatalog,
  type Application,
  type ApplicationScreen,
  type CatalogEntries
} from '@shared/application'
import { appError } from '@shared/errors'
import { DEFAULT_PLAYER_STATS } from '@shared/playerStats'
import { sha256Hex } from '@shared/sha256'
import type { Result, SemesterCarry, SemesterHandoff, StructuredRequest } from '@shared/types'
import type { Continuation } from '../src/renderer/stores/newGame'
import { character, playthroughRecord, restoreApi, stubApi } from './fixtures'

// The character store, read for the roster, reaches `jobStore`, which subscribes to
// `jobs:progress` at module scope — so the bridge has to exist before the import.
stubApi({ jobs: { onProgress: () => () => {} } })
const {
  applicationKept,
  applicationSettled,
  backCosts,
  backScreen,
  beginApplication,
  beginNextApplication,
  CALL_LABELS,
  discardCallsFrom,
  keepApplication,
  leaveApplication,
  openApplication,
  openFinalize,
  passScreen,
  revealPick,
  sealApplication,
  sendCalls,
  settledOutcome,
  updateApplication,
  updateFinalEdits,
  useApplicationStore
} = await import('../src/renderer/stores/applicationStore')
const { withFinalOccasion } = await import('../src/renderer/stores/applicationFinalize')
const { useCharacterStore } = await import('../src/renderer/stores/characterStore')
const { useLorebookStore, lorebookSettled } = await import('../src/renderer/stores/lorebookStore')

/**
 * When New Game's calls go out, what each reply is kept against, and what leaving stops: a
 * reply kept for a request it no longer answers, or a call paid for twice, is a semester
 * unlike the one the player set up.
 */

const SARAH = character({ charId: 'sarah', firstName: 'Sarah', lastName: 'Rose' })
const ROSTER = [SARAH]

/** A fresh application with every screen passed, and its wait. */
function startApplication(roster: typeof ROSTER): ReturnType<typeof settledOutcome> {
  beginApplication(roster, 'spring', 'loading')
  sendCalls()
  return settledOutcome()
}

/** The hash a reply is banked under. */
const keyOf = (request: StructuredRequest): string =>
  sha256Hex(JSON.stringify([request.system, request.user, request.schema]))

/** The schema a request carries, loosely typed for reading back. */
type Schema = { properties: Record<string, any> }
const schemaOf = (request: StructuredRequest): Schema =>
  request.schema.schema as unknown as Schema

/** An answer naming every occasion the request asked for. */
function occasionAnswer(request: StructuredRequest): Result<unknown> {
  const ids: string[] = schemaOf(request).properties.events.required
  return {
    ok: true,
    data: { events: Object.fromEntries(ids.map((id) => [id, { title: id, description: 'On.' }])) }
  }
}

/** What a student's part answers in each field it asks. */
const STUDENT_FIELDS: Record<string, unknown> = {
  year: 2,
  classesTaken: 4,
  majorClassesTaken: 1,
  dorm: 'lowrise',
  job: '',
  jobShifts: 0,
  homeSlots: 2,
  study: '',
  fun: [],
  activity: '',
  activityLocation: '',
  meal: '',
  handle: 'sarah.rose',
  winterPosts: [],
  springBreakPlans: 'Go home.',
  breakPosts: ['home'],
  pursuing: 'teaching',
  friendly: 'She knits.',
  trusted: 'She lied.',
  devoted: 'She ran.'
}

/** An answer to any part of the profile call: every major Biology, every field filled. */
function profileAnswer(request: StructuredRequest): Result<unknown> {
  const { properties } = schemaOf(request)
  if (request.schema.name === 'student_majors') {
    const keys: string[] = properties.characters.items.properties.key.enum
    return { ok: true, data: { characters: keys.map((key) => ({ key, major: 'Biology' })) } }
  }
  return {
    ok: true,
    data: Object.fromEntries(Object.keys(properties).map((field) => [field, STUDENT_FIELDS[field]]))
  }
}

/** An answer to any part of the catalog: one class for a pool or a major, or an interest class. */
function classAnswer(request: StructuredRequest): Result<unknown> {
  const course = { code: `C ${keyOf(request).slice(0, 6)}`, name: 'Hers', description: 'Hers.', kind: 'lecture' }
  if (request.schema.name === 'interest_class') return { ok: true, data: { interestClass: course } }
  return { ok: true, data: { classes: [course] } }
}

/** The schema names of every request a mock was sent, in order. */
const sentNames = (mock: ReturnType<typeof vi.fn>): string[] =>
  mock.mock.calls.map(([request]) => (request as StructuredRequest).schema.name)

const dropped = (): Result<never> => ({
  ok: false,
  error: appError('LLM_NETWORK', 'the connection dropped')
})

let occasions = vi.fn()
let profiles = vi.fn()
let classes = vi.fn()
let cancelGroup = vi.fn()
let apply = vi.fn()
let saved = vi.fn()
let write = vi.fn()

/** Installs the bridge over whatever the three mocks currently answer. */
function bridge(): void {
  stubApi({
    llm: {
      generateOccasions: occasions,
      generateProfiles: profiles,
      generateClasses: classes
    },
    jobs: { cancelGroup, onProgress: () => () => {} },
    saves: {
      apply,
      application: saved,
      enrollment: async () => ({ ok: false, error: appError('ENROLLMENT_NOT_FOUND', 'none') })
    },
    lorebook: { read: async () => ({ ok: true, data: null }), write }
  })
}

/** Every call answering at once. */
function answering(): void {
  occasions = vi.fn(async (request: StructuredRequest) => occasionAnswer(request))
  profiles = vi.fn(async (request: StructuredRequest) => profileAnswer(request))
  classes = vi.fn(async (request: StructuredRequest) => classAnswer(request))
  bridge()
}

/** A promise held open until the test lets it go. */
function held<T>(): { promise: Promise<T>; release: (value: T) => void } {
  let release!: (value: T) => void
  const promise = new Promise<T>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

/** Runs a wait to its answer, sleeping through however much backoff it buys. */
async function settle<T>(pending: Promise<T>): Promise<T> {
  await vi.advanceTimersByTimeAsync(60_000)
  return pending
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  occasions = vi.fn(async () => dropped())
  profiles = vi.fn(async () => dropped())
  classes = vi.fn(async () => dropped())
  cancelGroup = vi.fn(async () => ({ ok: true, data: undefined }))
  apply = vi.fn(async (draft: unknown, playthroughId?: string) => ({
    ok: true,
    data: { playthroughId: playthroughId ?? 'minted', application: draft }
  }))
  saved = vi.fn(async () => ({ ok: false, error: appError('APPLICATION_NOT_FOUND', 'none') }))
  write = vi.fn(async () => ({ ok: true, data: undefined }))
  bridge()
  useCharacterStore.setState({ characters: { sarah: SARAH }, load: async () => {} })
})

afterEach(async () => {
  leaveApplication()
  await applicationSettled()
  restoreApi()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** Every part a one-girl application with nothing written sends, by schema. */
const PROFILE_PARTS = ['student_majors', 'student_profile']
const POOL_PARTS = ['pool_classes', 'pool_classes', 'pool_classes', 'pool_classes']

describe('sendCalls', () => {
  it('re-sends a dropped part five times, then holds it for the wait to name', async () => {
    const outcome = await settle(startApplication(ROSTER))

    expect(occasions).toHaveBeenCalledTimes(6)
    // Her part waits on the majors the majors part never brought; the pools never wait.
    expect(sentNames(profiles)).toEqual(Array(6).fill('student_majors'))
    expect(classes).toHaveBeenCalledTimes(4 * 6)
    expect(new Set(sentNames(classes))).toEqual(new Set(['pool_classes']))
    expect(outcome.status).toBe('failed')
    if (outcome.status !== 'failed') return
    expect(outcome.missing).toEqual([CALL_LABELS.occasions, CALL_LABELS.profiles, CALL_LABELS.classes])
  })

  it('sends nothing for a request already answered, and supersedes one that changed', async () => {
    answering()
    const first = held<Result<unknown>>()
    profiles = vi.fn(async (request: StructuredRequest) =>
      profiles.mock.calls.length === 1 ? first.promise : profileAnswer(request)
    )
    bridge()
    beginApplication(ROSTER, 'spring', 'loading')
    sendCalls()
    sendCalls()
    expect(occasions).toHaveBeenCalledTimes(1)
    expect(profiles).toHaveBeenCalledTimes(1)

    // Notes written while the majors part is out make it a request nobody needs.
    const stale = profiles.mock.calls[0][1]
    updateApplication((draft) => ({
      ...draft,
      girls: { sarah: { profile: {}, secrets: {}, memories: [], notes: 'Sarah sings.' } }
    }))
    sendCalls()
    expect(cancelGroup).toHaveBeenCalledWith(stale)
    expect(profiles).toHaveBeenCalledTimes(2)

    const outcome = await settle(settledOutcome())
    expect(outcome.status).toBe('ready')
    // The first reply lands late, and is kept against nothing.
    first.release(profileAnswer(profiles.mock.calls[0][0]))
    await vi.advanceTimersByTimeAsync(0)
    const kept = useApplicationStore.getState().application?.replies['profiles:majors']
    expect(kept?.key).toBe(keyOf(profiles.mock.calls[1][0]))

    sendCalls()
    expect(occasions).toHaveBeenCalledTimes(1)
    expect(sentNames(profiles)).toEqual(['student_majors', ...PROFILE_PARTS])
    expect(sentNames(classes).sort()).toEqual(
      ['interest_class', 'major_classes', ...POOL_PARTS].sort()
    )
  })

  it('sends the pools at once and holds a major and an interest class for the majors', async () => {
    answering()
    const reply = held<Result<unknown>>()
    profiles = vi.fn(async (request: StructuredRequest) =>
      profiles.mock.calls.length === 1 ? reply.promise : profileAnswer(request)
    )
    bridge()
    beginApplication(ROSTER, 'spring', 'loading')
    sendCalls()
    await vi.advanceTimersByTimeAsync(0)
    expect(sentNames(profiles)).toEqual(['student_majors'])
    expect(sentNames(classes)).toEqual(POOL_PARTS)

    reply.release(profileAnswer(profiles.mock.calls[0][0]))
    await vi.advanceTimersByTimeAsync(0)
    expect(sentNames(profiles)).toEqual(PROFILE_PARTS)
    // Her part is told the major it waited for.
    expect((profiles.mock.calls[1][0] as StructuredRequest).user).toContain('major: "Biology"')
    const major = classes.mock.calls.find(([request]) => request.schema.name === 'major_classes')
    expect((major?.[0] as StructuredRequest).user).toContain('the Biology major')
    expect(sentNames(classes)).toContain('interest_class')
  })

  it('holds a part that failed alone, leaves it for Retry when the majors land, and Retry sends only it', async () => {
    answering()
    const pe = (request: StructuredRequest): boolean =>
      request.user.startsWith('Create 10 physical education')
    classes = vi.fn(async (request: StructuredRequest) =>
      pe(request) ? dropped() : classAnswer(request)
    )
    const reply = held<Result<unknown>>()
    profiles = vi.fn(async (request: StructuredRequest) =>
      profiles.mock.calls.length === 1 ? reply.promise : profileAnswer(request)
    )
    bridge()
    beginApplication(ROSTER, 'spring', 'loading')
    sendCalls()
    const pending = settledOutcome()
    await vi.advanceTimersByTimeAsync(60_000)
    const peSent = (): number => classes.mock.calls.filter(([request]) => pe(request)).length
    expect(peSent()).toBe(6)

    reply.release(profileAnswer(profiles.mock.calls[0][0]))
    const outcome = await settle(pending)
    expect(peSent()).toBe(6)
    expect(outcome.status).toBe('failed')
    if (outcome.status !== 'failed') return
    expect(outcome.missing).toEqual([CALL_LABELS.classes])
    const others = classes.mock.calls.length - peSent()

    sendCalls()
    await vi.advanceTimersByTimeAsync(0)
    expect(peSent()).toBe(7)
    expect(classes.mock.calls.length - peSent()).toBe(others)
  })

  it('resumes an application banked before calls went in parts, keeping only what still answers', async () => {
    answering()
    await settle(startApplication(ROSTER))
    const before = useApplicationStore.getState().application!
    const old = { key: 'an older build', reply: {} }
    leaveApplication()
    for (const mock of [occasions, profiles, classes]) mock.mockClear()

    void openApplication({
      ...before,
      replies: { occasions: before.replies.occasions, profiles: old, secrets: old, classes: old }
    })
    const outcome = await settle(startResumed())
    expect(occasions).not.toHaveBeenCalled()
    expect(sentNames(profiles)).toEqual(PROFILE_PARTS)
    expect(classes).toHaveBeenCalledTimes(6)
    expect(outcome.status).toBe('ready')
    const kept = Object.keys(useApplicationStore.getState().application!.replies)
    expect(kept).toContain('occasions')
    for (const call of ['profiles', 'secrets', 'classes']) expect(kept).not.toContain(call)
  })
})

/** Sends whatever an application just opened is owed, and its wait. */
function startResumed(): ReturnType<typeof settledOutcome> {
  sendCalls()
  return settledOutcome()
}

describe('Finalize', () => {
  it('sends nothing once the semester is composed, though a request no longer matches its reply', async () => {
    answering()
    const outcome = await settle(startApplication(ROSTER))
    if (outcome.status !== 'ready') throw new Error(outcome.status)
    openFinalize(outcome.data)
    const sent = [profiles.mock.calls.length, classes.mock.calls.length]
    // A resume re-sends what a renamed girl's request no longer answers; the semester stands.
    updateApplication((draft) => ({
      ...draft,
      girls: { sarah: { profile: { year: 4 }, secrets: {}, memories: [] } }
    }))
    sendCalls()
    expect([profiles.mock.calls.length, classes.mock.calls.length]).toEqual(sent)
    expect(useApplicationStore.getState().application?.composed).toEqual(outcome.data)
  })

  it('goes back onto Classes, dropping the semester, its changes and the catalog reply', async () => {
    answering()
    const outcome = await settle(startApplication(ROSTER))
    if (outcome.status !== 'ready') throw new Error(outcome.status)
    openFinalize(outcome.data)
    const app = () => useApplicationStore.getState().application!
    expect(app().screen).toBe('finalize')
    // Nothing changed here yet, but the composed semester is generation a Back throws away.
    expect(backCosts()).toEqual({ edits: false, calls: true })

    const id = outcome.data.occasions[0].id
    updateFinalEdits((draft) => withFinalOccasion(draft, id, { title: 'Moonlight Gala' }))
    expect(app().finalEdits?.occasions?.[id]).toEqual({ title: 'Moonlight Gala' })
    expect(backCosts()).toEqual({ edits: true, calls: true })

    backScreen()
    expect(app().screen).toBe('classes')
    expect(app().composed).toBeUndefined()
    expect(app().finalEdits).toBeUndefined()
    expect(Object.keys(app().replies).sort()).toEqual([
      'occasions',
      'profiles:majors',
      'profiles:student:sarah'
    ])
  })
})

describe('discardCallsFrom', () => {
  it('throws away the calls a Back onto Profiles can change, and keeps the occasions', async () => {
    answering()
    const outcome = await settle(startApplication(ROSTER))
    expect(outcome.status).toBe('ready')

    expect(discardCallsFrom('profiles')).toBe(true)
    const { replies } = useApplicationStore.getState().application!
    expect(Object.keys(replies)).toEqual(['occasions'])
    expect(discardCallsFrom('profiles')).toBe(false)
  })
})

describe('passScreen', () => {
  it('skips a screen’s calls, picks the missing majors once, and lets a Back drop them', async () => {
    answering()
    const MIA = character({ charId: 'mia', firstName: 'Mia', lastName: 'Park' })
    useCharacterStore.setState({ characters: { sarah: SARAH, mia: MIA } })
    const typed = { sarah: { profile: { major: 'Physics' }, secrets: {}, memories: [] } }
    const app = () => useApplicationStore.getState().application!

    beginApplication([SARAH, MIA], 'spring', 'occasions')
    updateApplication((draft) => ({ ...draft, girls: typed }))
    passScreen(true)
    passScreen()
    passScreen(true)
    expect(app().screen).toBe('classes')
    expect(app().skipped).toEqual(['occasions', 'profiles', 'secrets'])
    // Only the girl the player left without a major is dealt one, and only once.
    const dealt = app().dealtMajors
    expect(Object.keys(dealt ?? {})).toEqual(['mia'])
    sendCalls()
    expect(app().dealtMajors).toBe(dealt)

    // A Back onto Profiles throws the dealt major away and keeps what the player typed.
    discardCallsFrom('profiles')
    updateApplication((draft) => ({ ...draft, screen: 'profiles' }))
    expect(app().dealtMajors).toBeUndefined()
    expect(app().girls).toEqual(typed)
    passScreen(true)
    passScreen(true)
    expect(app().screen).toBe('loading')

    const outcome = await settle(settledOutcome())
    for (const mock of [occasions, profiles, classes]) expect(mock).not.toHaveBeenCalled()
    expect(outcome.status).toBe('ready')
    if (outcome.status !== 'ready') return
    expect(outcome.data.schedules.perChar.sarah.major).toBe('Physics')
    expect(outcome.data.schedules.perChar.mia.major).toBe(app().dealtMajors?.mia)
  })
})

describe('leaveApplication', () => {
  it('cancels every call out and ends the wait', async () => {
    const out = held<Result<unknown>>()
    occasions = vi.fn(async () => out.promise)
    profiles = vi.fn(async () => out.promise)
    classes = vi.fn(async () => out.promise)
    bridge()
    const pending = startApplication(ROSTER)
    const groups = [occasions, profiles, classes].flatMap((mock) =>
      mock.mock.calls.map((call) => call[1])
    )
    expect(groups).toHaveLength(6)

    leaveApplication()
    expect((await settle(pending)).status).toBe('cancelled')
    for (const group of groups) expect(cancelGroup).toHaveBeenCalledWith(group)
  })
})

describe('keeping the application', () => {
  it('writes nothing before the first change, then the newest draft into the folder its first write made', async () => {
    const first = held<Result<unknown>>()
    apply = vi.fn(async (draft: unknown, playthroughId?: string) =>
      apply.mock.calls.length === 1
        ? first.promise
        : { ok: true, data: { playthroughId: playthroughId ?? 'again', application: draft } }
    )
    bridge()
    const app = () => useApplicationStore.getState().application!

    beginApplication(ROSTER, 'spring', 'setting')
    await vi.advanceTimersByTimeAsync(0)
    expect(apply).not.toHaveBeenCalled()
    expect(applicationKept()).toBe(false)

    // The lorebook's first write asks for the folder, which writes the application first.
    const folder = keepApplication()
    expect(applicationKept()).toBe(true)
    await vi.advanceTimersByTimeAsync(0)
    // Two changes while that write is out: only the newest waits behind it.
    updateApplication((draft) => ({ ...draft, chars: [] }))
    updateApplication((draft) => ({ ...draft, chars: ['sarah'] }))
    first.release({ ok: true, data: { playthroughId: 'kept', application: app() } })
    expect(await folder).toBe('kept')
    await applicationSettled()
    expect(apply).toHaveBeenCalledTimes(2)
    expect(apply.mock.calls[0][1]).toBeUndefined()
    expect(apply.mock.calls[1][0]).toMatchObject({ chars: ['sarah'] })
    expect(apply.mock.calls[1][1]).toBe('kept')

    // Asked again, it answers without a write; sealed, it writes nothing more.
    expect(await keepApplication()).toBe('kept')
    expect(await sealApplication()).toBe('kept')
    updateApplication((draft) => ({ ...draft, chars: [] }))
    await applicationSettled()
    expect(apply).toHaveBeenCalledTimes(2)
  })

  it('tries a first write that failed again as it is sealed', async () => {
    apply = vi.fn(async (draft: unknown, playthroughId?: string) =>
      apply.mock.calls.length === 1
        ? { ok: false, error: appError('APPLICATION_UNWRITABLE', 'no') }
        : { ok: true, data: { playthroughId: playthroughId ?? 'minted', application: draft } }
    )
    bridge()
    beginApplication(ROSTER, 'spring', 'setting')
    expect(await keepApplication()).toBeNull()
    expect(await sealApplication()).toBe('minted')
    expect(apply).toHaveBeenCalledTimes(2)
  })
})

describe('backScreen', () => {
  it('puts back what the screen was entered with and drops the calls sent from where it returns', async () => {
    answering()
    const app = () => useApplicationStore.getState().application!
    beginApplication(ROSTER, 'spring', 'occasions')
    passScreen()
    passScreen()
    passScreen()
    await vi.advanceTimersByTimeAsync(0)
    expect(app().screen).toBe('classes')
    expect(Object.keys(app().replies).sort()).toEqual([
      'occasions',
      'profiles:majors',
      'profiles:student:sarah'
    ])

    const entered = app().girls
    updateApplication((draft) => ({
      ...draft,
      girls: { sarah: { profile: { year: 3 }, secrets: {}, memories: [] } }
    }))
    expect(backCosts()).toEqual({ edits: true, calls: true })

    backScreen()
    expect(app().screen).toBe('profiles')
    expect(app().girls).toEqual(entered)
    expect(Object.keys(app().replies)).toEqual(['occasions'])
    // Nothing entered on Profiles since, and nothing out a Back onto Characters would drop.
    expect(backCosts()).toEqual({ edits: false, calls: false })
  })

  it('drops the random picks going back onto Characters, and keeps the reveal and the occasions', async () => {
    answering()
    const MIA = character({ charId: 'mia', firstName: 'Mia', lastName: 'Park' })
    const LENA = character({ charId: 'lena', firstName: 'Lena', lastName: 'Cho' })
    useCharacterStore.setState({ characters: { sarah: SARAH, mia: MIA, lena: LENA } })
    const app = () => useApplicationStore.getState().application!
    beginApplication([SARAH], 'spring', 'occasions')
    passScreen()
    passScreen(false, ['mia', 'lena'])
    await vi.advanceTimersByTimeAsync(0)
    expect(app().screen).toBe('profiles')
    expect(app().chars).toEqual(['sarah', 'mia', 'lena'])
    expect(app().randomPicks).toEqual(['mia', 'lena'])

    revealPick('mia')
    revealPick('sarah')
    expect(app().revealed).toEqual(['mia'])
    // The picks going is not a change on Profiles, and nothing is out that the Back would drop.
    expect(backCosts()).toEqual({ edits: false, calls: false })

    backScreen()
    expect(app().screen).toBe('characters')
    expect(app().chars).toEqual(['sarah'])
    expect(app().randomPicks).toBeUndefined()
    expect(app().revealed).toEqual(['mia'])
    expect(Object.keys(app().replies)).toEqual(['occasions'])
    expect(occasions).toHaveBeenCalledTimes(1)
  })

  /** An application opened on `screen` with one PE class written, as a resume would open it. */
  function openWithCatalog(screen: ApplicationScreen): CatalogEntries {
    const catalog = {
      ...emptyCatalog(),
      pe: [{ code: 'PE 101', title: 'Yoga', description: 'Stretching.' }]
    }
    void openApplication({
      screen,
      season: 'spring',
      chars: ['sarah'],
      plan: [],
      occasions: {},
      catalog,
      girls: {},
      pairs: {},
      replies: {}
    })
    return catalog
  }

  it('empties the whole catalog going back from Classes, and asks first though nothing changed', () => {
    openWithCatalog('classes')
    expect(backCosts()).toEqual({ edits: true, calls: false })
    backScreen()
    const app = useApplicationStore.getState().application!
    expect(app.screen).toBe('profiles')
    expect(app.catalog).toEqual(emptyCatalog())
  })

  it('keeps the catalog going back from Loading', () => {
    const catalog = openWithCatalog('loading')
    expect(backCosts()).toEqual({ edits: false, calls: false })
    backScreen()
    const app = useApplicationStore.getState().application!
    expect(app.screen).toBe('classes')
    expect(app.catalog).toEqual(catalog)
  })
})

describe('beginNextApplication', () => {
  const HANDOFF: SemesterHandoff = {
    index: 1,
    continuing: ['sarah', 'deleted'],
    graduated: [],
    alumni: [],
    priorProfiles: { sarah: { year: 2, dorm: 'lowrise_1', major: 'History', schedule: {} } },
    jobs: {},
    haunts: {},
    majorLoads: {},
    carry: { stats: DEFAULT_PLAYER_STATS, bio: 'A runner.' } as unknown as SemesterCarry
  }
  const NEXT: Continuation = {
    playthroughId: 'kept',
    record: playthroughRecord({ chars: ['sarah'] }),
    from: undefined,
    ending: '9000',
    handoff: HANDOFF
  }
  const app = () => useApplicationStore.getState().application!

  /** An application saved beside the record, continuing from `parent`, left on Occasions. */
  function savedFrom(parent: string | undefined, ending = '9000'): Application {
    return {
      schemaVersion: 1,
      savedAt: 1,
      screen: 'occasions',
      season: 'fall',
      chars: ['sarah'],
      plan: [],
      occasions: {},
      catalog: emptyCatalog(),
      girls: {},
      pairs: {},
      replies: {},
      continued: { ...HANDOFF, id: '250', ...(parent ? { parent } : {}), ending, taken: [] }
    }
  }

  it('opens a fresh application unkept beside the record, written there from its first change', async () => {
    expect(await beginNextApplication(NEXT)).toBe('opened')
    expect(app()).toMatchObject({
      screen: 'setting',
      season: 'fall',
      chars: ['sarah'],
      reader: {
        firstName: 'Seth',
        lastName: 'Hawke',
        stats: DEFAULT_PLAYER_STATS,
        bio: 'A runner.'
      },
      continued: { index: 1, continuing: ['sarah', 'deleted'], taken: [] }
    })
    expect(app().continued?.parent).toBeUndefined()
    expect(applicationKept()).toBe(false)
    expect(apply).not.toHaveBeenCalled()

    updateApplication((draft) => ({ ...draft, chars: [] }))
    await applicationSettled()
    expect(apply).toHaveBeenCalledTimes(1)
    expect(apply.mock.calls[0][1]).toBe('kept')
  })

  it('writes the application before the first lorebook write a Setting edit makes, and once', async () => {
    await beginNextApplication(NEXT)
    const lorebook = useLorebookStore.getState()
    expect(lorebook.editSetting('A small college.', lorebook.revision)).toBe(true)
    await lorebookSettled()
    expect(applicationKept()).toBe(true)
    expect(apply).toHaveBeenCalledTimes(1)
    expect(apply.mock.calls[0][1]).toBe('kept')
    expect(write).toHaveBeenCalledTimes(1)
    expect(write.mock.calls[0][0]).toBe('kept')
    expect(apply.mock.invocationCallOrder[0]).toBeLessThan(write.mock.invocationCallOrder[0])

    // Landed, it is not written again for the next.
    const now = useLorebookStore.getState()
    expect(now.editSetting('A large college.', now.revision)).toBe(true)
    await lorebookSettled()
    expect(apply).toHaveBeenCalledTimes(1)
    expect(write).toHaveBeenCalledTimes(2)
  })

  it('reopens one saved off the same ending, and opens fresh over one off another', async () => {
    saved = vi.fn(async () => ({ ok: true, data: savedFrom(undefined) }))
    bridge()
    expect(await beginNextApplication(NEXT)).toBe('opened')
    expect(app().screen).toBe('occasions')
    expect(app().continued?.id).toBe('250')
    expect(applicationKept()).toBe(true)

    saved = vi.fn(async () => ({ ok: true, data: savedFrom('200') }))
    bridge()
    expect(await beginNextApplication(NEXT)).toBe('opened')
    expect(app().screen).toBe('setting')
    expect(app().continued?.id).not.toBe('250')
    expect(applicationKept()).toBe(false)

    // The same semester, played to its ending again from an earlier save.
    saved = vi.fn(async () => ({ ok: true, data: savedFrom(undefined, '8000') }))
    bridge()
    expect(await beginNextApplication(NEXT)).toBe('opened')
    expect(app().screen).toBe('setting')
    expect(app().continued?.ending).toBe('9000')

    // An ending standing on no slot save reopens nothing.
    saved = vi.fn(async () => ({ ok: true, data: savedFrom(undefined) }))
    bridge()
    expect(await beginNextApplication({ ...NEXT, ending: null })).toBe('opened')
    expect(app().screen).toBe('setting')
    expect(app().continued?.ending).toBeUndefined()
  })

  it('opens on the size the last roster held, never below the least', async () => {
    expect(await beginNextApplication(NEXT)).toBe('opened')
    expect(app().size).toBe(12)

    const roster = Array.from({ length: 20 }, (_, i) => `girl-${i}`)
    const handoff = { ...HANDOFF, continuing: roster.slice(0, 17), graduated: roster.slice(17) }
    expect(await beginNextApplication({ ...NEXT, handoff })).toBe('opened')
    expect(app().size).toBe(20)
  })
})
