import { describe, expect, it } from 'vitest'
import { AFTER_TAG, customCgAfterEdit } from '@shared/customCgs'
import { SHIPPED_DEFAULT_TAGS as tags } from '@shared/defaultTags'
import { EMOTIONS } from '@shared/emotions'
import {
  buildBasePrompt,
  buildCgPrompt,
  buildImagePrompt,
  buildOutfitBasePrompt,
  cgDraft,
  cgSetDraft,
  expressionDraft,
  spriteDraft
} from '@shared/imagePrompt'
import { STOCK_OUTFIT_SETS } from '@shared/outfits'
import { STOCK_POSITIONS } from '@shared/positions'
import type { Emotion } from '@shared/types'
import { character } from './fixtures'

/**
 * A regenerate hands a builder the modal's tag groups in place of the character's, so a builder
 * given back its own unedited draft has to render exactly what it renders unedited. A group read
 * from the wrong half of the edit would degrade every edited render with nothing to show for it.
 */

/** A tag list per group and per emotion, each one distinct, so no two can be confused. */
const expressionTags = {} as Record<Emotion, string[]>
for (const emotion of EMOTIONS) expressionTags[emotion] = ['open_mouth', 'blush', `${emotion}_face`]
expressionTags.neutral = ['sideways_glance', 'neutral_face']

const c = character({
  baseAppearance: ['silver_hair', 'green_eyes'],
  outfit: ['white_blouse', 'pleated_skirt'],
  peOutfit: ['navy_buruma', 'buruma'],
  swimOutfit: ['red_bikini', 'bikini'],
  expressionTags,
  negativeTags: ['extra_fingers', 'watermark'],
  customCgs: { customcg1: { tags: ['doggystyle', 'from_behind'] } }
})

const poseTags = ['arms_at_sides', 'looking_ahead']

describe("the draft is the builder's default", () => {
  it('renders the default base frame the same under its own draft', () => {
    expect(buildBasePrompt(c, poseTags, tags, spriteDraft(c, poseTags, null, tags))).toEqual(
      buildBasePrompt(c, poseTags, tags)
    )
  })

  it('renders every wardrobe base frame the same under that set’s draft', () => {
    for (const set of [...STOCK_OUTFIT_SETS, 'custom1', 'custom12'] as const) {
      expect(
        buildOutfitBasePrompt(c, poseTags, set, tags, spriteDraft(c, poseTags, set, tags))
      ).toEqual(buildOutfitBasePrompt(c, poseTags, set, tags))
    }
  })

  it('renders every expression the same under either draft a face pass is edited by', () => {
    for (const emotion of EMOTIONS) {
      const plain = buildImagePrompt(c, poseTags, emotion, tags)
      expect(
        buildImagePrompt(c, poseTags, emotion, tags, spriteDraft(c, poseTags, null, tags))
      ).toEqual(plain)
      expect(buildImagePrompt(c, poseTags, emotion, tags, expressionDraft(c, emotion))).toEqual(
        plain
      )
    }
  })

  it('renders every CG the same under its own draft and under the set’s', () => {
    for (const position of [...STOCK_POSITIONS, 'customcg1', 'customcg12_after'] as const) {
      const plain = buildCgPrompt(c, position, poseTags, tags)
      expect(buildCgPrompt(c, position, poseTags, tags, cgDraft(c, position, tags))).toEqual(plain)
      expect(buildCgPrompt(c, position, poseTags, tags, cgSetDraft(c, tags))).toEqual(plain)
    }
  })

  it('a builder ignores an edit of another kind', () => {
    expect(buildBasePrompt(c, poseTags, tags, expressionDraft(c, 'happy'))).toEqual(
      buildBasePrompt(c, poseTags, tags)
    )
    expect(buildCgPrompt(c, 'sex', poseTags, tags, spriteDraft(c, poseTags, null, tags))).toEqual(
      buildCgPrompt(c, 'sex', poseTags, tags)
    )
  })
})

describe('a custom CG pair', () => {
  it('draws its after from its main with the after tag added once', () => {
    expect(cgDraft(c, 'customcg1', tags).position).toEqual(['doggystyle', 'from_behind'])
    expect(cgDraft(c, 'customcg1_after', tags)).toEqual(
      customCgAfterEdit(cgDraft(c, 'customcg1', tags), c)
    )

    const tagged = character({ customCgs: { customcg1: { tags: ['doggystyle', AFTER_TAG] } } })
    expect(cgDraft(tagged, 'customcg1_after', tags).position).toEqual(['doggystyle', AFTER_TAG])
  })

  it('carries the after tag to the face detailer, aroused in the main and happy after', () => {
    expect(buildCgPrompt(c, 'customcg1_after', poseTags, tags).detailerPositive).toContain(
      AFTER_TAG
    )
    expect(buildCgPrompt(c, 'customcg1', poseTags, tags).detailerPositive).not.toContain(
      AFTER_TAG
    )
    expect(cgDraft(c, 'customcg1', tags).expression).toEqual(expressionTags.aroused)
    expect(cgDraft(c, 'customcg1_after', tags).expression).toEqual(expressionTags.happy)
    expect(cgDraft(c, 'sex_after', tags).expression).toEqual(expressionTags.happy)
  })
})
