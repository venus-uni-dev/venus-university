import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { appError } from '@shared/errors'
import { charKeyOf, type Result, type StructuredRequest } from '@shared/types'
import type { ClassGenReply } from '../src/renderer/prompts/classPrompt'
import type { ProfileGenReply } from '../src/renderer/prompts/profilePrompt'
import { character, restoreApi, stubApi } from './fixtures'

// The start reaches `gameLoop` for the ComfyUI nudge, and `jobStore` down that
// chain subscribes to `jobs:progress` at module scope — so the bridge has to
// exist before the import rather than before the call (`characterStore`'s).
stubApi({ jobs: { onProgress: () => () => {} } })
const { cancelNewGameStart, retryNewGameStart, startNewGame, NEW_GAME_LLM_GROUP } = await import(
  '../src/renderer/stores/newGame'
)

/**
 * What Start Game will and will not hand the player. All three one-shots
 * are written into the first save and can never be fetched again, so a failure
 * is retried, then asked about, and a cancelled start leaves nothing half-answered.
 */
const roster = [character()]
const key = charKeyOf(roster[0].firstName, roster[0].lastName)

/** A catalog the scheduler accepts: one major course, one interest class. */
function classReply(): ClassGenReply {
  return {
    classes: [
      {
        code: 'BAK101',
        name: 'Introduction to Baking',
        description: 'Bread, mostly.',
        category: 'major',
        major: 'Culinary Arts'
      }
    ],
    characters: {
      [key]: {
        major: 'Culinary Arts',
        majorClassesTaken: 1,
        interestClass: { code: 'BAK210', name: 'Sourdough', description: 'Starters.' }
      }
    }
  }
}

/** A profile reply carrying the one field the validator refuses to repair. */
function profileReply(): ProfileGenReply {
  return {
    characters: [
      {
        key,
        year: 2,
        classesTaken: 3,
        dorm: 'lowrise_4',
        job: '',
        jobShifts: 0,
        homeSlots: 2,
        study: '',
        fun: [],
        activity: '',
        activityLocation: '',
        meal: '',
        handle: 'sarah',
        winterPosts: ['baked all week'],
        springBreakPlans: 'home to the bakery'
      }
    ]
  }
}

/** The reply the occasions call answers with, one entry per requested id. */
function occasionReply(ids: readonly string[]): { events: Record<string, unknown> } {
  const events: Record<string, unknown> = {}
  for (const id of ids) events[id] = { title: 'Something', description: 'Something happens.' }
  return { events }
}

const dropped = (): Result<never> => ({
  ok: false,
  error: appError('LLM_NETWORK', 'the connection dropped')
})

let classes = vi.fn()
let profiles = vi.fn()
let occasions = vi.fn()
let cancelGroup = vi.fn()

/** Installs the bridge over whatever the three mocks currently answer. */
function bridge(): void {
  stubApi({
    llm: { generateClasses: classes, generateProfiles: profiles, generateOccasions: occasions },
    jobs: { cancelGroup }
  })
}

/**
 * The occasion ids the call was asked for, read off the request the module
 * built — every requested id is a required property of its schema.
 * Read rather than hard-coded, the placement being rolled fresh per attempt.
 */
function requestedIds(request: StructuredRequest): string[] {
  const schema = request.schema as unknown as {
    schema: { properties: { events: { required: string[] } } }
  }
  return schema.schema.properties.events.required
}

/** Runs a start to its answer, sleeping through however much backoff it buys. */
async function settle<T>(pending: Promise<T>): Promise<T> {
  await vi.advanceTimersByTimeAsync(60_000)
  return pending
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  classes = vi.fn(async () => dropped())
  profiles = vi.fn(async () => dropped())
  occasions = vi.fn(async () => dropped())
  cancelGroup = vi.fn(async () => ({ ok: true, data: undefined }))
  bridge()
})

afterEach(() => {
  cancelNewGameStart()
  restoreApi()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('startNewGame', () => {
  it('re-sends a dropped call five times before it asks the player', async () => {
    const outcome = await settle(startNewGame(roster))

    expect(classes).toHaveBeenCalledTimes(6)
    expect(profiles).toHaveBeenCalledTimes(6)
    expect(occasions).toHaveBeenCalledTimes(6)
    expect(outcome.status).toBe('failed')
    if (outcome.status !== 'failed') return
    // Every half still missing is named, not merely the first one to fail.
    expect(outcome.missing).toHaveLength(3)
  })

  // The bug the whole path was written for: the call came back, nothing in it
  // could be written, and the save was started with an empty calendar anyway.
  it('refuses a reply that leaves the semester with no occasions at all', async () => {
    classes = vi.fn(async () => ({ ok: true, data: classReply() }))
    profiles = vi.fn(async () => ({ ok: true, data: profileReply() }))
    occasions = vi.fn(async () => ({ ok: true, data: { events: {} } }))
    bridge()

    const outcome = await settle(startNewGame(roster))

    expect(outcome.status).toBe('failed')
    if (outcome.status !== 'failed') return
    expect(outcome.error.code).toBe('OCCASION_GEN_INVALID')
    expect(outcome.missing).toHaveLength(1)
  })
})

describe('retryNewGameStart', () => {
  it('re-sends only what is still missing, and keeps what landed', async () => {
    classes = vi.fn(async () => ({ ok: true, data: classReply() }))
    profiles = vi.fn(async () => ({ ok: true, data: profileReply() }))
    bridge()
    expect((await settle(startNewGame(roster))).status).toBe('failed')

    let asked: string[] = []
    occasions = vi.fn(async (request: StructuredRequest) => {
      asked = requestedIds(request)
      return { ok: true, data: occasionReply(asked) }
    })
    bridge()

    const outcome = await settle(retryNewGameStart(roster))

    // The two replies already paid for are not asked for a second time.
    expect(classes).toHaveBeenCalledTimes(1)
    expect(profiles).toHaveBeenCalledTimes(1)
    expect(outcome.status).toBe('ready')
    if (outcome.status !== 'ready') return
    expect(asked.length).toBeGreaterThan(0)
    expect(outcome.data.occasions).toHaveLength(asked.length)
    expect(Object.keys(outcome.data.schedules.classes).length).toBeGreaterThan(0)
  })
})

describe('cancelNewGameStart', () => {
  it('fences the outcome and aborts what is in flight', async () => {
    const pending = startNewGame(roster)
    // Mid-backoff: the first send has failed and the second is sleeping.
    await vi.advanceTimersByTimeAsync(100)
    const sent = classes.mock.calls.length
    cancelNewGameStart()
    const outcome = await settle(pending)

    expect(outcome.status).toBe('cancelled')
    expect(cancelGroup).toHaveBeenCalledWith(NEW_GAME_LLM_GROUP)
    // Nothing goes out behind the fence, and no sleep is waited out.
    expect(classes).toHaveBeenCalledTimes(sent)
  })

  it('leaves nothing for a later retry to resume', async () => {
    classes = vi.fn(async () => ({ ok: true, data: classReply() }))
    bridge()
    await settle(startNewGame(roster))
    cancelNewGameStart()

    classes = vi.fn(async () => ({ ok: true, data: classReply() }))
    profiles = vi.fn(async () => ({ ok: true, data: profileReply() }))
    occasions = vi.fn(async (request: StructuredRequest) => ({
      ok: true,
      data: occasionReply(requestedIds(request))
    }))
    bridge()

    const outcome = await settle(retryNewGameStart(roster))

    // The catalog that landed before the cancel is not one this start holds.
    expect(outcome.status).toBe('ready')
    expect(classes).toHaveBeenCalledTimes(1)
  })
})
