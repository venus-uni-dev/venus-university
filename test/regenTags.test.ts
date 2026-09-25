import { describe, expect, it } from 'vitest'
import { cgDraft, spriteDraft, type PromptEdit } from '@shared/imagePrompt'
import { withoutRegenEdits, withRegenEdit, withRegenTags } from '@shared/regenTags'
import { character } from './fixtures'

/**
 * A kept edit read into the wrong button's regenerate would render one wardrobe in another's
 * clothes, or another kind's groups altogether. A hand-edited entry that throws costs the
 * player the modal outright.
 */

const c = character()
const poseTags = ['arms_at_sides']

describe('withRegenTags', () => {
  it('opens on the kept edit whole', () => {
    const draft = spriteDraft(c, poseTags, 'pe')
    const kept = { ...draft, appearance: ['red_hair'], negative: [] }
    expect(withRegenTags(draft, kept)).toEqual(kept)
  })

  it('falls back to the draft for another wardrobe, another kind, or a non-object', () => {
    const draft = spriteDraft(c, poseTags, 'pe')
    const otherSet = { ...spriteDraft(c, poseTags, 'swim'), appearance: ['red_hair'] }
    expect(withRegenTags(draft, otherSet)).toEqual(draft)

    const otherKind: PromptEdit = { kind: 'expression', expression: ['x'] }
    expect(withRegenTags(draft, otherKind)).toEqual(draft)

    expect(withRegenTags(draft, 'broken')).toEqual(draft)
    expect(withRegenTags(draft, null)).toEqual(draft)
  })

  it('falls back one group at a time, and carries no group the kind lacks', () => {
    const draft = cgDraft(c, 'sex')
    const stored = {
      kind: 'cg',
      base: 'masterpiece',
      appearance: ['red_hair', 3],
      position: ['kept'],
      outfit: ['stray']
    }
    const result = withRegenTags(draft, stored)
    expect(result).toEqual({ ...draft, position: ['kept'] })
    expect('outfit' in result).toBe(false)
  })
})

describe('withRegenEdit / withoutRegenEdits', () => {
  it('keeps each button’s own entry, forgets only the ones asked for, and drops the field at none', () => {
    const happyEdit: PromptEdit = { kind: 'expression', expression: ['happy'] }
    const cgsEdit: PromptEdit = { kind: 'cgs', base: ['masterpiece'], appearance: [], negative: [] }

    let held = withRegenEdit(c, 'expression:happy', happyEdit)
    held = withRegenEdit(held, 'cgs', cgsEdit)
    expect(held.regenTags).toEqual({ 'expression:happy': happyEdit, cgs: cgsEdit })

    const afterOne = withoutRegenEdits(held, ['cgs'])
    expect(afterOne.regenTags).toEqual({ 'expression:happy': happyEdit })

    const afterAll = withoutRegenEdits(afterOne, ['expression:happy'])
    expect('regenTags' in afterAll).toBe(false)
  })
})
