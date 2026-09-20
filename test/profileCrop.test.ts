import { describe, expect, it } from 'vitest'
import {
  activeProfileCrop,
  clampProfileCrop,
  clampProfileCropWithin,
  defaultProfileCrop,
  normalizeFaceBox,
  PROFILE_ASPECT,
  PROFILE_FACE_ASPECT,
  PROFILE_FACE_CENTRE,
  PROFILE_FRAME,
  PROFILE_MIN_WIDTH,
  PROFILE_REACH,
  profileStage
} from '@shared/profileCrop'
import { character } from './fixtures'

/**
 * Where a portrait is cut from a sprite. The frame comes from a *detected* box that bangs and
 * hands make smaller than the face, and is persisted: a crop that leaves the image is a portrait
 * of nothing, and one off the archway's ratio is stretched wherever it is shown.
 */

/** The sprite every character renders at. */
const W = 1160
const H = 1696

describe('normalizeFaceBox', () => {
  it('puts back the forehead a fringe took, about the box it found', () => {
    // A wide, short box is what blunt bangs leave: the width stands, the height grows.
    const grown = normalizeFaceBox({ x: 500, y: 200, width: 200, height: 150 })
    expect(grown.width).toBe(200)
    expect(grown.height).toBe(250)
    // Grown about its own centre, so the face has not moved.
    expect(grown.x + grown.width / 2).toBe(600)
    expect(grown.y + grown.height / 2).toBe(275)
  })

  it('widens a box a hand over one cheek left narrow', () => {
    const grown = normalizeFaceBox({ x: 500, y: 200, width: 100, height: 250 })
    expect(grown.width).toBe(200)
    expect(grown.height).toBe(250)
  })

  it('leaves a box already at the ratio alone', () => {
    const face = { x: 480, y: 180, width: 200, height: 200 * PROFILE_FACE_ASPECT }
    expect(normalizeFaceBox(face)).toEqual(face)
  })
})

describe('clampProfileCrop', () => {
  it('holds the archway ratio, whole pixels and the floor', () => {
    const crop = clampProfileCrop({ seed: 7, x: 10.4, y: 20.6, width: 301.2, height: 999 }, W, H)
    expect(crop).toEqual({ seed: 7, x: 10, y: 21, width: 301, height: Math.round(301 / PROFILE_ASPECT) })
    expect(clampProfileCrop({ seed: 7, x: 0, y: 0, width: 4, height: 4 }, W, H).width).toBe(
      PROFILE_MIN_WIDTH
    )
  })

  it('keeps the frame inside the sprite, whichever edge it left', () => {
    expect(clampProfileCrop({ seed: 1, x: -50, y: -50, width: 300, height: 360 }, W, H)).toMatchObject({
      x: 0,
      y: 0
    })
    const far = clampProfileCrop({ seed: 1, x: 9999, y: 9999, width: 300, height: 360 }, W, H)
    expect(far.x + far.width).toBe(W)
    expect(far.y + far.height).toBe(H)
  })

  it('caps a frame taller than the sprite rather than letting it hang off the bottom', () => {
    const crop = clampProfileCrop({ seed: 1, x: 0, y: 0, width: W, height: H }, W, H)
    expect(crop.height).toBeLessThanOrEqual(H)
    expect(crop.width).toBeLessThanOrEqual(W)
  })
})

