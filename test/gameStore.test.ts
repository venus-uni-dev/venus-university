import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MEMORY_CAP } from '@shared/relationship'
import { MAX_RAISES, RAISE_EVERY } from '@shared/jobs'
import { giftMemoryDesc, itemDefOf, type ItemDef } from '@shared/shop'
import type { CharMemory, GameSave, SceneState, SocialPost } from '@shared/types'
import { weatherAt } from '@shared/weather'
import { buildCharKeyToId, useGameStore } from '../src/renderer/stores/gameStore'
import { useSettingsStore } from '../src/renderer/stores/settingsStore'
import {
  calendarEvent,
  character,
  charactersById,
  charInfo,
  charJob,
  playthroughRecord
} from './fixtures'

// The store resolves a gift by id, so the fakes the gifting tests give have to resolve too.
vi.mock('@shared/shop', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shared/shop')>()
  const { item } = await import('./fixtures')
  const fakes: Record<string, ItemDef> = {
    rose: item({ id: 'rose', name: 'Rose', categories: ['romantic'] }),
    coin: item({ id: 'coin', name: 'Coin', categories: ['romantic', 'novelty'] })
  }
  return { ...actual, itemDefOf: (id: string) => fakes[id] ?? actual.itemDefOf(id) }
})

/**
 * The store fields that end up on disk. A bug in any of these writes a
 * plausible-looking save that is quietly wrong — the wrong date on a memory, a
 * lost history entry, a scene that resumes onto a different stage.
 */

beforeEach(() => {
  useGameStore.getState().reset()
  useSettingsStore.setState({ settings: null })
})

describe('captureScene / restoreScene', () => {
  const scene: SceneState = {
    cast: ['a', 'b'],
    classCode: 'BIO 210',
    transcript: [{ speaker: 'sarah_rose', text: 'Hi.' }],
    summary: 'They met.',
    bg: 'quad',
    slots: ['a', null, 'b'],
    emotions: { a: 'happy', b: 'sex' },
    flipped: { b: true },
    departed: ['c'],
    offStage: { d: 1 },
    sceneLog: [
      { speaker: '', text: 'The bell rings.' },
      { speaker: 'sarah_rose', text: 'Hi.' }
    ],
    currentLine: { speaker: '', text: 'The bell rings.' },
    // A capture taken at a decision point is drained; a queue here is a reply
    // the player has not read yet.
    pendingLines: []
  }

  it('captures a solo scene, which has a transcript but no cast', () => {
    // Keyed on the cast this would be null, and a solo scene could never be
    // saved mid-scene.
    useGameStore.setState({ currentSceneTranscript: [{ speaker: '', text: 'You walk.' }] })
    expect(useGameStore.getState().captureScene()).toMatchObject({ cast: [] })
  })

  it('captures a slot opening, which has narration read but no scene', () => {
    useGameStore.setState({ sceneLog: [{ speaker: '', text: 'Monday.' }] })
    expect(useGameStore.getState().captureScene()).not.toBeNull()
  })

  it('round-trips a queued reply, so a resumed save starts at its first line', () => {
    const queued: SceneState = {
      ...scene,
      pendingLines: [
        { speaker: '', text: 'She turns.' },
        { speaker: 'sarah_rose', text: 'Hey.' }
      ]
    }
    useGameStore.getState().restoreScene(queued)
    expect(useGameStore.getState().pendingLines).toEqual(queued.pendingLines)
    expect(useGameStore.getState().captureScene()).toEqual(queued)
  })

  it('ignores the ending fields, which are the loop’s state and not the store’s', () => {
    // All three are read off the save by `enterGame`; a capture that
    // echoed them back would resume an ending twice — and `opening` is a slot
    // opening already paid for, so replaying it would bill a second one and
    // double-file the plans it carries.
    useGameStore.getState().restoreScene({
      ...scene,
      endPending: true,
      ledger: { memories: [], events: [] },
      opening: {
        lines: [],
        hangouts: [],
        events: [],
        cancellations: [],
        rumorPass: { suspicions: {}, memories: [], sightings: [] },
        crushes: [],
        npcRelationships: {}
      }
    })
    const captured = useGameStore.getState().captureScene()
    expect(captured).not.toHaveProperty('endPending')
    expect(captured).not.toHaveProperty('ledger')
    expect(captured).not.toHaveProperty('opening')
  })

  it('round-trips the project course and the job a scene belongs to', () => {
    const store = useGameStore.getState()
    store.setCast(['a'], { projectClass: 'ART 110' })
    expect(useGameStore.getState().captureScene()).toMatchObject({ projectClass: 'ART 110' })

    // A shift is cast with nobody in it, so the transcript is what makes the
    // capture non-null at all — an empty scene still captures as `null`.
    store.restoreScene(scene)
    store.setCast([], { jobId: 'cutetea' })
    const captured = useGameStore.getState().captureScene()
    expect(captured).toMatchObject({ jobId: 'cutetea' })
    expect(captured).not.toHaveProperty('projectClass')

    store.restoreScene({ ...scene, projectClass: 'ART 110', jobId: 'cutetea' })
    expect(useGameStore.getState()).toMatchObject({
      sceneProject: 'ART 110',
      sceneJob: 'cutetea'
    })
  })

  it('clears every scene kind when a cast is set without one', () => {
    // What every "no longer in that scene" caller relies on: a shift's workplace
    // must not still be in the lorebook of the scene after it.
    const store = useGameStore.getState()
    store.setCast(['a'], { classCode: 'BIO 210' })
    store.setCast(['a'])
    expect(useGameStore.getState()).toMatchObject({
      sceneClass: null,
      sceneProject: null,
      sceneJob: null,
      sceneVisitJob: null,
      sceneTextLedgerSkip: null
    })
  })

  it('round-trips a visited workplace, and rides alongside a project', () => {
    const store = useGameStore.getState()
    // The one scene kind that is not exclusive: a work session at the counter
    // she is working behind is legitimately both.
    store.setCast(['a'], { projectClass: 'ART 110', visitJobId: 'cutetea' })
    expect(useGameStore.getState().captureScene()).toMatchObject({
      projectClass: 'ART 110',
      visitJobId: 'cutetea'
    })

    store.restoreScene({ ...scene, visitJobId: 'fast_eats' })
    expect(useGameStore.getState().sceneVisitJob).toBe('fast_eats')
  })

  it('round-trips the thread the hour’s texting ledger skips', () => {
    // A hangout is the only thing that sets it, and it has to survive the
    // mid-scene reload that re-fires the prefetch — a reload that lost it would
    // read the very texts that arranged the hour he is in.
    const store = useGameStore.getState()
    store.setCast(['a'], { textLedgerSkip: 'a' })
    expect(useGameStore.getState().captureScene()).toMatchObject({ textLedgerSkip: 'a' })

    store.restoreScene({ ...scene, textLedgerSkip: 'b' })
    expect(useGameStore.getState().sceneTextLedgerSkip).toBe('b')
  })

  it('round-trips the banked texting ledger and clears it with the cast', () => {
    // A reload that lost it would pay for the call again; a fresh cast must not
    // inherit a reply that was banked for a different scene.
    const store = useGameStore.getState()
    store.setCast(['a'], {})
    store.bankTextLedger({ key: 'k', reply: { events: [] } })
    expect(useGameStore.getState().captureScene()).toMatchObject({
      textLedger: { key: 'k', reply: { events: [] } }
    })

    store.restoreScene({ ...scene })
    expect(useGameStore.getState().sceneTextLedger).toBeNull()

    store.restoreScene({ ...scene, textLedger: { key: 'k2', reply: {} } })
    expect(useGameStore.getState().sceneTextLedger).toEqual({ key: 'k2', reply: {} })

    store.setCast(['a'])
    expect(useGameStore.getState().sceneTextLedger).toBeNull()
  })

  it('round-trips the mentions and the location a turn was classified with', () => {
    // Both survive a mid-scene reload for the reason every scene-kind field
    // does: the action they came from is gone by the second turn, and the
    // lorebook is rescanned from scratch every call.
    const store = useGameStore.getState()
    store.setCast(['a'], { mentions: ['b'], location: 'the Kendall Library' })
    expect(useGameStore.getState()).toMatchObject({
      sceneMentions: ['b'],
      sceneLocation: 'the Kendall Library'
    })
    expect(store.captureScene()).toMatchObject({
      mentions: ['b'],
      location: 'the Kendall Library'
    })

    store.restoreScene({ ...scene, mentions: ['c'], location: 'CuteTea' })
    expect(useGameStore.getState()).toMatchObject({
      sceneMentions: ['c'],
      sceneLocation: 'CuteTea'
    })
  })

  // The one scene fact written only when *false*: absent is public, which is
  // the classifier's own default and what an older capture has to keep meaning.
  it('records a private scene and writes nothing at all for a public one', () => {
    const store = useGameStore.getState()
    store.setCast(['a'], { inPublic: false })
    expect(useGameStore.getState().sceneInPublic).toBe(false)
    expect(store.captureScene()).toMatchObject({ inPublic: false })

    store.setCast(['a'], { inPublic: true })
    expect(useGameStore.getState().sceneInPublic).toBe(true)
    expect(store.captureScene()).not.toHaveProperty('inPublic')
  })

  it('reads a scene with no inPublic key as public, however it was written', () => {
    const store = useGameStore.getState()
    store.setCast(['a'], { inPublic: false })
    store.restoreScene(scene)
    expect(useGameStore.getState().sceneInPublic).toBe(true)

    store.restoreScene({ ...scene, inPublic: false })
    expect(useGameStore.getState().sceneInPublic).toBe(false)
  })

  it('copies the log rather than aliasing it, so a capture cannot grow later', () => {
    const store = useGameStore.getState()
    store.restoreScene(scene)
    const captured = store.captureScene()!
    useGameStore.setState({ pendingLines: [{ speaker: '', text: 'later' }] })
    useGameStore.getState().advanceLine()
    expect(captured.sceneLog).toHaveLength(2)
  })
})

