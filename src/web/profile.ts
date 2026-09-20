import { expressionRel, faceRel, profileRel, stagedRel } from '@shared/characterFiles'
import { appError, messageOf } from '@shared/errors'
import { alphaBounds, type LineupBox } from '@shared/lineup'
import { activeProfileCrop, clampProfileCrop, defaultProfileCrop } from '@shared/profileCrop'
import type { Character, ProfileCrop, ProfileCropInfo } from '@shared/types'
import { blobOf } from './blob'
import { writeFiles } from './db/chars'
import { imageBytes } from './files'
import { forgetImages } from './images'

/**
 * Her portrait, cut from her neutral sprite on a canvas — the browser's own decode, crop and
 * re-encode, over the same arithmetic the desktop's does.
 */

/** How opaque a mask pixel must be to count as face; the mask is drawn white on black. */
const MASK_FLOOR = 128

/** One of her images decoded, or `null` where there is nothing to decode. */
async function decode(charId: string, rel: string, staged: boolean): Promise<ImageBitmap | null> {
  const bytes = await imageBytes(charId, rel, staged)
  if (!bytes) return null
  try {
    return await createImageBitmap(blobOf(bytes))
  } catch {
    return null
  }
}

/** The sprite a portrait is cut from, or the refusal naming what could not be read. */
async function decodeSpriteOrThrow(charId: string, staged: boolean): Promise<ImageBitmap> {
  const sprite = await decode(charId, expressionRel('neutral'), staged)
  if (!sprite) {
    throw appError(
      'PROFILE_SOURCE_MISSING',
      'Could not read the neutral sprite.',
      `${charId} has no readable neutral sprite.`
    )
  }
  return sprite
}

/** A canvas of the given size and its context, or the refusal where the browser gave neither. */
function canvasOf(width: number, height: number): {
  canvas: OffscreenCanvas
  context: OffscreenCanvasRenderingContext2D
} {
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext('2d')
  if (!context) {
    throw appError('PROFILE_UNWRITABLE', 'Could not save the portrait.', 'no 2D canvas')
  }
  return { canvas, context }
}

/**
 * The box the face mask marks out, in the sprite's own pixels. The mask is greyscale, so any
 * one channel says what the whole pixel does and the red one is read.
 */
async function faceBoxOf(charId: string, staged: boolean): Promise<LineupBox | null> {
  const mask = await decode(charId, faceRel(), staged)
  if (!mask) return null

  const { width, height } = mask
  if (width === 0 || height === 0) return null

  const { context } = canvasOf(width, height)
  context.drawImage(mask, 0, 0)
  const { data } = context.getImageData(0, 0, width, height)
  const values = new Uint8Array(width * height)
  for (let i = 0; i < values.length; i++) values[i] = data[i * 4]

  return alphaBounds(values, width, height, MASK_FLOOR)
}

/**
 * Cuts her portrait out of her neutral sprite and answers with the frame it used: the crop she
 * is wearing where it is still hers, the one her face asks for otherwise.
 */
export async function cutProfile(
  charId: string,
  character: Character,
  staged = false
): Promise<ProfileCrop> {
  const sprite = await decodeSpriteOrThrow(charId, staged)
  const { width, height } = sprite

  const stored = activeProfileCrop(character)
  const crop = stored
    ? clampProfileCrop(stored, width, height)
    : defaultProfileCrop(await faceBoxOf(charId, staged), width, height, character.generationSeed)

  const rel = profileRel()
  try {
    const { canvas, context } = canvasOf(crop.width, crop.height)
    context.drawImage(
      sprite,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
      crop.width,
      crop.height
    )
    const blob = await canvas.convertToBlob({ type: 'image/png' })
    await writeFiles(charId, [{ rel: staged ? stagedRel(rel) : rel, blob }])
  } catch (err) {
    throw appError('PROFILE_UNWRITABLE', 'Could not save the portrait.', messageOf(err))
  }

  forgetImages(charId, rel, staged)
  return crop
}

/**
 * {@link cutProfile} where a portrait that cannot be cut costs only the icon and never the
 * write the call was actually for.
 */
export async function tryCutProfile(charId: string, character: Character): Promise<void> {
  try {
    await cutProfile(charId, character)
  } catch (err) {
    console.warn(`[profile] ${charId}: no portrait — ${messageOf(err)}`)
  }
}

/** What the crop modal opens on: her stored frame, the one her face asks for, and the sprite. */
export async function profileCropOf(
  charId: string,
  character: Character
): Promise<ProfileCropInfo> {
  const sprite = await decodeSpriteOrThrow(charId, false)
  const { width, height } = sprite

  const stored = activeProfileCrop(character)
  return {
    stored: stored ? clampProfileCrop(stored, width, height) : null,
    suggested: defaultProfileCrop(
      await faceBoxOf(charId, false),
      width,
      height,
      character.generationSeed
    ),
    width,
    height
  }
}
