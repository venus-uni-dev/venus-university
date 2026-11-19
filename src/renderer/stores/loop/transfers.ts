import { toAppError } from '@shared/errors'
import { globalSlotOf } from '@shared/jobs'
import type { AppError, Character, Result, StructuredRequest, TimeSlot } from '@shared/types'
import { nextSlot } from '../../prompts/gameDate'
import { isGraduationSlot } from '../../prompts/graduation'
import { FINALS_WEEK } from '../../prompts/occasions'
import type { Deal } from '../applicationSkip'
import type { TransferCourses, UnslottedCourse } from '../classScheduler'
import { blankCharInfo, useGameStore, type TransferJob } from '../gameStore'
import { useGrabBagStore } from '../grabBagStore'
import { settingNow } from '../lorebookStore'
import { takenClassesOf } from '../semesterCarry'
import { retrySilently } from '../silentRetry'
import {
  composeTransfer,
  skipTransfer,
  transferInterestOf,
  transferInterestRequest,
  transferMajorClassCount,
  transferMajorClassesOf,
  transferMajorClassesRequest,
  transferMajorOf,
  transferMajorRequest,
  transferNeedsMajorClasses,
  transferRoomLeft,
  transferStudentOf,
  transferStudentRequest,
  type TransferContext,
  type TransferDraft
} from '../transferCompose'
import type { Arrival } from './npc'
import { milestonesOffer, type ReplayOffer } from './saves'
import { currentRun, loopState, runStale } from './state'

/**
 * Transfer students picked from the landing: each one's calls, run in the background beside the
 * others', the failure that stops them, and the waiting list she joins once all of her is in.
 */

/**
 * The cancellation group for one transfer's calls, apart from the loop's own and every other
 * transfer's, so that giving up on her cancels nothing else. Cancelled on leaving too.
 */
function transferGroupOf(charId: string): string {
  return `loop:transfer:${charId}`
}

/**
 * The calls a transfer is generated in: her major; then the rest of her and her secrets beside
 * her interest class; then, where her major runs no class, its classes.
 */
type TransferPart = 'major' | 'student' | 'interest' | 'majorClasses'

/** One transfer being generated: what has landed, what failed, and the edits a retry keeps. */
interface Attempt {
  /** The stay it was started in. */
  run: object
  character: Character
  /** Dealt off the authored pools rather than asked of the model. */
  skip: boolean
  /** The landing it was started from, which her first three parts are built and checked on. */
  ctx: TransferContext
  /** The landing her major's classes were asked against, once they are asked. */
  classCtx: TransferContext | null
  /** Her major once its call has landed. */
  major: string | null
  /** Her profile and secrets once their call has landed. */
  draft: TransferDraft | null
  /** Her interest class once its call has landed. */
  interest: UnslottedCourse | null
  /** Her major's classes once settled: none where the catalog already runs her major. */
  majorClasses: UnslottedCourse[] | null
  /** Each part's request as it was built, re-sent verbatim. */
  requests: Partial<Record<TransferPart, StructuredRequest>>
  /** The parts whose calls failed past their silent retries, in the order they failed. */
  failed: TransferPart[]
  /** What stopped the attempt: the first failed part's error, or the deal's or compose's. */
  error: AppError | null
  /** Cuts short each silent retry's sleep in progress. */
  wakes: Set<() => void>
  /** Resolved once she is on the waiting list or given up. */
  settled: Promise<void>
  settle: () => void
}

/** Every transfer being generated, or whose failure stands, by charId, in the order picked. */
const attempts = new Map<string, Attempt>()

/** The endings waiting on their opening while transfers are out, each by its own token. */
const endingWaits = new Set<object>()

/** Whether an ending is waiting on its opening with the player parked on it. */
function endingParkedOnTransfers(): boolean {
  const game = useGameStore.getState()
  return game.endingAwaitsTransfers && game.waitingForLine
}

/** The grab bags the skipped path deals from. */
const storeDeal: Deal = (bag, items, count, keyOf, accept) =>
  useGrabBagStore.getState().drawMany(bag, items, count, keyOf, accept)

/**
 * What the Game menu's Transfer student offers: nothing outside a playthrough's own landings — a
 * created scene, a replay, the epilogue, a game over, or a slot whose next opens finals week or
 * later — and otherwise what Edit milestones offers.
 */
