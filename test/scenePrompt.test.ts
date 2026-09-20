import { describe, expect, it } from 'vitest'
import {
  addsAnnouncedBy,
  buildContinuationPrompt,
  buildLedgerPrompt,
  buildScenePrompt,
  dropsKnownTo,
  ledgerStoryFallback,
  ledgerTranscriptOf,
  shortenSceneSoFar,
  type ScenePromptState
} from '../src/renderer/prompts/scenePrompt'
import { cgAction } from '@shared/sceneActions'
import { READER_SPEAKER, type SceneLine, type TimeSlot } from '@shared/types'
import { character, charactersById } from './fixtures'

/**
 * The transforms a blocked request is resent through, the ledger's STATS branches, and the
 * notice predicates the scene boundary spends. They find their block by matching the header
 * and its fences literally, so a builder that changed that shape would disarm the guard.
 */

const FENCE = '\'\'\''

const sarah = character()
const mina = character({ charId: 'char-2', firstName: 'Mina', lastName: 'Okafor' })

function promptState() {
  return {
    playthroughId: 'p1',
    date: 0,
    time: 0 as TimeSlot,
    seedWord: 'aspen',
    backgrounds: { interior: ['library'], exterior: ['quad'] },
    charInfo: {},
    npcRelationships: {},
    roster: [],
    classes: {},
    playerSchedule: {},
    occasions: [],
    bg: null,
    classCode: null,
    projectClass: null,
    playerJob: null,
    jobId: null,
    visitJobId: null,
    giftNotes: [],
    emotions: {},
    onStage: [],
    lessNsfwText: false,
    cgReady: {},
    outfitReady: {},
    roomReady: {}
  }
}

/** A transcript of alternating narration and dialogue, plus the reader's own line. */
function transcript(): SceneLine[] {
  return [
    { speaker: 'NARRATOR', text: 'The quad is empty.' },
    { speaker: READER_SPEAKER, text: 'say hi' },
    { speaker: 'char-1', text: 'Hey there.' },
    { speaker: 'NARRATOR', text: 'She smiles.' },
    { speaker: 'char-1', text: 'Walk with me?' }
  ]
}

/** A hand-built prompt with the block the builders emit, for the surgical cases. */
function withBlock(...stubs: string[]): string {
  return ['HEAD', '', 'SCENE SO FAR', FENCE, ...stubs, FENCE, '', 'YOUR TURN', 'write'].join('\n')
}

describe('shortenSceneSoFar', () => {
  it('keeps the last stub and nothing else inside the block', () => {
    const user = withBlock('NARRATOR: one.', 'SARAH: two.', 'NARRATOR: three.')
    expect(shortenSceneSoFar(user)).toBe(withBlock('NARRATOR: three.'))
  })

  // Nothing to try: the resend would be the request that was just blocked.
  it('answers null for a block already down to one stub, or to none', () => {
    expect(shortenSceneSoFar(withBlock('NARRATOR: only.'))).toBeNull()
    expect(shortenSceneSoFar(withBlock())).toBeNull()
  })

  it('answers null for a prompt with no block at all', () => {
    expect(shortenSceneSoFar('HEAD\n\nYOUR TURN\nwrite')).toBeNull()
  })

  // The header is scanned for from the end, so prose quoting it cannot be
  // mistaken for the block the guard is trimming.
  it('trims the real block, not a stub that quotes its name', () => {
    const user = [
      'SCENE SO FAR',
      FENCE,
      'NARRATOR: she asks what the SCENE SO FAR is.',
      'NARRATOR: last one.',
      FENCE,
      ''
    ].join('\n')
    expect(shortenSceneSoFar(user)).toBe(
      ['SCENE SO FAR', FENCE, 'NARRATOR: last one.', FENCE, ''].join('\n')
    )
  })

  it('trims a continuation the builder wrote, keeping its final stub alone', () => {
    const { user } = buildContinuationPrompt(
      [sarah],
      'walk with her',
      transcript(),
      promptState(),
      'SETTING',
      'READER',
      'They met on the quad.',
      3
    )
    const shortened = shortenSceneSoFar(user)
    expect(shortened).not.toBeNull()
    expect(shortened).toContain('Walk with me?')
    expect(shortened).not.toContain('The quad is empty.')
    // The summary is a block of its own and is not what this transform touches.
    expect(shortened).toContain('They met on the quad.')
    // Everything the call is actually asking for survives the cut.
    expect(shortened).toContain('YOUR TURN')
    expect(shortened).toContain('Reader\'s action: walk with her')
  })
})

