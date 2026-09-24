import type { Character } from '@shared/types'
import { buildScenePrompt } from '../../prompts/scenePrompt'
import { SETTING } from '../../prompts/setting'
import { useGameStore } from '../gameStore'
import { coverSceneOpening } from '../slotCrossing'
import { castCharactersOf, nameOf } from './cast'
import {
  admitLocals,
  injectPasserby,
  resolveAttendance,
  resolveLocationId,
  runIntoNote,
  workersAtLocation
} from './casting'
import {
  buildClassifyAttempt,
  classifyAction,
  classifyOnce,
  type ClassifyAttempt,
  type Verdict
} from './classify'
import { registerHangoutEntry } from './hooks'
import { applyCast, reader, scenePromptState } from './promptState'
import { currentRun, loopState, runStale, type TurnSnapshot } from './state'
import { deliverSceneLines, streamScene, type PreviewSink, type SceneCall } from './stream'
import { runSceneTurn } from './turn'

/** An agreed Bunnyboard hangout, from the plan to the scene. */
registerHangoutEntry({ prefetchHangoutScene, startHangoutScene })

/** An armed hangout's scene, already in flight while the player reads. */
export interface HangoutPrefetch {
  charId: string
  snapshot: TurnSnapshot
  /** Null until the call is away — and for good if the classifier refused it. */
  scene: {
    cast: string[]
    castCharacters: Character[]
    action: string
    sink: PreviewSink
    pending: SceneCall
  } | null
  /** The spent classifier call, so Begin's parking loop re-sends rather than re-asks. */
  attempt?: ClassifyAttempt
}

/**
 * Starts an armed hangout's scene while the player is still reading the reply that agreed to
 * it, so **Begin** has lines in hand.
 */
async function prefetchHangoutScene(charId: string, description: string): Promise<void> {
  const game = useGameStore.getState()
  if (game.busy || loopState.hangoutPrefetch) return

  // Before any mutation, so a failed turn rewinds to the reader's own state.
  const snapshot: TurnSnapshot = { scene: game.captureScene(), action: description, charId }

  // Claimed before the first await: a Begin during the classify takes it and every checkpoint
  // below bails, or two scene calls would cross their deltas on the one broadcast channel.
  const token: HangoutPrefetch = { charId, scene: null, snapshot }
  loopState.hangoutPrefetch = token

  const attempt = buildClassifyAttempt(description)
  const result = await classifyOnce(attempt)
  if (loopState.hangoutPrefetch !== token) return
  if (!result.ok) {
    console.warn('[hangout] the prefetched classify failed, parking it until Begin:', result.error)
    attempt.result = result
    token.attempt = attempt
    return
  }

  // Stamped before the scene call goes out, so a scene failure retries on this verdict rather
  // than classifying again; the cast is re-decided on that retry.
  token.snapshot.preset = result.verdict

  const { cast, action } = await castHangout(charId, description, result.verdict)
  if (loopState.hangoutPrefetch !== token) return
  const castCharacters = castCharactersOf(cast)
  // Not `logPlayerAction`: the reader's line in the transcript would take the Bunnyboard's
  // composer away mid-read. Begin logs it.
  const request = buildScenePrompt(castCharacters, action, scenePromptState(), SETTING, reader())
  const sink: PreviewSink = { live: false, settled: false, held: [] }
  token.scene = {
    cast,
    castCharacters,
    action,
    sink,
    // An opening call onto an empty stage, like any other.
    pending: streamScene(request, sink, { forceShowSpeakers: true })
  }
}

/**
 * Opens a scene from an agreed Bunnyboard hangout: the plan's description is the reader's
 * action, classified exactly like a typed one.
 */
