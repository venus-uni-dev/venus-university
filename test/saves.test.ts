import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  READER_SPEAKER,
  type BankedOpening,
  type GameSave,
  type LedgerResponse,
  type QuizState,
  type Result,
  type SaveDraft,
  type SceneLine
} from '@shared/types'
import {
  endingGameOver,
  foldOpeningIntoSlotSave,
  manualSaveDraft,
  manualSaveOffer,
  markDecisionPoint,
  openingScene,
  queuedScene,
  writeAutosave,
  writeEpilogueSave,
  writeManualSave,
  writeSlotSave,
  writesSettled
} from '../src/renderer/stores/loop/saves'
import { loopState, resetLoopState } from '../src/renderer/stores/loop/state'
import { useBunnyboardStore } from '../src/renderer/stores/bunnyboardStore'
import { useGameStore } from '../src/renderer/stores/gameStore'
import { useUiStore } from '../src/renderer/stores/uiStore'
import { GRADUATION_DATE } from '../src/renderer/prompts/occasions'
import { restoreApi, sceneLines, stubApi } from './fixtures'

/**
 * Every write the slot-cycle loop makes, and the order they land in: strictly one after another,
 * so no write overtakes one queued before it, and none queued by a stay that has been left lands
 * in the next game's files.
 */

/** A save the way `saves:*` answers with one; only `saveId` is ever read back. */
function savedAs(saveId: string): Result<GameSave> {
  return { ok: true, data: { saveId } as GameSave }
}

const FAILED: Result<GameSave> = { ok: false, error: { code: 'SAVE_WRITE_FAILED', message: 'disk' } }

/** Every write channel, each recording what it was handed. */
function stubSaves(
  overrides: Partial<Record<'autosave' | 'slot' | 'overwrite' | 'manual', unknown>> = {}
) {
  const autosave = vi.fn(async () => savedAs('auto'))
  const slot = vi.fn(async () => savedAs('slot-1'))
  const overwrite = vi.fn(async () => savedAs('slot-1'))
  const manual = vi.fn(async () => savedAs('manual03'))
  const saves = { autosave, slot, overwrite, manual, ...overrides } as unknown as {
    autosave: typeof autosave
    slot: typeof slot
    overwrite: typeof overwrite
    manual: typeof manual
  }
  stubApi({ saves })
  return saves
}

/** An autosave that lands only when released, recording the order writes land in. */
function heldAutosave(order: string[]): { autosave: () => Promise<Result<GameSave>>; release: () => void } {
  let release = (): void => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  const autosave = vi.fn(async () => {
    await held
    order.push('autosave')
    return savedAs('auto')
  })
  return { autosave, release }
}

/** A reply partway read: its first line on screen and three still queued. */
function midReply(): void {
  useGameStore.setState({
    cast: ['char-1'],
    currentSceneTranscript: sceneLines('One.', 'Two.', 'Three.', 'Four.'),
    sceneLog: sceneLines('One.'),
    currentLine: { speaker: '', text: 'One.' },
    pendingLines: sceneLines('Two.', 'Three.', 'Four.'),
    awaitingInput: false
  })
}

/** A reply read to its end, the input open under its last line. */
function atDecisionPoint(): void {
  useGameStore.setState({
    cast: ['char-1'],
    currentSceneTranscript: sceneLines('Hello.'),
    sceneLog: sceneLines('Hello.'),
    currentLine: { speaker: '', text: 'Hello.' },
    pendingLines: [],
    awaitingInput: true
  })
}

