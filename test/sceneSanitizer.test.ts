import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PLAYER_STATS, statsForTiers } from '@shared/playerStats'
import { emptyFlags, MEMORY_CAP } from '@shared/relationship'
import { giftStatusMarkedLine } from '@shared/shop'
import type { LedgerResponse, SceneGift, SceneLine, SceneResponse } from '@shared/types'
import { useAssetStore } from '../src/renderer/stores/assetStore'
import { useSettingsStore } from '../src/renderer/stores/settingsStore'
import { buildCharKeyToId, useGameStore } from '../src/renderer/stores/gameStore'
import {
  applyLedger,
  bondedCharIds,
  createSceneSanitizer,
  ledgerActs,
  likedCharIds,
  memoryStatusLines,
  projectLedger,
  sanitizeScene,
  splitOverflow,
  stageAsWritten
} from '../src/renderer/stores/sceneSanitizer'
import { character, charactersById, charInfo } from './fixtures'

/**
 * The sanitizer's parser hardening. Everything the LLM returns passes through here before it
 * reaches the store, so a hole in it puts an unrenderable stage or a memory
 * attached to nobody into the save.
 */

const sarah = character({ charId: 'a', firstName: 'Sarah', lastName: 'Rose' })
const mina = character({ charId: 'b', firstName: 'Mina', lastName: 'Kwon', pose: 'sitting' })
const eve = character({ charId: 'c', firstName: 'Eve', lastName: 'Lang', pose: 'leaning' })
const roster = charactersById(sarah, mina, eve)

/**
 * A reader every girl here is already within reach of, so the standards line
 * stays out of the cases that are about something else. The fixture
 * roster all prefer `heart`, whose floor is `Good`.
 */
const CLEARS = statsForTiers({ brain: 3, body: 3, heart: 3 })

beforeEach(() => {
  // The sanitizer warns loudly on every rejection; the suite exercises the
  // rejections deliberately, so the noise is muted rather than read.
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})

  useGameStore.getState().reset()
  useGameStore.setState({
    date: 7,
    characters: roster,
    charKeyToId: buildCharKeyToId(roster),
    cgReady: { a: true },
    outfitReady: { a: ['pe'] }
  })
  useAssetStore.setState({ backgrounds: { interior: ['dorm'], exterior: ['quad'] } })
  // The one setting the sanitizer's walk reads.
  useSettingsStore.setState({ settings: null })
})

describe('sanitizeLine — speakers and backgrounds', () => {
  it('demotes an unknown speaker to narration rather than persisting a bad key', () => {
    const line = createSceneSanitizer().sanitizeLine({ speaker: 'nobody_atall', text: 'Hi.' })
    expect(line.speaker).toBe('')
  })

  it('drops an unknown background so the stage keeps the one it has', () => {
    const line = createSceneSanitizer().sanitizeLine({ speaker: '', bg: 'atlantis', text: 'x' })
    expect(line.bg).toBeUndefined()
  })

  it('drops a room bg for a cast member whose room is not rendered', () => {
    useGameStore.setState({ cast: ['a'], roomReady: {} })
    const line = createSceneSanitizer().sanitizeLine({ speaker: '', bg: 'sarah_rose_room', text: 'x' })
    expect(line.bg).toBeUndefined()
  })

  it('drops a room bg for a character who is not in the cast', () => {
    useGameStore.setState({ cast: ['a'], roomReady: { a: true, b: true } })
    const line = createSceneSanitizer().sanitizeLine({ speaker: '', bg: 'mina_kwon_room', text: 'x' })
    expect(line.bg).toBeUndefined()
  })
})

describe('sanitizeLine — quotation marks', () => {
  /** The text a line comes back with, spoken or narrated. */
  const said = (text: string, speaker = 'sarah_rose'): string =>
    createSceneSanitizer().sanitizeLine({ speaker, text }).text

  it('unwraps a spoken line the reply quoted whole', () => {
    expect(said('"Hi there."')).toBe('Hi there.')
  })

  it('leaves a line that only opens on a quote alone', () => {
    // Its own dialogue, reported — the closing mark is not the line's end.
    expect(said('"Are you coming?" she asked.')).toBe('"Are you coming?" she asked.')
  })

  it('leaves a line quoting somebody inside itself alone', () => {
    // Both ends are quotes and neither pair is the whole line; taking the ends
    // off would leave the halves mismatched.
    const both = '"Hi," she said, "how are you?"'
    expect(said(both)).toBe(both)
  })

  it('does not mistake an elided apostrophe for a quotation', () => {
    expect(said("'Course not, don't be daft.")).toBe("'Course not, don't be daft.")
  })
})

/** One line carrying `actions`, spelled once so the cases stay readable. */
function acting(actions: string[], speaker = ''): { speaker: string; actions: string[]; text: string } {
  return { speaker, actions, text: '' }
}

