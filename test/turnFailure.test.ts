import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppError } from '@shared/types'
import { useGameStore } from '../src/renderer/stores/gameStore'
import { registerLoopHooks } from '../src/renderer/stores/loop/hooks'
import { loopState, resetLoopState, type TurnSnapshot } from '../src/renderer/stores/loop/state'
import type { SceneCall } from '../src/renderer/stores/loop/stream'
import { runSceneTurn } from '../src/renderer/stores/loop/turn'
import { restoreApi, sceneLines, stubApi } from './fixtures'

/**
 * What a failed turn is allowed to hand back: the premise of an authored scene is the app's
 * own writing, so it may never reach the reader's box, and its failure waits under the lines
 * it was written behind rather than interrupting them.
 */

const dispatchTurn = vi.fn()

function failed(code: string): SceneCall {
  return Promise.resolve({ ok: false, error: { code, message: 'the call failed' } as AppError })
}

/**
 * The orientation scroll queued and its first line on screen, as `beginSlot` leaves it before
 * firing the scene behind it — with the snapshot that scene captured.
 */
function readingTheScroll(action = 'The reader is standing with his orientation group.'): TurnSnapshot {
  const game = useGameStore.getState()
  game.appendPendingLines(sceneLines('One.', 'Two.', 'Three.'))
  game.advanceLine()
  game.setBusy(true)
  game.setStreaming(true)
  return { scene: useGameStore.getState().captureScene(), action, intro: true }
}

/** A preview line reaching the store the way `streamScene`'s `emit` puts one there. */
function streamOneLine(text: string): void {
  const game = useGameStore.getState()
  game.appendSceneLines(sceneLines(text))
  game.appendPendingLines(sceneLines(text))
}

beforeEach(() => {
  dispatchTurn.mockClear()
  useGameStore.getState().reset()
  resetLoopState()
  // The slot cycle belongs to `gameLoop`, which this file does not import: what is under test is
  // which of its paths a failure takes, not the paths themselves.
  registerLoopHooks({
    advance: vi.fn(),
    runEnding: vi.fn(async () => {}),
    fetchEndingOpening: vi.fn(async () => null),
    dispatchTurn,
    prefetchTextLedger: vi.fn(),
    claimTextLedger: vi.fn(async () => ({}))
  })
  stubApi({})
})

afterEach(() => {
  restoreApi()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('a failed turn hands back only words the reader owns', () => {
  it('leaves the box empty when the action was an authored premise', async () => {
    const snapshot = readingTheScroll()
    // Permanently refused, which is the branch that opens the box on a typed turn.
    await runSceneTurn(failed('LLM_REQUEST_REJECTED'), snapshot, [], [], false)

    const game = useGameStore.getState()
    // The regression: the app's own scene-writing directive, sitting in the reader's box over a
    // screen the opening has not handed the input back on.
    expect(game.inputDraft).toBe('')
    expect(game.awaitingInput).toBe(false)
    expect(game.turnError?.code).toBe('LLM_REQUEST_REJECTED')
  })

  it('leaves it empty for a goodbye too, whoever it is with', async () => {
    const snapshot: TurnSnapshot = {
      scene: useGameStore.getState().captureScene(),
      action: 'The reader is saying goodbye to Mika some time after graduation day.',
      farewell: 'mika'
    }
    await runSceneTurn(failed('LLM_BLOCKED'), snapshot, [], [], false)

    expect(useGameStore.getState().inputDraft).toBe('')
    expect(useGameStore.getState().awaitingInput).toBe(false)
  })

  it("blanks a gift's composed sentence, as abandoning one already does", async () => {
    const snapshot: TurnSnapshot = {
      scene: useGameStore.getState().captureScene(),
      action: 'The reader hands Mika the bracelet, and she likes it.',
      gift: true
    }
    await runSceneTurn(failed('LLM_REQUEST_REJECTED'), snapshot, [], [], false)

    expect(useGameStore.getState().inputDraft).toBe('')
  })

  it('gives a typed action straight back', async () => {
    const snapshot: TurnSnapshot = {
      scene: useGameStore.getState().captureScene(),
      action: 'I ask her about the reading.'
    }
    await runSceneTurn(failed('LLM_REQUEST_REJECTED'), snapshot, [], [], false)

    const game = useGameStore.getState()
    expect(game.inputDraft).toBe('I ask her about the reading.')
    expect(game.awaitingInput).toBe(true)
  })
})

describe('an authored scene fails behind the lines it was written under', () => {
  it('re-sends itself silently while the reader still has some to read', async () => {
    vi.useFakeTimers()
    const snapshot = readingTheScroll()
    // A preview reached the queue before the reply broke off.
    streamOneLine('Half a scene.')

    const turn = runSceneTurn(failed('LLM_HTTP'), snapshot, [], [], false)
    await vi.advanceTimersByTimeAsync(1000)
    await turn

    const game = useGameStore.getState()
    expect(dispatchTurn).toHaveBeenCalledWith(snapshot)
    // No modal while there is reading to do, and nothing of the broken attempt left on the queue.
    expect(game.turnError).toBeNull()
    expect(game.pendingLines).toEqual(sceneLines('Two.', 'Three.'))
    expect(game.currentSceneTranscript).toEqual([])
  })

  it('keeps the reader where he had read to, rather than rewinding the scroll under him', async () => {
    vi.useFakeTimers()
    const snapshot = readingTheScroll()
    // Two more lines read while the call was out.
    useGameStore.getState().advanceLine()

    const turn = runSceneTurn(failed('LLM_NETWORK'), snapshot, [], [], false)
    await vi.advanceTimersByTimeAsync(1000)
    await turn

    const game = useGameStore.getState()
    // The snapshot's own queue is `One.`-onward: restoring it would replay the scroll.
    expect(game.pendingLines).toEqual(sceneLines('Three.'))
    expect(game.currentLine).toEqual({ speaker: '', text: 'Two.' })
  })

  it('asks once the reader is out of lines instead of spending the budget on a spinner', async () => {
    const snapshot = readingTheScroll()
    // Parked on the spinner at the end of the queue: nothing left to read behind a resend.
    useGameStore.setState({ pendingLines: [], waitingForLine: true })

    await runSceneTurn(failed('LLM_HTTP'), snapshot, [], [], false)

    expect(dispatchTurn).not.toHaveBeenCalled()
    expect(useGameStore.getState().turnError?.code).toBe('LLM_HTTP')
    // The modal's own gate: the reader is waiting, so it may open.
    expect(useGameStore.getState().waitingForLine).toBe(true)
  })

  it('falls through to the modal once the silent budget is gone', async () => {
    vi.useFakeTimers()
    const snapshot = readingTheScroll()
    loopState.authoredRetrySpent = 5

    await runSceneTurn(failed('LLM_HTTP'), snapshot, [], [], false)

    expect(dispatchTurn).not.toHaveBeenCalled()
    expect(useGameStore.getState().turnError?.code).toBe('LLM_HTTP')
    // Still two lines short of the end, so the modal waits on the view's own gate, not here.
    expect(useGameStore.getState().pendingLines).toEqual(sceneLines('Two.', 'Three.'))
    expect(useGameStore.getState().waitingForLine).toBe(false)
  })
})
