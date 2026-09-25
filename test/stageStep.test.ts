import { describe, expect, it } from 'vitest'
import { PORTRAIT_SLOTS, stageOnLoad, type StageContext } from '../src/renderer/stores/stageStep'
import type { SceneLine, SceneState } from '@shared/types'

/**
 * The stage a load opens on: it steps the lines a load plays before it waits and stops there,
 * whether that queue holds a reply, resumes on its own line, or is drained.
 */

/** A mid-scene save's scene, with the fields `stageOnLoad` reads filled in. */
function scene(over: Partial<SceneState> = {}): SceneState {
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
    pendingLines: [],
    ...over
  } as SceneState
}

const ctx: StageContext = {
  charKeyToId: { mia: 'mia-1' },
  characters: { 'mia-1': { pose: 'a' } },
  outfitReady: {},
  noNsfwImages: false
}

describe('stageOnLoad', () => {
  it('steps a queued reply up to its first line that says something, and stops', () => {
    const lines: SceneLine[] = [
      { speaker: '', text: '', bg: 'cafe', actions: ['show:mia'] },
      { speaker: 'mia', text: 'Hi.' },
      { speaker: 'mia', text: 'Bye.', actions: ['hide:mia'] }
    ]
    const result = stageOnLoad(scene({ bgOverride: 'park', pendingLines: lines }), ctx)

    expect(result.stage.bg).toBe('cafe')
    expect(result.stage.slots).toContain('mia-1')
    expect(result.bgOverride).toBeNull()
  })

  it('answers the scene’s own facts when it resumes on its own line', () => {
    const lines: SceneLine[] = [{ speaker: 'mia', text: 'Never mind.', bg: 'quad' }]
    const result = stageOnLoad(
      scene({
        bg: 'library',
        bgOverride: 'quad',
        currentLine: { speaker: 'mia', text: 'Hi.' },
        resumeOnLine: true,
        pendingLines: lines
      }),
      ctx
    )

    expect(result.stage.bg).toBe('library')
    expect(result.bgOverride).toBe('quad')
  })

  it('answers the scene’s own facts and override when its queue is drained', () => {
    const result = stageOnLoad(scene({ bg: 'library', bgOverride: 'quad', pendingLines: [] }), ctx)

    expect(result.stage.bg).toBe('library')
    expect(result.bgOverride).toBe('quad')
  })
})
