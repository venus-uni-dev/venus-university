import { describe, expect, it, vi } from 'vitest'
import {
  hiddenScheduleAssignmentsOf,
  jobAssignmentsOf,
  mergeProfiles,
  validateProfileDraft,
  type ProfileGenReply
} from '../src/renderer/prompts/profilePrompt'
import type { ClassGenReply } from '../src/renderer/prompts/classPrompt'
import { character } from './fixtures'

/**
 * The profile call's validation and merge passes — the two places a bad reply could
 * write a character into a save as a year she is not, or with more classes in
 * her major than she takes altogether.
 */

const ROSTER = [character({ charId: 'char-1', firstName: 'Sarah', lastName: 'Rose' })]

/** One profile reply entry, with the fields a valid one always has. */
function profile(over: Record<string, unknown> = {}): ProfileGenReply {
  return {
    characters: [
      {
        key: 'sarah_rose',
        year: 2,
        classesTaken: 4,
        dorm: 'lowrise_3',
        job: 'cutetea',
        jobShifts: 2,
        homeSlots: 2,
        study: 'library',
        fun: ['arcade'],
        activity: '',
        activityLocation: '',
        meal: '',
        handle: 'sarahrose',
        winterPosts: [],
        springBreakPlans: 'Go home to Russia to see her parents.',
        ...over
      }
    ]
  } as ProfileGenReply
}

/** The catalog half, as `validateClassDraft` leaves it. */
function classReply(majorClassesTaken = 2): ClassGenReply {
  return {
    characters: {
      sarah_rose: {
        major: 'Biology',
        majorClassesTaken,
        interestClass: { code: 'ART 101', name: 'Pots', description: 'Pots.' }
      }
    },
    classes: []
  }
}

describe('validateProfileDraft', () => {
  it('repairs a missing spring break plan to blank rather than failing the reply', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out = validateProfileDraft(profile({ springBreakPlans: '   ' }), ROSTER)
    expect(out.characters.sarah_rose.springBreakPlans).toBe('')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('derives a handle when the reply gave nothing usable', () => {
    // The renderer has no fallback of its own — a handle is minted once or the
    // `@name` line is simply absent — so this repair is the only thing between
    // a blank answer and a character with no handle for the playthrough.
    for (const handle of ['', '   ', '@@@', '123']) {
      const out = validateProfileDraft(profile({ handle }), ROSTER)
      expect(out.characters.sarah_rose.handle).toMatch(/^sarahrose\d$/)
    }
  })

  it('drops a freshman’s winter posts — she had no term here to go home from', () => {
    const out = validateProfileDraft(profile({ year: 1, winterPosts: ['home for xmas'] }), ROSTER)
    expect(out.characters.sarah_rose.winterPosts).toEqual([])
  })

  it('keeps an upperclassman’s, trimmed and capped at three', () => {
    const out = validateProfileDraft(
      profile({ year: 3, winterPosts: ['  one  ', '', 'two', 'three', 'four'] }),
      ROSTER
    )
    expect(out.characters.sarah_rose.winterPosts).toEqual(['one', 'two', 'three'])
  })

  it('is fatal when a roster character was left out — year has no honest default', () => {
    expect(() => validateProfileDraft({ characters: [] }, ROSTER)).toThrowError(
      expect.objectContaining({ code: 'PROFILE_GEN_INVALID' })
    )
  })

  it('clamps a year and a course load outside the schema bounds', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out = validateProfileDraft(profile({ year: 9, classesTaken: 1 }), ROSTER)
    expect(out.characters.sarah_rose.year).toBe(4)
    expect(out.characters.sarah_rose.classesTaken).toBe(3)
    vi.restoreAllMocks()
  })

  it('leaves her jobless when the employer is not in the catalog', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out = validateProfileDraft(profile({ job: 'space_station' }), ROSTER)
    expect(out.characters.sarah_rose.job).toBe('')
    expect(out.characters.sarah_rose.jobShifts).toBe(0)
    vi.restoreAllMocks()
  })

  it('repairs an unknown dorm to the fallback Lowrise', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out = validateProfileDraft(profile({ dorm: 'the_moon' }), ROSTER)
    expect(out.characters.sarah_rose.dorm).toBe('lowrise_2')
    vi.restoreAllMocks()
  })

  it('resolves a job with no shifts to no job at all', () => {
    const out = validateProfileDraft(profile({ jobShifts: 0 }), ROSTER)
    expect(out.characters.sarah_rose.job).toBe('')
  })

  it("folds the array by key: the first row for a student wins, and a stranger's row never becomes a character", () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const reply: ProfileGenReply = {
      characters: [
        profile({ key: 'nobody_here' }).characters[0],
        profile({ year: 2 }).characters[0],
        profile({ year: 4 }).characters[0]
      ]
    }
    const out = validateProfileDraft(reply, ROSTER)
    expect(Object.keys(out.characters)).toEqual(['sarah_rose'])
    expect(out.characters.sarah_rose.year).toBe(2)
    expect(out.characters.nobody_here).toBeUndefined()
    warn.mockRestore()
  })
})