describe('sanitizeLine — show and hide', () => {
  it('drops an action naming a character who is not in the roster', () => {
    expect(
      createSceneSanitizer().sanitizeLine(acting(['show:nobody_atall'])).actions
    ).toBeUndefined()
  })

  it('drops an action that is not in the grammar at all', () => {
    expect(createSceneSanitizer().sanitizeLine(acting(['dance:sarah_rose'])).actions).toBeUndefined()
    expect(createSceneSanitizer().sanitizeLine(acting(['show:'])).actions).toBeUndefined()
  })

  it('drops a fourth character instead of overflowing the three portrait slots', () => {
    const sanitizer = createSceneSanitizer()
    expect(sanitizer.sanitizeLine(acting(['show:sarah_rose'])).actions).toEqual(['show:sarah_rose'])
    expect(sanitizer.sanitizeLine(acting(['show:mina_kwon'])).actions).toEqual(['show:mina_kwon'])
    expect(sanitizer.sanitizeLine(acting(['show:eve_lang'])).actions).toEqual(['show:eve_lang'])
    // A fourth would be applied by advanceLine to a full slots array, silently
    // losing her — the sanitizer is what keeps that from being written down.
    const fourth = character({ charId: 'd', firstName: 'Nia', lastName: 'Ito' })
    const wider = { ...roster, d: fourth }
    useGameStore.setState({ characters: wider, charKeyToId: buildCharKeyToId(wider) })
    expect(sanitizer.sanitizeLine(acting(['show:nia_ito'])).actions).toBeUndefined()
  })

  it('drops a redundant show for someone already on screen', () => {
    const sanitizer = createSceneSanitizer()
    sanitizer.sanitizeLine(acting(['show:sarah_rose']))
    expect(sanitizer.sanitizeLine(acting(['show:sarah_rose'])).actions).toBeUndefined()
  })

  it('drops a hide for someone who is not on screen', () => {
    expect(createSceneSanitizer().sanitizeLine(acting(['hide:mina_kwon'])).actions).toBeUndefined()
  })

  it('accepts a hide for someone shown earlier in the same batch, and frees her slot', () => {
    const sanitizer = createSceneSanitizer()
    sanitizer.sanitizeLine(acting(['show:sarah_rose']))
    expect(sanitizer.sanitizeLine(acting(['hide:sarah_rose'])).actions).toEqual(['hide:sarah_rose'])
    expect(sanitizer.sanitizeLine(acting(['show:sarah_rose'])).actions).toEqual(['show:sarah_rose'])
  })

  it('seeds who is on screen from the stage it was created on', () => {
    useGameStore.setState({ slots: ['a', null, null] })
    const sanitizer = createSceneSanitizer()
    expect(sanitizer.sanitizeLine(acting(['hide:sarah_rose'])).actions).toEqual(['hide:sarah_rose'])
  })

  it('seeds from the stage the options carry, not the slots playback has moved', () => {
    // The first-autosave regression: the player read past her entrance while
    // the reply streamed, so the slots hold her — but the authoritative pass
    // re-sanitizes the reply from its first line, and dropping her show as
    // redundant there writes an autosave whose replay never stages her.
    useGameStore.setState({ slots: ['a', null, null] })
    const line = createSceneSanitizer({ stage: [] }).sanitizeLine(acting(['show:sarah_rose']))
    expect(line.actions).toEqual(['show:sarah_rose'])
  })
})

describe('splitOverflow', () => {
  /**
   * The box, standing in for the real one: `views/boxRows.ts` measures a rendered paragraph and
   * there is no DOM here, so the cases below say "a line of more than 40 characters overflows"
   * and read exactly as they would against three rows of it.
   */
  const fits = (text: string): boolean => text.length <= 40

  it('cuts a line that would overflow into one line per sentence', () => {
    expect(
      splitOverflow({ speaker: 'a_rose', text: 'She looks up from the book. Nothing is said.' }, fits)
    ).toEqual([
      { speaker: 'a_rose', text: 'She looks up from the book.' },
      { speaker: 'a_rose', text: 'Nothing is said.' }
    ])
  })

  it('leaves the stage on the first piece, and the rest is the same speaker talking', () => {
    // `actions` and `bg` are applied as their line is reached, so a copy on the
    // second piece would play the entrance twice and the camera would move mid-speech.
    const [first, second] = splitOverflow(
      {
        speaker: 'a_rose',
        text: 'She looks up from the book. Nothing is said.',
        bg: 'dorm',
        actions: ['show:a_rose']
      },
      fits
    )
    expect(first).toEqual({
      speaker: 'a_rose',
      text: 'She looks up from the book.',
      bg: 'dorm',
      actions: ['show:a_rose']
    })
    expect(second).toEqual({ speaker: 'a_rose', text: 'Nothing is said.' })
  })

  it('packs greedily, so sentences that fit together stay together', () => {
    expect(
      splitOverflow({ speaker: '', text: 'He nods. She waits. The room is very quiet now.' }, fits)
    ).toEqual([
      { speaker: '', text: 'He nods. She waits.' },
      { speaker: '', text: 'The room is very quiet now.' }
    ])
  })

  it('leaves a line that fits, and one long sentence there is nothing to cut', () => {
    const short = { speaker: '', text: 'She waits.' }
    expect(splitOverflow(short, fits)).toEqual([short])

    const oneSentence = { speaker: '', text: 'She waits by the door for a very long time indeed.' }
    expect(splitOverflow(oneSentence, fits)).toEqual([oneSentence])
  })

  it('leaves a status line whole, whatever its length', () => {
    // Its marks are offsets into this text, and half a line would strand them.
    const line: SceneLine = {
      speaker: '',
      text: 'You are getting smarter. Your balance is now $40.',
      status: { marks: [] }
    }
    expect(splitOverflow(line, fits)).toEqual([line])
  })

  it('changes nothing where the caller has no box to measure against', () => {
    const line = { speaker: '', text: 'She looks up from the book. Nothing is said.' }
    expect(splitOverflow(line)).toEqual([line])
  })
})

