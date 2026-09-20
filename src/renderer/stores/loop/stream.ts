import { appError } from '@shared/errors'
import type { AppError, SceneLine, StructuredRequest } from '@shared/types'
import { useGameStore } from '../gameStore'
import {
  createSceneSanitizer,
  sanitizeScene,
  splitOverflow,
  stageAsWritten,
  type SanitizerOptions
} from '../sceneSanitizer'
import { createLineExtractor } from '../sceneStream'
import { boxFits } from '../../views/boxRows'
import { owedFloor } from '../replyFloor'
import { sceneCoverClosing } from '../slotCrossing'
import { advance } from './hooks'
import { currentRun, loopState, runStale, LOOP_LLM_GROUP } from './state'

/** The one channel every scene call goes down. */

/**
 * Puts lines on the transcript and queue, and hands playback to whoever is waiting on them;
 * held and flushed together, in arrival order, while a scene's opening curtain is still closing.
 * The curtain itself is the stage's to raise, once it has drawn the line's picture.
 */
let held: { lines: SceneLine[]; run: object }[] = []
let flushing: Promise<void> | null = null

export function deliverSceneLines(lines: SceneLine[], run: object): Promise<void> {
  if (lines.length === 0) return Promise.resolve()

  // **A batch queues behind one already waiting, whatever the phase says.** The flush is
  // released by a store subscription, so there is a hair of a window between the cover landing
  // and the held lines being written; a batch arriving in it would find nothing in its way and
  // overtake the ones in front of it. Order is the guarantee this function exists for.
  const covering = held.length > 0 ? flushing : sceneCoverClosing()
  if (covering) {
    held.push({ lines, run })
    // One flush for however many batches arrive behind the sheet, so their order is the order
    // they were streamed in rather than the order their timers happen to fire.
    flushing ??= covering.then(() => {
      const owed = held
      held = []
      flushing = null
      for (const batch of owed) {
        if (runStale(batch.run)) continue
        writeSceneLines(batch.lines)
      }
    })
    return flushing
  }

  writeSceneLines(lines)
  return Promise.resolve()
}

/** The write itself: the transcript, the queue, and the reader parked at the end of it. */
function writeSceneLines(lines: SceneLine[]): void {
  const live = useGameStore.getState()
  live.appendSceneLines(lines)
  live.appendPendingLines(lines)
  // Whoever is waiting on the box is served by the same handoff.
  if (live.waitingForLine) {
    live.setWaitingForLine(false)
    advance()
  }
}

/** Drops what a cover is still holding — a teardown taking the run those lines were for. */
export function dropHeldSceneLines(): void {
  held = []
}

/**
 * Where a scene call's lines go while it is in flight. Only the hangout prefetch
 * supplies one.
 */
export interface PreviewSink {
  live: boolean
  settled: boolean
  held: SceneLine[]
}

/** What one scene call comes back with, resolved. */
export type SceneCall = Promise<
  | { ok: true; data: { lines: SceneLine[]; summary: string | null; end: boolean; applied: boolean } }
  | { ok: false; error: AppError }
>

/** Queues narration lines and hands playback back if the player is parked. */
export function queueLines(lines: readonly (string | SceneLine)[]): void {
  useGameStore
    .getState()
    .appendPendingLines(
      lines.map((line) => (typeof line === 'string' ? { speaker: '', text: line } : line))
    )
}

/**
 * True while a scene is running — the game loop's own marker, a written transcript or a running
 * summary; not the cast, which a solo scene lacks.
 */
export function sceneInProgress(): boolean {
  const game = useGameStore.getState()
  return game.currentSceneTranscript.length > 0 || game.sceneSummary !== null
}

/**
 * Runs one scene request for an action or wrap-up turn. Streams sanitized preview
 * lines behind the reply floor, then reconciles with the resolved response.
 */
