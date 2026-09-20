import { readFile, rename, rm, writeFile } from 'fs/promises'
import { nativeImage } from 'electron'
import { expressionRel, faceRel, profileRel } from '@shared/characterFiles'
import { appError, messageOf } from '@shared/errors'
import { alphaBounds, type LineupBox } from '@shared/lineup'
import { activeProfileCrop, clampProfileCrop, defaultProfileCrop } from '@shared/profileCrop'
import type { Character, ProfileCrop, ProfileCropInfo } from '@shared/types'
import {
  getCharacterExpressionPath,
  getCharacterFacePath,
  getCharacterProfilePath,
  getStagedPath
} from '../paths'
import { dropImageTwins, imagePath } from './imageFiles'

/**
 * Her portrait, cut from her neutral sprite. Main owns it because `nativeImage`
 * decodes, crops and re-encodes a PNG here, which is all this needs — the renderer's canvas is
 * still the only thing that can *composite*.
 */

/** How opaque a mask pixel must be to count as face; the mask is drawn white on black. */
const MASK_FLOOR = 128

/** Where the sprite and its mask live for one wardrobe pass, live or staged. */
function paths(
  charId: string,
  staged: boolean
): { sprite: string; face: string; profile: string } {
  return staged
    ? {
        sprite: getStagedPath(charId, expressionRel('neutral')),
        face: getStagedPath(charId, faceRel()),
        profile: getStagedPath(charId, profileRel())
      }
    : {
        sprite: getCharacterExpressionPath(charId, 'neutral'),
        face: getCharacterFacePath(charId),
        profile: getCharacterProfilePath(charId)
      }
}

/** One image off disk, whichever extension it is under, or `null` where there is none. */
async function decode(path: string): Promise<Electron.NativeImage | null> {
  try {
    const image = nativeImage.createFromBuffer(await readFile(await imagePath(path)))
    return image.isEmpty() ? null : image
  } catch {
    return null
  }
}

/** The sprite a portrait is cut from, or `PROFILE_SOURCE_MISSING` where there is no readable PNG. */
async function decodeSpriteOrThrow(path: string): Promise<Electron.NativeImage> {
  const sprite = await decode(path)
  if (!sprite) {
    throw appError(
      'PROFILE_SOURCE_MISSING',
      'Could not read the neutral sprite.',
      `${path} is missing or not a readable PNG.`
    )
  }
  return sprite
}

/**
 * The box the face mask marks out, in the sprite's own pixels. The mask is greyscale, so any
 * one channel says what the whole pixel does and the red one is read.
 */
async function faceBoxOf(maskPath: string): Promise<LineupBox | null> {
  const mask = await decode(maskPath)
  if (!mask) return null

  const { width, height } = mask.getSize()
  if (width === 0 || height === 0) return null

  // BGRA, four bytes a pixel; every channel carries the same value in a greyscale mask.
  const bitmap = mask.toBitmap()
  const values = new Uint8Array(width * height)
  for (let i = 0; i < values.length; i++) values[i] = bitmap[i * 4]

  return alphaBounds(values, width, height, MASK_FLOOR)
}

/**
 * Cuts `profile.png` out of her neutral sprite and answers with the frame it used: the crop she
 * is wearing where it is still hers, the one her face asks for otherwise.
 */
export async function cutProfile(
  charId: string,
  character: Character,
  staged = false
): Promise<ProfileCrop> {
  const at = paths(charId, staged)
  const sprite = await decodeSpriteOrThrow(at.sprite)

  const { width, height } = sprite.getSize()
  const stored = activeProfileCrop(character)
  const crop = stored
    ? clampProfileCrop(stored, width, height)
    : defaultProfileCrop(await faceBoxOf(at.face), width, height, character.generationSeed)

  const temp = `${at.profile}.tmp`
  try {
    const cut = sprite.crop({ x: crop.x, y: crop.y, width: crop.width, height: crop.height })
    await writeFile(temp, cut.toPNG())
    await rename(temp, at.profile)
    await dropImageTwins(at.profile)
  } catch (err) {
    await rm(temp, { force: true }).catch(() => {})
    throw appError('PROFILE_UNWRITABLE', 'Could not save the portrait.', messageOf(err))
  }

  return crop
}

/**
 * {@link cutProfile} on the render path, where a portrait that cannot be cut costs only the
 * icon and never the sprite the job is actually for.
 */
export async function tryCutProfile(
  charId: string,
  character: Character,
  staged = false
): Promise<void> {
  try {
    await cutProfile(charId, character, staged)
  } catch (err) {
    console.warn(`[profile] ${charId}: no portrait — ${messageOf(err)}`)
  }
}

/** What the crop modal opens on: her stored frame, the one her face asks for, and the sprite. */
export async function profileCropOf(
  charId: string,
  character: Character
): Promise<ProfileCropInfo> {
  const at = paths(charId, false)
  const sprite = await decodeSpriteOrThrow(at.sprite)

  const { width, height } = sprite.getSize()
  const stored = activeProfileCrop(character)
  return {
    stored: stored ? clampProfileCrop(stored, width, height) : null,
    suggested: defaultProfileCrop(
      await faceBoxOf(at.face),
      width,
      height,
      character.generationSeed
    ),
    width,
    height
  }
}