describe('stageAsWritten', () => {
  /** One queued line carrying stage directions and nothing else. */
  const queued = (actions: string[], bg?: string): SceneLine => ({
    speaker: '',
    text: 'x',
    actions,
    ...(bg ? { bg } : {})
  })

  it('plays the queued show and hide actions forward over the slots', () => {
    // The stage as the player sees it trails the queue; the stage a new call's
    // lines land on is where the queue ends.
    useGameStore.setState({
      slots: ['a', null, null],
      pendingLines: [queued(['hide:sarah_rose']), queued(['show:mina_kwon'])]
    })
    expect(stageAsWritten().onStage).toEqual(['mina_kwon'])
  })

  // The walk is what the prompt's NOW block and the sanitizer's seed both read, so a CG it
  // left standing would be described to the model after the store had already ended it.
  it('ends a queued CG when a queued show puts somebody beside her', () => {
    useGameStore.setState({
      slots: ['a', null, null],
      emotions: { a: 'sex' },
      outfitReady: { a: ['pe', 'nude'] },
      pendingLines: [queued(['cg:sex']), queued(['show:mina_kwon'])]
    })
    const stage = stageAsWritten()
    expect(stage.onStage).toEqual(['sarah_rose', 'mina_kwon'])
    expect(stage.emotions.a).toBe('aroused_nude')
  })

  it('runs the absences forward too, so a queued hide is already one', () => {
    // The ending's calls are built while the scene's last lines are still queued: the hide
    // the player has not reached yet has to count, or the prompt puts her back on screen.
    useGameStore.setState({
      slots: ['a', 'b', null],
      offStage: { c: 0 },
      pendingLines: [queued(['hide:mina_kwon']), queued(['show:eve_lang'])]
    })
    const stage = stageAsWritten()
    expect(stage.hidden).toEqual(new Set(['b']))
    expect(stage.onStage).toEqual(['sarah_rose', 'eve_lang'])
  })
})

describe('sanitizeLine — the forgotten entrance', () => {
  // `forceShowSpeakers` repairs an opening reply that gives a cast member lines
  // without ever staging her. Off by default, because a continuation's
  // silent characters are off stage on purpose.
  const speaking = (speaker: string, actions?: string[]): Parameters<
    ReturnType<typeof createSceneSanitizer>['sanitizeLine']
  >[0] => ({ speaker, text: 'Hi.', ...(actions ? { actions } : {}) })

  it('shows a cast member the first time she speaks without having been shown', () => {
    useGameStore.setState({ cast: ['a'] })
    const line = createSceneSanitizer({ forceShowSpeakers: true }).sanitizeLine(
      speaking('sarah_rose')
    )
    expect(line.actions).toEqual(['show:sarah_rose'])
    expect(line.speaker).toBe('sarah_rose')
  })

  it('shows her once, not on every line she speaks', () => {
    useGameStore.setState({ cast: ['a'] })
    const sanitizer = createSceneSanitizer({ forceShowSpeakers: true })
    expect(sanitizer.sanitizeLine(speaking('sarah_rose')).actions).toEqual(['show:sarah_rose'])
    expect(sanitizer.sanitizeLine(speaking('sarah_rose')).actions).toBeUndefined()
  })

  it('leaves the reply\'s own show alone and does not double it', () => {
    useGameStore.setState({ cast: ['a'] })
    const line = createSceneSanitizer({ forceShowSpeakers: true }).sanitizeLine(
      speaking('sarah_rose', ['show:sarah_rose', 'sprite:sarah_rose,happy'])
    )
    expect(line.actions).toEqual(['show:sarah_rose', 'sprite:sarah_rose,happy'])
  })

  it('puts the forced show ahead of the line\'s own actions, so a sprite behind it is legal', () => {
    useGameStore.setState({ cast: ['a'] })
    const line = createSceneSanitizer({ forceShowSpeakers: true }).sanitizeLine(
      speaking('sarah_rose', ['sprite:sarah_rose,happy'])
    )
    expect(line.actions).toEqual(['show:sarah_rose', 'sprite:sarah_rose,happy'])
  })

  it('never stages somebody who is not in the cast', () => {
    // `knownKeys` is the whole roster; only the cast is in this scene.
    useGameStore.setState({ cast: ['a'] })
    expect(
      createSceneSanitizer({ forceShowSpeakers: true }).sanitizeLine(speaking('mina_kwon')).actions
    ).toBeUndefined()
  })

  it('leaves her off rather than overflowing the portrait slots', () => {
    useGameStore.setState({ cast: ['a', 'b', 'c', 'd'], slots: ['a', 'b', 'c'] })
    const fourth = character({ charId: 'd', firstName: 'Nia', lastName: 'Ito' })
    const wider = { ...roster, d: fourth }
    useGameStore.setState({ characters: wider, charKeyToId: buildCharKeyToId(wider) })
    expect(
      createSceneSanitizer({ forceShowSpeakers: true }).sanitizeLine(speaking('nia_ito')).actions
    ).toBeUndefined()
  })

  it('does not drag back somebody the reply deliberately walked off', () => {
    useGameStore.setState({ cast: ['a'] })
    const sanitizer = createSceneSanitizer({ forceShowSpeakers: true })
    sanitizer.sanitizeLine(acting(['show:sarah_rose']))
    expect(sanitizer.sanitizeLine(acting(['hide:sarah_rose'])).actions).toEqual(['hide:sarah_rose'])
    // Her parting line is hers to speak from off stage; re-showing her would
    // contradict the exit the reply just wrote.
    expect(sanitizer.sanitizeLine(speaking('sarah_rose')).actions).toBeUndefined()
  })

  it('sanitizeScene carries the flag, so preview and authoritative agree', () => {
    useGameStore.setState({ cast: ['a'] })
    const response: SceneResponse = { lines: [{ speaker: 'sarah_rose', text: 'Hi.' }] }
    expect(sanitizeScene(response, { forceShowSpeakers: true }).lines[0].actions).toEqual([
      'show:sarah_rose'
    ])
    expect(sanitizeScene(response).lines[0].actions).toBeUndefined()
  })

  it('repairs off the carried stage, so the pass that runs mid-playback still shows her', () => {
    // Same regression as the show/hide seed test, through the repair: the
    // player has watched her forced entrance play, and the authoritative pass
    // must write it down again anyway.
    useGameStore.setState({ cast: ['a'], slots: ['a', null, null] })
    const line = createSceneSanitizer({ forceShowSpeakers: true, stage: [] }).sanitizeLine(
      speaking('sarah_rose')
    )
    expect(line.actions).toEqual(['show:sarah_rose'])
  })
})

