import { isPermanent } from '@shared/errors'
import type { AppError, Character } from '@shared/types'
import { shortenSceneSoFar } from '../../prompts/scenePrompt'
import { useGameStore } from '../gameStore'
import { retrySilently } from '../silentRetry'
import { castCharactersOf } from './cast'
import { dispatchTurn, runEnding } from './hooks'
import { queuedScene, writeAutosave } from './saves'
import { authoredTurn, currentRun, loopState, runStale, type TurnSnapshot } from './state'
import { deliverSceneLines, unpark, type SceneCall } from './stream'

/** One turn, from the reply landing to the scene being over. */

/**
 * Puts the scene back as the turn found it, without deciding what happens next.
 * Shared by the failure modal and the content-block guard's silent resend.
 */
function rewindTurn(snapshot: TurnSnapshot): void {
  const game = useGameStore.getState()
  // The capture covers the slot opening too, so a rejected first action is no special case.
  game.restoreScene(snapshot.scene)
  // The two scene-kind records follow the scene put back, or a hangout begun afterwards — which
  // has no casting turn to clear them — is paid a wage for somebody else's shift.
  if (!snapshot.scene?.jobId) loopState.jobShift = null
  if (!snapshot.scene?.projectClass) loopState.projectWork = null
  game.setStreaming(false)
  game.setWaitingForLine(false)
}

/**
 * The rewind an authored turn takes instead of {@link rewindTurn}: the queue stays the reader's,
 * and only this attempt's own streamed tail — preview lines added since the snapshot — is
 * dropped. Idempotent: a rewind that already ran finds nothing to drop.
 */
function rewindAuthoredTurn(snapshot: TurnSnapshot): void {
  const game = useGameStore.getState()
  const streamed = Math.max(
    0,
    game.currentSceneTranscript.length - (snapshot.scene?.transcript.length ?? 0)
  )
  const scene = snapshot.scene && {
    ...snapshot.scene,
    pendingLines: game.pendingLines.slice(0, Math.max(0, game.pendingLines.length - streamed)),
    currentLine: game.currentLine
  }
  rewindTurn({ ...snapshot, scene })
  // A reader out of lines is a reader waiting: the spinner is his, and so is the modal the
  // moment there is one. `advance()` raises it for a queue drained after this.
  if (!scene || scene.pendingLines.length === 0) {
    useGameStore.getState().setWaitingForLine(true)
  }
}

/**
 * Rewinds a failed turn to its snapshot and opens the retry/reword modal.
 * Retryable errors keep input locked; permanent errors restore the player's text.
 */
export function failTurn(error: AppError, snapshot: TurnSnapshot): void {
  const game = useGameStore.getState()
  const authored = authoredTurn(snapshot)
  if (authored) rewindAuthoredTurn(snapshot)
  else rewindTurn(snapshot)
  game.setBusy(false)
  game.setTurnError(error)
  // The attempt is over once the modal is up; the guard re-arms for whatever answers it.
  loopState.blockedRetrySpent = false

  // Only words the reader owns go back to the box: an authored premise and a gift's sentence
  // are the app's own, and its modal offers him no reword to put them in.
  if (isPermanent(error) && !authored) {
    game.setInputDraft(snapshot.gift ? '' : snapshot.action)
    game.setAwaitingInput(true)
  }
}

/**
 * The silent budget an authored turn spends before its modal, on an ending call's rule: nobody
 * asked for this call, and while the reader still has the lines it was written behind
 * to read it re-sends itself under them. Returns true once it has taken the failure over.
 */
async function resendAuthoredTurn(
  error: AppError,
  snapshot: TurnSnapshot,
  superseded: () => boolean
): Promise<boolean> {
  if (!authoredTurn(snapshot)) return false

  const spent = loopState.authoredRetrySpent
  // Rewound before the backoff rather than after it: whatever the attempt previewed comes off
  // the queue the reader is reading, and `streaming` holds the box shut over the gap, so a
  // drain under a resend parks on the spinner instead of opening the input.
  rewindAuthoredTurn(snapshot)
  useGameStore.getState().setStreaming(true)

  const resend = await retrySilently('scene', error, spent, {
    // Out of lines, he is owed the modal rather than another wait.
    skip: () => useGameStore.getState().waitingForLine,
    // The same wake `waitingForLine` rising already fires, so parking cuts a backoff short.
    onSleep: (cancel) => loopState.parkedWaiters.push(cancel)
  })
  if (!resend) return false
  if (superseded()) return true

  loopState.authoredRetrySpent = spent + 1
  dispatchTurn(snapshot)
  return true
}