describe('buildLedgerPrompt — STATS', () => {
  const roster = charactersById(sarah, mina)

  function ledgerFor(cast: (typeof sarah)[], state: Partial<ScenePromptState> = {}) {
    const { user, schema } = buildLedgerPrompt(
      cast,
      transcript(),
      { ...promptState(), ...state },
      'READER',
      { date: 0, time: 0 as TimeSlot, threads: [], characters: roster, planned: [] }
    )
    return {
      user,
      required: schema.schema.required as string[],
      props: schema.schema.properties as Record<string, unknown>
    }
  }

  // The hour was shared, so the reader gets one stat out of it and the prompt
  // has to say so — the schema cannot.
  it('asks a scene with company for a single stat', () => {
    const { required, props } = ledgerFor([sarah])
    expect(required).toContain('stats')
    expect(props.stats).toBeDefined()
  })

  // Both hours the app scores by itself. Asking anyway would invite a model to
  // pay a second time for a point the timetable or the employer already paid.
  it('drops the section and the field on a class the reader sat in', () => {
    const { user, required, props } = ledgerFor([sarah], { classCode: 'BIO101' })
    expect(user).not.toContain('STATS')
    expect(required).not.toContain('stats')
    expect(props.stats).toBeUndefined()
  })

  it('drops the section and the field on a worked shift', () => {
    const { user, required } = ledgerFor([sarah], { jobId: 'cafe' })
    expect(user).not.toContain('STATS')
    expect(required).not.toContain('stats')
  })

  // A class he was the only student of is still an hour alone, and the solo
  // branch is what decides — dropping it there would silently stop paying the
  // one kind of scene stats were built for.
  it('keeps the solo section on a class with nobody else in it', () => {
    const { user, required } = ledgerFor([], { classCode: 'BIO101' })
    expect(user).toContain('STATS')
    expect(required).toContain('stats')
  })
})

describe('ledgerStoryFallback', () => {
  const roster = charactersById(sarah, mina)

  function ledger(scene: SceneLine[]) {
    return buildLedgerPrompt([sarah], scene, promptState(), 'READER', {
      date: 0,
      time: 0 as TimeSlot,
      threads: [],
      characters: roster,
      planned: []
    })
  }

  it('replaces the scene with the summary, renaming the block', () => {
    const user = withBlock('NARRATOR: one.', 'READER: say hi', 'SARAH: two.')
    expect(ledgerStoryFallback(user, 'They talked on the quad.')).toBe(
      ['HEAD', '', 'STORY SO FAR', FENCE, 'They talked on the quad.', FENCE, '', 'YOUR TURN', 'write'].join('\n')
    )
  })

  // Nothing to send in the log's place, so the modal is the next step.
  it('answers null without a summary to stand in', () => {
    const user = withBlock('NARRATOR: one.', 'NARRATOR: two.')
    expect(ledgerStoryFallback(user, null)).toBeNull()
    expect(ledgerStoryFallback(user, '   ')).toBeNull()
  })

  it('answers null for a prompt with no block', () => {
    expect(ledgerStoryFallback('HEAD\n\nSTATS\n', 'A summary.')).toBeNull()
  })

  it('folds a ledger request the builder wrote, dropping the reader\'s own lines with it', () => {
    const { user } = ledger(transcript())
    expect(user).toContain('READER: say hi')

    const folded = ledgerStoryFallback(user, 'They met on the quad and walked together.')
    expect(folded).not.toBeNull()
    expect(folded).toContain('STORY SO FAR')
    expect(folded).not.toContain('SCENE SO FAR')
    expect(folded).toContain('They met on the quad and walked together.')
    expect(folded).not.toContain('READER: say hi')
    expect(folded).not.toContain('The quad is empty.')
    // The questions the call exists to answer are all above the block.
    expect(folded).toContain('MEMORIES')
    expect(folded).toContain('MONEY')
    expect(folded).toContain('PLANS')
  })
})

/**
 * The predicate the scene boundary spends a drop notice by: a wrong
 * answer announces the drop to her twice, or never.
 */
describe('dropsKnownTo', () => {
  const notices = [
    { code: 'BIO 210', name: 'Organic Chemistry', day: 'Tuesday Night' },
    { code: 'ART 101', name: 'Ceramics', day: 'Thursday Day' }
  ]

  it('answers with only the drops this character shares a room with', () => {
    // Slot 4 holds BIO 210 for her; she is in no section of ART 101.
    expect(dropsKnownTo({ 4: 'BIO 210', 7: 'PHY 100' }, notices)).toEqual([notices[0]])
  })

  it('answers empty for a character enrolled in neither, and for no schedule', () => {
    expect(dropsKnownTo({ 7: 'PHY 100' }, notices)).toEqual([])
    expect(dropsKnownTo(undefined, notices)).toEqual([])
    expect(dropsKnownTo({ 4: 'BIO 210' }, [])).toEqual([])
  })
})

/**
 * The add's half of the same contract: it is the meeting rather than
 * the classmate that spends an add notice.
 */
describe('addsAnnouncedBy', () => {
  const notices = [
    { code: 'BIO 210', name: 'Organic Chemistry' },
    { code: 'ART 101', name: 'Ceramics' }
  ]

  it('answers with the one add this meeting is of', () => {
    expect(addsAnnouncedBy('ART 101', notices)).toEqual([notices[1]])
  })

  it('answers empty for a scene in another class, or in none at all', () => {
    expect(addsAnnouncedBy('PHY 100', notices)).toEqual([])
    expect(addsAnnouncedBy(null, notices)).toEqual([])
    expect(addsAnnouncedBy(undefined, notices)).toEqual([])
    expect(addsAnnouncedBy('ART 101', [])).toEqual([])
  })
})