describe('sanitizeLine — sprites', () => {
  it('drops a sprite for someone who is not on screen', () => {
    expect(
      createSceneSanitizer().sanitizeLine(acting(['sprite:sarah_rose,happy'])).actions
    ).toBeUndefined()
  })

  it('drops an unparseable sprite reference rather than storing the junk', () => {
    // The value is sticky and persisted in `SceneState.emotions`, so an unknown
    // one would keep resolving to a sprite that does not exist.
    const sanitizer = createSceneSanitizer()
    sanitizer.sanitizeLine(acting(['show:sarah_rose']))
    expect(sanitizer.sanitizeLine(acting(['sprite:sarah_rose,smug'])).actions).toBeUndefined()
    expect(sanitizer.sanitizeLine(acting(['sprite:sarah_rose,happy_gym'])).actions).toBeUndefined()
  })
})

describe('sanitizeLine — outfit sets', () => {
  // The value is sticky and persisted in `SceneState.emotions`, so anything
  // stored here must resolve to a file: an outfit set that is not fully
  // rendered has to come out as the bare emotion, never as the suffixed form.
  it('degrades to the bare emotion when that set is not rendered', () => {
    // Sarah has `pe` but not `swim`.
    expect(
      createSceneSanitizer().sanitizeLine(acting(['show:sarah_rose', 'sprite:sarah_rose,happy_swim']))
        .actions
    ).toEqual(['show:sarah_rose', 'sprite:sarah_rose,happy'])
  })

  it('checks the set against the action\'s own character, not the speaker', () => {
    // Sarah speaks, but the wardrobe belongs to Mina, who has no sets.
    const line = createSceneSanitizer().sanitizeLine(
      acting(['show:mina_kwon', 'sprite:mina_kwon,angry_pe'], 'sarah_rose')
    )
    expect(line.actions).toEqual(['show:mina_kwon', 'sprite:mina_kwon,angry'])
  })
})

describe('sanitizeLine — CGs', () => {
  it('drops a cg when a second character is on screen', () => {
    const sanitizer = createSceneSanitizer()
    sanitizer.sanitizeLine(acting(['show:sarah_rose', 'show:mina_kwon']))
    expect(sanitizer.sanitizeLine(acting(['cg:sex'])).actions).toBeUndefined()
  })

  it('drops a cg for a character with no CGs rendered', () => {
    const sanitizer = createSceneSanitizer()
    sanitizer.sanitizeLine(acting(['show:mina_kwon']))
    expect(sanitizer.sanitizeLine(acting(['cg:sex'])).actions).toBeUndefined()
  })

  it('drops a cg naming something that is not a position', () => {
    const sanitizer = createSceneSanitizer()
    sanitizer.sanitizeLine(acting(['show:sarah_rose']))
    expect(sanitizer.sanitizeLine(acting(['cg:cuddling'])).actions).toBeUndefined()
  })
})

describe('sanitizeScene', () => {
  it('nulls a blank summary so it cannot erase the running one', () => {
    // `summary` replaces everything older in the transcript. A blank
    // string read as a summary throws the whole scene's memory away.
    for (const summary of ['', '   ', undefined]) {
      expect(sanitizeScene({ lines: [], summary } as SceneResponse).summary).toBeNull()
    }
  })

  it('ends the scene only on a literal true', () => {
    expect(sanitizeScene({ lines: [], end_scene: true } as SceneResponse).end).toBe(true)
    for (const end_scene of [false, null, undefined]) {
      expect(sanitizeScene({ lines: [], end_scene } as SceneResponse).end).toBe(false)
    }
  })

  it('carries the show budget across the whole reply, not per line', () => {
    const nia = character({ charId: 'd', firstName: 'Nia', lastName: 'Ito' })
    const wider = { ...roster, d: nia }
    useGameStore.setState({
      characters: wider,
      charKeyToId: buildCharKeyToId(wider),
      // Sarah and Mina are already on stage when the reply arrives.
      slots: ['a', 'b', null]
    })
    const { lines } = sanitizeScene({
      lines: [
        { speaker: '', actions: ['show:sarah_rose'], text: '' },
        { speaker: '', actions: ['show:eve_lang'], text: '' },
        { speaker: '', actions: ['show:nia_ito'], text: '' }
      ]
    } as SceneResponse)
    // Sarah's show is redundant, Eve takes the last slot, and Nia would be a
    // fourth head — the budget is tracked across the batch, not per line.
    expect(lines.map((line) => line.actions)).toEqual([undefined, ['show:eve_lang'], undefined])
  })
})