/** The one silent resend a content block earns, before the modal. */
function retryBlockedTurn(error: AppError, snapshot: TurnSnapshot): boolean {
  if (error.code !== 'LLM_BLOCKED' || loopState.blockedRetrySpent) return false
  const shortened = shortenSceneSoFar(loopState.lastScenePrompt ?? '')
  if (shortened === null) return false

  console.warn('[scene] blocked — re-sending once with the transcript cut back')
  loopState.blockedRetrySpent = true
  rewindTurn(snapshot)
  // The two gates the dispatch runs into, in `retryTurn`'s order and with no `await` before
  // it, so nothing lands in the gap where input is open and nothing is in flight.
  useGameStore.getState().setBusy(false)
  useGameStore.getState().setAwaitingInput(true)
  // One-shot, spent by the resend's own `streamScene`.
  loopState.promptOverride = shortened
  dispatchTurn(snapshot)
  return true
}

/**
 * The back half of every scene-opening turn — player-typed and hangout alike:
 * stream the reply, then either hand playback back or fire the wrap-up calls.
 */
export async function runSceneTurn(
  pending: SceneCall,
  snapshot: TurnSnapshot,
  cast: readonly string[],
  castCharacters: Character[],
  solo: boolean
): Promise<void> {
  const run = currentRun()
  // The call `pending` is, claimed synchronously when it went out.
  const call = loopState.sceneCall
  /** The run was left, or an interjection cut this turn's call short and took its place. */
  const superseded = (): boolean => runStale(run) || loopState.sceneCall !== call
  const result = await pending

  // The reply belongs to a run the player has left, or to a call he interjected over: neither
  // may reach the failure modal or the authored resend.
  if (superseded()) return

  if (!result.ok) {
    // Every failure lands here, malformed JSON included; a content block is re-sent once
    // behind the player's back, an authored scene re-sends itself behind the lines it was
    // written under, and everything else is the permanent/retryable split.
    if (retryBlockedTurn(result.error, snapshot)) return
    if (await resendAuthoredTurn(result.error, snapshot, superseded)) return
    if (superseded()) return
    failTurn(result.error, snapshot)
    return
  }

  // A turn that landed re-arms both guards for the next one.
  loopState.blockedRetrySpent = false
  loopState.authoredRetrySpent = 0

  // A prefetch that resolved before Begin left its lines nowhere, so the reply is queued whole;
  // its `finally` ran before Begin raised `streaming`, so that is lowered here.
  if (!result.data.applied) {
    // Through the one delivery, so a prefetch landing behind a scene opening's curtain waits
    // that cover out exactly as a streamed line does.
    await deliverSceneLines(result.data.lines, run)
    if (superseded()) return
    const live = useGameStore.getState()
    if (result.data.summary) live.setSceneSummary(result.data.summary, result.data.at)
    live.setStreaming(false)
  } else if (result.data.summary) {
    // `streamScene` has already waited out its own delivery, so the lines are on the transcript.
    useGameStore.getState().setSceneSummary(result.data.summary, result.data.at)
  }

  // `end_scene` is stashed until playback reaches the last line; a solo scene is over
  // after its one turn.
  const ending = solo || result.data.end
  useGameStore.getState().setSceneEnding(ending)

  if (!ending) {
    // Written before playback is handed back: `unpark()` can run to the next decision point,
    // whose own write has to be the later of the two.
    await writeAutosave(queuedScene(snapshot.scene, result.data.lines))
    if (superseded()) return
    useGameStore.getState().setBusy(false)
    unpark()
    return
  }

  // Two casts: the goodbye is written for whoever is still in the scene, the ledger for
  // everyone who was in it, departed included.
  loopState.closingCastPresent = castCharacters
  loopState.closingCast = castCharactersOf(cast, true)
  // The ending's one autosave is composed from this base and accumulates the
  // goodbye as it arrives.
  loopState.endBase = snapshot.scene
  loopState.endLines = [...result.data.lines]
  // Raised before the first call and lowered by the write that ends it: the
  // boundary parks while it is up.
  loopState.endingInFlight = true
  loopState.endingAbandoned = false

  await runEnding(solo)
}
