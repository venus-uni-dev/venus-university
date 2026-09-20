import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GameSave, QuizState, Result, SaveDraft, SceneLine } from '@shared/types'
import {
  deleteAutosave,
  foldOpeningIntoSlotSave,
  markDecisionPoint,
  openingScene,
  queuedScene,
  writeAutosave,
  writeEpilogueSave,
  writeSlotSave
} from '../src/renderer/stores/loop/saves'
import { loopState, resetLoopState } from '../src/renderer/stores/loop/state'
import { useGameStore } from '../src/renderer/stores/gameStore'
import { useUiStore } from '../src/renderer/stores/uiStore'
import { restoreApi, stubApi } from './fixtures'

/**
 * Every write the slot-cycle loop makes, and the order they land in: the boundary write deletes
 * the autosave, so an autosave still in flight when it lands would recreate the file and
 * leave a finished scene resumable — a failure nothing shows until the next load.
 */

/** A save the way `saves:*` answers with one; only `saveId` is ever read back. */
function savedAs(saveId: string): Result<GameSave> {
  return { ok: true, data: { saveId } as GameSave }
}

const FAILED: Result<GameSave> = { ok: false, error: { code: 'SAVE_WRITE_FAILED', message: 'disk' } }

/** Every write channel, each recording what it was handed. */
function stubSaves(
  overrides: Partial<Record<'autosave' | 'slot' | 'overwrite' | 'delete', unknown>> = {}
) {
  const autosave = vi.fn(async () => savedAs('auto'))
  const slot = vi.fn(async () => savedAs('slot-1'))
  const overwrite = vi.fn(async () => savedAs('slot-1'))
  const remove = vi.fn(async (): Promise<Result<void>> => ({ ok: true, data: undefined }))
  const saves = { autosave, slot, overwrite, delete: remove, ...overrides } as unknown as {
    autosave: typeof autosave
    slot: typeof slot
    overwrite: typeof overwrite
    delete: typeof remove
  }
  stubApi({ saves })
  return saves
}

beforeEach(() => {
  useGameStore.getState().reset()
  useUiStore.setState({ error: null })
  resetLoopState()
  useGameStore.setState({ playthroughId: 'p1' })
})

afterEach(() => {
  restoreApi()
  vi.restoreAllMocks()
})

describe('write ordering', () => {
  it('holds a slot save until the autosave before it has landed', async () => {
    const order: string[] = []
    let releaseAutosave = (): void => {}
    const held = new Promise<void>((resolve) => {
      releaseAutosave = resolve
    })

    const saves = stubSaves({
      autosave: vi.fn(async () => {
        await held
        order.push('autosave')
        return savedAs('auto')
      }),
      slot: vi.fn(async () => {
        order.push('slot')
        return savedAs('slot-1')
      })
    })

    const first = writeAutosave(null)
    const second = writeSlotSave()

    // The boundary write has not even been issued while the autosave is out.
    expect(saves.slot).not.toHaveBeenCalled()

    releaseAutosave()
    await Promise.all([first, second])
    expect(order).toEqual(['autosave', 'slot'])
  })

  it('lets the next write through after one rejects, rather than stalling the chain', async () => {
    const saves = stubSaves({
      autosave: vi.fn(async () => {
        throw new Error('bridge died')
      })
    })

    await writeAutosave(null).catch(() => undefined)
    await writeSlotSave()
    expect(saves.slot).toHaveBeenCalledTimes(1)
  })
})

describe('writeAutosave', () => {
  it('writes the scene it was handed alongside the save the store holds', async () => {
    const saves = stubSaves()
    const scene = openingScene([{ speaker: '', text: 'The bell rings.' }])

    await writeAutosave(scene)
    expect(saves.autosave).toHaveBeenCalledTimes(1)
    const [playthroughId, draft] = saves.autosave.mock.calls[0] as unknown as [string, SaveDraft]
    expect(playthroughId).toBe('p1')
    expect(draft.scene).toBe(scene)
  })
})

describe('writeSlotSave', () => {
  it('records the minted save as the one an opening folds back into', async () => {
    stubSaves()
    await writeSlotSave()
    expect(loopState.slotSaveId).toBe('slot-1')
  })

  it('leaves the fold target unset when the write failed, so nothing amends a save that is not there', async () => {
    stubSaves({ slot: vi.fn(async () => FAILED) })

    await writeSlotSave()
    expect(loopState.slotSaveId).toBeNull()
    expect(useUiStore.getState().error?.code).toBe('SAVE_WRITE_FAILED')
  })
})