describe('advanceLine', () => {
  it('logs each line as it is reached, and only then', () => {
    // The log is persisted through `captureScene`, so a line lost here is
    // lost from every mid-scene save. Appending at playback rather than on
    // receipt is also what keeps a queued line out of the log.
    const lines = [
      { speaker: '', text: 'first' },
      { speaker: '', text: 'second' }
    ]
    useGameStore.setState({ pendingLines: [...lines] })

    useGameStore.getState().advanceLine()
    expect(useGameStore.getState().sceneLog).toEqual([lines[0]])

    useGameStore.getState().advanceLine()
    expect(useGameStore.getState().sceneLog).toEqual(lines)
  })

  describe('stage actions', () => {
    // `offStage` and `departed` are both persisted in `SceneState`, so a
    // hide charged to the wrong clock writes a girl out of a scene she is in.
    beforeEach(() => {
      const roster = charactersById(
        character({ charId: 'a', firstName: 'Sarah', lastName: 'Rose' }),
        character({ charId: 'b', firstName: 'Mina', lastName: 'Kwon', pose: 'sitting' })
      )
      useGameStore.setState({
        characters: roster,
        charKeyToId: buildCharKeyToId(roster),
        cast: ['a', 'b']
      })
    })

    it('hides off-stage and frees the slot, without writing her out of the scene', () => {
      // The absence is opened, not settled: nothing leaves the cast until a
      // decision point has charged it.
      useGameStore.setState({
        pendingLines: [
          { speaker: '', actions: ['show:sarah_rose'], text: 'x' },
          { speaker: '', actions: ['hide:sarah_rose'], text: 'y' }
        ]
      })
      useGameStore.getState().advanceLine()
      useGameStore.getState().advanceLine()
      expect(useGameStore.getState().slots).toEqual([null, null, null])
      expect(useGameStore.getState().offStage).toEqual({ a: 0 })
      expect(useGameStore.getState().departed).toEqual([])
    })

    it('a re-show cancels the absence — a hide used for effect must not cost her the cast', () => {
      useGameStore.setState({
        pendingLines: [
          { speaker: '', actions: ['show:sarah_rose'], text: 'x' },
          { speaker: '', actions: ['hide:sarah_rose'], text: 'y' },
          { speaker: '', actions: ['show:sarah_rose'], text: 'z' }
        ]
      })
      useGameStore.getState().advanceLine()
      useGameStore.getState().advanceLine()
      useGameStore.getState().advanceLine()
      expect(useGameStore.getState().slots).toEqual(['a', null, null])
      expect(useGameStore.getState().offStage).toEqual({})
      expect(useGameStore.getState().departed).toEqual([])
    })

    // A CG is one girl by herself, and what ends it is the stage: the sprite it retires to
    // is sticky and persisted, so a CG left standing behind a newcomer would be drawn over her.
    it('ends a CG when a second girl is shown, in the nude set she has rendered', () => {
      useGameStore.setState({
        outfitReady: { a: ['nude'] },
        pendingLines: [
          { speaker: '', actions: ['show:sarah_rose', 'cg:sex'], text: 'x' },
          { speaker: '', actions: ['show:mina_kwon', 'sprite:mina_kwon,happy'], text: 'y' }
        ]
      })
      useGameStore.getState().advanceLine()
      expect(useGameStore.getState().emotions.a).toBe('sex')
      useGameStore.getState().advanceLine()
      expect(useGameStore.getState().emotions.a).toBe('aroused_nude')
    })

    it('retires the CG of the girl who walks off, so a re-show stands her up', () => {
      useGameStore.setState({
        pendingLines: [
          { speaker: '', actions: ['show:sarah_rose', 'cg:sex_after'], text: 'x' },
          { speaker: '', actions: ['hide:sarah_rose'], text: 'y' }
        ]
      })
      useGameStore.getState().advanceLine()
      useGameStore.getState().advanceLine()
      // No nude set rendered for her: the mood alone, in the clothes she started in.
      expect(useGameStore.getState().emotions.a).toBe('happy')
    })

    it('ends a CG the player interrupts by showing somebody else by hand', () => {
      useGameStore.setState({
        slots: ['a', null, null],
        emotions: { a: 'sex' },
        outfitReady: { a: ['nude'] }
      })
      useGameStore.getState().toggleStageChar('b')
      expect(useGameStore.getState().emotions.a).toBe('aroused_nude')
    })

    it('does not restart the clock on a second hide of someone already off', () => {
      // Two hides with no show between them are one absence; re-zeroing it would
      // let a repeated stage direction keep her in the scene forever.
      useGameStore.setState({
        pendingLines: [
          { speaker: '', actions: ['show:sarah_rose'], text: 'x' },
          { speaker: '', actions: ['hide:sarah_rose'], text: 'y' },
          { speaker: '', actions: ['hide:sarah_rose'], text: 'z' }
        ]
      })
      useGameStore.getState().advanceLine()
      useGameStore.getState().advanceLine()
      useGameStore.getState().settleDepartures()
      useGameStore.getState().advanceLine()
      expect(useGameStore.getState().offStage).toEqual({ a: 1 })
    })
  })

  describe('seeing a wardrobe', () => {
    // `seenOutfits` is persisted per character and is what her contact page's outfit
    // switcher offers, so a set recorded that was never on screen offers the reader a picture
    // the game withheld — and one missed is a wardrobe he can never look at again.
    beforeEach(() => {
      const roster = charactersById(character({ charId: 'a', firstName: 'Sarah', lastName: 'Rose' }))
      useGameStore.setState({
        characters: roster,
        charKeyToId: buildCharKeyToId(roster),
        cast: ['a'],
        charInfo: { a: charInfo() }
      })
    })

    it('records the set a line puts her in, once, in first-seen order', () => {
      useGameStore.setState({
        pendingLines: [
          { speaker: '', actions: ['show:sarah_rose', 'sprite:sarah_rose,happy_pe'], text: 'x' },
          { speaker: '', actions: ['sprite:sarah_rose,angry_pe'], text: 'y' },
          { speaker: '', actions: ['sprite:sarah_rose,happy_swim'], text: 'z' }
        ]
      })
      useGameStore.getState().advanceLine()
      useGameStore.getState().advanceLine()
      expect(useGameStore.getState().charInfo.a.seenOutfits).toEqual(['pe'])
      useGameStore.getState().advanceLine()
      expect(useGameStore.getState().charInfo.a.seenOutfits).toEqual(['pe', 'swim'])
    })

    it('records nothing for the wardrobe she is already in', () => {
      useGameStore.setState({
        pendingLines: [
          { speaker: '', actions: ['show:sarah_rose', 'sprite:sarah_rose,happy'], text: 'x' }
        ]
      })
      useGameStore.getState().advanceLine()
      expect(useGameStore.getState().charInfo.a.seenOutfits).toBeUndefined()
    })

    it('records the reference as applied, so a withheld set was never seen', () => {
      // `noNsfwImages` drops the nude set off the reference and she keeps what she is wearing,
      // which means nothing was shown and nothing may be offered later.
      useSettingsStore.setState({ settings: { noNsfwImages: true } as never })
      useGameStore.setState({
        pendingLines: [
          { speaker: '', actions: ['show:sarah_rose', 'sprite:sarah_rose,happy_nude'], text: 'x' }
        ]
      })
      useGameStore.getState().advanceLine()
      expect(useGameStore.getState().charInfo.a.seenOutfits).toBeUndefined()
    })
  })

  describe('learning a name', () => {
    // `nameKnown` is persisted per character, so a flip that lands on the
    // wrong entry — or never lands — is wrong in every save from then on.
    const sarah = character({ charId: 'a' })
    const mina = character({ charId: 'b', firstName: 'Mina', lastName: 'Okada' })

    beforeEach(() => {
      useGameStore.setState({
        cast: ['a', 'b'],
        characters: charactersById(sarah, mina),
        charInfo: { a: charInfo(), b: charInfo() }
      })
    })

    it('flips the named character on the very line that says it', () => {
      useGameStore.setState({ pendingLines: [{ speaker: '', text: 'She is Sarah, apparently.' }] })
      useGameStore.getState().advanceLine()
      expect(useGameStore.getState().charInfo.a.nameKnown).toBe(true)
      expect(useGameStore.getState().charInfo.b.nameKnown).toBe(false)
    })

    it('matches whole words only, so a short name cannot fire on a longer one', () => {
      useGameStore.setState({ pendingLines: [{ speaker: '', text: 'A dominant streak.' }] })
      useGameStore.getState().advanceLine()
      expect(useGameStore.getState().charInfo.b.nameKnown).toBe(false)
    })
  })
})

