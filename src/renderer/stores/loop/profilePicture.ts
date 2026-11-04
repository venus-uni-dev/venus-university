import { bytesToBase64 } from '@shared/base64'
import { coverCrop } from '@shared/coverCrop'
import { appError, messageOf, toAppError } from '@shared/errors'
import { imageTypeOf } from '@shared/imageBytes'
import { PROFILE_ASPECT } from '@shared/profileCrop'
import {
  assertProfilePicture,
  assertProfileSource,
  PROFILE_PICTURE_MAX_SOURCE_BYTES,
  PROFILE_PICTURE_SIZE,
  PROFILE_PICTURE_TYPES,
  PROFILE_SOURCE_MAX_SIDE,
  type ProfileFrame
} from '@shared/profilePicture'
import { WEBP_PROFILE } from '@shared/webpProfile'
import { useGameStore } from '../gameStore'
import { cropToPng } from '../pngCanvas'
import { useUiStore } from '../uiStore'
import { blobToBase64, canvasToWebpOr } from './encode'
import { currentRun, runStale } from './state'

/**
 * The reader's own picture where it meets the store: the shape it is cut to and the checks its
 * bytes pass are pure in `@shared/profilePicture.ts`; this half reads the playthrough, drives a
 * canvas and talks to the bridge. One picture per playthrough, so its crop is read on the way into
 * a game and released on the way out, and the full picture only when something asks for it. A
 * read of the crop that fails costs nothing but the picture.
 */

/** A full picture on its way through the crop modal, and the frame the modal opens on. */
export interface ReaderPicture {
  blob: Blob
  width: number
  height: number
  frame: ProfileFrame
  /** The playthrough does not keep this picture as its full picture yet, so a save writes it. */
  unsaved: boolean
}

/** The object URL the screen is drawing, so the next one can revoke it. */
let pictureUrl: string | null = null

/** Hands the bytes to the screen, releasing whatever was on it before them. */
function publish(bytes: Uint8Array<ArrayBuffer>): void {
  if (pictureUrl) URL.revokeObjectURL(pictureUrl)
  pictureUrl = URL.createObjectURL(new Blob([bytes]))
  useGameStore.getState().setProfilePicture(pictureUrl)
}

/**
 * Reads a playthrough's crop, where it has one: the game's own, or the one named for a stay that
 * holds no playthrough of its own. Silent about a read that failed.
 */
export async function loadProfilePicture(
  playthroughId = useGameStore.getState().playthroughId
): Promise<void> {
  if (!playthroughId) return

  const run = currentRun()
  const found = await window.api.saves.readProfilePicture(playthroughId)
  if (runStale(run)) return
  if (!found.ok) {
    console.warn('[profile] no profile picture:', found.error.message)
    return
  }
  if (found.data) publish(found.data)
}

/** Drops the crop and releases the URL behind it, on the way out of a game. */
export function dropProfilePicture(): void {
  if (pictureUrl) URL.revokeObjectURL(pictureUrl)
  pictureUrl = null
  useGameStore.getState().setProfilePicture(null)
}

/** The picked file turned upright and shrunk to the size the full picture is kept at. */
async function encodeSource(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, PROFILE_SOURCE_MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw appError('PROFILE_PICTURE_INVALID', 'That picture could not be encoded.')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await canvasToWebpOr(canvas, WEBP_PROFILE.quality / 100, 'image/png')
    assertProfileSource(new Uint8Array(await blob.arrayBuffer()))
    return { blob, width: canvas.width, height: canvas.height }
  } finally {
    bitmap.close()
  }
}

/**
 * The file the player picked, ready for the crop modal on the largest centred frame; null, with
 * the reason on screen, where it cannot be used. Nothing is written.
 */
export async function openPickedPicture(file: File): Promise<ReaderPicture | null> {
  const ui = useUiStore.getState()
  if (!PROFILE_PICTURE_TYPES.includes(file.type) || file.size > PROFILE_PICTURE_MAX_SOURCE_BYTES) {
    ui.showError(
      appError(
        'PROFILE_PICTURE_INVALID',
        'That has to be a PNG, JPEG or WebP under 8 MB.',
        `${file.name} is ${file.type || 'of no declared type'} and ${String(file.size)} bytes.`
      )
    )
    return null
  }

  try {
    const { blob, width, height } = await encodeSource(file)
    return { blob, width, height, frame: coverCrop(width, height, PROFILE_ASPECT), unsaved: true }
  } catch (err) {
    console.warn('[profile] picture refused:', messageOf(err))
    ui.showError(toAppError(err, 'PROFILE_PICTURE_INVALID'))
    return null
  }
}