describe('writeEpilogueSave', () => {
  // The epilogue's menu is between scenes, and the save has to say so: a capture
  // taken there is non-null (the last line read is still on screen), and
  // `enterGame` would restore it instead of reaching `beginSlot` — which is what
  // replays the ceremony and leaves the graduation picture undrawn.
  it('records no scene, whatever the epilogue left on screen', async () => {
    const saves = stubSaves()
    useGameStore.setState({
      currentLine: { speaker: '', text: 'Mina will miss you.' },
      graduationSeen: true,
      farewellsDone: ['char-1']
    })

    await writeEpilogueSave()
    const [, draft] = saves.autosave.mock.calls[0] as unknown as [string, SaveDraft]
    expect(draft.scene).toBeNull()
    expect(draft.graduationSeen).toBe(true)
    expect(draft.farewellsDone).toEqual(['char-1'])
  })
})

describe('deleteAutosave', () => {
  // The boundary of a playthrough that ended badly writes nothing and removes
  // this file instead. A delete that overtook the ending call's own
  // autosave would leave the scene that finished the playthrough on disk and
  // resumable — the same failure the chain exists to prevent, from the other end.
  it('waits for an autosave already in flight, so it cannot delete a file written after it', async () => {
    const order: string[] = []
    let releaseAutosave = (): void => {}
    const held = new Promise<void>((resolve) => {
      releaseAutosave = resolve
    })

    const saves = stubSaves({
      autosave: vi.fn(async () => {
        await held
        order.push('autosave')
        return savedAs('auto')
      }),
      delete: vi.fn(async () => {
        order.push('delete')
        return { ok: true, data: undefined }
      })
    })

    const first = writeAutosave(null)
    const second = deleteAutosave()
    expect(saves.delete).not.toHaveBeenCalled()

    releaseAutosave()
    await Promise.all([first, second])
    expect(order).toEqual(['autosave', 'delete'])
  })
})

describe('foldOpeningIntoSlotSave', () => {
  const lines: SceneLine[] = [{ speaker: '', text: 'Morning, and the quad is loud.' }]

  it('rewrites the slot save in place, with the narration queued', async () => {
    const saves = stubSaves()
    loopState.slotSaveId = 'slot-1'

    await foldOpeningIntoSlotSave(lines)
    const [playthroughId, saveId, draft] = saves.overwrite.mock.calls[0] as unknown as [
      string,
      string,
      SaveDraft
    ]
    expect(playthroughId).toBe('p1')
    expect(saveId).toBe('slot-1')
    expect(draft.scene?.pendingLines).toEqual(lines)
  })

  it('skips the fold when no slot save is known, rather than minting one', async () => {
    const saves = stubSaves()
    loopState.slotSaveId = null

    await foldOpeningIntoSlotSave(lines)
    expect(saves.overwrite).not.toHaveBeenCalled()
  })
})