describe('applyLedger', () => {
  it('records a valid memory against the right character, dated today', () => {
    applyLedger({
      memories: [{ charKey: 'sarah_rose', type: 'loved', desc: '  walked her home  ' }],
      events: []
    })
    expect(useGameStore.getState().charInfo.a.memories).toEqual([
      { date: 7, type: 'loved', desc: 'walked her home' }
    ])
  })

  it('latches the expulsion flag, and only on a literal true', () => {
    applyLedger({ memories: [], events: [] })
    expect(useGameStore.getState().expelled).toBe(false)

    applyLedger({ memories: [], events: [], expelled: false })
    expect(useGameStore.getState().expelled).toBe(false)

    // A model that answered with something truthy-but-wrong does not end a
    // playthrough; only the boolean does.
    applyLedger({ memories: [], events: [], expelled: 'yes' as never })
    expect(useGameStore.getState().expelled).toBe(false)

    applyLedger({ memories: [], events: [], expelled: true })
    expect(useGameStore.getState().expelled).toBe(true)
  })

  it('never takes the expulsion back on a later clean scene', () => {
    applyLedger({ memories: [], events: [], expelled: true })
    applyLedger({ memories: [], events: [], expelled: false })
    expect(useGameStore.getState().expelled).toBe(true)
  })

  it('drops a memory for an unknown character instead of creating one', () => {
    applyLedger({ memories: [{ charKey: 'nobody', type: 'liked', desc: 'x' }], events: [] })
    expect(useGameStore.getState().charInfo).toEqual({})
  })

  it('drops a memory with an invalid type or a blank description', () => {
    applyLedger({
      memories: [
        { charKey: 'sarah_rose', type: 'adored' as never, desc: 'x' },
        { charKey: 'sarah_rose', type: 'liked', desc: '   ' },
        { charKey: 'sarah_rose', type: 'liked', desc: undefined as never }
      ],
      events: []
    })
    expect(useGameStore.getState().charInfo).toEqual({})
  })

  it('keeps the good rows when one row is unusable', () => {
    applyLedger({
      memories: [
        { charKey: 'nobody', type: 'liked', desc: 'x' },
        { charKey: 'mina_kwon', type: 'hated', desc: 'ignored her' }
      ],
      events: []
    })
    expect(useGameStore.getState().charInfo.b.memories).toHaveLength(1)
  })

  it('applies a character’s events ahead of her acts, so a night with a lover is not benefits', () => {
    applyLedger({
      memories: [],
      events: [{ charKey: 'sarah_rose', event: 'became_lovers' }],
      acts: [{ kind: 'sex', inPublic: false, chars: ['sarah_rose'] }]
    })
    expect(useGameStore.getState().charInfo.a.flags).toMatchObject({
      hadSex: true,
      isLover: true,
      benefits: false
    })
  })

  it('drops an unknown event and an event for an unknown character', () => {
    applyLedger({
      memories: [],
      events: [
        { charKey: 'sarah_rose', event: 'eloped' as never },
        { charKey: 'nobody', event: 'kissed' }
      ]
    })
    expect(useGameStore.getState().charInfo.a?.flags ?? emptyFlags()).toEqual(emptyFlags())
  })

  it('files a texting memory apart from the scene memories, dated today', () => {
    applyLedger({
      memories: [{ charKey: 'sarah_rose', type: 'liked', desc: 'you walked her home' }],
      textMemories: [
        { charKey: 'sarah_rose', type: 'loved', desc: '  you asked about her recital  ' }
      ],
      events: []
    })
    const info = useGameStore.getState().charInfo.a
    expect(info.memories).toEqual([{ date: 7, type: 'liked', desc: 'the reader walked her home' }])
    expect(info.textMemory).toEqual({
      date: 7,
      type: 'loved',
      desc: 'the reader asked about her recital'
    })
  })

  // JSON Schema cannot say "at most one row per enum value", so the cap is the
  // sanitizer's. First row wins — a second is a mistake, not a correction.
  it('keeps only the first texting memory per character', () => {
    applyLedger({
      memories: [],
      textMemories: [
        { charKey: 'sarah_rose', type: 'liked', desc: 'first' },
        { charKey: 'sarah_rose', type: 'hated', desc: 'second' },
        { charKey: 'mina_kwon', type: 'liked', desc: 'hers' }
      ],
      events: []
    })
    expect(useGameStore.getState().charInfo.a.textMemory).toMatchObject({ desc: 'first' })
    expect(useGameStore.getState().charInfo.b.textMemory).toMatchObject({ desc: 'hers' })
  })

  it('drops an unusable texting memory row without costing the rest', () => {
    applyLedger({
      memories: [],
      textMemories: [
        { charKey: 'nobody', type: 'liked', desc: 'x' },
        { charKey: 'sarah_rose', type: 'adored' as never, desc: 'x' },
        { charKey: 'sarah_rose', type: 'liked', desc: '  ' },
        { charKey: 'mina_kwon', type: 'liked', desc: 'kept' }
      ],
      events: []
    })
    expect(useGameStore.getState().charInfo.a?.textMemory).toBeUndefined()
    expect(useGameStore.getState().charInfo.b.textMemory).toMatchObject({ desc: 'kept' })
  })

  it('announces an unblock in her thread and clears the flag', () => {
    useGameStore.setState({
      charInfo: { a: charInfo({ flags: { ...emptyFlags(), gaveContactInfo: true, blocked: true } }) }
    })
    applyLedger({ memories: [], events: [{ charKey: 'sarah_rose', event: 'unblocked' }] })

    expect(useGameStore.getState().charInfo.a.flags.blocked).toBe(false)
    const messages = useGameStore.getState().bunnyboard.conversations.a.messages
    expect(messages.at(-1)).toMatchObject({ sender: 'system' })
  })

  // The model can report the milestone for somebody who never blocked him; the
  // thread must not then be told about an unblock that never happened.
  it('says nothing when she did not have him blocked', () => {
    applyLedger({ memories: [], events: [{ charKey: 'sarah_rose', event: 'unblocked' }] })
    expect(useGameStore.getState().bunnyboard.conversations.a).toBeUndefined()
  })
})