beforeEach(() => {
  useGameStore.getState().reset()
  useBunnyboardStore.getState().reset()
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

  it('drops a write queued by a stay that has been left before its turn came', async () => {
    // Left unfenced, the leaving game's scene would land in whatever playthrough loads next.
    const saves = stubSaves()
    const write = writeAutosave(null)
    resetLoopState()

    await write
    expect(saves.autosave).not.toHaveBeenCalled()
  })

  it('settles only once the autosave out ahead of it has landed', async () => {
    // What leaving waits on before the game is torn down.
    const order: string[] = []
    const { autosave, release } = heldAutosave(order)
    stubSaves({ autosave })
    void writeAutosave(null)
    let settled = false
    const done = writesSettled().then(() => {
      settled = true
    })

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(settled).toBe(false)
    release()
    await done
    expect(order).toEqual(['autosave'])
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

  it('leaves the fold target unset when the write failed, so nothing amends the save before it', async () => {
    stubSaves({ slot: vi.fn(async () => FAILED) })
    loopState.slotSaveId = 'old'

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

  it("reads the turn's action onto the log the base was captured without, once", () => {
    // `base` is taken before the action is logged; without the line, a reload of the reply's
    // autosave plays the reply with the reader's own words missing from the log.
    const base = openingScene([])
    base.sceneLog = [{ speaker: 'Sarah', text: 'Hi.' }]
    const action: SceneLine = { speaker: READER_SPEAKER, text: 'I wave.' }
    useGameStore.setState({
      currentSceneTranscript: [{ speaker: 'Sarah', text: 'Hi.' }, action, ...lines]
    })

    const scene = queuedScene(base, lines)
    expect(scene.sceneLog).toEqual([{ speaker: 'Sarah', text: 'Hi.' }, action])
    expect(base.sceneLog).toEqual([{ speaker: 'Sarah', text: 'Hi.' }])
    // A base that already ends on it is not given it twice.
    expect(queuedScene(scene, lines).sceneLog).toEqual(scene.sceneLog)
  })

  it('reads the same words onto the log again after a reply with no lines', () => {
    // Taken for the one before it, the reload's log holds one action fewer than its transcript.
    const keep: SceneLine = { speaker: READER_SPEAKER, text: 'Keep going' }
    const base = openingScene([])
    base.sceneLog = [{ speaker: 'Sarah', text: 'Hi.' }, keep]
    useGameStore.setState({
      currentSceneTranscript: [{ speaker: 'Sarah', text: 'Hi.' }, keep, { ...keep }, ...lines]
    })

    const scene = queuedScene(base, lines)
    expect(scene.sceneLog).toEqual([{ speaker: 'Sarah', text: 'Hi.' }, keep, keep])
  })

  it('carries the summary marks live, as copies, and drops stale ones from the base', () => {
    // A cut or a rewind reverts the running summary off these marks, so a reload without them
    // would keep a summary covering lines the scene no longer has.
    useGameStore.setState({ sceneSummaries: [{ at: 2, summary: 'They met.' }] })
    const scene = queuedScene(null, lines)
    expect(scene.summaries).toEqual([{ at: 2, summary: 'They met.' }])
    expect(scene.summaries?.[0]).not.toBe(useGameStore.getState().sceneSummaries[0])

    const base = { ...openingScene([]), summaries: [{ at: 1, summary: 'Old.' }] }
    useGameStore.setState({ sceneSummaries: [] })
    expect('summaries' in queuedScene(base, lines)).toBe(false)
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

describe('manualSaveDraft', () => {
  // A load reads these marks to decide where playback stands: a wrong one either skips the lines
  // still queued, or opens the input over a reply the reader had not finished.
  it('marks a save taken mid-reply to resume on the line on screen, queue and all', () => {
    midReply()
    const scene = manualSaveDraft()?.scene
    expect(scene?.resumeOnLine).toBe(true)
    expect(scene?.currentLine).toEqual({ speaker: '', text: 'One.' })
    expect(scene?.pendingLines).toEqual(sceneLines('Two.', 'Three.', 'Four.'))
  })

  it('leaves a decision point unmarked', () => {
    atDecisionPoint()
    const scene = manualSaveDraft()?.scene
    expect(scene).toBeTruthy()
    expect(scene && 'resumeOnLine' in scene).toBe(false)
  })

  it('marks the last line of a reply that has not been turned yet', () => {
    atDecisionPoint()
    useGameStore.setState({ awaitingInput: false })
    const scene = manualSaveDraft()?.scene
    expect(scene?.resumeOnLine).toBe(true)
    expect(scene?.pendingLines).toEqual([])
  })

  it('records a resolved scene as its ending, with whatever the ending has banked', () => {
    midReply()
    useGameStore.setState({ sceneEnding: true })
    const bare = manualSaveDraft()?.scene
    expect(bare?.endPending).toBe(true)
    expect(bare && ('ledger' in bare || 'opening' in bare)).toBe(false)

    const ledger: LedgerResponse = {}
    const opening = { lines: [], hangouts: [], events: [] } as unknown as BankedOpening
    loopState.pendingLedgerResult = ledger
    loopState.bankedOpening = opening
    const banked = manualSaveDraft()?.scene
    expect(banked?.ledger).toBe(ledger)
    expect(banked?.opening).toBe(opening)
  })

  it('records the status sequence as the base it was raised on, and nothing without one', () => {
    // Money has already moved by the time the lines are read; the base is from before it did.
    midReply()
    useGameStore.setState({ sceneEnding: true, statusShown: true })
    expect(manualSaveDraft()).toBeNull()

    const base: SaveDraft = { ...useGameStore.getState().toGameSave(), money: 1 }
    loopState.statusBase = base
    expect(manualSaveDraft()).toBe(base)
  })

  it('records the goodbye menu as between scenes, whatever is still on screen', () => {
    useGameStore.setState({
      date: GRADUATION_DATE,
      time: 0,
      graduationSeen: true,
      currentLine: { speaker: '', text: 'Mina will miss you.' },
      awaitingInput: true
    })
    const draft = manualSaveDraft()
    expect(draft).not.toBeNull()
    expect(draft?.scene).toBeNull()
  })

  it('refuses with no scene a load could be put back onto', () => {
    expect(manualSaveDraft()).toBeNull()
  })

  it('keeps a paper at the question it stands on', () => {
    const quiz: QuizState = {
      code: 'BIO 210',
      exam: 'midterm',
      questions: [],
      index: 2,
      correct: 1
    }
    useGameStore.setState({ sceneQuiz: quiz, awaitingInput: true })
    expect(manualSaveDraft()?.scene?.quiz?.index).toBe(2)
  })
})

describe('manualSaveOffer', () => {
  it.each<[string, () => void]>([
    [
      'a failed turn',
      () => useGameStore.setState({ turnError: { code: 'LLM_NETWORK', message: 'dropped' } })
    ],
    ['a call in flight', () => useGameStore.setState({ busy: true })],
    ['an ending still being paid for', () => useGameStore.getState().setEndingInFlight(true)],
    [
      'a hangout being written behind the phone',
      () => {
        loopState.hangoutPrefetch = { charId: 'char-1', snapshot: { scene: null, action: '' }, scene: null }
      }
    ]
  ])('waits on %s', (_, arrange) => {
    atDecisionPoint()
    arrange()
    expect(manualSaveOffer()).toBe('waiting')
  })

  it('is never offered once the playthrough has ended', () => {
    atDecisionPoint()
    useGameStore.setState({ activeGameOver: 'debt' })
    expect(manualSaveOffer()).toBe('none')
  })

  it('is never offered on the goodbye menu past the debt floor', () => {
    useGameStore.setState({ date: GRADUATION_DATE, time: 0, graduationSeen: true, money: -5000 })
    expect(manualSaveOffer()).toBe('none')
  })

  it('is never offered over a losing ending', () => {
    atDecisionPoint()
    useGameStore.setState({ sceneEnding: true })
    loopState.pendingLedgerResult = { memories: [], events: [], expelled: true }
    expect(manualSaveOffer()).toBe('none')
  })

  it('is open at a plain decision point', () => {
    atDecisionPoint()
    expect(manualSaveOffer()).toBe('open')
  })
})

describe('endingGameOver', () => {
  /** The balance at which the debt ends the playthrough. */
  const DEBT_FLOOR = -5000

  it('is nothing without a ledger', () => {
    loopState.pendingLedgerResult = null
    expect(endingGameOver()).toBeNull()
  })

  it('reads the expulsion off the ledger before the boundary applies it', () => {
    loopState.pendingLedgerResult = { memories: [], events: [], expelled: true }
    expect(endingGameOver()).toBe('expulsion')
  })

  it('takes the spend off the balance before the status lines, and not again after them', () => {
    useGameStore.setState({ money: DEBT_FLOOR + 10, statusShown: false })
    loopState.pendingLedgerResult = { memories: [], events: [], spent: 20 }
    expect(endingGameOver()).toBe('debt')
    useGameStore.setState({ money: DEBT_FLOOR + 10, statusShown: true })
    expect(endingGameOver()).toBeNull()
  })

  it('counts the pay of a shift in, and no spend', () => {
    useGameStore.setState({ money: DEBT_FLOOR - 5, statusShown: false })
    loopState.pendingLedgerResult = { memories: [], events: [], spent: 20 }
    loopState.jobShift = { slotId: 0, pay: 50, gain: { stats: [], text: '' } }
    expect(endingGameOver()).toBeNull()
  })
})

describe('writeManualSave', () => {
  it('writes the game as it stood at the click, behind the autosave already out', async () => {
    const order: string[] = []
    const { autosave, release } = heldAutosave(order)
    const saves = stubSaves({
      autosave,
      manual: vi.fn(async () => {
        order.push('manual')
        return savedAs('manual03')
      })
    })
    atDecisionPoint()
    useGameStore.setState({ money: 100 })

    const first = writeAutosave(null)
    const second = writeManualSave(3)
    useGameStore.setState({ money: 5 })
    expect(saves.manual).not.toHaveBeenCalled()

    release()
    const [, saved] = await Promise.all([first, second])
    expect(saved).toBe(true)
    expect(order).toEqual(['autosave', 'manual'])
    const [playthroughId, slot, draft] = saves.manual.mock.calls[0] as unknown as [
      string,
      number,
      SaveDraft
    ]
    expect(playthroughId).toBe('p1')
    expect(slot).toBe(3)
    expect(draft.money).toBe(100)
  })

  it('writes nothing while the loop is unsettled', async () => {
    const saves = stubSaves()
    atDecisionPoint()
    useGameStore.setState({ busy: true })

    await expect(writeManualSave(1)).resolves.toBe(false)
    expect(saves.manual).not.toHaveBeenCalled()
    expect(saves.autosave).not.toHaveBeenCalled()
  })

  it('reports a write that failed, and says it did not save', async () => {
    stubSaves({ manual: vi.fn(async () => FAILED) })
    atDecisionPoint()

    await expect(writeManualSave(1)).resolves.toBe(false)
    expect(useUiStore.getState().error?.code).toBe('SAVE_WRITE_FAILED')
  })
})