describe('mergeProfiles', () => {
  it('clamps major classes to the course load — the bound neither call could apply', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const merged = mergeProfiles(classReply(3), validateProfileDraft(profile({ classesTaken: 3 }), ROSTER))
    expect(merged.characters.sarah_rose.majorClassesTaken).toBe(3)

    const tighter = mergeProfiles(
      classReply(3),
      validateProfileDraft(profile({ classesTaken: 3, year: 1 }), ROSTER)
    )
    expect(tighter.characters.sarah_rose.classesTaken).toBe(3)
    vi.restoreAllMocks()
  })
})

describe('validateProfileDraft — where she spends her free time', () => {
  it('clamps a home count outside the schema bounds', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(validateProfileDraft(profile({ homeSlots: 9 }), ROSTER).characters.sarah_rose.homeSlots)
      .toBe(3)
    expect(validateProfileDraft(profile({ homeSlots: 0 }), ROSTER).characters.sarah_rose.homeSlots)
      .toBe(1)
    vi.restoreAllMocks()
  })

  it('drops a haunt that is not on its menu rather than failing the save', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out = validateProfileDraft(
      profile({ study: 'the_moon', meal: 'library', fun: ['library', 'arcade'] }),
      ROSTER
    )
    // `library` is a study key, not a fun or meal one: each menu is closed.
    expect(out.characters.sarah_rose.study).toBe('')
    expect(out.characters.sarah_rose.meal).toBe('')
    expect(out.characters.sarah_rose.fun).toEqual(['arcade'])
    vi.restoreAllMocks()
  })

  it('drops an activity that has lost half of itself, either half', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const offMenu = validateProfileDraft(
      profile({ activity: 'sketching in the greenhouse', activityLocation: 'library' }),
      ROSTER
    )
    expect(offMenu.characters.sarah_rose.activity).toBe('')
    expect(offMenu.characters.sarah_rose.activityLocation).toBe('')

    const unsaid = validateProfileDraft(
      profile({ activity: '  ', activityLocation: 'greenhouse' }),
      ROSTER
    )
    expect(unsaid.characters.sarah_rose.activity).toBe('')
    expect(unsaid.characters.sarah_rose.activityLocation).toBe('')
    vi.restoreAllMocks()
  })

  it('names the place in a phrase that left it out, so the line still says where she is', () => {
    const out = validateProfileDraft(
      profile({ activity: 'Lifting weights.', activityLocation: 'stadium' }),
      ROSTER
    )
    expect(out.characters.sarah_rose.activity).toBe('lifting weights at Palaestra Stadium')
    expect(hiddenScheduleAssignmentsOf(out).sarah_rose.activity).toEqual({
      location: 'palaestra_stadium',
      doing: 'lifting weights at Palaestra Stadium'
    })
  })

  it('dedupes and caps the fun list', () => {
    const out = validateProfileDraft(
      profile({ fun: ['arcade', 'arcade', 'bar', 'club'] }),
      ROSTER
    )
    expect(out.characters.sarah_rose.fun).toEqual(['arcade', 'bar'])
  })
})

describe('jobAssignmentsOf', () => {
  it('reports only the characters who actually hold a job', () => {
    const draft = validateProfileDraft(
      {
        characters: [
          profile().characters[0],
          { ...profile({ job: '', jobShifts: 0 }).characters[0], key: 'mina_okafor' }
        ]
      },
      [
        character({ charId: 'char-1', firstName: 'Sarah', lastName: 'Rose' }),
        character({ charId: 'char-2', firstName: 'Mina', lastName: 'Okafor' })
      ]
    )
    expect(jobAssignmentsOf(draft)).toEqual({ sarah_rose: { jobId: 'cutetea', count: 2 } })
  })
})

describe('hiddenScheduleAssignmentsOf', () => {
  it('resolves every menu key onto its location id', () => {
    const draft = validateProfileDraft(
      profile({
        study: 'cafe',
        fun: ['club', 'lounge'],
        activity: 'sketching at the Whitman Greenhouse',
        activityLocation: 'greenhouse',
        meal: 'diner'
      }),
      ROSTER
    )
    expect(hiddenScheduleAssignmentsOf(draft).sarah_rose).toEqual({
      homeSlots: 2,
      study: 'reserve_bank_cafe',
      fun: ['apogee_club', 'pino_cola_lounge'],
      activity: {
        location: 'whitman_greenhouse',
        doing: 'sketching at the Whitman Greenhouse'
      },
      meal: 'bobbys_diner'
    })
  })

  it('carries a character who goes nowhere, because she still stays in', () => {
    const draft = validateProfileDraft(
      profile({ study: '', fun: [], activity: '', homeSlots: 3 }),
      ROSTER
    )
    expect(hiddenScheduleAssignmentsOf(draft).sarah_rose).toEqual({
      homeSlots: 3,
      study: null,
      fun: [],
      activity: null,
      meal: null
    })
  })
})