export function transferOffer(): ReplayOffer {
  const game = useGameStore.getState()
  if (!game.playthroughId || game.createdScene !== null || game.replaying !== null) return 'none'
  if (game.activeGameOver !== null) return 'none'
  if (game.graduationSeen || isGraduationSlot(game.date, game.time)) return 'none'
  if (nextSlot(game.date, game.time).date >= FINALS_WEEK.startDate) return 'none'
  return milestonesOffer()
}

/** How many more transfers the semester takes: the cap less the roster, waiting and generating. */
export function transferRoom(): number {
  const game = useGameStore.getState()
  return transferRoomLeft(game.chars, game.pendingTransfers) - attempts.size
}

/** The transfer listed first among `jobs` whose generation failed; null where none has. */
export function firstFailedTransfer(jobs: Readonly<Record<string, TransferJob>>): string | null {
  return Object.entries(jobs).find(([, job]) => job.phase === 'failed')?.[0] ?? null
}

/** The character being generated as `charId`'s transfer; null where none is. */
export function transferCharacterOf(charId: string): Character | null {
  return attempts.get(charId)?.character ?? null
}

/**
 * The landing as a transfer of `character` is generated and dealt against: the catalog with every
 * waiting transfer's own classes laid on, and every class the line has run.
 */
function contextOf(character: Character): TransferContext {
  const game = useGameStore.getState()
  const classes = { ...game.classes }
  for (const entry of game.pendingTransfers) Object.assign(classes, entry.classes ?? {})
  const record = loopState.record
  return {
    character,
    season: game.calendar.season,
    date: game.date,
    time: game.time,
    chars: game.chars,
    charInfo: game.charInfo,
    pending: game.pendingTransfers,
    classes,
    taken: record
      ? takenClassesOf(record, game.semesterId ?? undefined, { transfers: game.transfers })
      : [],
    playerSchedule: game.playerSchedule,
    jobClosures: game.jobClosures,
    springBreakAway: game.springBreakAway,
    setting: settingNow()
  }
}

/** Whether `a` is still a transfer being generated, in the stay it was started in. */
function live(a: Attempt): boolean {
  return attempts.get(a.character.charId) === a && !runStale(a.run)
}

/** Files the failure that stopped `a`, for the player to answer. */
function fail(a: Attempt): void {
  useGameStore
    .getState()
    .setTransferJob(a.character.charId, {
      phase: 'failed',
      error: a.error ?? toAppError(new Error('The transfer stopped short.'))
    })
}

/**
 * Sends one part's request until its reply passes `check`, it fails past its silent retries, or
 * `a` is given up; the checked value, or null where it did not land. A part that fails is kept
 * on `a` for the player's answer.
 */
async function sendPart<T>(
  a: Attempt,
  part: TransferPart,
  check: (reply: unknown) => T
): Promise<T | null> {
  let spent = 0
  for (;;) {
    const request = a.requests[part]
    if (!request) return null
    const result: Result<unknown> = await window.api.llm.generateProfiles<unknown>(
      request,
      transferGroupOf(a.character.charId)
    )
    if (!live(a)) return null
    let error: AppError
    if (result.ok) {
      try {
        return check(result.data)
      } catch (err) {
        error = toAppError(err)
      }
    } else error = result.error

    console.warn(`[transfer] the ${part} call failed:`, error)
    let wake: (() => void) | undefined
    const retried = await retrySilently(`transfer:${part}`, error, spent, {
      // An ending parked on her says the failure at once rather than sleeping it off.
      skip: endingParkedOnTransfers,
      onSleep: (cancel) => {
        wake = cancel
        a.wakes.add(cancel)
      }
    })
    if (wake) a.wakes.delete(wake)
    if (!live(a)) return null
    if (!retried) {
      a.failed.push(part)
      a.error ??= error
      return null
    }
    spent += 1
  }
}

/** Puts her on the waiting list, dealt around the landing as it stands now, and settles `a`. */
function admitToWaiting(
  a: Attempt,
  draft: TransferDraft,
  courses: TransferCourses
): void {
  const entry = composeTransfer(
    draft.profile,
    draft.secrets,
    courses,
    contextOf(a.character),
    Math.random
  )
  attempts.delete(a.character.charId)
  const game = useGameStore.getState()
  game.addPendingTransfer(entry, a.character)
  game.setTransferJob(a.character.charId, null)
  a.settle()
}

