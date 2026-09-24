import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GameSave, LedgerResponse, Result, SceneResponse } from '@shared/types'
import { useGameStore } from '../src/renderer/stores/gameStore'
import { registerLoopHooks, runEnding } from '../src/renderer/stores/loop/hooks'
import {
  currentRun,
  loopState,
  resetLoopState,
  resetTurnSlice,
  runStale
} from '../src/renderer/stores/loop/state'
import { streamScene, type SceneCall } from '../src/renderer/stores/loop/stream'
import { runSceneTurn } from '../src/renderer/stores/loop/turn'
import { restoreApi, sceneLines, stubApi } from './fixtures'

/**
 * The fence that stops a reply outliving the run it was asked for. A call
 * left in flight by a player leaving for the menu resolves against whatever
 * playthrough is loaded by then; unfenced, it writes the abandoned scene into it.
 * An ending the player interjects over is fenced the same way inside the run.
 */

/** The slot cycle `gameLoop` registers as it loads, kept for the suite that runs a real ending. */
const registered = vi.hoisted(() => ({
  slotCycle: null as
    | Parameters<typeof import('../src/renderer/stores/loop/hooks').registerLoopHooks>[0]
    | null
}))

// Every registration still lands; the first, `gameLoop`'s own as it loads, is also kept.
vi.mock('../src/renderer/stores/loop/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/renderer/stores/loop/hooks')>()
  return {
    ...actual,
    registerLoopHooks: (hooks: Parameters<typeof actual.registerLoopHooks>[0]) => {
      registered.slotCycle ??= hooks
      actual.registerLoopHooks(hooks)
    }
  }
})

// `gameLoop` reaches `jobStore`, which subscribes to `jobs:progress` at module scope — so the
// bridge has to exist before the import, not the call.
stubApi({ jobs: { onProgress: () => () => {} } })
const { dropEnding } = await import('../src/renderer/stores/gameLoop')

/** One scene call the test resolves by hand, so leaving can be timed inside it. */
function deferredCall(): { call: SceneCall; resolve: (result: Awaited<SceneCall>) => void } {
  let resolve!: (result: Awaited<SceneCall>) => void
  const call = new Promise<Awaited<SceneCall>>((r) => {
    resolve = r
  })
  return { call, resolve }
}

/** A resolved reply the way `streamScene` hands one back. */
function replied(texts: string[], summary: string | null = 'they talked'): Awaited<SceneCall> {
  return {
    ok: true,
    data: { lines: sceneLines(...texts), summary, end: false, applied: true, at: 0 }
  }
}

const autosave = vi.fn(
  async (): Promise<Result<GameSave>> => ({ ok: true, data: { saveId: 'auto' } as GameSave })
)

/** The player left for the menu and loaded another playthrough while a call was out. */
function leaveAndLoad(): void {
  resetLoopState()
  useGameStore.getState().reset()
  useGameStore.setState({ playthroughId: 'p2' })
  useGameStore.getState().appendSceneLines(sceneLines('The loaded scene.'))
}

beforeEach(() => {
  autosave.mockClear()
  useGameStore.getState().reset()
  resetLoopState()
  useGameStore.setState({ playthroughId: 'p1' })
  // The loop's late-bound edges belong to `gameLoop`, stood in for everywhere but the
  // interrupted ending: the fence is what is under test, and a real `runEnding` would drag the
  // whole slot cycle in behind it.
  registerLoopHooks({
    advance: vi.fn(),
    runEnding: vi.fn(async () => {}),
    fetchEndingOpening: vi.fn(async () => null),
    dispatchTurn: vi.fn(),
    prefetchTextLedger: vi.fn(),
    claimTextLedger: vi.fn(async () => ({}))
  })
  stubApi({ saves: { autosave } })
})

afterEach(() => {
  restoreApi()
  vi.restoreAllMocks()
})

describe('the run token', () => {
  it('is re-minted by a full reset and left alone by a turn reset', () => {
    const run = currentRun()
    resetTurnSlice()
    // The slot boundary resets a turn mid-run; fencing there would abandon the
    // very scene the player is still in.
    expect(runStale(run)).toBe(false)

    resetLoopState()
    expect(runStale(run)).toBe(true)
  })
})