/**
 * The pure reads of one validated ledger that the boundary rolls key off:
 * a row they place differently from the banking is a crush,
 * a bond or a rumor settled against a girl the save says nothing happened with.
 */
describe('the status lines and the banking', () => {
  it('names who came out of the scene liking the reader, and nobody else', () => {
    // The sum, not a bare "any liked one": an hour that left her a hated memory
    // as well is not an hour she enjoyed, and nobody bonds over one.
    expect(
      bondedCharIds({
        memories: [
          { charKey: 'sarah_rose', type: 'loved', desc: 'you walked her home' },
          { charKey: 'sarah_rose', type: 'disliked', desc: 'you were late' },
          { charKey: 'mina_kwon', type: 'liked', desc: 'you shared your notes' },
          { charKey: 'mina_kwon', type: 'hated', desc: 'you laughed at her' }
        ],
        events: []
      })
    ).toEqual(['a'])
    // A texting memory is not a shared hour and never bonds anybody.
    expect(
      bondedCharIds({
        memories: [],
        textMemories: [{ charKey: 'sarah_rose', type: 'loved', desc: 'you texted her first' }],
        events: []
      })
    ).toEqual([])
    expect(bondedCharIds(null)).toEqual([])
  })

  it('names who took something good out of the scene, on softer terms', () => {
    // Any positive entry, deliberately unlike `bondedCharIds` above: a crush
    // starts at one moment, and an evening that also went wrong is exactly how.
    expect(
      likedCharIds({
        memories: [
          { charKey: 'sarah_rose', type: 'liked', desc: 'you walked her home' },
          { charKey: 'sarah_rose', type: 'hated', desc: 'you laughed at her' },
          { charKey: 'mina_kwon', type: 'disliked', desc: 'you were late' },
          { charKey: 'eve_lang', type: 'loved', desc: 'you stayed up talking' }
        ],
        events: []
      })
    ).toEqual(['a', 'c'])
  })

  it('names her once however many good memories the hour left her', () => {
    expect(
      likedCharIds({
        memories: [
          { charKey: 'sarah_rose', type: 'liked', desc: 'you walked her home' },
          { charKey: 'sarah_rose', type: 'loved', desc: 'you stayed' }
        ],
        events: []
      })
    ).toEqual(['a'])
  })

  it('takes nothing from the phone, and nothing from a charKey it cannot place', () => {
    expect(
      likedCharIds({
        memories: [{ charKey: 'nobody_here', type: 'loved', desc: 'you texted her first' }],
        textMemories: [{ charKey: 'sarah_rose', type: 'loved', desc: 'you texted her first' }],
        events: []
      })
    ).toEqual([])
    expect(likedCharIds(null)).toEqual([])
  })

  // What the campus could have seen, off the same seam the flags are folded from:
  // a row nothing can identify starts no rumor, exactly as it moves no flag.
  it('resolves the acts it can and drops the rows it cannot', () => {
    expect(
      ledgerActs({
        acts: [
          { kind: 'kiss', inPublic: false, chars: ['sarah_rose', 'nobody_atall'] },
          { kind: 'sex', inPublic: true, chars: ['nobody_atall'] },
          { kind: 'snuggle' as never, inPublic: true, chars: ['mina_kwon'] },
          { kind: 'kiss', inPublic: false, chars: [] }
        ]
      })
    ).toEqual([{ kind: 'kiss', inPublic: false, charIds: ['a'] }])
  })

  it('folds one pairing reported twice into one act, public winning', () => {
    expect(
      ledgerActs({
        acts: [
          { kind: 'kiss', inPublic: false, chars: ['sarah_rose'] },
          { kind: 'kiss', inPublic: true, chars: ['sarah_rose'] },
          // The same pair the other way round is the same pairing.
          { kind: 'kiss', inPublic: false, chars: ['mina_kwon', 'sarah_rose'] },
          { kind: 'kiss', inPublic: false, chars: ['sarah_rose', 'mina_kwon'] },
          // A night is its own act beside the kiss.
          { kind: 'sex', inPublic: false, chars: ['sarah_rose'] }
        ]
      })
    ).toEqual([
      { kind: 'kiss', inPublic: true, charIds: ['a'] },
      { kind: 'kiss', inPublic: false, charIds: ['b', 'a'] },
      { kind: 'sex', inPublic: false, charIds: ['a'] }
    ])
  })

  it('names nobody for a scene that reached nothing, and nobody for no ledger', () => {
    expect(ledgerActs({ events: [{ charKey: 'sarah_rose', event: 'became_lovers' }] })).toEqual([])
    expect(ledgerActs(null)).toEqual([])
  })

  it('drops a kiss or a night reported as an event rather than as an act', () => {
    applyLedger({
      memories: [],
      events: [
        { charKey: 'sarah_rose', event: 'kissed' },
        { charKey: 'sarah_rose', event: 'sex' }
      ]
    })
    expect(useGameStore.getState().charInfo.a?.flags ?? emptyFlags()).toEqual(emptyFlags())
  })
})

