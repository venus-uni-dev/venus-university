import { describe, expect, it } from 'vitest'
import { MALE_SUBJECT_TAGS, SUBJECT_TAGS } from '@shared/defaultTags'
import type { PoseManifest } from '@shared/types'
import {
  draftToCharacter,
  missingRequiredFields,
  type CharacterDraft
} from '../src/renderer/prompts/characterPrompt'
import { character } from './fixtures'

/**
 * `draftToCharacter` writes straight to `character.json`: a value that should have been
 * filtered out is on disk for the life of the playthrough and nothing downstream catches it.
 */

const POSES: PoseManifest = {
  standing: { tags: ['standing'], description: 'standing upright, arms at her sides' }
}

function draft(over: Partial<CharacterDraft> = {}): CharacterDraft {
  return {
    firstName: 'Sarah',
    lastName: 'Rose',
    personality: 'warm',
    behavior: {
      withStrangers: 'polite',
      withFriends: 'warm',
      withCrush: 'shy',
      withLover: 'doting',
      withEnemy: 'cold'
    },
    backstory: 'behind the counter of her family bakery',
    datingHistory: 'one long relationship that ended badly',
    datingPreference: 'She wants something that lasts',
    kinks: 'She fantasizes about being praised',
    isVirgin: false,
    attractedToMale: true,
    attractedToFemale: false,
    likes: ['quiet mornings'],
    dislikes: ['being interrupted'],
    giftPreferences: { liked: ['cozy'], disliked: ['edgy'] },
    traits: [],
    preferredStat: 'brain',
    appearance: {
      hairColor: 'brown',
      eyeColor: 'green',
      hairShade: [],
      eyeShade: [],
      hairLength: 'long',
      hairTexture: 'straight',
      hairStyle: [],
      hairBangs: [],
      headAccessories: [],
      makeup: [],
      breastSize: [],
      skin: []
    },
    outfit: ['coat'],
    peOutfit: ['buruma'],
    swimOutfit: ['bikini'],
    pose: 'standing',
    expressions: {
      neutral: ['smile'],
      happy: ['smile'],
      sad: ['frown'],
      angry: ['scowl'],
      surprised: ['open_mouth'],
      embarrassed: ['blush'],
      aroused: ['bedroom_eyes']
    },
    roomPrompt: 'with fairy lights.',
    voice: 'medium',
    ...over
  }
}

const flatten = (over: Partial<CharacterDraft> = {}) =>
  draftToCharacter(character(), draft(over), POSES, SUBJECT_TAGS)

describe('draftToCharacter', () => {
  /** A value nothing branches on is not a preference — the `traits` rule. */
  it('drops a category outside the vocabulary rather than storing a dead value', () => {
    const filled = flatten({
      giftPreferences: { liked: ['cozy', 'wholesome'], disliked: ['Edgy', ''] }
    })
    expect(filled.giftPreferences).toEqual({ liked: ['cozy'], disliked: [] })
  })

  /** Charm on anything outside the vocabulary, rather than a stat no gate can read. */
  it('falls back to charm on a stat the vocabulary does not know', () => {
    expect(flatten({ preferredStat: 'Brain' }).preferredStat).toBe('heart')
    expect(flatten({ preferredStat: '' }).preferredStat).toBe('heart')
  })

  /** Absent is centre, so the centre tier and a word nobody knows both write nothing. */
  it('turns a voice tier into a pitch and leaves a centred one off the character', () => {
    expect(flatten({ voice: 'low' }).voicePitch).toBe(-0.5)
    expect('voicePitch' in flatten({ voice: 'sultry' })).toBe(false)
  })

  /** Absent is the other gender alone, so that answer and an answer of nobody write nothing. */
  it('writes her sexuality only where it is not the other gender alone', () => {
    expect('attractedTo' in flatten()).toBe(false)
    expect('attractedTo' in flatten({ attractedToMale: false })).toBe(false)
    expect(flatten({ attractedToFemale: true }).attractedTo).toEqual({ female: true, male: true })
    const base = character({ attractedTo: { female: true, male: true } })
    expect('attractedTo' in draftToCharacter(base, draft(), POSES, SUBJECT_TAGS)).toBe(false)
  })

  /** The brief is what an unwritten record is resumed from, and this write is the sheet. */
  it('drops the brief the record was created with', () => {
    const base = character({
      pose: '',
      brief: { prompt: 'a baker', namesAreSuggestions: false, options: {}, reference: true }
    })
    expect('brief' in draftToCharacter(base, draft(), POSES, SUBJECT_TAGS)).toBe(false)
  })

  it('never lets one category sit on both lists', () => {
    const filled = flatten({ giftPreferences: { liked: ['cozy'], disliked: ['cozy', 'edgy'] } })
    expect(filled.giftPreferences).toEqual({ liked: ['cozy'], disliked: ['edgy'] })
  })

  /**
   * His sheet is what every render and prompt reads his gender and build off: a breast tag, a
   * girl's swimsuit or a girl's pose written here draws him wrong for the life of the record.
   */
  it('writes a guy as one, with no breast or makeup tag, his swimwear and a pose of his own', () => {
    const poses: PoseManifest = {
      ...POSES,
      male_bold: { tags: ['standing'], description: 'legs apart', gender: 'male' }
    }
    const filled = draftToCharacter(
      character({ gender: 'male' }),
      draft({
        appearance: {
          ...draft().appearance,
          makeup: ['eyeshadow'],
          breastSize: ['big'],
          facialHair: ['stubble', 'beard'],
          build: ['bishounen', 'muscular_male']
        }
      }),
      poses,
      MALE_SUBJECT_TAGS
    )
    expect(filled.gender).toBe('male')
    expect(filled.baseAppearance.slice(0, MALE_SUBJECT_TAGS.length)).toEqual(MALE_SUBJECT_TAGS)
    expect(filled.baseAppearance).toContain('stubble')
    expect(filled.baseAppearance).not.toContain('beard')
    expect(filled.baseAppearance).toContain('bishounen')
    expect(filled.baseAppearance).not.toContain('muscular_male')
    expect(filled.height).toBe(1.03)
    expect(filled.baseAppearance.some((tag) => tag.includes('breasts') || tag === 'eyeshadow')).toBe(
      false
    )
    // Every guy's swimwear is the same: the draft's bikini is dropped.
    expect(filled.swimOutfit).toEqual(['bare_legs', 'bare_feet', 'topless_male', 'male_swimwear'])
    // The draft's girl's pose is not his to stand in.
    expect(filled.pose).toBe('male_bold')
  })
})

describe('missingRequiredFields', () => {
  /**
   * Gated on the liked half alone: a girl no present can please has a mechanic
   * that can never fire for her, where one nothing offends is ordinary.
   */
  it('refuses a character with nothing she would be glad to receive', () => {
    const filled = flatten({ giftPreferences: { liked: [], disliked: ['edgy'] } })
    expect(missingRequiredFields(filled, SUBJECT_TAGS)).toContain('gift preferences')
  })
})