/** Her profile and secrets, then her major's classes where it runs none; false on a failure. */
async function runStudent(a: Attempt, major: string): Promise<boolean> {
  if (a.draft === null) {
    a.requests.student ??= transferStudentRequest(a.ctx, major)
    const draft = await sendPart(a, 'student', (reply) => transferStudentOf(a.ctx, major, reply))
    if (draft === null || !live(a)) return false
    a.draft = draft
  }
  if (a.majorClasses !== null) return true
  if (!a.requests.majorClasses) {
    // Asked of the landing as it stands once her load is known, another transfer's classes
    // landed since counting as her major's.
    const classCtx = contextOf(a.character)
    if (!transferNeedsMajorClasses(classCtx, major)) {
      a.majorClasses = []
      return true
    }
    a.classCtx = classCtx
    a.requests.majorClasses = transferMajorClassesRequest(
      classCtx,
      major,
      transferMajorClassCount(a.draft.profile)
    )
  }
  const classCtx = a.classCtx ?? a.ctx
  const count = transferMajorClassCount(a.draft.profile)
  const classes = await sendPart(a, 'majorClasses', (reply) =>
    transferMajorClassesOf(classCtx, major, count, reply)
  )
  if (classes === null || !live(a)) return false
  a.majorClasses = classes
  return true
}

/** Her interest class; false on failure. */
async function runInterest(a: Attempt, major: string): Promise<boolean> {
  if (a.interest !== null) return true
  a.requests.interest ??= transferInterestRequest(a.ctx, major)
  const interest = await sendPart(a, 'interest', (reply) =>
    transferInterestOf(a.ctx, major, reply)
  )
  if (interest === null || !live(a)) return false
  a.interest = interest
  return true
}

/**
 * Whether the parts `run` sends all landed, a refusal to build or check one counting as a failure
 * of `a`, so that no part is still out once its sibling has failed.
 */
async function partsLanded(a: Attempt, run: Promise<boolean>): Promise<boolean> {
  try {
    return await run
  } catch (err) {
    a.error ??= toAppError(err)
    return false
  }
}

/**
 * Runs `a` from wherever it stands: its pools dealt, or each call not yet landed sent, her
 * profile's and her interest class's at once; files the failure once every call this run sent
 * has come back.
 */
async function runAttempt(a: Attempt): Promise<void> {
  try {
    if (a.skip) {
      const skipped = skipTransfer(a.ctx, storeDeal, Math.random)
      if (!live(a)) return
      admitToWaiting(a, skipped, skipped.courses)
      return
    }

    if (a.major === null) {
      a.requests.major ??= transferMajorRequest(a.ctx)
      const major = await sendPart(a, 'major', (reply) => transferMajorOf(a.ctx, reply))
      if (!live(a)) return
      if (major === null) {
        fail(a)
        return
      }
      a.major = major
    }
    const major = a.major
    const [student, interest] = await Promise.all([
      partsLanded(a, runStudent(a, major)),
      partsLanded(a, runInterest(a, major))
    ])
    if (!live(a)) return
    if (!student || !interest || !a.draft || !a.interest || !a.majorClasses) {
      fail(a)
      return
    }
    admitToWaiting(a, a.draft, { interest: a.interest, major: a.majorClasses })
  } catch (err) {
    // The deal or the compose refused her: nothing of a call to edit, and a retry rolls again.
    if (!live(a)) return
    console.warn('[transfer] dealing her failed:', err)
    a.error = toAppError(err)
    fail(a)
  }
}

/**
 * Generates `character` as a transfer student in the background and puts her on the waiting list
 * once all of her is in: dealt off the authored pools where `skip`, otherwise asked of the model.
 * Does nothing unless the offer is open, there is room, and she is nobody the semester already
 * holds, waits for or is generating.
 */
export async function startTransfer(character: Character, skip: boolean): Promise<void> {
  const game = useGameStore.getState()
  if (transferOffer() !== 'open' || transferRoom() <= 0) return
  const { charId } = character
  if (
    attempts.has(charId) ||
    game.chars.includes(charId) ||
    game.alumni.includes(charId) ||
    game.pendingTransfers.some((entry) => entry.charId === charId)
  ) {
    return
  }
  let settle = (): void => undefined
  const settled = new Promise<void>((resolve) => {
    settle = resolve
  })
  const a: Attempt = {
    run: currentRun(),
    character,
    skip,
    ctx: contextOf(character),
    classCtx: null,
    major: null,
    draft: null,
    interest: null,
    majorClasses: null,
    requests: {},
    failed: [],
    error: null,
    wakes: new Set(),
    settled,
    settle
  }
  attempts.set(charId, a)
  game.setTransferJob(charId, { phase: 'generating', error: null })
  await runAttempt(a)
}