/**
 * The two turns separating stepping outside from leaving: both are written with the same
 * `hide:`, so only a second turn gone tells them apart. Getting it wrong writes a girl out of a
 * scene she is in, or keeps one in it who left.
 */
describe('settleDepartures', () => {
  beforeEach(() => {
    useGameStore.getState().reset()
    useGameStore.setState({ cast: ['a', 'b'] })
  })

  it('charges the first turn without settling anything', () => {
    useGameStore.setState({ offStage: { a: 0 } })
    useGameStore.getState().settleDepartures()
    expect(useGameStore.getState().offStage).toEqual({ a: 1 })
    expect(useGameStore.getState().departed).toEqual([])
  })

  it('settles her on the second, and spends the entry doing it', () => {
    useGameStore.setState({ offStage: { a: 0 } })
    useGameStore.getState().settleDepartures()
    useGameStore.getState().settleDepartures()
    expect(useGameStore.getState().offStage).toEqual({})
    expect(useGameStore.getState().departed).toEqual(['a'])
  })
})

describe('commitSceneToHistory', () => {
  it('keeps the other slot of the same day', () => {
    useGameStore.setState({ sceneSummary: 'Night.', history: { 3: { 0: 'Day.' } } })
    useGameStore.getState().commitSceneToHistory(3, 1)
    expect(useGameStore.getState().history[3]).toEqual({ 0: 'Day.', 1: 'Night.' })
  })

  // The sentence is what history stores and the recent-summary walk reads back.
  it('appends the plans the reader did not turn up for, naming only the stood-up', () => {
    useGameStore.setState({
      sceneSummary: 'He stayed in.',
      history: {},
      characters: charactersById(character({ charId: 'a', firstName: 'Sarah' })),
      events: [
        calendarEvent({ id: 'e1', date: 3, time: 1, title: 'Dinner', noShow: ['a'] }),
        // Kept: nobody was stood up, and it is not this slot anyway.
        calendarEvent({ id: 'e2', date: 3, time: 0, title: 'Gym', noShow: ['a'] }),
        calendarEvent({ id: 'e3', date: 3, time: 1, title: 'Study', noShow: [] })
      ]
    })
    useGameStore.getState().commitSceneToHistory(3, 1)
    expect(useGameStore.getState().history[3]?.[1]).toBe(
      "He stayed in. The reader didn't show up for Dinner with Sarah."
    )
  })
})