/** Bytes as a blob typed off their own first bytes. */
function pictureBlob(bytes: Uint8Array<ArrayBuffer>): Blob {
  return new Blob([bytes], { type: imageTypeOf(bytes) ?? '' })
}

/**
 * The playthrough's full picture for the crop modal, on the frame it was last cut through. Where
 * an older build kept only the crop, the crop stands in as the full picture until the next save.
 * Null, with the reason on screen, where nothing could be read.
 */
export async function openStoredPicture(): Promise<ReaderPicture | null> {
  const ui = useUiStore.getState()
  const playthroughId = useGameStore.getState().playthroughId
  if (!playthroughId) return null

  const source = await window.api.saves.readProfileSource(playthroughId)
  if (!source.ok) {
    ui.showError(source.error)
    return null
  }
  let bytes = source.data?.image ?? null
  if (!bytes) {
    const crop = await window.api.saves.readProfilePicture(playthroughId)
    if (!crop.ok) {
      ui.showError(crop.error)
      return null
    }
    bytes = crop.data
  }
  if (!bytes) return null

  const blob = pictureBlob(bytes)
  try {
    const bitmap = await createImageBitmap(blob)
    const { width, height } = bitmap
    bitmap.close()
    return {
      blob,
      width,
      height,
      frame: source.data?.frame ?? coverCrop(width, height, PROFILE_ASPECT),
      unsaved: !source.data
    }
  } catch (err) {
    ui.showError(toAppError(err, 'PROFILE_PICTURE_UNREADABLE'))
    return null
  }
}

/**
 * Cuts the crop out of the picture through `frame` and keeps both, the full picture only where it
 * is not already kept. False, with the reason on screen, where it could not be kept.
 */
export async function savePicture(picture: ReaderPicture, frame: ProfileFrame): Promise<boolean> {
  const ui = useUiStore.getState()
  const playthroughId = useGameStore.getState().playthroughId
  if (!playthroughId) return false

  const run = currentRun()
  let crop: Uint8Array<ArrayBuffer>
  let image: string | undefined
  try {
    const bitmap = await createImageBitmap(picture.blob)
    try {
      const bytes = await cropToPng(
        bitmap,
        frame,
        PROFILE_PICTURE_SIZE.width,
        PROFILE_PICTURE_SIZE.height
      )
      if (!bytes) throw appError('PROFILE_PICTURE_INVALID', 'That picture could not be encoded.')
      assertProfilePicture(bytes)
      crop = bytes
    } finally {
      bitmap.close()
    }
    if (picture.unsaved) image = await blobToBase64(picture.blob)
  } catch (err) {
    console.warn('[profile] picture refused:', messageOf(err))
    ui.showError(toAppError(err, 'PROFILE_PICTURE_INVALID'))
    return false
  }
  if (runStale(run)) return false

  const { x, y, width, height } = frame
  const written = await window.api.saves.writeProfilePicture(playthroughId, bytesToBase64(crop), {
    ...(image !== undefined ? { image } : {}),
    frame: { x, y, width, height }
  })
  if (!written.ok) {
    ui.showError(written.error)
    return false
  }
  // The same bytes the bridge took, so the screen and the folder cannot disagree.
  if (!runStale(run)) publish(crop)
  return true
}

/** The picture a photo sends for the reader: the full one, else the crop; null where neither reads. */
export async function readerReference(playthroughId: string): Promise<Blob | null> {
  const source = await window.api.saves.readProfileSource(playthroughId)
  if (source.ok && source.data) return pictureBlob(source.data.image)
  const crop = await window.api.saves.readProfilePicture(playthroughId)
  return crop.ok && crop.data ? pictureBlob(crop.data) : null
}

/** Takes the picture off the playthrough and off the screen. */
export async function removeProfilePicture(): Promise<void> {
  const playthroughId = useGameStore.getState().playthroughId
  if (!playthroughId) return

  const removed = await window.api.saves.deleteProfilePicture(playthroughId)
  if (!removed.ok) {
    useUiStore.getState().showError(removed.error)
    return
  }
  dropProfilePicture()
}