describe('queuedScene', () => {
  const lines: SceneLine[] = [{ speaker: 'Sarah', text: 'Hello.' }]

  it('keeps the stage the turn began on but takes the transcript live', () => {
    const base = openingScene([])
    base.bg = 'quad'
    base.slots = ['char-1', null, null]
    useGameStore.setState({
      cast: ['char-1'],
      currentSceneTranscript: [{ speaker: 'Sarah', text: 'Hello.' }],
      sceneSummary: 'They met.'
    })

    const scene = queuedScene(base, lines)
    expect(scene.bg).toBe('quad')
    expect(scene.slots).toEqual(['char-1', null, null])
    expect(scene.cast).toEqual(['char-1'])
    expect(scene.transcript).toEqual([{ speaker: 'Sarah', text: 'Hello.' }])
    expect(scene.summary).toBe('They met.')
    expect(scene.pendingLines).toEqual(lines)
  })

  it('carries the class a class scene is sitting in, and drops it when it is not one', () => {
    useGameStore.setState({ sceneClass: 'BIO 210' })
    expect(queuedScene(null, lines).classCode).toBe('BIO 210')

    // A base that carried one, replayed in a scene that does not: the field has
    // to go, or the lorebook keeps injecting a course nobody is sitting in.
    const base = { ...openingScene([]), classCode: 'BIO 210' }
    useGameStore.setState({ sceneClass: null })
    expect('classCode' in queuedScene(base, lines)).toBe(false)
  })

  it('carries the project course and the job, and drops each when the scene is neither', () => {
    useGameStore.setState({ sceneClass: null, sceneProject: 'ART 110', sceneJob: null })
    expect(queuedScene(null, lines).projectClass).toBe('ART 110')

    useGameStore.setState({ sceneProject: null, sceneJob: 'cutetea' })
    const shift = queuedScene(null, lines)
    expect(shift.jobId).toBe('cutetea')
    expect('projectClass' in shift).toBe(false)

    // Same trap the class field has: a base replayed in a scene of another kind
    // would keep injecting the last one's workplace.
    const base = { ...openingScene([]), projectClass: 'ART 110', jobId: 'cutetea' }
    useGameStore.setState({ sceneProject: null, sceneJob: null })
    const plain = queuedScene(base, lines)
    expect('projectClass' in plain).toBe(false)
    expect('jobId' in plain).toBe(false)
  })

  it('carries a visited workplace and drops it when the scene is not at one', () => {
    useGameStore.setState({ sceneClass: null, sceneProject: null, sceneJob: null })
    useGameStore.setState({ sceneVisitJob: 'cutetea' })
    expect(queuedScene(null, lines).visitJobId).toBe('cutetea')

    // The same trap the other three have, and the reason this field is written
    // set-or-delete: a base replayed elsewhere would keep her counter in the
    // lorebook of a scene nowhere near it.
    const base = { ...openingScene([]), visitJobId: 'cutetea' }
    useGameStore.setState({ sceneVisitJob: null })
    expect('visitJobId' in queuedScene(base, lines)).toBe(false)
  })

  it('carries the goodbye it is, and drops it when the scene is not one', () => {
    // The field the epilogue rests on. `base` is the capture taken before
    // the goodbye was staged, so it never holds one — read live, or a goodbye
    // resumed off this autosave is an ordinary scene that files a ledger and
    // moves the clock past the last day of the game.
    useGameStore.setState({ sceneClass: null, sceneProject: null, sceneJob: null })
    useGameStore.setState({ sceneVisitJob: null, sceneFarewell: 'char-1' })
    expect(queuedScene(null, lines).farewell).toBe('char-1')

    const base = { ...openingScene([]), farewell: 'char-1' }
    useGameStore.setState({ sceneFarewell: null })
    expect('farewell' in queuedScene(base, lines)).toBe(false)
  })

  it('carries the mentions and the location, and drops each when the scene has none', () => {
    // `base` is the capture taken before the casting turn ran, so both fields
    // exist only in the store — read live or they never reach the autosave and
    // a mid-scene reload loses who the scene was about.
    useGameStore.setState({
      sceneClass: null,
      sceneProject: null,
      sceneJob: null,
      sceneVisitJob: null,
      sceneMentions: ['char-2'],
      sceneLocation: 'the Kendall Library'
    })
    const scene = queuedScene(null, lines)
    expect(scene.mentions).toEqual(['char-2'])
    expect(scene.location).toBe('the Kendall Library')

    // The same set-or-delete trap the four scene kinds have: a base replayed in
    // a scene about nobody would keep describing the last one's absentee.
    const base = { ...openingScene([]), mentions: ['char-2'], location: 'CuteTea' }
    useGameStore.setState({ sceneMentions: [], sceneLocation: null })
    const plain = queuedScene(base, lines)
    expect('mentions' in plain).toBe(false)
    expect('location' in plain).toBe(false)
  })

  it('carries the banked texting ledger and drops a stale one from the base', () => {
    // Same set-or-delete trap: a base replayed in a scene whose bank the store cleared
    // would keep an old reply on the save for the next reload to wrongly claim.
    useGameStore.setState({
      sceneClass: null,
      sceneProject: null,
      sceneJob: null,
      sceneVisitJob: null,
      sceneTextLedger: { key: 'k', reply: { events: [] } }
    })
    const scene = queuedScene(null, lines)
    expect(scene.textLedger).toEqual({ key: 'k', reply: { events: [] } })

    const base = { ...openingScene([]), textLedger: { key: 'k', reply: { events: [] } } }
    useGameStore.setState({ sceneTextLedger: null })
    expect('textLedger' in queuedScene(base, lines)).toBe(false)
  })

  it('copies the mention list rather than aliasing the store\'s', () => {
    useGameStore.setState({ sceneMentions: ['char-2'], sceneLocation: null })
    const scene = queuedScene(null, lines)
    useGameStore.setState({ sceneMentions: ['char-2', 'char-3'] })
    expect(scene.mentions).toEqual(['char-2'])
  })
})

describe('markDecisionPoint', () => {
  it('holds the drained scene and writes it over the autosave', async () => {
    const saves = stubSaves()
    useGameStore.setState({
      cast: ['char-1'],
      currentSceneTranscript: [{ speaker: 'Sarah', text: 'Hello.' }]
    })

    markDecisionPoint()
    expect(loopState.decisionSave?.transcript).toEqual([{ speaker: 'Sarah', text: 'Hello.' }])

    await writeAutosave(null)
    const [, draft] = saves.autosave.mock.calls[0] as unknown as [string, SaveDraft]
    expect(draft.scene).toEqual(loopState.decisionSave)
  })

  it('leaves an exam alone: the paper is written once, at its start', () => {
    const saves = stubSaves()
    const quiz: QuizState = {
      code: 'BIO 210',
      exam: 'midterm',
      questions: [
        { question: 'What is a ribosome?', a: 'A', b: 'B', c: 'C', d: 'D', correct: 'A' }
      ],
      index: 1,
      correct: 0
    }
    useGameStore.setState({
      sceneQuiz: quiz,
      currentSceneTranscript: [{ speaker: '', text: 'What is a ribosome?' }]
    })

    markDecisionPoint()
    expect(loopState.decisionSave).toBe(null)
    expect(saves.autosave).not.toHaveBeenCalled()
  })
})