describe('markEventNoShow', () => {
  it('records the stood-up on the one event named', () => {
    useGameStore.setState({ events: [calendarEvent({ id: 'e1' }), calendarEvent({ id: 'e2' })] })
    useGameStore.getState().markEventNoShow('e2', ['a'])
    expect(useGameStore.getState().events[0].noShow).toBeUndefined()
    expect(useGameStore.getState().events[1].noShow).toEqual(['a'])
  })
})

describe('rescheduleEvent', () => {
  it('moves the one plan named and leaves the rest of it alone', () => {
    useGameStore.setState({
      events: [
        calendarEvent({ id: 'e1', date: 3, time: 1, seen: true }),
        calendarEvent({ id: 'e2', date: 3, time: 1 })
      ]
    })
    useGameStore.getState().rescheduleEvent('e1', 9, 0)

    const [moved, other] = useGameStore.getState().events
    expect(moved).toMatchObject({ id: 'e1', date: 9, time: 0 })
    // When it was agreed is not what a change of time alters, and the player
    // picked the new slot himself, so it is not news for the badge either.
    expect(moved.madeOn).toEqual({ date: 2, time: 0 })
    expect(moved.seen).toBe(true)
    expect(other).toMatchObject({ id: 'e2', date: 3, time: 1 })
  })

  // `noShow` is written when the slot's scene starts, so it is the
  // record that the hour has been and gone. History does not move.
  it('refuses to move a plan the reader has already been marked down for', () => {
    useGameStore.setState({ events: [calendarEvent({ id: 'e1', date: 3, time: 1, noShow: [] })] })
    const settled = useGameStore.getState().events
    useGameStore.getState().rescheduleEvent('e1', 9, 0)
    expect(useGameStore.getState().events).toBe(settled)
  })
})

describe('recordMemory', () => {
  const mem = (i: number): CharMemory => ({ date: i, type: 'liked', desc: `m${i}` })

  it('keeps the newest MEMORY_CAP and drops the oldest', () => {
    const store = useGameStore.getState()
    for (let i = 0; i < MEMORY_CAP + 5; i++) store.recordMemory('a', mem(i))
    const memories = useGameStore.getState().charInfo.a.memories
    expect(memories).toHaveLength(MEMORY_CAP)
    expect(memories[0]).toEqual(mem(5))
    expect(memories.at(-1)).toEqual(mem(MEMORY_CAP + 4))
  })
})

describe('clearNewJobNotice', () => {
  it('spends the notice once and is inert every time after', () => {
    useGameStore.setState({ date: 0, charInfo: { a: charInfo({ job: charJob({ newJobNotice: true }) }) } })
    useGameStore.getState().clearNewJobNotice('a')
    expect(useGameStore.getState().charInfo.a.job).toEqual({ jobId: 'cutetea', shifts: [11] })

    // Replayed boundary: the same charInfo object comes back untouched.
    const before = useGameStore.getState().charInfo
    useGameStore.getState().clearNewJobNotice('a')
    expect(useGameStore.getState().charInfo).toBe(before)
  })

  it('leaves a freshman notice alone until the day her job starts', () => {
    // The injection makes the same test, so a scene before the start day
    // neither shows the news nor spends it.
    const job = charJob({ startsOn: 14, newJobNotice: true })
    useGameStore.setState({ date: 7, charInfo: { a: charInfo({ job }) } })
    useGameStore.getState().clearNewJobNotice('a')
    expect(useGameStore.getState().charInfo.a.job?.newJobNotice).toBe(true)

    useGameStore.setState({ date: 14 })
    useGameStore.getState().clearNewJobNotice('a')
    expect(useGameStore.getState().charInfo.a.job?.newJobNotice).toBeUndefined()
  })
})

