import { describe, expect, it } from 'vitest'
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
import { OUTFIT_SETS } from '@shared/outfits'
import { POSITIONS } from '@shared/positions'
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
  negativeTags: ['extra_fingers', 'watermark']
})

const poseTags = ['arms_at_sides', 'looking_ahead']

describe("the draft is the builder's default", () => {
  it('renders the default base frame the same under its own draft', () => {
    expect(buildBasePrompt(c, poseTags, spriteDraft(c, poseTags, null))).toEqual(
      buildBasePrompt(c, poseTags)
    )
  })

  it('renders every wardrobe base frame the same under that set’s draft', () => {
    for (const set of OUTFIT_SETS) {
      expect(buildOutfitBasePrompt(c, poseTags, set, spriteDraft(c, poseTags, set))).toEqual(
        buildOutfitBasePrompt(c, poseTags, set)
      )
    }
  })

  it('renders every expression the same under either draft a face pass is edited by', () => {
    for (const emotion of EMOTIONS) {
      const plain = buildImagePrompt(c, poseTags, emotion)
      expect(buildImagePrompt(c, poseTags, emotion, spriteDraft(c, poseTags, null))).toEqual(plain)
      expect(buildImagePrompt(c, poseTags, emotion, expressionDraft(c, emotion))).toEqual(plain)
    }
  })

  it('renders every CG the same under its own draft and under the set’s', () => {
    for (const position of POSITIONS) {
      const plain = buildCgPrompt(c, position, poseTags)
      expect(buildCgPrompt(c, position, poseTags, cgDraft(c, position))).toEqual(plain)
      expect(buildCgPrompt(c, position, poseTags, cgSetDraft(c))).toEqual(plain)
    }
  })

  it('a builder ignores an edit of another kind', () => {
    expect(buildBasePrompt(c, poseTags, expressionDraft(c, 'happy'))).toEqual(
      buildBasePrompt(c, poseTags)
    )
    expect(buildCgPrompt(c, 'sex', poseTags, spriteDraft(c, poseTags, null))).toEqual(
      buildCgPrompt(c, 'sex', poseTags)
    )
  })
})
