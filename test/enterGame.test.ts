import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  BankedOpening,
  GameSave,
  LedgerResponse,
  Result,
  SceneState
} from '@shared/types'
import { useGameStore } from '../src/renderer/stores/gameStore'
import { openingScene } from '../src/renderer/stores/loop/saves'
import { loopState, resetLoopState } from '../src/renderer/stores/loop/state'
import { playthroughRecord, restoreApi, sceneLines, stubApi } from './fixtures'

/**
 * Where a loaded save puts playback. A load that reads its marks wrong either replays lines the
 * reader already had, skips the ones still queued, or holds a decision point where there is
 * none — and leaving then writes that point over the autosave.
 */

// `gameLoop` reaches `jobStore`, which subscribes to `jobs:progress` at module scope — so the
// bridge has to exist before the import, not the call.
stubApi({ jobs: { onProgress: () => () => {} } })
const { enterGame } = await import('../src/renderer/stores/gameLoop')

/** A save of the store as it starts, under `saveId`, holding `scene`. */
function saveOf(scene: SceneState, saveId = 'manual07'): GameSave {
  useGameStore.getState().reset()
  return {
    ...useGameStore.getState().toGameSave(),
    playthroughId: 'p1',
    saveId,
    saveDate: 0,
    scene
  }
}

/** A solo scene's reply, `read` lines of it read and `queued` more to come. */
function replyScene(read: string[], queued: string[]): SceneState {
  const lines = sceneLines(...read)
  return {
    ...openingScene(sceneLines(...queued)),
    transcript: [...lines, ...sceneLines(...queued)],
    summary: 'They talked.',
    sceneLog: lines,
    currentLine: lines[lines.length - 1] ?? null
  }
}

beforeEach(() => {
  resetLoopState()
  stubApi({
    saves: {
      readProfilePicture: vi.fn(
        async (): Promise<Result<Uint8Array<ArrayBuffer> | null>> => ({ ok: true, data: null })
      )
    }
  })
})

afterEach(() => {
  restoreApi()
  vi.restoreAllMocks()
})

describe('enterGame', () => {
  it('shows a mid-reply save on its line, with the rest of the reply still queued', () => {
    const scene = { ...replyScene(['One.'], ['Two.', 'Three.', 'Four.']), resumeOnLine: true as const }
    enterGame(saveOf(scene), playthroughRecord(), {})

    const game = useGameStore.getState()
    expect(game.awaitingInput).toBe(false)
    expect(game.currentLine).toEqual({ speaker: '', text: 'One.' })
    expect(game.pendingLines).toEqual(sceneLines('Two.', 'Three.', 'Four.'))
    // Not a decision point: leaving from it writes nothing over the autosave.
    expect(loopState.decisionSave).toBeNull()
  })

  it('opens the input on a decision point and holds it for the way out', () => {
    const scene = replyScene(['Hello.'], [])
    const save = saveOf(scene)
    enterGame(save, playthroughRecord(), {})

    expect(useGameStore.getState().awaitingInput).toBe(true)
    expect(loopState.decisionSave).toBe(save.scene)
  })

  it('opens the input on a landing without making it a decision point', () => {
    // A live landing is not one either: nothing has been said that a reload could lose.
    const narration = sceneLines('Morning, and the quad is loud.')
    const scene: SceneState = {
      ...openingScene([]),
      sceneLog: narration,
      currentLine: narration[0]
    }
    enterGame(saveOf(scene), playthroughRecord(), {})

    expect(useGameStore.getState().awaitingInput).toBe(true)
    expect(loopState.decisionSave).toBeNull()
  })

  it('resumes an ending on its line, with what the ending banked restored', () => {
    const ledger: LedgerResponse = {}
    const opening = {
      lines: sceneLines('Evening.'),
      hangouts: [],
      events: [],
      cancellations: []
    } as unknown as BankedOpening
    const scene: SceneState = {
      ...replyScene(['Goodbye.'], []),
      endPending: true,
      ledger,
      opening,
      resumeOnLine: true
    }
    enterGame(saveOf(scene), playthroughRecord(), {})

    const game = useGameStore.getState()
    expect(game.sceneEnding).toBe(true)
    expect(loopState.pendingLedgerResult).toBe(ledger)
    expect(loopState.bankedOpening).toEqual(opening)
    // Nothing has advanced: the last line is still up and the status sequence not yet raised.
    expect(game.currentLine).toEqual({ speaker: '', text: 'Goodbye.' })
    expect(game.statusShown).toBe(false)
    expect(game.awaitingInput).toBe(false)
  })

  it('folds a slot opening back only into a boundary save', () => {
    const scene = replyScene(['Hello.'], [])
    enterGame(saveOf(scene, '1700000000000'), playthroughRecord(), {})
    expect(loopState.slotSaveId).toBe('1700000000000')

    enterGame(saveOf(scene, 'autosave'), playthroughRecord(), {})
    expect(loopState.slotSaveId).toBeNull()

    enterGame(saveOf(scene, 'manual07'), playthroughRecord(), {})
    expect(loopState.slotSaveId).toBeNull()
  })
})