/**
 * The `crushHint` a status pass writes once per tier. The
 * wording and the state machine are `relationship.test.ts`'; here it is the
 * record itself, and that a replayed pass does not write it again.
 */
describe('the crush standards line', () => {
  /** Nothing to offer anybody: `Unremarkable` across the board. */
  const NOBODY = DEFAULT_PLAYER_STATS

  const scene: LedgerResponse = {
    memories: [{ charKey: 'sarah_rose', type: 'loved', desc: 'you walked her home' }],
    textMemories: [{ charKey: 'sarah_rose', type: 'liked', desc: 'you asked about her recital' }],
    events: []
  }

  beforeEach(() => {
    useGameStore.setState({ charInfo: { a: charInfo({ nameKnown: true }) } })
  })

  it('closes her paragraph, under the phone as well as the scene', () => {
    const shown = memoryStatusLines(scene, NOBODY, [], [], [])
    // Her two memory lines, then the standards line closing them.
    expect(shown).toHaveLength(3)
    expect(shown.at(-1)?.text).toContain('Heart')
    // What it said, so it is not said again at the same tier.
    expect(useGameStore.getState().charInfo.a.crushHint).toEqual({ stat: 'heart', tier: 1 })
  })

  it('says nothing a second time while the stat has not moved', () => {
    memoryStatusLines(scene, NOBODY, [], [], [])
    const recorded = useGameStore.getState().charInfo.a.crushHint

    expect(memoryStatusLines(scene, NOBODY, [], [], [])).toHaveLength(2)
    // Untouched rather than rewritten to an equal value: the store write is what
    // a replayed status pass must not do.
    expect(useGameStore.getState().charInfo.a.crushHint).toBe(recorded)
  })

  it('tells her he made it, once, when the tier he bought clears her bar', () => {
    memoryStatusLines(scene, NOBODY, [], [], [])
    const cleared = { ...NOBODY, heart: statsForTiers({ brain: 1, body: 1, heart: 3 }).heart }

    expect(memoryStatusLines(scene, cleared, [], [], [])).toHaveLength(3)
    expect(useGameStore.getState().charInfo.a.crushHint).toEqual({ met: true })
    // And never again — the roll it was about is hers to make now.
    expect(memoryStatusLines(scene, cleared, [], [], [])).toHaveLength(2)
  })

  it('says nothing to a reader who was never short of her', () => {
    expect(memoryStatusLines(scene, CLEARS, [], [], [])).toHaveLength(2)
    expect(useGameStore.getState().charInfo.a.crushHint).toBeUndefined()
  })
})

/**
 * Where a present he handed over lands in the messages — with the rest of her
 * paragraph, not in a run of its own, and never lost because the ledger forgot her.
 */
describe("the gift's landing", () => {
  beforeEach(() => {
    useGameStore.setState({
      charInfo: {
        a: charInfo({ nameKnown: true }),
        b: charInfo({ nameKnown: true }),
        c: charInfo({ nameKnown: true })
      }
    })
  })

  it('closes her own lines, and still speaks for a girl the ledger left out', () => {
    const ledger: LedgerResponse = {
      memories: [
        { charKey: 'sarah_rose', type: 'loved', desc: 'you walked her home' },
        { charKey: 'mina_kwon', type: 'liked', desc: 'you shared her umbrella' }
      ],
      events: []
    }
    const gifts: SceneGift[] = [
      { charId: 'a', itemId: 'rose', repeat: false, reaction: 'loved' },
      { charId: 'c', itemId: 'mug', repeat: true, reaction: 'unimpressed' }
    ]

    const shown = memoryStatusLines(ledger, CLEARS, gifts, [], [])
    expect(shown).toHaveLength(4)
    expect(shown[1].text).toBe(giftStatusMarkedLine('Sarah', 'loved').text)
    expect(shown[2].text).toContain('Mina')
    // Eve was never in the ledger; what he gave her is said last rather than dropped.
    expect(shown[3].text).toBe(giftStatusMarkedLine('Eve', 'unimpressed').text)
  })
})

/**
 * An act two girls were both in is a threesome, and the fold that says so lives on the
 * `ledgerEvents` seam — otherwise two girls who were in the same bed end up with one filing a
 * jealousy memory about the other.
 */