describe('defaultProfileCrop', () => {
  it('frames the head off the face, with the crown its room above', () => {
    const face = { x: 500, y: 200, width: 160, height: 200 }
    const crop = defaultProfileCrop(face, W, H, 7)

    expect(crop.seed).toBe(7)
    // PROFILE_FRAME face heights tall, at the archway's ratio.
    expect(crop.height).toBe(Math.round(200 * PROFILE_FRAME))
    expect(crop.width / crop.height).toBeCloseTo(PROFILE_ASPECT, 2)
    // Centred on the face across — within the half pixel a whole-pixel width can leave.
    expect(Math.abs(crop.x + crop.width / 2 - 580)).toBeLessThanOrEqual(1)
    // The face's own centre sits where PROFILE_FACE_CENTRE puts it, which is the crown's room.
    expect((300 - crop.y) / crop.height).toBeCloseTo(PROFILE_FACE_CENTRE, 2)
  })

  it('reads two faces the same size the same way, whatever the fringe left', () => {
    // The same head, detected as bangs leave it and as a bare forehead leaves it.
    const bangs = defaultProfileCrop({ x: 500, y: 250, width: 200, height: 150 }, W, H, 1)
    const bare = defaultProfileCrop({ x: 500, y: 200, width: 200, height: 250 }, W, H, 1)
    expect(bangs.width).toBe(bare.width)
  })

  it('still frames a picture when the detector found nothing', () => {
    const crop = defaultProfileCrop(null, W, H, 3)
    expect(crop.width).toBeGreaterThan(PROFILE_MIN_WIDTH)
    expect(crop.x).toBeGreaterThanOrEqual(0)
    expect(crop.y + crop.height).toBeLessThanOrEqual(H)
    expect(Math.abs(crop.x + crop.width / 2 - W / 2)).toBeLessThanOrEqual(1)
  })
})

describe('profileStage', () => {
  /** A frame her face asks for, somewhere across the sprite. */
  const facing = (centreX: number) =>
    clampProfileCrop({ seed: 1, x: centreX - 150, y: 120, width: 300, height: 360 }, W, H)

  it('is the sprite\u2019s top third at the archway ratio, so the largest frame is the window', () => {
    const stage = profileStage(facing(W / 2), W, H)
    expect(stage.y).toBe(0)
    expect(Math.abs(stage.height - H * PROFILE_REACH)).toBeLessThanOrEqual(1)
    expect(stage.width / stage.height).toBeCloseTo(PROFILE_ASPECT, 2)
    // A frame the size of the window is one the window can hold: it is what a full pull gives.
    expect(clampProfileCropWithin({ ...facing(W / 2), ...stage, seed: 1 }, stage)).toMatchObject({
      x: stage.x,
      y: stage.y,
      width: stage.width
    })
  })

  it('is centred on her face rather than on the sprite', () => {
    const face = facing(400)
    const stage = profileStage(face, W, H)
    expect(Math.abs(stage.x + stage.width / 2 - 400)).toBeLessThanOrEqual(1)
  })

  it('stays on the sprite when she is standing against an edge', () => {
    expect(profileStage(facing(40), W, H).x).toBe(0)
    const right = profileStage(facing(W - 40), W, H)
    expect(right.x + right.width).toBe(W)
  })
})

describe('clampProfileCropWithin', () => {
  const box = { x: 300, y: 0, width: 471, height: 565 }

  it('holds the frame inside the window, whichever edge it left', () => {
    expect(clampProfileCropWithin({ seed: 1, x: 0, y: -80, width: 200, height: 240 }, box)).toMatchObject({
      x: box.x,
      y: box.y
    })
    const far = clampProfileCropWithin({ seed: 1, x: 9999, y: 9999, width: 200, height: 240 }, box)
    expect(far.x + far.width).toBe(box.x + box.width)
    expect(far.y + far.height).toBe(box.y + box.height)
  })

  it('caps a frame larger than the window at the window', () => {
    const crop = clampProfileCropWithin({ seed: 1, x: 0, y: 0, width: 5000, height: 6000 }, box)
    expect(crop.width).toBeLessThanOrEqual(box.width)
    expect(crop.height).toBeLessThanOrEqual(box.height)
  })

  it('leaves a frame already inside it where it is', () => {
    const crop = { seed: 1, x: 380, y: 60, width: 200, height: 240 }
    expect(clampProfileCropWithin(crop, box)).toEqual(crop)
  })
})

describe('activeProfileCrop', () => {
  it('keeps a crop framed under the seed she still renders under', () => {
    const crop = { seed: 42, x: 1, y: 2, width: 300, height: 360 }
    expect(activeProfileCrop(character({ generationSeed: 42, profileCrop: crop }))).toBe(crop)
  })

  it('retires one framed around the face a regenerate replaced', () => {
    const crop = { seed: 41, x: 1, y: 2, width: 300, height: 360 }
    expect(activeProfileCrop(character({ generationSeed: 42, profileCrop: crop }))).toBeNull()
    expect(activeProfileCrop(character({ generationSeed: 42 }))).toBeNull()
  })
})
