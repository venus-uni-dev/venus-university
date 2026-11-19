import { describe, expect, it } from 'vitest'
import {
  charStartOf,
  emptyGirl,
  emptyStartMilestones,
  startDispositionOf,
  type ApplicationGirl,
  type StartMilestones
} from '@shared/application'
import { character } from './fixtures'

/**
 * Where a girl stands with the reader as the first save opens, off what the Profiles screen set:
 * a milestone that contradicts another, a memory filed in the wrong voice or order, or a date
 * dropped, is a start quietly unlike the one set up.
 */

const plain = character()

/** A girl with the given memories and milestones over nothing set. */
function girlOf(
  memories: ApplicationGirl['memories'],
  milestones: Partial<StartMilestones> = {}
): ApplicationGirl {
  return { ...emptyGirl(), memories, milestones: { ...emptyStartMilestones(), ...milestones } }
}

describe('a girl the reader knows before the semester', () => {
  it('starts with her memories filed, met and named, her milestones and her number', () => {
    const girl = girlOf(
      [
        { date: -3, type: 'loved', desc: 'you walked her home' },
        { date: -40, type: 'liked', desc: '  the reader lent her a book ' },
        { date: -2, type: 'liked', desc: '   ' }
      ],
      { sex: true, crush: true, contact: true }
    )
    const start = charStartOf(girl, plain, 'he')

    // Oldest first, in the reader's voice, the one with no words left out.
    expect(start?.memories).toEqual([
      { date: -40, type: 'liked', desc: 'the reader lent her a book' },
      { date: -3, type: 'loved', desc: 'the reader walked her home' }
    ])
    expect(start?.nameKnown).toBe(true)
    expect(start?.flags).toMatchObject({
      hasMet: true,
      hadSex: true,
      hasKissed: true,
      benefits: true,
      hasCrush: true,
      gaveContactInfo: true,
      isLover: false
    })
    expect(start?.datingSince).toBeUndefined()
    expect(startDispositionOf(girl, plain)).toBe('neutral')
  })

  it('holds no crush below nothing, and dates a lover, an ex and one back together', () => {
    const hated = girlOf([{ date: -1, type: 'hated', desc: 'he lied' }], { crush: true })
    expect(charStartOf(hated, plain, 'he')?.flags.hasCrush).toBe(false)

    const lover = charStartOf(
      girlOf([], { met: true, lovers: true, crush: true, datingSince: -100 }),
      plain,
      'he'
    )
    expect(lover).toMatchObject({
      datingSince: -100,
      flags: { isLover: true, hasCrush: false, knowsLoveLife: true }
    })
    expect(lover?.brokeUpOn).toBeUndefined()

    const ex = charStartOf(
      girlOf([], { met: true, broke_up: true, brokeUpOn: -20, datingSince: -90 }),
      plain,
      'he'
    )
    expect(ex).toMatchObject({ brokeUpOn: -20, flags: { brokenUp: 1, isLover: false } })
    expect(ex?.datingSince).toBeUndefined()

    // Back together after a breakup: dated from the default day, no longer an ex.
    const again = charStartOf(
      girlOf([], { met: true, broke_up: true, lovers: true, brokeUpOn: -20 }),
      plain,
      'he'
    )
    expect(again).toMatchObject({ datingSince: -1, flags: { brokenUp: 1, isLover: true } })
    expect(again?.brokeUpOn).toBeUndefined()
  })

  it('is a stranger with nothing set, or with her number and nothing else', () => {
    expect(charStartOf(undefined, plain, 'he')).toBeNull()
    expect(charStartOf(emptyGirl(), plain, 'he')).toBeNull()
    expect(charStartOf(girlOf([], { contact: true, kissed: true }), plain, 'he')).toBeNull()
  })
})
