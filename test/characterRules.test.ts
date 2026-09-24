import { describe, expect, it } from 'vitest'
import { blankSheet, isWritten, newCharacter } from '@shared/characterRules'
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
