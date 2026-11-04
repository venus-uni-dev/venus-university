import { mkdir, readFile, rm } from 'fs/promises'
import { dirname } from 'path'
import { appError, messageOf } from '@shared/errors'
import { validateRecord } from '@shared/jsonValidate'
import {
  assertProfilePicture,
  assertProfileSource,
  PROFILE_SOURCE_READ,
  PROFILE_SOURCE_SCHEMA_VERSION,
  type ProfileFrame,
  type ProfileSource,
  type ProfileSourceRecord,
  type ProfileSourceWrite
} from '@shared/profilePicture'
import { getProfilePicturePath, getProfileSourcePath, getProfileSourceRecordPath } from '../paths'
import { imagePath, removeImage, writeImageFile } from './imageFiles'
import { readJsonFile, writeAtomicJson } from './jsonFile'
import { assertSafePlaythroughId } from './saveService'

/**
 * The reader's own picture, kept as WebP in the playthrough folder beside the saves it belongs
 * to: the crop the renderer cut as a PNG, the full picture it was cut from, and the frame it was
 * cut through.
 */

const UNREADABLE = {
  code: 'PROFILE_PICTURE_UNREADABLE',
  message: 'Could not read the profile picture.'
}

const UNWRITABLE = {
  code: 'PROFILE_PICTURE_UNWRITABLE',
  message: 'Could not save the profile picture.'
}

/** The picture at `path` under either extension, or `null` where there is none. */
async function readPicture(path: string): Promise<Buffer | null> {
  try {
    return await readFile(await imagePath(path))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw appError(UNREADABLE.code, UNREADABLE.message, messageOf(err))
  }
}

/** The crop already on disk, or `null` where there is none. */
export async function readProfilePicture(playthroughId: string): Promise<Buffer | null> {
  assertSafePlaythroughId(playthroughId)
  return readPicture(getProfilePicturePath(playthroughId))
}

/** The frame the crop was cut through, or `null` where its record is missing or will not read. */
async function readFrame(playthroughId: string): Promise<ProfileFrame | null> {
  const path = getProfileSourceRecordPath(playthroughId)
  try {
    const read = await readJsonFile<null>(path, {
      malformed: PROFILE_SOURCE_READ.malformed,
      unreadable: UNREADABLE,
      onMissing: () => null
    })
    if (read.kind === 'missing') return null
    return validateRecord(read.parsed, path, PROFILE_SOURCE_READ).frame
  } catch (err) {
    console.warn('[profile] no frame for the full picture:', messageOf(err))
    return null
  }
}

/** The full picture and its frame, or `null` where only a crop was ever kept. */
export async function readProfileSource(playthroughId: string): Promise<ProfileSource | null> {
  assertSafePlaythroughId(playthroughId)
  const image = await readPicture(getProfileSourcePath(playthroughId))
  if (!image) return null
  return { image: new Uint8Array(image), frame: await readFrame(playthroughId) }
}

/**
 * Writes the crop, `png` being its base64 bytes, and beside it the frame and any new full picture,
 * once they have passed the shared checks. The crop goes last, so one that landed stands on the
 * full picture it was cut from.
 */
export async function writeProfilePicture(
  playthroughId: string,
  png: string,
  source: ProfileSourceWrite
): Promise<void> {
  assertSafePlaythroughId(playthroughId)
  const crop = Buffer.from(png, 'base64')
  assertProfilePicture(crop)
  const image = source.image === undefined ? null : Buffer.from(source.image, 'base64')
  if (image) assertProfileSource(image)

  const path = getProfilePicturePath(playthroughId)
  try {
    await mkdir(dirname(path), { recursive: true })
  } catch (err) {
    throw appError(UNWRITABLE.code, UNWRITABLE.message, messageOf(err))
  }
  if (image) {
    await writeImageFile(getProfileSourcePath(playthroughId), image, { error: UNWRITABLE })
  }
  const record: ProfileSourceRecord = {
    schemaVersion: PROFILE_SOURCE_SCHEMA_VERSION,
    frame: source.frame
  }
  await writeAtomicJson(getProfileSourceRecordPath(playthroughId), record, UNWRITABLE)
  await writeImageFile(path, crop, { error: UNWRITABLE })
}

/** Removes the crop, the full picture and its frame; whatever is already gone is success. */
export async function deleteProfilePicture(playthroughId: string): Promise<void> {
  assertSafePlaythroughId(playthroughId)
  try {
    await removeImage(getProfilePicturePath(playthroughId))
    await removeImage(getProfileSourcePath(playthroughId))
    await rm(getProfileSourceRecordPath(playthroughId), { force: true })
  } catch (err) {
    throw appError(
      'PROFILE_PICTURE_UNWRITABLE',
      'Could not remove the profile picture.',
      messageOf(err)
    )
  }
}
