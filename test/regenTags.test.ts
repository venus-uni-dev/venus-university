import { describe, expect, it } from 'vitest'
import { SHIPPED_DEFAULT_TAGS as tags, type DefaultTags } from '@shared/defaultTags'
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
    const draft = spriteDraft(c, poseTags, 'pe', tags)
    const kept = { ...draft, appearance: ['red_hair'], negative: [] }
    expect(withRegenTags(draft, kept, tags)).toEqual(kept)
  })

  it('falls back to the draft for another wardrobe, another kind, or a non-object', () => {
    const draft = spriteDraft(c, poseTags, 'pe', tags)
    const otherSet = { ...spriteDraft(c, poseTags, 'swim', tags), appearance: ['red_hair'] }
    expect(withRegenTags(draft, otherSet, tags)).toEqual(draft)

    const otherKind: PromptEdit = { kind: 'expression', expression: ['x'] }
    expect(withRegenTags(draft, otherKind, tags)).toEqual(draft)

    expect(withRegenTags(draft, 'broken', tags)).toEqual(draft)
    expect(withRegenTags(draft, null, tags)).toEqual(draft)
  })

  it('falls back one group at a time, and carries no group the kind lacks', () => {
    const draft = cgDraft(c, 'sex', tags)
    const stored = {
      kind: 'cg',
      base: 'masterpiece',
      appearance: ['red_hair', 3],
      position: ['kept'],
      outfit: ['stray']
    }
    const result = withRegenTags(draft, stored, tags)
    expect(result).toEqual({ ...draft, position: ['kept'] })
    expect('outfit' in result).toBe(false)
  })
})

describe('withRegenEdit / withoutRegenEdits', () => {
  it('keeps each button’s own entry, forgets only the ones asked for, and drops the field at none', () => {
    const happyEdit: PromptEdit = { kind: 'expression', expression: ['happy'] }
    const cgsEdit: PromptEdit = { kind: 'cgs', base: ['masterpiece'], appearance: [], negative: [] }

    let held = withRegenEdit(c, 'expression:happy', happyEdit, tags)
    held = withRegenEdit(held, 'cgs', cgsEdit, tags)
    const cgsKept = {
      ...cgsEdit,
      sentDefaults: {
        base: [...tags.quality, ...tags.cg],
        negative: [...tags.negative]
      }
    }
    expect(held.regenTags).toEqual({ 'expression:happy': happyEdit, cgs: cgsKept })

    const afterOne = withoutRegenEdits(held, ['cgs'])
    expect(afterOne.regenTags).toEqual({ 'expression:happy': happyEdit })

    const afterAll = withoutRegenEdits(afterOne, ['expression:happy'])
    expect('regenTags' in afterAll).toBe(false)
  })
})

/**
 * A kept Base or Negative group holds the default tags it was sent with; read back as kept after
 * the player changes them, every regenerate that kept anything would go on sending the old ones.
 */

describe('withRegenTags — the default tags', () => {
  const changed: DefaultTags = {
    ...tags,
    quality: ['score_9', 'masterpiece'],
    negative: ['score_4']
  }

  it('swaps an older entry’s shipped defaults for the ones in force, the player’s own kept', () => {
    const draft = spriteDraft(c, poseTags, 'pe', changed)
    const sent = spriteDraft(c, poseTags, 'pe', tags)
    // Sent before the defaults moved: one taken out, one added, and a negative of the player's.
    const kept = {
      ...sent,
      base: sent.base.filter((tag) => tag !== 'masterpiece').concat('absurdres'),
      negative: [...sent.negative, 'bag']
    }
    const opened = withRegenTags(draft, kept, changed)
    expect(opened.kind === 'sprite' && opened.base).toEqual([
      'score_9',
      ...tags.sprite,
      'absurdres'
    ])
    expect(opened.kind === 'sprite' && opened.negative).toEqual([
      'score_4',
      ...tags.spriteNegative,
      'bag'
    ])
  })

  it('reads an entry against the defaults it says it was sent with, and leaves it be unchanged', () => {
    const draft = cgDraft(c, 'sex', changed)
    const kept = withRegenEdit(c, 'cg:sex', { ...draft, base: [...draft.base, 'x'] }, changed)
      .regenTags?.['cg:sex']
    expect(withRegenTags(draft, kept, changed)).toEqual({ ...draft, base: [...draft.base, 'x'] })

    const back = withRegenTags(cgDraft(c, 'sex', tags), kept, tags)
    expect(back.kind === 'cg' && back.base).toEqual([...tags.quality, ...tags.cg, 'x'])
  })
})
