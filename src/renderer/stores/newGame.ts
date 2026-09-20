import { appError, toAppError } from '@shared/errors'
import {
  charKeyOf,
  type AppError,
  type Character,
  type Enrollment,
  type FeedAssignment,
  type HiddenScheduleAssignment,
  type JobAssignment,
  type Occasion,
  type Result
} from '@shared/types'
import {
  buildClassPrompt,
  decorateClasses,
  validateClassDraft,
  type ClassGenReply
} from '../prompts/classPrompt'
import {
  buildProfilePrompt,
  feedAssignmentsOf,
  hiddenScheduleAssignmentsOf,
  jobAssignmentsOf,
  mergeProfiles,
  springBreakAssignmentsOf,
  validateProfileDraft,
  type ProfileGenDraft,
  type ProfileGenReply
} from '../prompts/profilePrompt'
import {
  buildOccasionPrompt,
  normalizeOccasions,
  planOccasionSlots,
  type OccasionGenDraft,
  type OccasionRequest
} from '../prompts/occasionPrompt'
import { SEED_WORD_BAG, SEED_WORDS } from '../prompts/seedWords'
import { buildSchedules, type ScheduleResult } from './classScheduler'
import { prepareGameServices } from './gameLoop'
import { useGrabBagStore } from './grabBagStore'
import { retrySilently } from './silentRetry'

/** The cancellation group New Game's three one-shots register under. */
export const NEW_GAME_LLM_GROUP = 'newGame:llm'

/** Everything the three one-shot New Game calls produce, settled together. */
export interface StartResult {
  schedules: ScheduleResult
  /** Who works where, by charId — the slots themselves are picked at Finalize. */
  jobs: Record<string, JobAssignment>
  /** Where each character likes to be, by charId — placed at Finalize too. */
  haunts: Record<string, HiddenScheduleAssignment>
  /** Her handle and what she posted over the break, by charId — dated at Finalize. */
  feeds: Record<string, FeedAssignment>
  /** What each of them does with spring break, by charId. */
  springBreakPlans: Record<string, string>
  occasions: Occasion[]
}

/**
 * How one press of Start Game ended. `failed` names every call that could not be written,
 * in the modal's words.
 */
export type StartOutcome =
  | { status: 'ready'; data: StartResult }
  | { status: 'failed'; error: AppError; missing: string[] }
  | { status: 'cancelled' }

/** One press of Start Game, held across its retries. */
interface StartAttempt {
  roster: readonly Character[]
  classRequest: ReturnType<typeof buildClassPrompt>
  profileRequest: ReturnType<typeof buildProfilePrompt>
  occasionRequests: OccasionRequest[]
  occasionRequest: ReturnType<typeof buildOccasionPrompt>
  classDraft?: ClassGenReply
  profiles?: ProfileGenDraft
  occasions?: Occasion[]
}

/** What each call is called on the modal, in the order failures are reported. */
const CALL_LABELS = {
  classes: 'the class catalog',
  profiles: "the students' profiles",
  occasions: 'the semester’s calendar'
} as const

let attempt: StartAttempt | null = null

/**
 * The identity of one press of Start Game, minted by {@link startNewGame} and dropped by
 * {@link cancelNewGameStart} — the game loop's `runToken` for this screen.
 */
let run: object | null = null

/** Cancellers for the backoff sleep in flight, so leaving never waits one out. */
let sleepers: (() => void)[] = []

/** A semester on disk with its cast resolved — what the registrar is reopened on. */
export interface StagedEnrollment {
  playthroughId: string
  enrollment: Enrollment
  characters: Character[]
}

let staged: StagedEnrollment | null = null

/** Hands New Game the enrollment the screen it is about to raise stands on. */
export function stageEnrollment(next: StagedEnrollment): void {
  staged = next
}

/** What is staged, left where it is: a `useState` initializer runs twice under StrictMode. */
export function stagedEnrollment(): StagedEnrollment | null {
  return staged
}

/** Drops what was staged, once the screen holding it has mounted. */
export function clearStagedEnrollment(): void {
  staged = null
}

/** Whether the run a continuation started under is still the live one. */
function stale(mine: object): boolean {
  return run !== mine
}

/** Sends one call until it lands, its budget runs out, or the run is left. */
async function sendUntilAnswered<T>(
  call: string,
  mine: object,
  send: () => Promise<Result<T>>
): Promise<Result<T>> {
  let spent = 0
  for (;;) {
    const result = await send()
    if (stale(mine) || result.ok) return result

    console.warn(`[newGame] ${call} failed:`, result.error)
    const retried = await retrySilently(`newGame:${call}`, result.error, spent, {
      onSleep: (cancel) => sleepers.push(cancel)
    })
    if (!retried || stale(mine)) return result
    spent += 1
  }
}

/** Fetches and validates the save's class catalog. */
async function fetchClassDraft(current: StartAttempt): Promise<Result<ClassGenReply>> {
  const generated = await window.api.llm.generateClasses<ClassGenReply>(
    current.classRequest,
    NEW_GAME_LLM_GROUP
  )
  if (!generated.ok) return { ok: false, error: generated.error }
  try {
    return { ok: true, data: validateClassDraft(generated.data, current.roster) }
  } catch (err) {
    return { ok: false, error: toAppError(err) }
  }
}