export async function streamScene(
  request: StructuredRequest,
  sink?: PreviewSink,
  options: SanitizerOptions = {}
): SceneCall {
  const run = currentRun()

  // The override that answers the edit modal is spent here — by no prefetch, which has no
  // failed turn of its own and must not swallow a resend's.
  if (loopState.promptOverride !== null && !sink) {
    request = { ...request, user: loopState.promptOverride }
    loopState.promptOverride = null
  }
  loopState.lastScenePrompt = request.user

  if (!sink || sink.live) useGameStore.getState().setStreaming(true)

  // Stage and `fits` are seeded once here, before the first line can play: re-reading the stage
  // after playback advances would drop a `show:` a resumed autosave needs, and both of this
  // call's passes must cut lines identically or a preview/authoritative mismatch diverges.
  options = {
    ...options,
    stage: options.stage ?? stageAsWritten().onStage,
    fits: options.fits ?? boxFits
  }

  // One sanitizer for every preview chunk; for a prefetch that is before Begin, onto a
  // stage the hangout gate guarantees empty.
  const sanitizer = createSceneSanitizer(options)
  const extractor = createLineExtractor()
  let streamed = 0

  /** The last delivery this call made, which it waits out before reporting itself finished. */
  let delivered: Promise<void> = Promise.resolve()

  /**
   * Puts sanitized lines where this call's lines go — the prefetch's sink, or the screen. What
   * is owed to a cover still closing is the delivery's, and this call's own share of it is
   * tracked so `streamScene` cannot return with lines still behind a sheet.
   */
  function emit(fresh: SceneLine[]): void {
    if (sink && !sink.live) {
      sink.held.push(...fresh)
      return
    }
    delivered = deliverSceneLines(fresh, run)
  }

  // What the player's wait is measured from, or null when nobody is waiting;
  // preview lines are held rather than the reply delayed.
  const startedAt = loopState.turnStartedAt
  const floorHeld: SceneLine[] = []
  let floorPaid = startedAt === null

  /** Releases what the floor held. Idempotent, and it writes nothing for a run already left. */
  function payFloor(): void {
    if (floorPaid) return
    floorPaid = true
    if (floorHeld.length === 0 || runStale(run)) return
    emit(floorHeld.splice(0))
  }

  const floor =
    startedAt === null
      ? null
      : new Promise<void>((resolve) => {
          setTimeout(() => {
            payFloor()
            resolve()
          }, owedFloor(startedAt))
        })

  const unsubscribe = window.api.llm.onSceneDelta((delta) => {
    // The broadcast outlives the run.
    if (runStale(run)) return

    const fresh = extractor
      .feed(delta)
      .flatMap((raw) => splitOverflow(sanitizer.sanitizeLine(raw as SceneLine), options.fits))
    if (fresh.length === 0) return

    // Counted before the hold, so the count and the reconciliation below agree.
    streamed += fresh.length
    if (!floorPaid) {
      floorHeld.push(...fresh)
      return
    }

    emit(fresh)
  })

  let result: Awaited<ReturnType<typeof window.api.llm.completeScene>>
  try {
    result = await window.api.llm.completeScene(request, LOOP_LLM_GROUP)
    // Inside the `try`, so the flag below falls on the far side of the floor and a drained
    // queue cannot read as the end of a scene still owed lines.
    if (floor && !runStale(run)) await floor
  } finally {
    unsubscribe()
    if (sink) sink.settled = true
    // An abandoned call lowering it would clear the spinner off a scene still streaming.
    if (!runStale(run)) useGameStore.getState().setStreaming(false)
  }

  if (runStale(run)) return { ok: false, error: appError('CANCELLED', 'The scene was abandoned.') }

  if (!result.ok) return result

  // The same options the preview ran under, or the two passes disagree.
  const { lines, summary, end } = sanitizeScene(result.data, options)

  // A prefetch still holding its lines has nothing to reconcile; Begin appends the reply whole.
  if (sink && !sink.live) return { ok: true, data: { lines, summary, end, applied: false } }

  const game = useGameStore.getState()

  if (streamed === lines.length) {
    // The preview was the whole scene; nothing to append.
  } else if (streamed === 0) {
    // Nothing streamed, so this is the scene arriving whole — and it is what a cover raised on
    // the click is waiting for, exactly as a first delta would have been.
    delivered = deliverSceneLines(lines, run)
  } else {
    // If preview and resolved reply disagree, discard preview rather than splice
    // two generations together.
    console.warn(
      `[scene] streamed ${streamed} lines but the reply has ${lines.length} — discarding the preview.`
    )
    game.dropSceneTranscript(streamed)
    game.dropPendingLines(streamed)
    game.appendSceneLines(lines)
    game.appendPendingLines(lines)
    game.setWaitingForLine(true)
  }

  // Retire only authoritative lines into the new summary; without a summary,
  // keep accumulating the transcript.
  if (summary) {
    const live = useGameStore.getState()
    live.setSceneSummary(summary)
    live.setSceneTranscript(lines)
  }

  // Nothing may report itself finished while its own lines are still behind a sheet: a caller
  // that read the store here would find a scene that has not arrived yet.
  await delivered

  return { ok: true, data: { lines, summary, end, applied: true } }
}

/** Hands playback back to a player parked on the spinner at the end of the queue. */
export function unpark(): void {
  if (useGameStore.getState().waitingForLine) {
    useGameStore.getState().setWaitingForLine(false)
    advance()
  }
}
