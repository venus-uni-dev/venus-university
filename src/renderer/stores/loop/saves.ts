import { AUTOSAVE_ID, type AppError, type SceneLine, type SceneState } from '@shared/types'
import { PORTRAIT_SLOTS, useGameStore } from '../gameStore'
import { lastReaderIndexOf } from '../stageStep'
import { useUiStore } from '../uiStore'
import { loopState } from './state'
import { sceneInProgress } from './stream'

/**
 * Every write the slot loop makes, which scene each one records, and the ordering
 * discipline they share.
 */

/** Reports a failed save without undoing anything. */
function reportWriteFailure(error: AppError): void {
  useUiStore.getState().showError(error)
}

/** Save writes run strictly one after another. */
let writeChain: Promise<void> = Promise.resolve()

/** How many writes are queued or running behind {@link writeChain}. */
let pending = 0

function queueWrite(run: () => Promise<void>): Promise<void> {
  pending += 1
  writeChain = writeChain.then(run, run).finally(() => {
    pending -= 1
  })
  return writeChain
}

/** True while a save write is still queued or in flight. */
export function writesPending(): boolean {
  return pending > 0
}

/** Overwrites the autosave, recording `scene` in place of what is on screen now. */
export function writeAutosave(scene: SceneState | null): Promise<void> {
  return queueWrite(async () => {
    const game = useGameStore.getState()
    if (!game.playthroughId) return

    const result = await window.api.saves.autosave(game.playthroughId, {
      ...game.toGameSave(),
      scene
    })
    if (!result.ok) reportWriteFailure(result.error)
  })
}

/** Mints the slot-boundary save, which also clears the now-stale autosave. */
export function writeSlotSave(): Promise<void> {
  return queueWrite(async () => {
    const game = useGameStore.getState()
    if (!game.playthroughId) return

    const result = await window.api.saves.slot(game.playthroughId, game.toGameSave())
    if (!result.ok) reportWriteFailure(result.error)
    // The file the opening narration is folded back into once it arrives.
    else loopState.slotSaveId = result.data.saveId
  })
}

/**
 * Records where the graduation epilogue stands: the narration having played, and every
 * goodbye said so far. The scene is `null`: the menu is between scenes.
 */
export function writeEpilogueSave(): Promise<void> {
  return writeAutosave(null)
}

/**
 * Removes the autosave without minting anything in its place — the boundary of a playthrough
 * that ended badly.
 */
export function deleteAutosave(): Promise<void> {
  return queueWrite(async () => {
    const game = useGameStore.getState()
    if (!game.playthroughId) return

    const result = await window.api.saves.delete(game.playthroughId, AUTOSAVE_ID)
    if (!result.ok) reportWriteFailure(result.error)
  })
}

/**
 * Folds the slot opening's narration into the slot-save minted before the call went out, so
 * reloading it replays the opening.
 */
export function foldOpeningIntoSlotSave(lines: SceneLine[]): Promise<void> {
  return queueWrite(async () => {
    const game = useGameStore.getState()
    const saveId = loopState.slotSaveId
    if (!game.playthroughId || !saveId) return

    const result = await window.api.saves.overwrite(game.playthroughId, saveId, {
      ...game.toGameSave(),
      scene: openingScene(lines)
    })
    if (!result.ok) reportWriteFailure(result.error)
  })
}

/**
 * The slot opening as a resumable scene: narration queued, nothing else. The empty transcript
 * is load-bearing — the classifier turn reads it as "no scene has started".
 */
export function openingScene(lines: SceneLine[]): SceneState {
  return {
    cast: [],
    transcript: [],
    summary: null,
    bg: null,
    slots: Array<string | null>(PORTRAIT_SLOTS).fill(null),
    emotions: {},
    flipped: {},
    departed: [],
    offStage: {},
    sceneLog: [],
    currentLine: null,
    pendingLines: lines
  }
}

/**
 * `log` with the reader's newest action in `transcript` read onto its end, unless it already
 * ends on that line.
 */
function withReaderAction(log: readonly SceneLine[], transcript: readonly SceneLine[]): SceneLine[] {
  const action = transcript[lastReaderIndexOf(transcript)]
  const last = log[log.length - 1]
  if (!action || (last && last.speaker === action.speaker && last.text === action.text)) {
    return [...log]
  }
  return [...log, action]
}

/**
 * The scene as it stood *before* `lines` played, with them queued. The turn's own action is read
 * onto the log: `base` was captured before it was logged.
 */
export function queuedScene(
  base: SceneState | null,
  lines: SceneLine[],
  extra: Partial<SceneState> = {}
): SceneState {
  const game = useGameStore.getState()
  const from = base ?? openingScene([])
  const scene: SceneState = {
    ...from,
    cast: [...game.cast],
    transcript: [...game.currentSceneTranscript],
    summary: game.sceneSummary,
    sceneLog: withReaderAction(from.sceneLog, game.currentSceneTranscript),
    pendingLines: lines,
    ...extra
  }
  // Set-or-delete, like the kinds below: the marks are the store's, never the base's.
  if (game.sceneSummaries.length > 0) {
    scene.summaries = game.sceneSummaries.map((mark) => ({ ...mark }))
  } else delete scene.summaries
  // Set-or-delete: a scene that is not one of these kinds must carry no key at all.
  if (game.sceneClass) scene.classCode = game.sceneClass
  else delete scene.classCode
  if (game.sceneProject) scene.projectClass = game.sceneProject
  else delete scene.projectClass
  if (game.sceneJob) scene.jobId = game.sceneJob
  else delete scene.jobId
  if (game.sceneJobStats.length > 0) scene.jobStats = [...game.sceneJobStats]
  else delete scene.jobStats
  if (game.sceneVisitJob) scene.visitJobId = game.sceneVisitJob
  else delete scene.visitJobId
  if (game.sceneTextLedgerSkip) scene.textLedgerSkip = game.sceneTextLedgerSkip
  else delete scene.textLedgerSkip
  if (game.sceneTextLedger) scene.textLedger = { ...game.sceneTextLedger }
  else delete scene.textLedger
  if (game.sceneIgnoredInvites.length > 0) scene.ignoredInvites = [...game.sceneIgnoredInvites]
  else delete scene.ignoredInvites
  if (game.sceneTurnedDown.length > 0) scene.turnedDownInvites = [...game.sceneTurnedDown]
  else delete scene.turnedDownInvites
  if (game.sceneFarewell) scene.farewell = game.sceneFarewell
  else delete scene.farewell
  // `base` predates the casting turn, so these are only in the store.
  if (game.sceneMentions.length > 0) scene.mentions = [...game.sceneMentions]
  else delete scene.mentions
  if (game.sceneLocation) scene.location = game.sceneLocation
  else delete scene.location
  // Set-or-delete on the same terms, and only ever *false*: absent is public.
  if (game.sceneInPublic) delete scene.inPublic
  else scene.inPublic = false
  return scene
}

/**
 * The decision point: what is on disk becomes the drained scene, so a reload lands on
 * this line with the input open. An exam is the exception — its decision point is the paper's
 * start, written and held when the questions landed, so no question is one of its own.
 */
export function markDecisionPoint(): void {
  if (!sceneInProgress()) return
  if (useGameStore.getState().sceneQuiz) return
  loopState.decisionSave = useGameStore.getState().captureScene()
  void writeAutosave(loopState.decisionSave)
}