describe('the add/drop actions', () => {
  it('records drops unannounced, stamped with the day, and never re-records one', () => {
    // The stamp is what the notice waits on: without it nothing can say
    // whether the class has met since he left.
    useGameStore.setState({ date: 20 })
    useGameStore.getState().recordDroppedClasses(['BIO 210', 'ART 101'])
    expect(useGameStore.getState().droppedClasses).toEqual({
      'BIO 210': { announced: false, date: 20 },
      'ART 101': { announced: false, date: 20 }
    })

    // A drop already announced must survive being recorded again — otherwise a
    // re-drop of the same code would re-announce it to the whole class. Its own
    // date survives with it, rather than restamping to the day of the re-drop.
    useGameStore.setState({ date: 24 })
    useGameStore.getState().markDropAnnounced('BIO 210')
    useGameStore.getState().recordDroppedClasses(['BIO 210', 'CHM 100'])
    expect(useGameStore.getState().droppedClasses['BIO 210']).toEqual({
      announced: true,
      date: 20
    })
    expect(useGameStore.getState().droppedClasses['CHM 100']).toEqual({
      announced: false,
      date: 24
    })
  })

  it('spends the announcement once and is inert every time after', () => {
    // The boundary that spends it is replayed whenever the save before it is
    // loaded, so the second call must change nothing at all.
    useGameStore.getState().recordDroppedClasses(['BIO 210'])
    useGameStore.getState().markDropAnnounced('BIO 210')
    const before = useGameStore.getState().droppedClasses
    useGameStore.getState().markDropAnnounced('BIO 210')
    expect(useGameStore.getState().droppedClasses).toBe(before)

    // A code nobody dropped is not a drop to announce.
    useGameStore.getState().markDropAnnounced('ART 101')
    expect(useGameStore.getState().droppedClasses['ART 101']).toBeUndefined()
  })

  it('records adds unannounced, stamped with the day, and never re-records one', () => {
    // The drop's stamp for the drop's reason, asked the other way round: whether
    // the course had already met when he picked it up.
    useGameStore.setState({ date: 20 })
    useGameStore.getState().recordAddedClasses(['BIO 210', 'ART 101'])
    expect(useGameStore.getState().addedClasses).toEqual({
      'BIO 210': { announced: false, date: 20 },
      'ART 101': { announced: false, date: 20 }
    })

    // The room has already met him; picking the same course up again at a later
    // add/drop must not walk him through the door a second time.
    useGameStore.setState({ date: 24 })
    useGameStore.getState().markAddAnnounced('BIO 210')
    useGameStore.getState().recordAddedClasses(['BIO 210', 'CHM 100'])
    expect(useGameStore.getState().addedClasses['BIO 210']).toEqual({ announced: true, date: 20 })
    expect(useGameStore.getState().addedClasses['CHM 100']).toEqual({
      announced: false,
      date: 24
    })
  })

  it('spends the entrance once and is inert every time after', () => {
    // The drop's rule, for the drop's reason: this boundary is replayed whenever
    // the save before it is loaded.
    useGameStore.getState().recordAddedClasses(['BIO 210'])
    useGameStore.getState().markAddAnnounced('BIO 210')
    const before = useGameStore.getState().addedClasses
    useGameStore.getState().markAddAnnounced('BIO 210')
    expect(useGameStore.getState().addedClasses).toBe(before)

    useGameStore.getState().markAddAnnounced('ART 101')
    expect(useGameStore.getState().addedClasses['ART 101']).toBeUndefined()
  })

  it('advances the Venus watermark monotonically', () => {
    useGameStore.getState().advanceVenusThrough(16)
    expect(useGameStore.getState().venusThrough).toBe(16)
    // A replayed earlier boundary must not rewind it: that would redeliver every
    // message between the two slots.
    useGameStore.getState().advanceVenusThrough(4)
    expect(useGameStore.getState().venusThrough).toBe(16)
  })

  it('round-trips all three fields through a save', () => {
    useGameStore.setState({
      venusThrough: 50,
      droppedClasses: { 'BIO 210': { announced: true, date: 20 } },
      addedClasses: { 'ART 101': { announced: false, date: 24 } }
    })
    const save = useGameStore.getState().toGameSave()
    useGameStore.setState({ venusThrough: -1, droppedClasses: {}, addedClasses: {} })
    useGameStore.getState().loadSave(save as GameSave, playthroughRecord(), {})
    expect(useGameStore.getState().venusThrough).toBe(50)
    expect(useGameStore.getState().droppedClasses).toEqual({
      'BIO 210': { announced: true, date: 20 }
    })
    expect(useGameStore.getState().addedClasses).toEqual({
      'ART 101': { announced: false, date: 24 }
    })
  })
})

describe('the shop and gifting', () => {
  const ROSE = 'rose'
  const COIN = 'coin'

  it('flags a repeat against what she has already been given', () => {
    useGameStore.setState({
      inventory: [{ itemId: ROSE, count: 1 }],
      charInfo: { a: charInfo({ gifts: [ROSE] }) }
    })
    useGameStore.getState().giftItem('a', ROSE)
    expect(useGameStore.getState().sceneGifts[0].repeat).toBe(true)
  })

  it('flags a repeat against the same scene, before the boundary has filed it', () => {
    useGameStore.setState({ inventory: [{ itemId: ROSE, count: 2 }] })
    useGameStore.getState().giftItem('a', ROSE)
    useGameStore.getState().giftItem('a', ROSE)
    expect(useGameStore.getState().sceneGifts.map((g) => g.repeat)).toEqual([false, true])
  })

  it('does not read another girl gift as a repeat', () => {
    useGameStore.setState({
      inventory: [{ itemId: ROSE, count: 2 }],
      charInfo: { a: charInfo({ gifts: [ROSE] }) }
    })
    useGameStore.getState().giftItem('b', ROSE)
    expect(useGameStore.getState().sceneGifts[0].repeat).toBe(false)
  })

  // The abandoned-turn rollback: without it the save records a gift nobody
  // in the scene was ever handed, over an action he decided not to take.
  it('puts exactly one item back when a gift turn is abandoned', () => {
    useGameStore.setState({ inventory: [{ itemId: ROSE, count: 2 }] })
    useGameStore.getState().giftItem('a', ROSE)
    useGameStore.getState().giftItem('a', ROSE)
    useGameStore.getState().ungiftItem()
    expect(useGameStore.getState().inventory).toEqual([{ itemId: ROSE, count: 1 }])
    expect(useGameStore.getState().sceneGifts).toHaveLength(1)
  })

  it('folds the scene gifts into charInfo at the boundary', () => {
    useGameStore.setState({
      sceneGifts: [
        { charId: 'a', itemId: ROSE, repeat: false, reaction: 'neutral' },
        { charId: 'a', itemId: COIN, repeat: false, reaction: 'neutral' },
        { charId: 'b', itemId: ROSE, repeat: false, reaction: 'neutral' }
      ]
    })
    useGameStore.getState().recordGifts()
    expect(useGameStore.getState().charInfo.a.gifts).toEqual([ROSE, COIN])
    expect(useGameStore.getState().charInfo.b.gifts).toEqual([ROSE])
  })

  // The verdict is stamped where the gift is given because the action line the
  // player reads quotes it; an unstamped gift files no memory at the boundary.
  it('stamps how the gift landed against her preferences', () => {
    useGameStore.setState({
      inventory: [{ itemId: ROSE, count: 1 }],
      characters: charactersById(
        character({ charId: 'a', giftPreferences: { liked: ['romantic'], disliked: [] } })
      )
    })
    useGameStore.getState().giftItem('a', ROSE)
    expect(useGameStore.getState().sceneGifts[0].reaction).toBe('loved')
  })

  it('files a memory only for a present she was glad to get', () => {
    useGameStore.setState({
      date: 12,
      sceneGifts: [
        { charId: 'a', itemId: ROSE, repeat: false, reaction: 'loved' },
        { charId: 'b', itemId: COIN, repeat: false, reaction: 'unimpressed' }
      ]
    })
    useGameStore.getState().recordGifts()
    expect(useGameStore.getState().charInfo.a.giftMemories).toEqual([
      { date: 12, type: 'loved', desc: giftMemoryDesc(itemDefOf(ROSE)!) }
    ])
    // Nobody resents a present that missed — he still went and chose something.
    expect(useGameStore.getState().charInfo.b.giftMemories).toBeUndefined()
    expect(useGameStore.getState().charInfo.b.gifts).toEqual([COIN])
  })

  // The gifts have to survive a failed turn's rewind and a mid-scene reload, or
  // the note each one injects stops reaching the lorebook mid-scene.
  it('round-trips the scene gifts through capture and restore', () => {
    useGameStore.setState({
      cast: ['a'],
      sceneGifts: [{ charId: 'a', itemId: ROSE, repeat: true, reaction: 'loved' }]
    })
    const captured = useGameStore.getState().captureScene()
    expect(captured?.gifts).toEqual([
      { charId: 'a', itemId: ROSE, repeat: true, reaction: 'loved' }
    ])
    useGameStore.getState().clearSceneGifts()
    useGameStore.getState().restoreScene(captured)
    expect(useGameStore.getState().sceneGifts).toEqual([
      { charId: 'a', itemId: ROSE, repeat: true, reaction: 'loved' }
    ])
  })
})

