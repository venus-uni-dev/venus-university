import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  emptyCatalog,
  ROSTER_MAX,
  ROSTER_MIN,
  rosterSizeOf,
  type Application,
  type ApplicationContinuation
} from '@shared/application'
import {
  assertSafeSaveId,
  atLocation,
  classifySaveId,
  ENROLLMENT_SCHEMA_VERSION,
  isSlotSaveId,
  manualSaveId,
  manualSlotOf,
  mintId,
  prunedSlotIds,
  readApplicationRecord,
  RECORD_SCHEMA_VERSION,
  SAVE_SCHEMA_VERSION,
  sortSlotIds,
  stampEnrollment,
  stampRecord,
  stampSave,
  summaryOf,
  withApplication
} from '@shared/saveRules'
import {
  AUTOSAVE_ID,
  MANUAL_SAVE_SLOTS,
  MAX_SLOT_SAVES,
  type AppError,
  type GameSave,
  type PlaythroughRecord,
  type PlaythroughSummary,
  type SaveDraft,
  type SceneState
} from '@shared/types'

/**
 * The rules a save is written under, apart from any store that holds them: a colliding id
 * overwrites the save it lands on, a window that prunes one too many throws away a save the
 * player can still see, and a missing stamp makes a file the loader refuses.
 */

afterEach(() => {
  vi.useRealTimers()
})

/** Slot ids as the clock mints them: `n` of them, one millisecond apart. */
function minted(from: number, count: number): string[] {
  return Array.from({ length: count }, (_, i) => String(from + i))
}

describe('mintId', () => {
  it('answers with the clock when nothing holds that id', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_700_000_000_000)

    expect(mintId(new Set())).toBe('1700000000000')
  })

  it('walks past a run of taken ids rather than reusing one', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_700_000_000_000)

    // Three saves written inside the same millisecond, which is what a fast machine does.
    const taken = new Set(minted(1_700_000_000_000, 3))
    expect(mintId(taken)).toBe('1700000000003')
  })
})

describe('assertSafeSaveId', () => {
  it('takes a mint timestamp and the autosave, and nothing else', () => {
    expect(() => assertSafeSaveId('1700000000000')).not.toThrow()
    expect(() => assertSafeSaveId(AUTOSAVE_ID)).not.toThrow()

    for (const unsafe of ['..', '../escaped', 'autosave.bak', '17000/000', '']) {
      expect(() => assertSafeSaveId(unsafe)).toThrow()
    }
  })

  it('takes a manual slot inside the range and refuses one outside it', () => {
    for (const manual of ['manual01', 'manual90', 'manual100', manualSaveId(MANUAL_SAVE_SLOTS)]) {
      expect(classifySaveId(manual)).toBe('manual')
      expect(() => assertSafeSaveId(manual)).not.toThrow()
    }

    const outside = ['manual0', 'manual00', 'manual0100', 'manual007', 'manual-1']
    for (const unsafe of [...outside, manualSaveId(MANUAL_SAVE_SLOTS + 1)]) {
      expect(classifySaveId(unsafe)).toBeNull()
      expect(() => assertSafeSaveId(unsafe)).toThrow()
    }
  })
})

describe('the save id kinds', () => {
  it('names a slot and reads it back off its id', () => {
    for (const slot of [1, 9, 100, MANUAL_SAVE_SLOTS]) {
      expect(manualSlotOf(manualSaveId(slot))).toBe(slot)
    }
    expect(manualSaveId(7)).toBe('manual07')
    expect(manualSaveId(100)).toBe('manual100')
    expect(manualSlotOf('1700000000000')).toBeNull()
    expect(manualSlotOf(AUTOSAVE_ID)).toBeNull()
  })

  it('counts only a boundary save as the slot window’s', () => {
    // A manual id taken for a slot id is a manual save the window prunes.
    expect(isSlotSaveId('1700000000000')).toBe(true)
    expect(isSlotSaveId(manualSaveId(1))).toBe(false)
    expect(isSlotSaveId(AUTOSAVE_ID)).toBe(false)
  })
})

