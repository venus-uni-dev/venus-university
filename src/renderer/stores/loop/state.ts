import type {
  BankedOpening,
  Character,
  LedgerResponse,
  SaveDraft,
  SceneLine,
  SceneState
} from '@shared/types'
import type { JobShift } from '@shared/jobs'
import type { ExamPeriod } from '@shared/academics'
import type { HangoutPrefetch } from './hangouts'
import type { Verdict } from './classify'
import type { StatusStep } from './statusSteps'
import type { MemoryAnswer } from './memoryEdit'

/**
 * Everything the slot loop holds between calls, in one object, so {@link resetLoopState} is
 * exhaustive by construction.
 */

/**
 * Everything a failed turn is rewound to, taken before the turn runs; also the
 * base the reply's autosave is composed onto.
 */
export interface TurnSnapshot {
  scene: SceneState | null
  action: string
  /** The agreed hangout this turn is, so a retry replays it as one. */
  charId?: string
  /** This turn handed over a gift; abandoning it hands the item back. */
  gift?: boolean
  /** This turn is the authored orientation scene, so a retry re-enters it. */
  intro?: boolean
  /** The epilogue goodbye this turn is, and who it is with. */
  farewell?: string
  /** The settled verdict this turn runs on, so a retry re-classifies nothing. */
  preset?: Verdict
}

/**
 * Whether the turn's action is the app's own writing rather than the reader's — the orientation
 * premise and a goodbye's. Neither is a sentence he can be handed back.
 */
export function authoredTurn(snapshot: TurnSnapshot): boolean {
  return Boolean(snapshot.intro || snapshot.farewell)
}

/**
 * How the player answered an ending call's failure modal. `prompt` is a hand-edited
 * `user` message, kept by the caller for every later retry of the same call.
 */
export type EndingAnswer = { retry: false } | { retry: true; prompt?: string }

/** The project a scene is a work session on, credited at the boundary. */
export interface ProjectWork {
  code: string
  exam: ExamPeriod
}

export const loopState = {
  /** One stay inside a playthrough; continuations bail when it goes stale. */
  runToken: {} as object,

  /** The next slot's opening, paid for and waiting for the boundary. */
  bankedOpening: null as BankedOpening | null,

  /** An exam's opening, in flight while the player answers; null after a reload. */
  examOpening: null as Promise<BankedOpening | null> | null,

  /**
   * The texting ledger fired at scene start, keyed on a fingerprint of the slot's message set;
   * `stale` lets an abandoned prefetch die without surfacing a modal.
   */
  textLedgerPrefetch: null as {
    key: string
    promise: Promise<LedgerResponse | null>
    stale: boolean
  } | null,

  /** An exam slot's texting ledger, in flight while the paper is answered. */
  examTextLedger: null as Promise<LedgerResponse | null> | null,

  /**
   * Continuations waiting for the player to be blocked before a failure modal surfaces; woken by
   * `waitingForLine` rising and by every reset, and each re-checks its predicate.
   */
  parkedWaiters: [] as Array<() => void>,

  /** `beginSlot` is waiting on its own narration — the window the store's `endingInFlight` misses. */
  openingWait: false,

  /** What an ending call's failure modal is waiting on, while the player answers it. */
  endingGate: null as ((answer: EndingAnswer) => void) | null,

  /** What the boundary's memory question is waiting on, while the player answers it. */
  memoryGate: null as ((answers: readonly MemoryAnswer[]) => void) | null,

  /** Serializes the ending's failure modals — two calls, one screen. */
  modalQueue: Promise.resolve() as Promise<void>,

  /** The player has answered one of this ending's modals with "leave". */
  endingAbandoned: false,

  /** The shift being worked this scene; cleared on every casting turn. */
  jobShift: null as JobShift | null,

  /** The project this scene is a work session on, credited at the boundary. */
  projectWork: null as ProjectWork | null,

  /** An armed hangout's scene, already in flight while the player reads. */
  hangoutPrefetch: null as HangoutPrefetch | null,

  /**
   * The graduation picture's run, held only as a guard against a second call; whether
   * the ending is still waiting is `gameStore.endingArtPending`.
   */
  endingArt: null as Promise<void> | null,

  /** The epilogue's status-update call has been made this stay; nothing waits on it. */
  endingPosts: false,

  /**
   * The ending in progress; re-minted to drop it, so each of its continuations bails at its next
   * check while the run carries on.
   */
  endingToken: {} as object,

  /** The live scene call's token; replaced or cleared to abandon that call. */
  sceneCall: null as object | null,

  /** The resolved ledger, held until playback drains alongside the store's `sceneEnding`. */
  pendingLedgerResult: null as LedgerResponse | null,

  /** Everyone who was in the scene being wrapped up — the ledger's cast, kept for its retry. */
  closingCast: null as Character[] | null,

  /** The same scene minus whoever already left: the cast the goodbye is written for. */
  closingCastPresent: null as Character[] | null,

  /** The turn most recently submitted, kept so a failure can rewind or re-send it. */
  lastTurn: null as TurnSnapshot | null,

  /**
   * When the player committed to this turn's wait — what the reply floor is
   * measured from. Null means nobody is waiting on the call.
   */
  turnStartedAt: null as number | null,

  /** The last scene call's `user` message, so a blocked turn can be hand-edited. */
  lastScenePrompt: null as string | null,

  /**
   * A `user` message waiting for the resend that spends it — hand-edited, or shortened by the
   * content-block guard. One-shot: `streamScene` clears it as it applies it.
   */
  promptOverride: null as string | null,

  /** This attempt has spent its one silent resend on a content block; `failTurn` clears it. */
  blockedRetrySpent: false,

  /**
   * Silent resends an authored turn has spent behind the lines it was written under. Not cleared
   * by `failTurn`: past the budget every answer costs one attempt, as an ending call's does.
   */
  authoredRetrySpent: 0,

  /** The ledger call's `user` message; kept apart so the editor opens on the call that failed. */
  lastLedgerPrompt: null as string | null,

  /** The texting-ledger call's `user` message; it runs parallel to the scene ledger's. */
  lastTextLedgerPrompt: null as string | null,

  /** The slot-opening call's `user` message; its `RECENTLY` block is filter-prone. */
  lastIntroPrompt: null as string | null,

  /**
   * The slot-save covering this slot, so its opening narration folds back into
   * it. Null means unknown, and the fold is skipped.
   */
  slotSaveId: null as string | null,

  /**
   * The scene's last decision point, held for the leave path alone. Null
   * until the first reply has been read out, where there is nothing to go back to.
   */
  decisionSave: null as SceneState | null,

  /** The pre-turn scene the end-of-scene autosave is composed onto. */
  endBase: null as SceneState | null,

  /** The resolved scene's lines, plus the goodbye once it lands — the ending, replayable. */
  endLines: null as SceneLine[] | null,

  /**
   * What is left of the scene-end status sequence — the runs of lines still to play and the
   * screens still to raise. Nothing between the messages and the boundary is written, so a
   * reload rebuilds the whole of it.
   */
  statusSteps: [] as StatusStep[],

  /**
   * The save the scene's ending stood at the moment its status sequence was raised, before any
   * money moved: what a save taken anywhere inside that sequence records.
   */
  statusBase: null as SaveDraft | null
}