describe('markMet', () => {
  it('marks and dates the meeting exactly once', () => {
    useGameStore.setState({ date: 4 })
    const store = useGameStore.getState()
    store.markMet(['a'])
    const after = useGameStore.getState().charInfo.a
    expect(after.flags.hasMet).toBe(true)
    expect(after.memories).toHaveLength(1)
    expect(after.memories[0]).toMatchObject({ date: 4, type: 'liked' })

    store.markMet(['a'])
    expect(useGameStore.getState().charInfo.a.memories).toHaveLength(1)
  })

  it('mirrors the polarity of the scene’s first memory, at half weight', () => {
    useGameStore.setState({
      charInfo: { a: charInfo({ memories: [{ date: 0, type: 'hated', desc: 'yelled' }] }) }
    })
    useGameStore.getState().markMet(['a'])
    // `disliked`, never `hated` — it must not double the weight of what it echoes.
    expect(useGameStore.getState().charInfo.a.memories[0].type).toBe('disliked')
  })
})

/**
 * The slots of the week the reader has run into somebody on (the map, standing haunts).
 * Written at every scene boundary, which is replayed whenever the save before
 * it is loaded — so the second write of the same hour has to be a no-op.
 */
describe('markSeenAt', () => {
  it('records the slot once, however many times the boundary is replayed', () => {
    useGameStore.setState({ charInfo: { a: charInfo() } })
    useGameStore.getState().markSeenAt(['a'], 7)
    useGameStore.getState().markSeenAt(['a'], 7)
    expect(useGameStore.getState().charInfo.a.metSlots).toEqual([7])
  })
})

describe('refreshDerivedFlags', () => {
  it('persists a contact-profile reveal into the save', () => {
    // The reveal is only permanent because it lands in charInfo here.
    const memories: CharMemory[] = Array.from({ length: 4 }, (_, i) => ({
      date: 0,
      type: 'loved',
      desc: `m${i}`
    }))
    useGameStore.setState({ date: 0, charInfo: { a: charInfo({ memories }) } })
    useGameStore.getState().refreshDerivedFlags(['a'])
    expect(useGameStore.getState().charInfo.a.flags.knowsTraits).toBe(true)
    expect(useGameStore.getState().charInfo.a.flags.knowsBackstory).toBe(true)
  })
})

describe('the job actions', () => {
  beforeEach(() => {
    useGameStore.getState().takeJob('fast_eats', [0], 0)
  })

  it('buys a raise every third clean shift and never past the ceiling', () => {
    const worked: boolean[] = []
    for (let i = 1; i <= RAISE_EVERY * MAX_RAISES + RAISE_EVERY; i++) {
      worked.push(useGameStore.getState().recordShiftWorked(i, 80))
    }
    // One raise per completed run of three, then nothing: the ceiling holds even
    // though the streak keeps climbing.
    expect(worked.filter(Boolean)).toHaveLength(MAX_RAISES)
    expect(useGameStore.getState().job!.raises).toBe(MAX_RAISES)
    expect(useGameStore.getState().job!.shiftsWorked).toBe(RAISE_EVERY * MAX_RAISES + RAISE_EVERY)
  })

  it('banks the wage and the slot on every worked shift', () => {
    useGameStore.getState().recordShiftWorked(4, 80)
    useGameStore.getState().recordShiftWorked(6, 96)
    const job = useGameStore.getState().job!
    expect(job.earned).toBe(176)
    // The credited slots are what stop the next sweep striking for these.
    expect(job.workedSlots).toEqual([4, 6])
  })

  it('credits a slot once however often the boundary replays it', () => {
    // The record the boundary reads is rebuilt from the save on every load, so
    // this is reachable: a slot credited twice is a wage and a raise-streak the
    // reader never earned, in a save that loads perfectly.
    expect(useGameStore.getState().recordShiftWorked(4, 80)).toBe(false)
    expect(useGameStore.getState().recordShiftWorked(4, 80)).toBe(false)
    const job = useGameStore.getState().job!
    expect(job.workedSlots).toEqual([4])
    expect(job.earned).toBe(80)
    expect(job.shiftsWorked).toBe(1)
    expect(job.streak).toBe(1)
  })

  it('resets the raise streak on a strike without taking a raise back', () => {
    for (let i = 1; i <= RAISE_EVERY; i++) useGameStore.getState().recordShiftWorked(i, 80)
    expect(useGameStore.getState().job!.raises).toBe(1)

    useGameStore.getState().recordStrike(10)
    const struck = useGameStore.getState().job!
    expect(struck.strikes).toBe(1)
    expect(struck.streak).toBe(0)
    // Pay already earned is his; only the run to the *next* raise is lost.
    expect(struck.raises).toBe(1)
    expect(struck.settledThrough).toBe(10)
  })

  it('closes an employer permanently, whichever way the job ended', () => {
    useGameStore.getState().endJob()
    expect(useGameStore.getState().job).toBeNull()
    expect(useGameStore.getState().jobsClosed).toEqual(['fast_eats'])

    // Taking and losing a second job does not disturb the first entry.
    useGameStore.getState().takeJob('cutetea', [2], 8)
    useGameStore.getState().endJob()
    expect(useGameStore.getState().jobsClosed).toEqual(['fast_eats', 'cutetea'])
  })
})

