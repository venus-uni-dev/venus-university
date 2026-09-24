import { describe, expect, it } from 'vitest'
import { blankSheet, isWritten, newCharacter, readCharacterRecord } from '@shared/characterRules'
import { EMOTIONS } from '@shared/emotions'

/**
 * `blankSheet` is the one place a Skip-LLM character becomes a sheet the player can open and
 * fill in by hand; a field it leaves wrong is one nothing downstream will ever catch.
 */

describe('blankSheet', () => {
  it('writes a blank, unbriefed sheet the player fills in by hand', () => {
    const character = newCharacter('Ann', 'Lee', {
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
 * `readCharacterRecord` is how a record an older build wrote reaches this one; one read wrong
 * is a silent corruption nothing downstream catches.
 */

describe('readCharacterRecord', () => {
  /** A written record at `schemaVersion`, with only the appearance the test gives her. */
  function stored(schemaVersion: number, baseAppearance: string[]): unknown {
    return { ...newCharacter('Ann', 'Lee'), schemaVersion, baseAppearance }
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