describe('the threesome fold', () => {
  it('settles the sharing for everybody in one act, and the milestone with it', () => {
    applyLedger({
      memories: [],
      events: [],
      acts: [{ kind: 'sex', inPublic: false, chars: ['sarah_rose', 'mina_kwon'] }]
    })
    const { charInfo } = useGameStore.getState()
    expect(charInfo.a.flags.harem).toBe(true)
    expect(charInfo.b.flags.harem).toBe(true)
    // The rest of what sleeping together does is untouched.
    expect(charInfo.a.flags.hadSex).toBe(true)
    expect(charInfo.a.flags.hasKissed).toBe(true)
    expect(charInfo.a.flags.benefits).toBe(true)
  })

  // Two rows are two separate hours: he can sleep with one girl and kiss another
  // without either of them having settled anything.
  it('counts who was in one act together, not who the scene reported at all', () => {
    applyLedger({
      memories: [],
      events: [],
      acts: [
        { kind: 'sex', inPublic: false, chars: ['sarah_rose'] },
        { kind: 'kiss', inPublic: false, chars: ['mina_kwon'] }
      ]
    })
    const { charInfo } = useGameStore.getState()
    expect(charInfo.a.flags.harem).toBe(false)
    expect(charInfo.b.flags.harem).toBe(false)
  })

  it('drops a name it cannot file before counting, like every other read of the seam', () => {
    applyLedger({
      memories: [],
      events: [],
      acts: [{ kind: 'sex', inPublic: false, chars: ['sarah_rose', 'nobody'] }]
    })
    expect(useGameStore.getState().charInfo.a.flags.harem).toBe(false)
  })

  // Idempotent under the boundary replay, like everything else the fold does:
  // `harem` only ever sets, so a second pass reaches the same flags.
  it('reaches the same flags on a replayed boundary', () => {
    const ledger: LedgerResponse = {
      memories: [],
      events: [],
      acts: [{ kind: 'sex', inPublic: false, chars: ['sarah_rose', 'mina_kwon'] }]
    }
    applyLedger(ledger)
    const once = useGameStore.getState().charInfo.a.flags
    applyLedger(ledger)
    expect(useGameStore.getState().charInfo.a.flags).toEqual(once)
  })
})

/**
 * The ending narrates the next slot off a *projection* of the ledger it just paid for, since
 * the real apply cannot move earlier than the boundary. These are the tripwire: the day
 * projection and apply stop agreeing, the opening describes a girl the save then contradicts.
 */
describe('projectLedger', () => {
  it('reaches exactly what the boundary will bank, for every kind of row at once', () => {
    useGameStore.setState({
      // A roster, so the dating pass the two seams share has somebody to fold over.
      chars: ['a', 'b', 'c'],
      charInfo: {
        // Full to the cap, so the eviction order is part of what is compared.
        a: charInfo({
          memories: Array.from({ length: MEMORY_CAP }, (_, at) => ({
            date: 1,
            type: 'liked' as const,
            desc: `old ${at}`
          })),
          textMemory: { date: 2, type: 'liked', desc: 'an older impression' },
          flags: { ...emptyFlags(), isLover: true }
        }),
        b: charInfo({
          flags: { ...emptyFlags(), blocked: true, gaveContactInfo: true, hasCrush: true }
        }),
        c: charInfo()
      }
    })
    const ledger: LedgerResponse = {
      memories: [
        { charKey: 'sarah_rose', type: 'loved', desc: '  she stayed the night  ' },
        { charKey: 'mina_kwon', type: 'hated', desc: 'he ignored her' },
        // Unfilable, and dropped identically by both readers of the seam.
        { charKey: 'nobody', type: 'liked', desc: 'x' },
        { charKey: 'eve_lang', type: 'adored' as never, desc: 'x' }
      ],
      textMemories: [{ charKey: 'sarah_rose', type: 'loved', desc: 'a newer impression' }],
      events: [
        // A breakup and a first time for the same girl: both milestone memories
        // stack on top of the ledger's own, in the fold's order.
        { charKey: 'sarah_rose', event: 'broke_up' },
        { charKey: 'mina_kwon', event: 'unblocked' },
        // A new lover, so the dating pass has a start to settle and Mina to sting.
        { charKey: 'eve_lang', event: 'became_lovers' }
      ],
      acts: [
        { kind: 'sex', inPublic: false, chars: ['sarah_rose'] },
        { kind: 'sex', inPublic: true, chars: ['eve_lang'] },
        { kind: 'kiss', inPublic: false, chars: ['nobody'] }
      ]
    }

    const before = useGameStore.getState().charInfo
    const projected = projectLedger(before, ledger, useGameStore.getState().date)
    applyLedger(ledger)

    expect(projected.charInfo).toEqual(useGameStore.getState().charInfo)
    expect(projected.charInfo.b.jealousyMemories).toHaveLength(1)
    // And it is a projection, not a write: the map it was handed is untouched.
    expect(before.a.memories.at(-1)).toEqual({ date: 1, type: 'liked', desc: `old ${MEMORY_CAP - 1}` })
    expect(before.a.flags.hadSex).toBe(false)
  })

  it('reaches the same entry the apply would for a girl the save has no row for', () => {
    useGameStore.setState({ charInfo: {} })
    const ledger: LedgerResponse = {
      memories: [{ charKey: 'sarah_rose', type: 'liked', desc: 'a good hour' }],
      events: [{ charKey: 'sarah_rose', event: 'kissed' }]
    }
    const projected = projectLedger(useGameStore.getState().charInfo, ledger, 7)
    applyLedger(ledger)
    expect(projected.charInfo).toEqual(useGameStore.getState().charInfo)
  })

  // The next opening writes her texts off these, so a ledger that started nothing must
  // hand back empty lists rather than something to write about.
  it('settles nothing for a ledger that moved nobody', () => {
    expect(applyLedger({ memories: [], events: [] })).toEqual({
      charInfo: {},
      breakups: []
    })
  })
})