/**
 * Where the ledger thinks the scene starts. Everything above the
 * reader's first action is the slot's opening narration, which the read log
 * carries and the scene did not.
 */
describe('ledgerTranscriptOf', () => {
  const opening: SceneLine[] = [
    { speaker: '', text: 'January 19, Monday morning.' },
    { speaker: '', text: 'What would you like to do?' }
  ]

  it('starts the scene at the reader\'s first action', () => {
    expect(ledgerTranscriptOf([...opening, ...transcript()])).toEqual(transcript().slice(1))
  })

  it('keeps every later action, having only one seam to find', () => {
    const second: SceneLine[] = [{ speaker: READER_SPEAKER, text: 'ask her out' }]
    const kept = ledgerTranscriptOf([...opening, ...transcript(), ...second])
    expect(kept.filter((line) => line.speaker === READER_SPEAKER)).toHaveLength(2)
  })

  it('passes a log with no action in it through whole', () => {
    // The orientation scroll: written rather than typed, and the whole scene.
    expect(ledgerTranscriptOf(opening)).toEqual(opening)
    expect(ledgerTranscriptOf([])).toEqual([])
  })

  it('keeps the opening out of a ledger request the builder wrote', () => {
    const { user } = buildLedgerPrompt(
      [sarah],
      [...opening, ...transcript()],
      promptState(),
      'READER',
      { date: 0, time: 0 as TimeSlot, threads: [], characters: charactersById(sarah), planned: [] }
    )
    expect(user).not.toContain('What would you like to do?')
    expect(user).not.toContain('January 19, Monday morning.')
    expect(user).toContain('READER: say hi')
    expect(user).toContain('She smiles.')
  })
})

/**
 * A CG belongs to a girl standing on the stage alone, and the schema is the whole of what
 * offers her one: a `cg:` the enum does not carry cannot be written at all.
 */
describe('buildScenePrompt — the CG gate', () => {
  /** The stage directions the built schema offers, or none where it offers no `actions` at all. */
  function actionsFor(cast: (typeof sarah)[], state: Partial<ScenePromptState>): string[] {
    const { schema } = buildScenePrompt(
      cast,
      'find her',
      { ...promptState(), ...state },
      'SETTING',
      'READER'
    )
    const properties = schema.schema.properties as {
      lines: { items: { properties: { actions?: { items: { enum: string[] } } } } }
    }
    return properties.lines.items.properties.actions?.items.enum ?? []
  }

  const READY = { 'char-1': true, 'char-2': true }

  it('offers a two-girl cast her CGs once the stage is down to her', () => {
    const actions = actionsFor([sarah, mina], { onStage: ['char-1'], cgReady: READY })
    expect(actions).toContain(cgAction('sex'))
    expect(actions).toContain(cgAction('sex_after'))
  })

  it('offers none while both of them are standing on it', () => {
    const actions = actionsFor([sarah, mina], { onStage: ['char-1', 'char-2'], cgReady: READY })
    expect(actions.filter((action) => action.startsWith('cg:'))).toEqual([])
  })

  // An opening: the cast is drawn but nobody has been shown yet, and the sanitizer is what
  // holds the `cg:` until her own `show:` has landed ahead of it.
  it('offers them to a lone girl on an empty stage', () => {
    const actions = actionsFor([sarah], { onStage: [], cgReady: { 'char-1': true } })
    expect(actions).toContain(cgAction('sex'))
  })
})

/**
 * The slot's rumor reaches the turn that opens a scene and no turn after it. The whole
 * mechanism is which builder passes the value on, so a builder that started reading it off the
 * state — the obvious tidy-up — would inject the sentence into every turn of the scene.
 */
describe('the slot rumor in the lorebook', () => {
  const RUMOR = {
    placeId: 'kendall_library',
    sentence: 'Word is the Kendall is open all night this week.'
  }

  it('rides the opening turn, on the entry for the place the action named', () => {
    const { user } = buildScenePrompt(
      [sarah],
      'head to the library',
      { ...promptState(), slotRumor: RUMOR },
      'SETTING',
      'READER'
    )
    expect(user).toContain(RUMOR.sentence)
    // Appended to that entry rather than printed as a block of its own.
    expect(user).toContain(`Kendall Library`)
  })

  it('says nothing where the turn never mentions the place', () => {
    const { user } = buildScenePrompt(
      [sarah],
      'go to the gym',
      { ...promptState(), slotRumor: RUMOR },
      'SETTING',
      'READER'
    )
    expect(user).not.toContain(RUMOR.sentence)
  })

  it('is gone from the very next turn of the same scene', () => {
    const state: ScenePromptState = { ...promptState(), slotRumor: RUMOR }
    const { user } = buildContinuationPrompt(
      [sarah],
      'keep reading',
      transcript(),
      state,
      'SETTING',
      'READER',
      'They went to the library.',
      2
    )
    // The entry itself is still matched — it is the rumor that is spent.
    expect(user).toContain('Kendall Library')
    expect(user).not.toContain(RUMOR.sentence)
  })
})
