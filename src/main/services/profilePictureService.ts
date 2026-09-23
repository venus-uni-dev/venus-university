import { mkdir, readFile, rename, unlink, writeFile } from 'fs/promises'
import { dirname } from 'path'
import { appError, messageOf } from '@shared/errors'
import { assertProfilePicture } from '@shared/profilePicture'
import { getProfilePicturePath } from '../paths'
import { assertSafePlaythroughId } from './saveService'

/**
 * The reader's own picture: one PNG the player picked and the renderer cut to shape, kept in
 * the playthrough folder beside the saves it belongs to.
 */

/** The picture already on disk, or `null` where there is none. */
export async function readProfilePicture(playthroughId: string): Promise<Buffer | null> {
  assertSafePlaythroughId(playthroughId)
  try {
    return await readFile(getProfilePicturePath(playthroughId))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw appError(
      'PROFILE_PICTURE_UNREADABLE',
      'Could not read the profile picture.',
      messageOf(err)
    )
  }
}

/** Writes the picture, `png` being its base64 bytes, once they have passed the shared check. */
export async function writeProfilePicture(playthroughId: string, png: string): Promise<void> {
  assertSafePlaythroughId(playthroughId)
  const bytes = Buffer.from(png, 'base64')
  assertProfilePicture(bytes)

  // Atomic like every other write.
  const path = getProfilePicturePath(playthroughId)
  const temp = `${path}.tmp`
  try {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(temp, bytes)
    await rename(temp, path)
  } catch (err) {
    await unlink(temp).catch(() => {})
    throw appError(
      'PROFILE_PICTURE_UNWRITABLE',
      'Could not save the profile picture.',
      messageOf(err)
    )
  }
}

/** Removes the picture; one that is already gone is success. */
export async function deleteProfilePicture(playthroughId: string): Promise<void> {
  assertSafePlaythroughId(playthroughId)
  try {
    await unlink(getProfilePicturePath(playthroughId))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
    throw appError(
      'PROFILE_PICTURE_UNWRITABLE',
      'Could not remove the profile picture.',
      messageOf(err)
    )
  }
}