describe('summaryOf', () => {
  /** A save between scenes, or mid-scene when handed one. */
  function save(over: Partial<GameSave> = {}): GameSave {
    return { date: 5, time: 1, graduationSeen: false, scene: null, ...over } as GameSave
  }

  it('reads a save between scenes as having no scene and no picture', () => {
    const summary = summaryOf(save())
    expect(summary).toEqual({ date: 5, time: 1, graduationSeen: false, midScene: false, bg: null })
    expect(summary).not.toHaveProperty('thumbnail')
  })

  it('takes the player’s own background over the scene’s, and the picture if any', () => {
    const scene = { bg: 'library', currentLine: null, pendingLines: [] } as unknown as SceneState
    expect(summaryOf(save({ scene }))).toMatchObject({ midScene: true, bg: 'library' })

    const picked = summaryOf(save({ scene: { ...scene, bgOverride: 'quad' }, thumbnail: 'AAAA' }))
    expect(picked).toMatchObject({ midScene: true, bg: 'quad', thumbnail: 'AAAA' })
  })

  it('reads a queued reply’s own background over the scene’s at rest', () => {
    const scene = {
      bg: null,
      currentLine: null,
      pendingLines: [{ speaker: '', text: 'The bell over the door rings.', bg: 'cafe' }]
    } as unknown as SceneState
    expect(summaryOf(save({ scene }))).toMatchObject({ midScene: true, bg: 'cafe' })
  })

  it('carries the save’s transfers for the listing’s roster, and only where there are any', () => {
    expect(summaryOf(save({ transfers: [] }))).not.toHaveProperty('transfers')
    const transfers = [
      { charId: 'm', profile: { year: 2, dorm: 'lowrise_1' as const, major: 'Art', schedule: {} } }
    ]
    expect(summaryOf(save({ transfers })).transfers).toEqual(transfers)
  })
})

describe('prunedSlotIds', () => {
  it('keeps nothing back while the window has room for the save being written', () => {
    expect(prunedSlotIds([])).toEqual([])
    expect(prunedSlotIds(minted(1000, MAX_SLOT_SAVES - 1))).toEqual([])
  })

  it('drops the oldest once the window is full, one per save written', () => {
    const slots = minted(1000, MAX_SLOT_SAVES)
    expect(prunedSlotIds(slots)).toEqual(['1000'])

    const overfull = minted(1000, MAX_SLOT_SAVES + 2)
    expect(prunedSlotIds(overfull)).toEqual(['1002', '1001', '1000'])
  })

  it('reads age off the id rather than the order it was handed', () => {
    const shuffled = ['1005', '1000', '1003', '1001', '1004', '1002']
    expect(sortSlotIds(shuffled)).toEqual(['1005', '1004', '1003', '1002', '1001', '1000'])
    // Fewer than the window holds, so nothing is pruned whatever the order.
    expect(prunedSlotIds(shuffled)).toEqual([])
  })
})

describe('the stamps', () => {
  /** The fields a draft carries that a stamp must not disturb. */
  const draft = { date: 3, time: 1 } as unknown as SaveDraft

  it('puts this build’s version and the write’s clock on a save', () => {
    const save = stampSave(draft, '1700000000000', '1700000000001', 1_700_000_000_500)

    expect(save).toMatchObject({
      date: 3,
      time: 1,
      playthroughId: '1700000000000',
      saveId: '1700000000001',
      schemaVersion: SAVE_SCHEMA_VERSION,
      saveDate: 1_700_000_000_500
    })
  })

  it('lets where a save was found win over what it carries', () => {
    const stale = { playthroughId: 'gone', saveId: 'gone', date: 3 } as unknown as GameSave

    expect(atLocation(stale, '1700000000000', AUTOSAVE_ID)).toMatchObject({
      playthroughId: '1700000000000',
      saveId: AUTOSAVE_ID,
      date: 3
    })
  })

  it('versions a record and an enrollment apart from the save', () => {
    expect(stampRecord({ chars: ['a'] } as never).schemaVersion).toBe(RECORD_SCHEMA_VERSION)

    const enrollment = stampEnrollment({ chars: ['a'] } as never, 1_700_000_000_500)
    expect(enrollment.schemaVersion).toBe(ENROLLMENT_SCHEMA_VERSION)
    expect(enrollment.savedAt).toBe(1_700_000_000_500)
  })
})