/** Fetches and validates the roster's years, course loads and jobs. */
async function fetchProfiles(current: StartAttempt): Promise<Result<ProfileGenDraft>> {
  const generated = await window.api.llm.generateProfiles<ProfileGenReply>(
    current.profileRequest,
    NEW_GAME_LLM_GROUP
  )
  if (!generated.ok) return { ok: false, error: generated.error }
  try {
    return { ok: true, data: validateProfileDraft(generated.data, current.roster) }
  } catch (err) {
    return { ok: false, error: toAppError(err) }
  }
}

/** Fetches the save's own calendar occasions. */
async function fetchOccasions(current: StartAttempt): Promise<Result<Occasion[]>> {
  const generated = await window.api.llm.generateOccasions<OccasionGenDraft>(
    current.occasionRequest,
    NEW_GAME_LLM_GROUP
  )
  if (!generated.ok) return { ok: false, error: generated.error }

  const occasions = normalizeOccasions(generated.data, current.occasionRequests)
  if (occasions.length === 0) {
    return {
      ok: false,
      error: appError(
        'OCCASION_GEN_INVALID',
        'The semester’s occasions came back empty.',
        `${current.occasionRequests.length} were asked for; none could be written.`
      )
    }
  }
  return { ok: true, data: occasions }
}

/**
 * Runs whatever the attempt is still missing, then composes the semester out of the three
 * replies.
 */
async function runAttempt(current: StartAttempt, mine: object): Promise<StartOutcome> {
  const [classResult, profileResult, occasionResult] = await Promise.all([
    current.classDraft
      ? Promise.resolve<Result<ClassGenReply>>({ ok: true, data: current.classDraft })
      : sendUntilAnswered('classes', mine, () => fetchClassDraft(current)),
    current.profiles
      ? Promise.resolve<Result<ProfileGenDraft>>({ ok: true, data: current.profiles })
      : sendUntilAnswered('profiles', mine, () => fetchProfiles(current)),
    current.occasions
      ? Promise.resolve<Result<Occasion[]>>({ ok: true, data: current.occasions })
      : sendUntilAnswered('occasions', mine, () => fetchOccasions(current))
  ])
  if (stale(mine)) return { status: 'cancelled' }

  // Banked before the verdict below, so a retry re-sends only what is still missing.
  if (classResult.ok) current.classDraft = classResult.data
  if (profileResult.ok) current.profiles = profileResult.data
  if (occasionResult.ok) current.occasions = occasionResult.data

  // The first failure is the one the modal shows; the rest are named beside it.
  if (!classResult.ok || !profileResult.ok || !occasionResult.ok) {
    const failures: { label: string; error: AppError }[] = []
    if (!classResult.ok) failures.push({ label: CALL_LABELS.classes, error: classResult.error })
    if (!profileResult.ok) {
      failures.push({ label: CALL_LABELS.profiles, error: profileResult.error })
    }
    if (!occasionResult.ok) {
      failures.push({ label: CALL_LABELS.occasions, error: occasionResult.error })
    }
    return {
      status: 'failed',
      error: failures[0].error,
      missing: failures.map((failure) => failure.label)
    }
  }

  const { roster } = current
  const profiles = profileResult.data
  const schedules = buildSchedules(
    decorateClasses(mergeProfiles(classResult.data, profiles)),
    roster
  )
  /** One profile assignment map re-keyed from charKey to charId, absences dropped. */
  const byCharId = <T,>(byKey: Record<string, T>): Record<string, T> =>
    Object.fromEntries(
      roster
        .map((c) => [c.charId, byKey[charKeyOf(c.firstName, c.lastName)]] as const)
        .filter(([, assignment]) => Boolean(assignment))
    ) as Record<string, T>

  attempt = null
  return {
    status: 'ready',
    data: {
      schedules,
      jobs: byCharId(jobAssignmentsOf(profiles)),
      haunts: byCharId(hiddenScheduleAssignmentsOf(profiles)),
      feeds: byCharId(feedAssignmentsOf(profiles)),
      springBreakPlans: byCharId(springBreakAssignmentsOf(profiles)),
      occasions: occasionResult.data
    }
  }
}

/**
 * Start Game's generation pass: the three one-shots in parallel, then the local passes
 * that turn them into a semester.
 */
export async function startNewGame(roster: readonly Character[]): Promise<StartOutcome> {
  const mine = {}
  run = mine
  sleepers = []
  const occasionRequests = planOccasionSlots((count) =>
    useGrabBagStore.getState().drawMany(SEED_WORD_BAG, SEED_WORDS, count)
  )
  const current: StartAttempt = {
    roster,
    classRequest: buildClassPrompt(roster),
    profileRequest: buildProfilePrompt(roster),
    occasionRequests,
    occasionRequest: buildOccasionPrompt(occasionRequests)
  }
  attempt = current

  await prepareGameServices()
  if (stale(mine)) return { status: 'cancelled' }
  return runAttempt(current, mine)
}

/**
 * The failure modal's Retry — resumes the stored attempt, re-sending only the calls with no
 * reply yet. With nothing held, it starts over.
 */
export async function retryNewGameStart(roster: readonly Character[]): Promise<StartOutcome> {
  const current = attempt
  if (!current) return startNewGame(roster)
  const mine = {}
  run = mine
  sleepers = []
  return runAttempt(current, mine)
}

/**
 * Abandons the start: the player answered the modal with Cancel, or left the screen entirely.
 */
export function cancelNewGameStart(): void {
  run = null
  attempt = null
  const waking = sleepers
  sleepers = []
  for (const wake of waking) wake()
  void window.api.jobs.cancelGroup(NEW_GAME_LLM_GROUP)
}