/**
 * What the reader's own page is written from. The tallies are counted by boundary
 * passes that replay, so a double count is a figure nothing ever puts right; and a save
 * written before either field existed has to keep loading.
 */
describe('the bio and the lifetime tallies', () => {
  it('loads a save written before either field with a blank bio and nothing counted', () => {
    const save = useGameStore.getState().toGameSave() as GameSave
    delete save.bio
    delete save.tallies
    useGameStore.setState({
      bio: 'Written by a later playthrough.',
      tallies: { moneyEarned: 240, kisses: 3, sex: 1, shiftsWorked: 2 }
    })

    useGameStore.getState().loadSave(save, playthroughRecord(), {})
    expect(useGameStore.getState().bio).toBe('')
    expect(useGameStore.getState().tallies).toEqual({
      moneyEarned: 0,
      kisses: 0,
      sex: 0,
      shiftsWorked: 0
    })
  })

  it('credits a worked shift once however often the boundary replays it', () => {
    useGameStore.getState().takeJob('fast_eats', [0], 0)
    useGameStore.getState().recordShiftWorked(4, 80)
    useGameStore.getState().recordShiftWorked(4, 80)
    useGameStore.getState().recordShiftWorked(6, 96)

    const tallies = useGameStore.getState().tallies
    expect(tallies.moneyEarned).toBe(176)
    expect(tallies.shiftsWorked).toBe(2)
  })

  it('counts one kiss or one night per act, whoever was in it', () => {
    useGameStore.getState().recordActs([
      { kind: 'kiss', inPublic: false, charIds: ['a'] },
      { kind: 'kiss', inPublic: true, charIds: ['a', 'b'] },
      { kind: 'sex', inPublic: false, charIds: ['b'] }
    ])
    const tallies = useGameStore.getState().tallies
    expect(tallies.kisses).toBe(2)
    expect(tallies.sex).toBe(1)
  })
})

/**
 * The feed actions. What earns tests is what a save is written from: a
 * like that landed on the wrong post, or an append that dropped the posts
 * before it, is a corrupted feed nothing ever repairs.
 */
describe('the feed actions', () => {
  const post = (id: string): SocialPost => ({ id, text: 'hi', date: 3, time: 0, likes: 2 })

  beforeEach(() => {
    useGameStore.getState().reset()
    useGameStore.setState({ chars: ['a'], charInfo: { a: charInfo() } })
  })

  it('appends posts oldest-last and keeps what was there', () => {
    useGameStore.getState().appendFeedPost('a', post('p1'))
    useGameStore.getState().appendFeedPost('a', post('p2'))
    expect(useGameStore.getState().charInfo.a.feed?.map((p) => p.id)).toEqual(['p1', 'p2'])
  })

  it('toggles a like on the named post alone, and back off', () => {
    useGameStore.getState().appendFeedPost('a', post('p1'))
    useGameStore.getState().appendFeedPost('a', post('p2'))
    useGameStore.setState({ date: 4 })
    useGameStore.getState().toggleFeedLike('a', 'p2')

    const feed = useGameStore.getState().charInfo.a.feed
    expect(feed?.find((p) => p.id === 'p1')?.liked).toBeUndefined()
    // Stamped with the day it was made, which is what the freshness rule reads.
    expect(feed?.find((p) => p.id === 'p2')?.liked).toBe(true)
    expect(feed?.find((p) => p.id === 'p2')?.likedOn).toBe(4)

    // Off means absent for both fields — the state a post starts in.
    useGameStore.getState().toggleFeedLike('a', 'p2')
    expect(useGameStore.getState().charInfo.a.feed?.find((p) => p.id === 'p2')?.liked).toBeUndefined()
    expect(
      useGameStore.getState().charInfo.a.feed?.find((p) => p.id === 'p2')?.likedOn
    ).toBeUndefined()
  })
})

