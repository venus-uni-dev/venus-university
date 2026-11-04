import { describe, expect, it } from 'vitest'
import {
  editLocksOf,
  milestonesOfFlags,
  normalizedEditMilestones,
  withEditMilestone,
  withMilestonesEdited,
  type EditMilestones,
  type EditStanding
} from '@shared/milestoneEdit'
import { emptyFlags } from '@shared/relationship'
import type { CharFlags, CharInfo } from '@shared/types'
import { character, charInfo } from './fixtures'

const TODAY = 40
const standing: EditStanding = { affection: 20, character: character(), planAhead: false }

/** A girl whose flags stand as given, and the boxes the edit opens on for her. */
function girl(flags: Partial<CharFlags>, over: Partial<CharInfo> = {}): {
  info: CharInfo
  opened: EditMilestones
} {
  const info = charInfo({ flags: { ...emptyFlags(), hasMet: true, ...flags }, ...over })
  return { info, opened: normalizedEditMilestones(milestonesOfFlags(info.flags), standing) }
}

describe('a hand edit writes only the boxes the player changed', () => {
  it('leaves an ex who shares as she was but for the kiss, and files the kiss', () => {
    const { info, opened } = girl(
      { brokenUp: 1, harem: true, gaveContactInfo: true },
      { datingSince: 5, brokeUpOn: 20 }
    )
    const edited = withMilestonesEdited(info, opened, { ...opened, kissed: true }, TODAY)
    expect(edited.flags).toMatchObject({ hasKissed: true, harem: true, brokenUp: 1 })
    expect(edited).toMatchObject({ datingSince: 5, brokeUpOn: 20 })
    expect(edited.memories).toEqual([
      { date: TODAY, type: 'loved', desc: 'the reader kissed her for the first time' }
    ])
  })
})

describe('a hand-set relationship starts and ends as the game would', () => {
  it('lovers ticked dates it today, voids every lesser arrangement and is told as new', () => {
    const { info, opened } = girl(
      { hasCrush: true, friendZoned: true, hadSex: true, hasKissed: true, benefits: true, brokenUp: 1 },
      { brokeUpOn: 10, leftFor: 'other' }
    )
    const picked = withEditMilestone(opened, 'lovers', true, standing)
    const edited = withMilestonesEdited(info, opened, picked, TODAY)
    expect(edited.flags).toMatchObject({
      isLover: true,
      hasCrush: false,
      friendZoned: false,
      friendZonedBy: false,
      benefits: false
    })
    expect(edited.datingSince).toBe(TODAY)
    expect(edited.brokeUpOn).toBeUndefined()
    expect(edited.leftFor).toBeUndefined()
    expect(edited.romanceScenes).toBe(0)

    const graduate = girl({}, { pursuing: 'law school' })
    const gone = withMilestonesEdited(
      graduate.info,
      graduate.opened,
      { ...graduate.opened, lovers: true },
      TODAY
    )
    expect(gone.flags.isLover).toBe(true)
    expect(gone.romanceScenes).toBeUndefined()
  })

  it('lovers cleared with broke up ticked is a breakup, and cleared alone never was', () => {
    const { info, opened } = girl({ isLover: true }, { datingSince: 5, romanceScenes: 0 })

    const ended = withMilestonesEdited(
      info,
      opened,
      { ...opened, lovers: false, broke_up: true },
      TODAY
    )
    expect(ended.flags).toMatchObject({ isLover: false, brokenUp: 1 })
    expect(ended).toMatchObject({ datingSince: 5, brokeUpOn: TODAY })
    expect(ended.romanceScenes).toBeUndefined()
    expect(ended.memories).toEqual([
      { date: TODAY, type: 'hated', desc: 'things ended between the reader and her' }
    ])

    const never = withMilestonesEdited(info, opened, { ...opened, lovers: false }, TODAY)
    expect(never.flags).toMatchObject({ isLover: false, brokenUp: 0 })
    expect(never.datingSince).toBeUndefined()
    expect(never.brokeUpOn).toBeUndefined()
    expect(never.memories).toEqual([])
  })
})

describe('the edit keeps a game being played consistent', () => {
  it('frees sharing, holds a crush off below nothing, a number with a plan ahead, a block on a number', () => {
    const { opened } = girl({})
    expect(editLocksOf(opened, standing).agreed_to_harem).toBeUndefined()
    expect(editLocksOf(opened, { ...standing, affection: -3 }).crush).toBe(false)
    expect(editLocksOf(opened, { ...standing, planAhead: true }).contact).toBe(true)
    expect(editLocksOf(opened, standing).blocked).toBe(false)
    expect(editLocksOf({ ...opened, contact: true }, standing).blocked).toBeUndefined()
  })
})