/**
 * Sends again every part of `charId`'s transfer that failed, as it was sent or with the first
 * failed part's `user` message replaced by `editedUser`, which every later retry of that part then
 * keeps; what already landed stands.
 */
export async function retryTransfer(charId: string, editedUser?: string): Promise<void> {
  const a = attempts.get(charId)
  if (!a || !live(a) || useGameStore.getState().transferJobs[charId]?.phase !== 'failed') return
  const part = a.failed[0]
  const request = part ? a.requests[part] : undefined
  if (part && request && editedUser !== undefined) {
    a.requests[part] = { ...request, user: editedUser }
  }
  a.failed = []
  a.error = null
  useGameStore.getState().setTransferJob(charId, { phase: 'generating', error: null })
  await runAttempt(a)
}

/** Forgets `a`, its calls cancelled and nothing kept of it, and settles it. */
function dropAttempt(a: Attempt): void {
  attempts.delete(a.character.charId)
  for (const wake of a.wakes) wake()
  a.wakes.clear()
  void window.api.jobs.cancelGroup(transferGroupOf(a.character.charId))
  a.settle()
}

/** Gives up on `charId`'s transfer, being generated or whose failure stands. */
export function abandonTransfer(charId: string): void {
  const a = attempts.get(charId)
  if (a) dropAttempt(a)
  useGameStore.getState().setTransferJob(charId, null)
}

/** Drops every transfer being generated on leaving a game, and every job with it. */
export function resetTransfers(): void {
  const game = useGameStore.getState()
  for (const a of [...attempts.values()]) {
    dropAttempt(a)
    game.setTransferJob(a.character.charId, null)
  }
  endingWaits.clear()
  if (game.endingAwaitsTransfers) game.setEndingAwaitsTransfers(false)
}

/** Takes `charId` off the waiting list, while the offer is open. */
export function cancelPendingTransfer(charId: string): void {
  if (transferOffer() !== 'open') return
  useGameStore.getState().dropPendingTransfer(charId)
}

/**
 * Resolves once every transfer being generated as this is called has landed on the waiting list
 * or been given up; a failed one waits for the player's answer.
 */
export async function transfersSettled(): Promise<void> {
  await Promise.all([...attempts.values()].map((a) => a.settled))
}

/**
 * Awaits an ending's `opening` with the store saying so while transfers are out, so that a
 * failure among them is raised at the ending's wait; `opening` as it is otherwise.
 */
export async function endingAwaitingTransfers<T>(opening: Promise<T>): Promise<T> {
  if (attempts.size === 0) return opening
  const token = {}
  endingWaits.add(token)
  useGameStore.getState().setEndingAwaitsTransfers(true)
  try {
    return await opening
  } finally {
    endingWaits.delete(token)
    if (endingWaits.size === 0 && useGameStore.getState().endingAwaitsTransfers) {
      useGameStore.getState().setEndingAwaitsTransfers(false)
    }
  }
}

/**
 * The request of `charId`'s first failed part, as a retry would send it; null with no failed
 * call.
 */
export function transferFailedPrompt(charId: string): StructuredRequest | null {
  const a = attempts.get(charId)
  if (!a || !live(a)) return null
  const part = a.failed[0]
  return part ? (a.requests[part] ?? null) : null
}

/**
 * Whether `charId`'s failure has a prompt to hand-edit: a call failed rather than the pools' deal.
 * The failure modal narrows it further by the error's code, as it does for every call.
 */
export function transferFailureOffersEdit(charId: string): boolean {
  return transferFailedPrompt(charId) !== null
}

/** Every waiting transfer whose character is held, as she arrives at the next slot. */
export function pendingArrivals(): Arrival[] {
  const game = useGameStore.getState()
  return game.pendingTransfers.flatMap(({ charId, profile, state }) => {
    const character = game.pendingCharacters[charId]
    if (!character || game.chars.includes(charId)) return []
    return [{ charId, character, info: { ...blankCharInfo(), ...profile, ...state } }]
  })
}

/** How many of the roster transferred in at `date`/`time`. */
export function arrivedAt(date: number, time: TimeSlot): number {
  const game = useGameStore.getState()
  const slot = globalSlotOf(date, time)
  return game.chars.filter((charId) => game.charInfo[charId]?.transferredAt === slot).length
}
