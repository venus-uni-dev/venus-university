import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Result, SceneLine, SceneResponse } from '@shared/types'
import {
  cancelCrossing,
  curtainCovered,
  useCrossingStore
} from '../src/renderer/stores/crossingStore'
import { useGameStore } from '../src/renderer/stores/gameStore'
import { registerLoopHooks } from '../src/renderer/stores/loop/hooks'
import { loopState, resetLoopState } from '../src/renderer/stores/loop/state'
import { streamScene, type SceneCall } from '../src/renderer/stores/loop/stream'
import { coverSceneOpening, revealSceneOpening } from '../src/renderer/stores/slotCrossing'
import { REPLY_FLOOR_MS } from '../src/renderer/stores/replyFloor'
import { lineDelta, restoreApi, sceneLines, stubApi } from './fixtures'

/**
 * The cover a scene opens under: a line delivered while the curtain still crosses the stage
 * replaces the landing in front of the reader, and a line held for a cancelled cover is a
 * scene that never arrives.
 */

/** The scene call under test, resolved and fed deltas by hand (`sceneFloor.test.ts`'s). */
function harness(): {
  emit: (delta: string) => void
  resolve: (result: Result<SceneResponse>) => void
} {
  let listener = (_delta: string): void => {}
  let resolve!: (result: Result<SceneResponse>) => void
  const call = new Promise<Result<SceneResponse>>((r) => {
    resolve = r
  })
  stubApi({
    llm: {
      completeScene: vi.fn(() => call),
      onSceneDelta: (fn: (delta: string) => void) => {
        listener = fn
        return () => {}
      }
    }
  })
  return { emit: (delta) => listener(delta), resolve }
}

/** What the player has actually been handed to read. */
function queuedLines(): SceneLine[] {
  return [...useGameStore.getState().pendingLines]
}

const request = { system: 's', user: 'u', schema: { name: 'n', schema: {} } }

beforeEach(() => {
  vi.useFakeTimers()
  cancelCrossing()
  useGameStore.getState().reset()
  resetLoopState()
  registerLoopHooks({
    advance: vi.fn(),
    runEnding: vi.fn(async () => {}),
    fetchEndingOpening: vi.fn(async () => null),
    dispatchTurn: vi.fn(),
    prefetchTextLedger: vi.fn(),
    claimTextLedger: vi.fn(async () => ({}))
  })
})

afterEach(() => {
  cancelCrossing()
  restoreApi()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('a scene opening under a cover', () => {
  it('holds its first line until the stage cannot be seen, then opens on it', async () => {
    const { emit, resolve } = harness()
    coverSceneOpening()
    const pending: SceneCall = streamScene(request)

    emit(lineDelta('She looks up.'))
    await vi.advanceTimersByTimeAsync(0)
    // The sheets are still crossing: a line put on screen now is the landing being replaced in
    // front of the reader, which is what the cover was raised to hide.
    expect(queuedLines()).toEqual([])

    curtainCovered()
    await vi.advanceTimersByTimeAsync(0)
    expect(queuedLines()).toEqual(sceneLines('She looks up.'))
    // The reveal is the stage's own, once it has drawn the line's picture — a delivery that
    // revealed here would play the crossfade in the open.
    expect(useCrossingStore.getState().ready).toBe(false)
    expect(useCrossingStore.getState().phase).toBe('holding')

    resolve({ ok: true, data: { lines: sceneLines('She looks up.') } })
    await pending
  })

  it('keeps the batches in the order they were streamed', async () => {
    const { emit, resolve } = harness()
    coverSceneOpening()
    const pending: SceneCall = streamScene(request)

    // Two chunks of one reply, as the model streams it: each closes one line object.
    emit('{"lines":[{"speaker":"","text":"First."},')
    emit('{"speaker":"","text":"Second."}]}')
    curtainCovered()
    await vi.advanceTimersByTimeAsync(0)

    expect(queuedLines()).toEqual(sceneLines('First.', 'Second.'))
    resolve({ ok: true, data: { lines: sceneLines('First.', 'Second.') } })
    await pending
  })

  it('drops what it was holding when the run is left under the cover', async () => {
    const { emit, resolve } = harness()
    coverSceneOpening()
    const pending: SceneCall = streamScene(request)

    emit(lineDelta('A stale line.'))
    // The player left: a new save is loaded and the curtain torn down with the screen it was
    // covering. What the sheet was holding belongs to a game that is gone.
    resetLoopState()
    useGameStore.getState().reset()
    useGameStore.setState({ playthroughId: 'p2' })
    cancelCrossing()
    await vi.advanceTimersByTimeAsync(0)

    expect(queuedLines()).toEqual([])
    resolve({ ok: true, data: { lines: sceneLines('A stale line.') } })
    await pending
    expect(queuedLines()).toEqual([])
  })
})

describe('a turn taken mid-scene', () => {
  it('raises no cover and lands its lines at once', async () => {
    const { emit, resolve } = harness()
    // No `coverSceneOpening`: a continuation's lines land on the screen they are already on.
    const pending: SceneCall = streamScene(request)

    emit(lineDelta('She answers.'))
    await vi.advanceTimersByTimeAsync(0)

    expect(queuedLines()).toEqual(sceneLines('She answers.'))
    expect(useCrossingStore.getState().phase).toBe('idle')

    resolve({ ok: true, data: { lines: sceneLines('She answers.') } })
    await pending
  })
})

describe('a turn that never reaches a scene', () => {
  it('gives the landing back rather than leaving the curtain down', async () => {
    coverSceneOpening()
    curtainCovered()
    expect(useCrossingStore.getState().ready).toBe(false)

    // What `abandonTurn` does after a failure the reader answered with `Change it`.
    revealSceneOpening()
    expect(useCrossingStore.getState().ready).toBe(true)
  })

  it('is a no-op where the cover belongs to somebody else', () => {
    // Nothing was raised for a scene, so nothing here may reveal what is on screen.
    revealSceneOpening()
    expect(useCrossingStore.getState().phase).toBe('idle')
  })
})

describe('the reply floor under a cover', () => {
  it('pays the floor and the cover once each, not twice', async () => {
    const { emit, resolve } = harness()
    coverSceneOpening()
    loopState.turnStartedAt = performance.now()
    const pending: SceneCall = streamScene(request)

    emit(lineDelta('Held twice over.'))
    curtainCovered()
    await vi.advanceTimersByTimeAsync(REPLY_FLOOR_MS)

    resolve({ ok: true, data: { lines: sceneLines('Held twice over.') } })
    await pending

    // Held by the floor, then by the sheet, and delivered once at the end of both.
    expect(queuedLines()).toEqual(sceneLines('Held twice over.'))
  })
})