/**
 * Clears what one finished turn leaves behind, at the slot boundary — the one list
 * of turn-owned fields the boundary and {@link resetLoopState} share.
 */
export function resetTurnSlice(): void {
  loopState.lastTurn = null
  loopState.turnStartedAt = null
  loopState.lastScenePrompt = null
  loopState.promptOverride = null
  loopState.blockedRetrySpent = false
  loopState.authoredRetrySpent = 0
  loopState.decisionSave = null
  loopState.endBase = null
  loopState.endLines = null
  loopState.statusBase = null
}

/**
 * The cancellation group for every loop call that is neither a scene call nor an ending's
 * bookkeeping — an opening a slot fetches for itself, the classifier, the texting ledger, the
 * epilogue's picture and posts. Cancelled only on leaving.
 */
export const LOOP_LLM_GROUP = 'loop:llm'

/**
 * The cancellation group for the scene calls — every reply and the goodbye. Cancelled on leaving
 * and by an interjection, which aborts the call it cuts short.
 */
export const SCENE_LLM_GROUP = 'loop:scene'

/**
 * The cancellation group for an ending's bookkeeping — the scene ledger and the next slot's
 * opening. Cancelled on leaving and by an interjection that interrupts the ending.
 */
export const ENDING_LLM_GROUP = 'loop:ending'

/** The current run's identity, captured before a continuation's first `await`. */
export function currentRun(): object {
  return loopState.runToken
}

/** Whether the run a continuation started in has since been left. */
export function runStale(run: object): boolean {
  return loopState.runToken !== run
}

/** Resets every field of {@link loopState}. Paired with `gameStore.reset()` on leaving a game. */
export function resetLoopState(): void {
  resetTurnSlice()
  // Re-minted here, so no leave path can forget to fence what it abandoned.
  loopState.runToken = {}
  loopState.endingToken = {}
  loopState.sceneCall = null
  loopState.pendingLedgerResult = null
  loopState.lastLedgerPrompt = null
  loopState.lastTextLedgerPrompt = null
  loopState.lastIntroPrompt = null
  // Marked stale as well as dropped: the retry loop reads the flag and dies quietly.
  if (loopState.textLedgerPrefetch) loopState.textLedgerPrefetch.stale = true
  loopState.textLedgerPrefetch = null
  loopState.examTextLedger = null
  loopState.openingWait = false
  // Woken so each sees the fresh run token; one left hanging would strand a future ending.
  const parked = loopState.parkedWaiters
  loopState.parkedWaiters = []
  for (const wake of parked) wake()
  loopState.closingCast = null
  loopState.closingCastPresent = null
  loopState.slotSaveId = null
  loopState.statusSteps = []
  loopState.jobShift = null
  // A session carried across a load would be filed against another save.
  loopState.projectWork = null
  // Nothing in flight is left holding a modal open on a view that is unmounting.
  loopState.endingGate = null
  loopState.memoryGate = null
  loopState.endingAbandoned = false
  loopState.modalQueue = Promise.resolve()
  // Whatever save is loaded next brings its own opening off disk.
  loopState.bankedOpening = null
  // An in-flight prefetch is simply abandoned; the next armed hangout makes its own call.
  loopState.hangoutPrefetch = null
  // Abandoned the same way; the bytes it holds are released separately, by `dropEndingArt`.
  loopState.endingArt = null
  // The next stay asks again, and `endingPostsDelivered` is what stops it filing twice.
  loopState.endingPosts = false
  loopState.examOpening = null
}