describe('a reply that lands after the player left', () => {
  it('writes nothing into the playthrough loaded since', async () => {
    const { call, resolve } = deferredCall()
    const snapshot = { scene: useGameStore.getState().captureScene(), action: 'wave' }
    const turn = runSceneTurn(call, snapshot, [], [], true)

    leaveAndLoad()
    resolve(replied(['A line from the abandoned scene.']))
    await turn

    const game = useGameStore.getState()
    expect(game.currentSceneTranscript).toEqual(sceneLines('The loaded scene.'))
    expect(game.pendingLines).toEqual([])
    expect(game.sceneSummary).toBeNull()
    expect(game.sceneEnding).toBe(false)
    // The headline regression: the abandoned scene persisted under `p2`.
    expect(autosave).not.toHaveBeenCalled()
  })

  it('does not rewind the loaded scene onto the abandoned turn snapshot', async () => {
    useGameStore.getState().appendSceneLines(sceneLines('The scene being left.'))
    const snapshot = { scene: useGameStore.getState().captureScene(), action: 'wave' }
    const { call, resolve } = deferredCall()
    const turn = runSceneTurn(call, snapshot, [], [], true)

    leaveAndLoad()
    resolve({ ok: false, error: { code: 'LLM_NETWORK', message: 'dropped' } })
    await turn

    const game = useGameStore.getState()
    expect(game.currentSceneTranscript).toEqual(sceneLines('The loaded scene.'))
    // A failure modal here would go up over a save the player just opened.
    expect(game.turnError).toBeNull()
  })

  it('still writes when the run was never left', async () => {
    const { call, resolve } = deferredCall()
    const snapshot = { scene: useGameStore.getState().captureScene(), action: 'wave' }
    const turn = runSceneTurn(call, snapshot, [], [], false)

    resolve(replied(['A line.']))
    await turn

    expect(autosave).toHaveBeenCalledTimes(1)
  })
})

describe('a scene call abandoned mid-stream', () => {
  it('drops its deltas and leaves the new run’s streaming flag alone', async () => {
    let emit = (_delta: string): void => {}
    let resolve!: (result: Result<SceneResponse>) => void
    const call = new Promise<Result<SceneResponse>>((r) => {
      resolve = r
    })
    stubApi({
      saves: { autosave },
      llm: {
        completeScene: vi.fn(() => call),
        onSceneDelta: (listener: (delta: string) => void) => {
          emit = listener
          return () => {}
        }
      }
    })

    const pending = streamScene({ system: 's', user: 'u', schema: { name: 'n', schema: {} } })

    leaveAndLoad()
    // The delta channel is a broadcast with no request id, so an abandoned call
    // keeps feeding it until the invoke settles.
    emit('{"lines":[{"speaker":"","text":"A stale line."}]}')
    expect(useGameStore.getState().currentSceneTranscript).toEqual(sceneLines('The loaded scene.'))

    useGameStore.getState().setStreaming(true)
    resolve({ ok: true, data: { lines: sceneLines('A stale line.') } })
    const result = await pending

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('CANCELLED')
    // Lowered by the stale call, this would clear the spinner off the scene the
    // loaded save is streaming.
    expect(useGameStore.getState().streaming).toBe(true)
  })
})

describe('an ending the player interjected over', () => {
  /**
   * A solo scene's ending under way with its ledger out, on the real slot cycle; the ledger is
   * answered by hand once the ending has been dropped.
   */
  function endingUnderWay(): {
    ending: Promise<void>
    answer: (result: Result<LedgerResponse>) => void
  } {
    let answer!: (result: Result<LedgerResponse>) => void
    const call = new Promise<Result<LedgerResponse>>((r) => {
      answer = r
    })
    stubApi({
      saves: { autosave },
      llm: { completeLedger: vi.fn(() => call) },
      jobs: { cancelGroup: vi.fn(async (): Promise<Result<void>> => ({ ok: true, data: undefined })) }
    })
    if (!registered.slotCycle) throw new Error('gameLoop registered no slot cycle')
    registerLoopHooks(registered.slotCycle)
    useGameStore.getState().setSceneEnding(true)
    loopState.endingInFlight = true
    return { ending: runEnding(true), answer }
  }

  it('writes and banks nothing when its ledger lands', async () => {
    const { ending, answer } = endingUnderWay()

    dropEnding()
    answer({ ok: true, data: {} })
    await ending

    // The interjection's decision point is the scene's save; the ending's would overwrite it
    // with a scene the player has already talked his way out of.
    expect(autosave).not.toHaveBeenCalled()
    expect(loopState.pendingLedgerResult).toBeNull()
    expect(loopState.endingInFlight).toBe(false)
  })

  it('raises no modal when its ledger fails, even over the next ending', async () => {
    const { ending, answer } = endingUnderWay()

    dropEnding()
    // The next ending has the player parked on its spinner, which is what a modal waits for.
    loopState.endingInFlight = true
    useGameStore.getState().setWaitingForLine(true)
    answer({ ok: false, error: { code: 'LLM_REQUEST_REJECTED', message: 'refused' } })
    await ending

    expect(useGameStore.getState().ledgerError).toBeNull()
  })
})
