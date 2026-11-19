import { describe, expect, it } from 'vitest'
import {
  charProfileOf,
  charStateOf,
  graduatesOf,
  hasSemester,
  readerYearOf,
  recordReplayIds,
  semesterChain,
  semesterName,
  semesterOf,
  seasonOf,
  withTransfers
} from '@shared/semesters'
import type { CharProfile, SemesterRecord } from '@shared/types'
import { charInfo, classEntry, playthroughRecord } from './fixtures'

/**
 * Reading a playthrough as its semesters: a save read against the wrong semester's roster or
 * catalog, or a graduate list that disagrees with the carry, writes a plausible but wrong
 * semester into every save after it.
 */

/** A settled half with only what the semester rules read. */
function profile(year: number, intake?: CharProfile['intake']): CharProfile {
  return { year, dorm: 'lowrise_1', major: 'Biology', schedule: {}, ...(intake ? { intake } : {}) }
}

/** A semester past the first with nothing but its place in the chain and its roster. */
function semester(over: Partial<SemesterRecord> = {}): SemesterRecord {
  return {
    index: 1,
    chars: ['a'],
    alumni: [],
    classes: {},
    occasions: [],
    jobClosures: {},
    weather: [],
    profiles: {},
    before: { history: {}, playerSchedule: {}, events: [] },
    ...over
  }
}

describe('the semester calendar', () => {
  it('alternates spring and fall from a first spring, the reader a year older every two', () => {
    expect([0, 1, 2, 3].map(seasonOf)).toEqual(['spring', 'fall', 'spring', 'fall'])
    expect([0, 1, 2, 7].map(readerYearOf)).toEqual([1, 1, 2, 4])
    expect(semesterName(1)).toBe('Freshman Fall')
    expect(semesterName(6)).toBe('Senior Spring')
  })
})

describe('graduatesOf', () => {
  it('graduates the first semester’s seniors at a spring’s end, never a freshman-intake senior', () => {
    const view = {
      season: 'spring' as const,
      chars: ['senior', 'junior', 'january-senior'],
      profiles: {
        senior: profile(4),
        junior: profile(3),
        'january-senior': profile(4, 'spring')
      },
      fallGraduate: undefined
    }
    expect(graduatesOf(view)).toEqual(['senior'])
  })

  it('graduates the January intake’s seniors and the early pick at a fall’s end', () => {
    const view = {
      season: 'fall' as const,
      chars: ['january-senior', 'august-senior', 'picked'],
      profiles: {
        'january-senior': profile(4, 'spring'),
        'august-senior': profile(4, 'fall'),
        picked: profile(4, 'fall')
      },
      fallGraduate: 'picked'
    }
    expect(graduatesOf(view)).toEqual(['january-senior', 'picked'])
  })
})

describe('semesterOf and semesterChain', () => {
  const record = playthroughRecord({
    chars: ['a', 'b'],
    semesters: {
      '200': semester({
        index: 1,
        chars: ['a', 'c'],
        alumni: ['b'],
        before: { history: { 3: { 0: 'spring day' } }, playerSchedule: {}, events: [] }
      }),
      '300': semester({
        index: 2,
        parent: '200',
        chars: ['a', 'c'],
        alumni: ['b'],
        before: {
          history: { 5: { 1: 'fall night' } },
          replays: { 5: { 1: 'f'.repeat(32) } },
          playerSchedule: {},
          events: []
        }
      }),
      '201': semester({ index: 1, chars: ['a', 'd'], alumni: ['b'] })
    }
  })

  it('reads the first semester off the top level and a later one off its own record', () => {
    expect(semesterOf(record)).toMatchObject({ index: 0, season: 'spring', chars: ['a', 'b'], alumni: [] })
    expect(semesterOf(record, '300')).toMatchObject({
      id: '300',
      index: 2,
      season: 'spring',
      chars: ['a', 'c'],
      alumni: ['b']
    })
  })

  it('refuses a semester the record does not hold', () => {
    expect(hasSemester(record, '999')).toBe(false)
    expect(() => semesterOf(record, '999')).toThrow()
  })

  it('walks a semester back to the first, each with the log its child recorded', () => {
    const chain = semesterChain(record, '300')
    expect(chain.map((entry) => entry.view.index)).toEqual([0, 1, 2])
    expect(chain[0].log?.history).toEqual({ 3: { 0: 'spring day' } })
    expect(chain[1].log?.history).toEqual({ 5: { 1: 'fall night' } })
    expect(chain[2].log).toBeNull()
    // A sibling from the same ending is no part of the chain.
    expect(semesterChain(record, '201').map((entry) => entry.view.id)).toEqual([undefined, '201'])
  })

  it('counts every replay a log names as the record’s to keep', () => {
    expect([...recordReplayIds(record)]).toEqual(['f'.repeat(32)])
  })
})

describe('transfers', () => {
  const arrived = { ...profile(2, 'spring'), transferredAt: 41 }

  it('joins a semester’s transfers onto its roster once, and leaves a view with none as it is', () => {
    const view = semesterOf(playthroughRecord({ chars: ['a'], profiles: { a: profile(1) } }))
    expect(withTransfers(view, null)).toBe(view)
    expect(withTransfers(view, { transfers: [] })).toBe(view)

    const joined = withTransfers(view, {
      transfers: [
        { charId: 'm', profile: arrived },
        { charId: 'm', profile: arrived }
      ]
    })
    expect(joined.chars).toEqual(['a', 'm'])
    expect(joined.profiles.m).toEqual(arrived)
    // The record's own view is not written through.
    expect(view.chars).toEqual(['a'])
    expect(view.profiles.m).toBeUndefined()
  })

  it('lays the classes a transfer brought over the catalog, the record’s own left alone', () => {
    const catalog = { 'BIO 210': classEntry() }
    const view = semesterOf(playthroughRecord({ chars: ['a'], classes: catalog }))
    const hers = classEntry({ code: 'KNT 101', category: 'interest', slot: 3 })
    const joined = withTransfers(view, {
      transfers: [
        { charId: 'm', profile: arrived, classes: { 'KNT 101': hers } },
        { charId: 'n', profile: arrived }
      ]
    })
    expect(Object.keys(joined.classes).sort()).toEqual(['BIO 210', 'KNT 101'])
    expect(joined.classes['KNT 101']).toEqual(hers)
    expect(view.classes).toEqual(catalog)
    // Transfers who brought none keep the catalog object itself.
    expect(withTransfers(view, { transfers: [{ charId: 'n', profile: arrived }] }).classes).toBe(
      view.classes
    )
  })

  it('seats a finished semester’s transfers off the log its next semester holds', () => {
    const record = playthroughRecord({
      chars: ['a'],
      semesters: {
        '200': semester({
          chars: ['a', 'm'],
          before: {
            history: {},
            playerSchedule: {},
            events: [],
            transfers: [{ charId: 'm', profile: arrived }]
          }
        })
      }
    })
    const chain = semesterChain(record, '200')
    expect(chain[0].view.chars).toEqual(['a', 'm'])
    expect(chain[0].view.profiles.m).toEqual(arrived)
    expect(chain[1].view.chars).toEqual(['a', 'm'])
  })

  it('keeps her arrival out of the half a save carries', () => {
    const info = { ...charInfo(), transferredAt: 41 }
    expect(charStateOf(info)).not.toHaveProperty('transferredAt')
    expect(charProfileOf(info).transferredAt).toBe(41)
  })
})
