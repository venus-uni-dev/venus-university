/**
 * Where a character's portrait is cut out of her neutral sprite. Pure arithmetic over a
 * detected face; the decode-crop-encode that executes it lives in `main/services/profileService.ts`,
 * and the modal that overrides it in `views/ProfilePictureModal.tsx`.
 */

import type { Character, ProfileCrop } from './types'
import type { LineupBox } from './lineup'

/** The archway's ratio, which every portrait in the app is shown in. */
export const PROFILE_ASPECT = 5 / 6

/** Small enough that a bad detection is still a picture, large enough to be one. */
export const PROFILE_MIN_WIDTH = 64

/**
 * The tallest a face may be measured relative to its width. The detector returns only visible
 * skin, so this ratio restores what bangs or a covering hand cut from the box.
 */
export const PROFILE_FACE_ASPECT = 1.25

/**
 * How tall the frame is in face heights, and where the face's centre sits down it: about five
 * sixths to the crown, chin near the bottom — calibrated off the shipped cast's faces, measured
 * at 169–190px on a 1160x1696 sprite. **This decides how close every avatar's camera stands**,
 * down to 18px, so a portrait framed for a card would be a smudge on a badge.
 */
export const PROFILE_FRAME = 1.84
export const PROFILE_FACE_CENTRE = 0.5

/**
 * The face a sprite with no usable mask is framed as, as shares of the sprite: centred, and
 * the size and place the shipped cast's median sits at. A detection can fail; a portrait may
 * not.
 */
const FALLBACK_FACE = { centreX: 0.5, centreY: 0.134, height: 0.106 } as const

/**
 * The face box as the frame should read it: at least {@link PROFILE_FACE_ASPECT} tall for its
 * width and no narrower than that ratio allows, grown about its own centre so the face stays
 * where it was found.
 */
export function normalizeFaceBox(face: LineupBox): LineupBox {
  const height = Math.max(face.height, face.width * PROFILE_FACE_ASPECT)
  const width = Math.max(face.width, face.height / PROFILE_FACE_ASPECT)
  return {
    x: face.x + face.width / 2 - width / 2,
    y: face.y + face.height / 2 - height / 2,
    width,
    height
  }
}

/** Onto whole pixels, at the archway's ratio, no smaller than the floor and inside the image. */
export function clampProfileCrop(
  crop: ProfileCrop,
  imageWidth: number,
  imageHeight: number
): ProfileCrop {
  // The width is the one dimension carried: the height follows the ratio, so a rounding step
  // can never leave the two disagreeing about the shape.
  const maxWidth = Math.min(imageWidth, imageHeight * PROFILE_ASPECT)
  const width = Math.round(
    Math.min(maxWidth, Math.max(Math.min(PROFILE_MIN_WIDTH, maxWidth), crop.width))
  )
  const height = Math.round(width / PROFILE_ASPECT)
  return {
    seed: crop.seed,
    x: Math.round(Math.min(Math.max(0, crop.x), imageWidth - width)),
    y: Math.round(Math.min(Math.max(0, crop.y), imageHeight - height)),
    width,
    height
  }
}

/**
 * The frame a face asks for: {@link PROFILE_FRAME} of its normalized height, centred on it
 * across and hung so the face sits {@link PROFILE_FACE_CENTRE} of the way down.
 */
export function defaultProfileCrop(
  face: LineupBox | null,
  imageWidth: number,
  imageHeight: number,
  seed: number
): ProfileCrop {
  const fallbackHeight = imageHeight * FALLBACK_FACE.height
  const found = normalizeFaceBox(
    face ?? {
      width: fallbackHeight / PROFILE_FACE_ASPECT,
      height: fallbackHeight,
      x: imageWidth * FALLBACK_FACE.centreX - fallbackHeight / PROFILE_FACE_ASPECT / 2,
      y: imageHeight * FALLBACK_FACE.centreY - fallbackHeight / 2
    }
  )

  const height = found.height * PROFILE_FRAME
  const width = height * PROFILE_ASPECT
  return clampProfileCrop(
    {
      seed,
      x: found.x + found.width / 2 - width / 2,
      y: found.y + found.height / 2 - height * PROFILE_FACE_CENTRE,
      width,
      height
    },
    imageWidth,
    imageHeight
  )
}

/**
 * The crop she is actually wearing: one framed under a stale seed is a frame around another
 * girl's face, so a regenerate retires it without anything deleting it.
 */
export function activeProfileCrop(character: Character): ProfileCrop | null {
  const crop = character.profileCrop
  return crop && crop.seed === character.generationSeed ? crop : null
}

/**
 * How far down the sprite the frame is offered. A portrait is a head, and the top third of
 * a full-body sprite is where every head is: showing the whole of her to frame one is two thirds
 * legs, and it makes the frame small in a big picture.
 */
export const PROFILE_REACH = 1 / 3

/**
 * The window the crop modal shows: {@link PROFILE_REACH} of the sprite tall, at the archway's
 * own ratio, so the largest frame the player can pull is the window exactly. Centred on the
 * suggested face rather than the sprite, since a girl standing off-centre still frames her head.
 */
export function profileStage(
  suggested: ProfileCrop,
  imageWidth: number,
  imageHeight: number
): LineupBox {
  const height = Math.round(imageHeight * PROFILE_REACH)
  const width = height * PROFILE_ASPECT
  // The frame's own clamp does the work: whole pixels, the ratio, and inside the sprite across.
  const { x, y, width: w, height: h } = clampProfileCrop(
    {
      seed: 0,
      x: suggested.x + suggested.width / 2 - width / 2,
      y: 0,
      width,
      height
    },
    imageWidth,
    imageHeight
  )
  return { x, y, width: w, height: h }
}

/**
 * {@link clampProfileCrop} read inside a box rather than inside the image: the frame may not
 * leave the window it is being pulled in, which is what makes the window the largest frame.
 */
export function clampProfileCropWithin(crop: ProfileCrop, box: LineupBox): ProfileCrop {
  const local = clampProfileCrop(
    { ...crop, x: crop.x - box.x, y: crop.y - box.y },
    box.width,
    box.height
  )
  return { ...local, x: local.x + box.x, y: local.y + box.y }
}
