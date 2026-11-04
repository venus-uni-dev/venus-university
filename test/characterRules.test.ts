import { describe, expect, it } from 'vitest'
import {
  blankSheet,
  isWritten,
  newCharacter,
  readCharacterRecord,
  withCharacterLora
} from '@shared/characterRules'
import { SUBJECT_TAGS } from '@shared/defaultTags'
import { EMOTIONS } from '@shared/emotions'
import { defaultSpriteScale } from '@shared/spriteScale'
import type { CharacterLoraBrief } from '@shared/types'
import { character } from './fixtures'

/**
 * `blankSheet` is the one place a Skip-LLM character becomes a sheet the player can open and
 * fill in by hand; a field it leaves wrong is one nothing downstream will ever catch.
 */

describe('blankSheet', () => {
  it('writes a blank, unbriefed sheet the player fills in by hand', () => {
    const character = newCharacter('Ann', 'Lee', SUBJECT_TAGS, {
      prompt: 'x',
      namesAreSuggestions: false,
      options: {},
      reference: false
    })

    const sheet = blankSheet(character, 'quiet', 'standing')

    expect(isWritten(sheet)).toBe(true)
    expect(sheet.personality).toBe('quiet')
    expect(sheet.pose).toBe('standing')
    expect(sheet.preferredStat).toBe('body')
    expect('brief' in sheet).toBe(false)
    for (const emotion of EMOTIONS) {
      expect(sheet.expressionTags[emotion].length).toBeGreaterThan(0)
    }
  })
})

/**
 * `withCharacterLora` is how the New Character modal's LoRA and its tags become her record, the
 * appearance every render opens with included; a group merged wrong is in every picture of her.
 */

describe('withCharacterLora', () => {
  const written = character({
    baseAppearance: ['1girl', 'mature_female', 'pink_hair', 'blue_eyes'],
    outfit: ['red_coat']
  })

  /** A brief for one LoRA, with only the tags the test gives it. */
  function brief(over: Partial<CharacterLoraBrief> = {}): CharacterLoraBrief {
    return {
      name: 'ana.safetensors',
      trigger: '',
      appearance: [],
      outfit: [],
      replace: true,
      ...over
    }
  }

  it('puts the trigger after the subject tags and replaces only the groups the player filled', () => {
    const merged = withCharacterLora(
      written,
      brief({ trigger: 'anav2', appearance: ['silver_hair'], weight: 0.8 }),
      SUBJECT_TAGS
    )
    expect(merged.baseAppearance).toEqual(['1girl', 'mature_female', 'anav2', 'silver_hair'])
    expect(merged.outfit).toEqual(['red_coat'])
    expect(merged.lora).toEqual({ name: 'ana.safetensors', weight: 0.8 })
    expect(merged.height).toBe(defaultSpriteScale(merged.baseAppearance))
  })

  it('puts the player tags in front of what was written where it adds, without repeats', () => {
    const merged = withCharacterLora(
      written,
      brief({ appearance: ['blue_eyes', 'freckles'], outfit: ['scarf'], replace: false, weight: 1 }),
      SUBJECT_TAGS
    )
    expect(merged.baseAppearance).toEqual([
      '1girl',
      'mature_female',
      'blue_eyes',
      'freckles',
      'pink_hair'
    ])
    expect(merged.outfit).toEqual(['scarf', 'red_coat'])
    // The default weight is no weight at all, so a later default reaches her.
    expect(merged.lora).toEqual({ name: 'ana.safetensors' })
  })
})

/**
 * `readCharacterRecord` is how a record an older build wrote reaches this one; one read wrong
 * is a silent corruption nothing downstream catches.
 */

describe('readCharacterRecord', () => {
  /** A written record at `schemaVersion`, with only the appearance the test gives her. */
  function stored(schemaVersion: number, baseAppearance: string[]): unknown {
    return { ...newCharacter('Ann', 'Lee', SUBJECT_TAGS), schemaVersion, baseAppearance }
  }

  it('reads a version-2 record as version 3, the subject tags in front of her appearance', () => {
    const { character, upgraded } = readCharacterRecord(stored(2, ['long_hair']), 'x')

    expect(upgraded).toBe(true)
    expect(character.schemaVersion).toBe(3)
    expect(character.baseAppearance).toEqual(['1girl', 'mature_female', 'long_hair'])
  })

  it('adds only the subject tags a version-2 record lacks', () => {
    const { character } = readCharacterRecord(stored(2, ['mature_female', 'long_hair']), 'x')

    expect(character.baseAppearance).toEqual(['1girl', 'mature_female', 'long_hair'])
  })

  it('leaves a version-3 record as it is', () => {
    const { character, upgraded } = readCharacterRecord(stored(3, ['long_hair']), 'x')

    expect(upgraded).toBe(false)
    expect(character.baseAppearance).toEqual(['long_hair'])
  })

  it('refuses a version-1 record by its version', () => {
    expect(() => readCharacterRecord(stored(1, ['long_hair']), 'x')).toThrowError(
      expect.objectContaining({ code: 'CHARACTER_SCHEMA_VERSION' })
    )
  })
})
