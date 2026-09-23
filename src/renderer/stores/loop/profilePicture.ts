import { bytesToBase64 } from '@shared/base64'
import { appError, messageOf, toAppError } from '@shared/errors'
import {
  assertProfilePicture,
  coverCrop,
  PROFILE_PICTURE_MAX_SOURCE_BYTES,
  PROFILE_PICTURE_SIZE,
  PROFILE_PICTURE_TYPES
} from '@shared/profilePicture'
import { useGameStore } from '../gameStore'
import { useUiStore } from '../uiStore'
import { currentRun, runStale } from './state'

/**
 * The reader's own picture where it meets the store: the shape it is cut to and the check its
 * bytes pass are pure in `@shared/profilePicture.ts`; this half reads the playthrough, drives a
 * canvas and talks to the bridge. One picture per playthrough, so it is read on the way into a
 * game and released on the way out. A read that fails costs nothing but the picture.
 */

/** The object URL the screen is drawing, so the next one can revoke it. */
let pictureUrl: string | null = null

/** Hands the bytes to the screen, releasing whatever was on it before them. */
function publish(bytes: Uint8Array<ArrayBuffer>): void {
  if (pictureUrl) URL.revokeObjectURL(pictureUrl)
  pictureUrl = URL.createObjectURL(new Blob([bytes]))
  useGameStore.getState().setProfilePicture(pictureUrl)
}

/** Reads the playthrough's picture, where it has one. Silent about a read that failed. */
export async function loadProfilePicture(): Promise<void> {
  const playthroughId = useGameStore.getState().playthroughId
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

/** Drops the picture and releases the URL behind it, on the way out of a game. */
export function dropProfilePicture(): void {
  if (pictureUrl) URL.revokeObjectURL(pictureUrl)
  pictureUrl = null
  useGameStore.getState().setProfilePicture(null)
}

/** The picked file cut to the archway's window and encoded as the PNG the bridge is handed. */
async function cropToPng(file: File): Promise<Uint8Array<ArrayBuffer>> {
  const bitmap = await createImageBitmap(file)
  try {
    const crop = coverCrop(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = PROFILE_PICTURE_SIZE.width
    canvas.height = PROFILE_PICTURE_SIZE.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw appError('PROFILE_PICTURE_INVALID', 'That picture could not be used.')
    ctx.drawImage(
      bitmap,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
      PROFILE_PICTURE_SIZE.width,
      PROFILE_PICTURE_SIZE.height
    )
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/png')
    })
    if (!blob) throw appError('PROFILE_PICTURE_INVALID', 'That picture could not be encoded.')
    const bytes = new Uint8Array(await blob.arrayBuffer())
    assertProfilePicture(bytes)
    return bytes
  } finally {
    bitmap.close()
  }
}

/** Takes the file the profile's picker handed over, cuts it to shape and writes it. */
export async function pickProfilePicture(file: File): Promise<void> {
  const ui = useUiStore.getState()
  if (!PROFILE_PICTURE_TYPES.includes(file.type) || file.size > PROFILE_PICTURE_MAX_SOURCE_BYTES) {
    ui.showError(
      appError(
        'PROFILE_PICTURE_INVALID',
        'That has to be a PNG, JPEG or WebP under 8 MB.',
        `${file.name} is ${file.type || 'of no declared type'} and ${String(file.size)} bytes.`
      )
    )
    return
  }

  const playthroughId = useGameStore.getState().playthroughId
  if (!playthroughId) return

  const run = currentRun()
  let bytes: Uint8Array<ArrayBuffer>
  try {
    bytes = await cropToPng(file)
  } catch (err) {
    console.warn('[profile] picture refused:', messageOf(err))
    ui.showError(toAppError(err, 'PROFILE_PICTURE_INVALID'))
    return
  }
  if (runStale(run)) return

  const written = await window.api.saves.writeProfilePicture(playthroughId, bytesToBase64(bytes))
  if (!written.ok) {
    ui.showError(written.error)
    return
  }
  // The same bytes the bridge took, so the screen and the folder cannot disagree.
  if (!runStale(run)) publish(bytes)
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
