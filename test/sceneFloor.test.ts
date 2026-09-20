import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Result, SceneLine, SceneResponse } from '@shared/types'
import { useGameStore } from '../src/renderer/stores/gameStore'
import { registerLoopHooks } from '../src/renderer/stores/loop/hooks'
import { loopState, resetLoopState } from '../src/renderer/stores/loop/state'
import { streamScene, type SceneCall } from '../src/renderer/stores/loop/stream'
import { REPLY_FLOOR_MS } from '../src/renderer/stores/replyFloor'
import { lineDelta, restoreApi, sceneLines, stubApi } from './fixtures'

/**
 * The floor under a scene the player is waiting on holds preview lines
 * in a closure the loop has no other handle on. What is defended is that the held
 * lines reach `pendingLines` exactly once, and never a save loaded since.
 */

/** The scene call under test, resolved and fed deltas by hand. */
function harness(): {
  emit: (delta: string) => void
  resolve: (result: Result<SceneResponse>) => void
  unsubscribed: () => boolean
} {
  let listener = (_delta: string): void => {}
  let resolve!: (result: Result<SceneResponse>) => void
  let off = false
  const call = new Promise<Result<SceneResponse>>((r) => {
    resolve = r
  })
  stubApi({
    llm: {
      completeScene: vi.fn(() => call),
      onSceneDelta: (fn: (delta: string) => void) => {
        listener = fn
        return () => {
          off = true
        }
      }
    }
  })
  return { emit: (delta) => listener(delta), resolve, unsubscribed: () => off }
}

/** What the player has actually been handed to read. */
function queuedLines(): SceneLine[] {
  return [...useGameStore.getState().pendingLines]
}

const request = { system: 's', user: 'u', schema: { name: 'n', schema: {} } }

beforeEach(() => {
  vi.useFakeTimers()
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
  restoreApi()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('a scene the player is waiting on', () => {
  it('reconciles against the held lines rather than reading them as a divergence', async () => {
    // What the floor held and what the reply carries have to agree, or the
    // preview is discarded and the whole scene is queued a second time.
    const { emit, resolve } = harness()
    loopState.turnStartedAt = performance.now()
    const pending: SceneCall = streamScene(request)

    emit(lineDelta('She looks up.'))
    resolve({ ok: true, data: { lines: sceneLines('She looks up.') } })
    await vi.advanceTimersByTimeAsync(REPLY_FLOOR_MS)
    await pending

    expect(queuedLines()).toEqual(sceneLines('She looks up.'))
  })

  it('splits an overflowing line the same way in both passes, so neither is discarded', async () => {
    // The preview and the authoritative reply are two independent sanitizer runs over the same
    // words, and reconciliation compares their line counts: a split applied to one and not
    // the other would read as a divergence and queue the scene twice.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { emit, resolve } = harness()
    loopState.turnStartedAt = performance.now()
    // Stands in for the box: `views/boxRows.ts` measures a rendered paragraph, and there is no
    // DOM here.
    const pending: SceneCall = streamScene(request, undefined, {
      fits: (text) => text.length <= 20
    })

    emit(lineDelta('She looks up. Nothing is said.'))
    resolve({ ok: true, data: { lines: sceneLines('She looks up. Nothing is said.') } })
    await vi.advanceTimersByTimeAsync(REPLY_FLOOR_MS)
    await pending

    expect(queuedLines()).toEqual(sceneLines('She looks up.', 'Nothing is said.'))
    // The discard path says so on the console and nowhere else.
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('a run left while the floor was still holding', () => {
  it('drops what it held instead of flushing it into the save loaded since', async () => {
    const { emit, resolve, unsubscribed } = harness()
    loopState.turnStartedAt = performance.now()
    const pending: SceneCall = streamScene(request)

    emit(lineDelta('A stale line.'))
    resetLoopState()
    useGameStore.getState().reset()
    useGameStore.setState({ playthroughId: 'p2' })

    resolve({ ok: true, data: { lines: sceneLines('A stale line.') } })
    const result = await pending

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('CANCELLED')
    // Settled without waiting the floor out: there is nobody left to pace for.
    expect(unsubscribed()).toBe(true)
    expect(queuedLines()).toEqual([])

    await vi.advanceTimersByTimeAsync(REPLY_FLOOR_MS)
    expect(queuedLines()).toEqual([])
  })
})