export async function startHangoutScene(
  charId: string,
  description: string,
  preset?: Verdict
): Promise<void> {
  const run = currentRun()
  const game = useGameStore.getState()
  if (game.busy) return

  // A hangout opens a scene like any other action, so it is covered like one: the curtain goes
  // up on Begin and comes off the scene's first line, once the stage has drawn it.
  coverSceneOpening()

  const prefetched = loopState.hangoutPrefetch
  loopState.hangoutPrefetch = null

  const ready = prefetched?.charId === charId ? prefetched : null
  const snapshot: TurnSnapshot = ready?.snapshot ?? {
    scene: game.captureScene(),
    action: description,
    charId,
    // A retry arrives with the verdict its failed attempt settled; a first Begin
    // with none, and classifies below.
    ...(preset ? { preset } : {})
  }
  loopState.lastTurn = snapshot

  game.setInputDraft('')
  game.setAwaitingInput(false)
  // Raised before the classify call, so one flag covers the whole in-flight window.
  game.setBusy(true)
  loopState.turnStartedAt = performance.now()
  game.setStreaming(true)
  game.setWaitingForLine(true)

  if (ready?.scene) {
    const scene = ready.scene
    // First, so the reader's own line precedes the scene's in the log. An opening, not a
    // continuation: the hangout scene starts here.
    useGameStore.getState().logPlayerAction(scene.action, false)

    // Only what is still held: a call that settled before Begin is appended whole by
    // `runSceneTurn`, and flushing its preview too would queue the scene twice.
    if (!scene.sink.settled) {
      scene.sink.live = true
      const held = scene.sink.held
      scene.sink.held = []
      // The one delivery, so a prefetch flushed into a scene opening waits out the cover that
      // opening raised rather than painting the scene in front of the reader.
      if (held.length > 0) await deliverSceneLines(held, run)
    }

    await runSceneTurn(scene.pending, snapshot, scene.cast, scene.castCharacters, false)
    return
  }

  // No usable prefetch — a retry, or an arm whose classifier failed, whose held failure goes
  // to the parking loop rather than being sent again.
  const verdict = preset ?? (await classifyAction(description, prefetched?.attempt))
  // The classifier's failure modal was answered with "leave".
  if (!verdict) return
  if (runStale(run)) return
  // Settled once, so a scene failure after this point retries without re-asking.
  if (!snapshot.preset) snapshot.preset = verdict

  const cast = await castHangout(charId, description, verdict)
  if (runStale(run)) return
  // An opening, not a continuation: the hangout scene starts here.
  useGameStore.getState().logPlayerAction(cast.action, false)
  const castCharacters = castCharactersOf(cast.cast)
  const request = buildScenePrompt(
    castCharacters,
    cast.action,
    scenePromptState(),
    SETTING,
    reader()
  )
  await runSceneTurn(
    streamScene(request, undefined, { forceShowSpeakers: true }),
    snapshot,
    cast.cast,
    castCharacters,
    false
  )
}

/**
 * Casts an agreed hangout and settles the phone for the slot it is spending — the
 * one path the prefetch and the serial fallback share.
 */
async function castHangout(
  charId: string,
  description: string,
  verdict: Verdict
): Promise<{ cast: string[]; action: string }> {
  const { mentioned, inPublic, sceneLocation } = verdict

  // A girl at work where they are meeting is available rather than busy.
  const workers = workersAtLocation(sceneLocation).map((worker) => worker.charId)
  const attendance = resolveAttendance(mentioned, charId, workers)
  const notes = [...attendance.notes]
  let cast = attendance.cast

  // A hangout rolls like a named typed action: the pinned character is the naming.
  const passerby = injectPasserby(cast, inPublic, resolveLocationId(sceneLocation))
  if (passerby) {
    cast = [...cast, passerby]
    notes.push(runIntoNote([passerby]))
  }

  // Last, after the pinned character has her slot; named, so a haunt is the crash-the-party
  // roll, except for whoever she is out with this slot.
  const atWork = admitLocals(cast, sceneLocation, { named: true, inPublic })
  cast = atWork.cast
  const action = [description, ...notes, ...atWork.notes].join('\n')

  console.log(
    `[cast] hangout: ${mentioned.map(nameOf).join(', ') || 'nobody'}` +
      `${inPublic ? ' [public]' : ' [private]'}` +
      ` → cast: ${cast.map(nameOf).join(', ')}` +
      `${passerby ? ` (ran into ${nameOf(passerby)})` : ''}`
  )

  // She is never her own snub: answering her cleared her `pendingHangout`, and the cast
  // `applyCast` expires against covers the whole room.
  await applyCast(cast, {
    ...(atWork.jobId ? { visitJobId: atWork.jobId } : {}),
    // The texts that arranged this are not a plan he still owes her; her thread alone,
    // since only one attendee ever texts about a plan.
    textLedgerSkip: charId,
    mentions: verdict.mentionedOnly.filter((id) => !cast.includes(id)),
    location: sceneLocation || null,
    inPublic
  })

  return { cast, action }
}
