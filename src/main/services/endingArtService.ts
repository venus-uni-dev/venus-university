import { copyFile, mkdir, readFile, rename, unlink, writeFile } from 'fs/promises'
import { dirname } from 'path'
import { appError, messageOf } from '@shared/errors'
import { assertEndingRequest, ENDING_PICTURE_SIZE, endingPicturePrompt } from '@shared/endingPicture'
import { generateImage } from '@shared/llm/cloudImage'
import { LINEUP_MIME_TYPE } from '@shared/lineup'
import { ENDING_IMAGE_MODEL_ID } from '@shared/providers'
import { getEndingArtPath } from '../paths'
import { assertSafePlaythroughId } from './saveService'

/**
 * The graduation picture: the reader's friends at a party, drawn once per
 * playthrough from a reference sheet of their sprites and kept in the playthrough folder.
 */

/** Draws the picture, writes it into the playthrough folder and answers with the same bytes. */
export async function generateEndingArt(
  playthroughId: string,
  sheet: string,
  friendCount: number,
  signal?: AbortSignal
): Promise<Buffer> {
  assertSafePlaythroughId(playthroughId)
  const bytes = Buffer.from(sheet, 'base64')
  assertEndingRequest(friendCount, bytes)

  const art = Buffer.from(
    await generateImage(endingPicturePrompt(friendCount), {
      modelId: ENDING_IMAGE_MODEL_ID,
      imageSize: ENDING_PICTURE_SIZE,
      source: { bytes, mimeType: LINEUP_MIME_TYPE },
      signal
    })
  )

  // Atomic like every other write.
  const path = getEndingArtPath(playthroughId)
  const temp = `${path}.tmp`
  try {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(temp, art)
    await rename(temp, path)
  } catch (err) {
    await unlink(temp).catch(() => {})
    throw appError(
      'ENDING_ART_UNWRITABLE',
      'Failed to generate CG.',
      messageOf(err)
    )
  }
  return art
}

/** The picture already on disk, or `null` where there is none. */
export async function readEndingArt(playthroughId: string): Promise<Buffer | null> {
  assertSafePlaythroughId(playthroughId)
  try {
    return await readFile(getEndingArtPath(playthroughId))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw appError(
      'ENDING_ART_UNREADABLE',
      'Failed to generate CG.',
      messageOf(err)
    )
  }
}

/** Copies the picture to `to`, where the native save dialog pointed. */
export async function copyEndingArtTo(playthroughId: string, to: string): Promise<void> {
  assertSafePlaythroughId(playthroughId)
  try {
    await copyFile(getEndingArtPath(playthroughId), to)
  } catch (err) {
    throw appError(
      'ENDING_ART_UNEXPORTABLE',
      'Failed to save the ending CG.',
      messageOf(err)
    )
  }
}