describe('toGameSave', () => {
  it('projects exactly the SaveDraft fields — no more, no fewer', () => {
    // saveService owns playthroughId/saveId/saveDate; anything extra here would
    // be written into every save file and read back as part of the schema.
    expect(Object.keys(useGameStore.getState().toGameSave()).sort()).toEqual([
      'addedClasses',
      'bio',
      'bunnyboard',
      'bunnybotContactIntroSent',
      'bunnybotDeferred',
      'bunnybotFirstPostNudgeSent',
      'bunnybotSeenTipSent',
      'bunnybotThrough',
      'bunnybotTwoTimingTipSent',
      'bunnymapUnlocked',
      'bunnyshopUnlocked',
      'charInfo',
      'classRecords',
      'date',
      'droppedClasses',
      'endingArtWanted',
      'events',
      'expelled',
      'farewellsDone',
      'feedExtras',
      'finalsScoresShown',
      'gradesStanding',
      'graduationSeen',
      'history',
      'inventory',
      'job',
      'jobsClosed',
      'lastSlotCast',
      'midtermStandingDone',
      'money',
      'npcFriendships',
      'npcOverlay',
      'npcRelationships',
      'occasionsDeclined',
      'outingSlots',
      'playerSchedule',
      'scene',
      'schemaVersion',
      'slotRumor',
      'springBreakAway',
      'stats',
      'tallies',
      'time',
      'venusJobIntroSent',
      'venusThrough',
      'weekendOutings'
    ])
  })

  it('writes no settled field into a save, and puts the record’s half back on load', () => {
    // The save-schema split: a profile key written into every save is the duplication the
    // record exists to end, and one dropped on load is a character the prompts
    // no longer know the year, dorm or timetable of.
    const profile = {
      year: 3,
      dorm: 'lowrise_2' as const,
      major: 'Botany',
      schedule: { 2: 'BIO 210' },
      hiddenSchedule: { 3: { location: 'kendall_library', kind: 'study' as const } },
      moodCycleOffset: 4,
      handle: 'sarah',
      springBreakPlans: 'Going home.'
    }
    useGameStore.setState({
      charInfo: { a: charInfo({ ...profile, job: charJob(), gifts: ['x'] }) }
    })

    const save = useGameStore.getState().toGameSave()
    for (const key of Object.keys(profile)) expect(save.charInfo.a).not.toHaveProperty(key)
    expect(save.charInfo.a).toMatchObject({ job: charJob(), gifts: ['x'] })

    useGameStore.setState({ charInfo: {}, jobClosures: {} })
    useGameStore.getState().loadSave(
      save as GameSave,
      playthroughRecord({
        profiles: { a: profile },
        // Rolled once at New Game and never again: dropped, it would
        // silently reopen hours the player planned a roster around.
        jobClosures: { fast_eats: [3, 7], cutetea: [0, 11] }
      }),
      {}
    )
    expect(useGameStore.getState().charInfo.a).toMatchObject({ ...profile, gifts: ['x'] })
    expect(useGameStore.getState().jobClosures).toEqual({ fast_eats: [3, 7], cutetea: [0, 11] })

    // The sky is the record's half too: a save with no table of its own reads whatever
    // the record it is loaded against says the slot was.
    useGameStore.getState().loadSave(
      save as GameSave,
      playthroughRecord({ weather: ['clear', 'storm'] }),
      {}
    )
    expect(weatherAt(useGameStore.getState().weather, 0, 1)).toBe('storm')
  })
})

/**
 * The timetable's class record. Every write happens at a slot boundary that replays on load, so
 * a write that is not idempotent silently inflates a recap, a project tally or an exam score —
 * and freezes a wrong grade onto the save forever.
 */
describe('class records', () => {
  it('files a meeting once per date, however often the boundary replays', () => {
    const store = useGameStore.getState()
    store.recordClassMeeting('BIO 210', { date: 7, attended: true, summary: 'Osmosis.' })
    store.recordClassMeeting('BIO 210', { date: 7, attended: true, summary: 'Something else.' })
    const meetings = useGameStore.getState().classRecords['BIO 210'].meetings
    expect(meetings).toHaveLength(1)
    expect(meetings[0].summary).toBe('Osmosis.')
  })

  it('credits one project session per slot and never twice for the same one', () => {
    const store = useGameStore.getState()
    store.recordProjectWork('ART 101', 'midterm', 9, 0, 'He sketched.')
    store.recordProjectWork('ART 101', 'midterm', 9, 0, 'A replayed boundary.')
    store.recordProjectWork('ART 101', 'midterm', 8, 1)
    expect(useGameStore.getState().classRecords['ART 101'].midtermProject).toEqual({
      sessions: [
        { date: 8, time: 1 },
        { date: 9, time: 0, summary: 'He sketched.' }
      ]
    })
  })

  // Both halves of one day are two hours of work, and the record has to hold
  // what each of them produced.
  it('counts the two halves of one day as two sessions', () => {
    const store = useGameStore.getState()
    store.recordProjectWork('ART 101', 'midterm', 9, 1, 'The evening.')
    store.recordProjectWork('ART 101', 'midterm', 9, 0, 'The morning.')
    expect(useGameStore.getState().classRecords['ART 101'].midtermProject).toEqual({
      sessions: [
        { date: 9, time: 0, summary: 'The morning.' },
        { date: 9, time: 1, summary: 'The evening.' }
      ]
    })
  })

  it('writes an exam tally once — a replayed exam must not be re-marked', () => {
    const store = useGameStore.getState()
    store.recordExam('BIO 210', 'midterm', { asked: 3, correct: 3 })
    store.recordExam('BIO 210', 'midterm', { asked: 3, correct: 0 })
    expect(useGameStore.getState().classRecords['BIO 210'].midterm).toEqual({
      asked: 3,
      correct: 3
    })
  })

  it('freezes a score once, so studying afterwards cannot rewrite a grade', () => {
    const store = useGameStore.getState()
    store.setClassScore('BIO 210', 'midterm', 72)
    store.setClassScore('BIO 210', 'midterm', 100)
    expect(useGameStore.getState().classRecords['BIO 210'].midtermScore).toBe(72)
  })

  // The Heart tier rides the same freeze as the score it bought; a score
  // charm did nothing for must not carry one.
  it('leaves the heart tier off a score charm did nothing for', () => {
    useGameStore.getState().setClassScore('BIO 210', 'midterm', 88)
    expect(useGameStore.getState().classRecords['BIO 210'].midtermHeartTier).toBeUndefined()
  })

  it('freezes a zero as firmly as any other score', () => {
    const store = useGameStore.getState()
    store.setClassScore('BIO 210', 'final', 0)
    store.setClassScore('BIO 210', 'final', 90)
    expect(useGameStore.getState().classRecords['BIO 210'].finalScore).toBe(0)
  })
})

/** The exam in progress rides `SceneState`, so a reload resumes the same paper. */
describe('the quiz on the scene capture', () => {
  const quiz = {
    code: 'BIO 210',
    exam: 'midterm' as const,
    questions: [
      { question: 'Q1?', a: '1', b: '2', c: '3', d: '4', correct: 'B' as const },
      { question: 'Q2?', a: '1', b: '2', c: '3', d: '4', correct: 'D' as const }
    ],
    index: 1,
    correct: 1
  }

  it('round-trips through capture and restore', () => {
    useGameStore.getState().setSceneQuiz(quiz)
    const captured = useGameStore.getState().captureScene()
    expect(captured?.quiz).toEqual(quiz)
    useGameStore.getState().restoreScene(captured)
    expect(useGameStore.getState().sceneQuiz).toEqual(quiz)
  })

  it('banks each answer, counting only the right ones', () => {
    useGameStore.getState().setSceneQuiz({ ...quiz, index: 0, correct: 0 })
    useGameStore.getState().answerQuiz(true)
    useGameStore.getState().answerQuiz(false)
    expect(useGameStore.getState().sceneQuiz).toMatchObject({ index: 2, correct: 1 })
  })
})