describe('a later semester’s New Game', () => {
  /** What the ending of the first semester handed on, with nothing in it but who stays. */
  const continued = {
    id: '200',
    index: 1,
    continuing: ['b'],
    graduated: ['a'],
    alumni: ['a'],
    priorProfiles: {},
    jobs: {},
    haunts: {},
    majorLoads: {},
    carry: {},
    taken: []
  } as unknown as ApplicationContinuation

  /** That New Game on its Characters screen, written at 2000. */
  function application(over: Partial<Application> = {}): Application {
    return {
      schemaVersion: 1,
      savedAt: 2_000,
      screen: 'characters',
      season: 'fall',
      chars: ['b', 'c'],
      plan: [],
      occasions: {},
      catalog: emptyCatalog(),
      girls: {},
      pairs: {},
      replies: {},
      continued,
      ...over
    }
  }

  /** The first semester's saves, the newest written at `savedAt`. */
  function saves(savedAt: number): PlaythroughSummary {
    return {
      playthroughId: '1',
      label: 'Playthrough 1',
      position: 1,
      chars: ['a', 'b'],
      date: 120,
      time: 1,
      savedAt,
      saveCount: 1,
      manualCount: 0,
      hasAutosave: true,
      unloadable: null
    }
  }

  it('is noted beside newer saves, which still stand for the playthrough', () => {
    expect(withApplication(saves(3_000), application(), null, undefined)).toEqual({
      ...saves(3_000),
      application: { savedAt: 2_000, semesterIndex: 1 }
    })
  })

  it('stands for the playthrough over older saves and an older registration, a tie included', () => {
    const enrolling = { ...saves(2_000), enrolling: true as const }
    const listed = withApplication(enrolling, application({ randomPicks: ['c'] }), null, undefined)

    expect(listed).toMatchObject({
      applying: true,
      chars: ['b', 'c'],
      masked: ['c'],
      date: 0,
      time: 0,
      semesterIndex: 1,
      savedAt: 2_000,
      application: { savedAt: 2_000, semesterIndex: 1 }
    })
    expect(listed.enrolling).toBeUndefined()
  })

  it('is passed over once the record or the registration holds its semester, and when it continues nothing', () => {
    const record = { semesters: { '200': {} } } as unknown as PlaythroughRecord
    expect(withApplication(saves(1_000), application(), record, undefined)).toEqual(saves(1_000))
    expect(withApplication(saves(1_000), application(), null, '200')).toEqual(saves(1_000))
    expect(
      withApplication(saves(1_000), application({ continued: undefined }), null, undefined)
    ).toEqual(saves(1_000))
  })

  /** The refusal reading `body` raises, or null where it reads. */
  function refusal(body: Application): AppError | null {
    try {
      readApplicationRecord(body, 'here')
      return null
    } catch (err) {
      return err as AppError
    }
  }

  it('is refused on read where its continuation is not what a Finalize stands on', () => {
    expect(refusal(application({ pursuits: { a: 'Teaching in Kyoto.' } }))).toBeNull()
    const faults: [string, unknown][] = [
      ['continued', 'spring'],
      ['continued.id', { ...continued, id: '../200' }],
      ['continued.index', { ...continued, index: 0 }],
      ['continued.parent', { ...continued, parent: 100 }],
      ['continued.alumni', { ...continued, alumni: [1] }],
      ['continued.majorLoads', { ...continued, majorLoads: [] }],
      ['continued.taken', { ...continued, taken: {} }]
    ]
    for (const [field, bad] of faults) {
      expect(refusal(application({ continued: bad as ApplicationContinuation }))).toMatchObject({
        code: 'APPLICATION_MALFORMED',
        detail: `here: ${field}`
      })
    }
    expect(refusal(application({ pursuits: { a: 3 } as never }))).toMatchObject({
      detail: 'here: pursuits'
    })
    expect(refusal(application({ catalog: {} as never }))).toMatchObject({
      detail: 'here: catalog.pe'
    })
  })

  it('reads without a roster size as the least, and is refused one it cannot hold', () => {
    const unsized = application()
    expect(refusal(unsized)).toBeNull()
    expect(rosterSizeOf(unsized)).toBe(ROSTER_MIN)
    const crowded = Array.from({ length: ROSTER_MIN + 2 }, (_, i) => `g${i}`)
    expect(rosterSizeOf({ chars: crowded })).toBe(ROSTER_MIN + 2)
    expect(rosterSizeOf({ chars: crowded, size: ROSTER_MIN })).toBe(ROSTER_MIN + 2)

    expect(refusal(application({ size: ROSTER_MIN }))).toBeNull()
    expect(refusal(application({ size: ROSTER_MAX }))).toBeNull()
    for (const size of [ROSTER_MIN - 1, ROSTER_MAX + 1, 14.5, '16']) {
      expect(refusal(application({ size: size as number }))).toMatchObject({
        code: 'APPLICATION_MALFORMED',
        detail: 'here: size'
      })
    }
  })
})
