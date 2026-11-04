import type { CropWindow } from './coverCrop'
import { appError } from './errors'
import { imageTypeOf } from './imageBytes'
import type { ValidateRecordOptions } from './jsonValidate'

/**
 * The reader's own picture: the shape every build cuts the crop to, what the picker will take off
 * the player, the full picture kept beside the crop with the frame it was cut through, and the
 * checks the bytes pass before either build writes them.
 */

/** The archway's own proportions, at a size a card and a rail tile both read well from. */
export const PROFILE_PICTURE_SIZE = { width: 400, height: 480 } as const

/** The file types the picker accepts. */
export const PROFILE_PICTURE_TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/webp']

/** The largest file the picker will decode. */
export const PROFILE_PICTURE_MAX_SOURCE_BYTES = 8 * 1024 * 1024

/** The largest encoded picture either build will write. */
export const PROFILE_PICTURE_MAX_BYTES = 2 * 1024 * 1024

/** The longest side the full picture is kept at, which is more than a reference sheet draws. */
export const PROFILE_SOURCE_MAX_SIDE = 2048

/** The largest full picture either build will write: one a browser could only encode as a PNG. */
export const PROFILE_SOURCE_MAX_BYTES = 20 * 1024 * 1024

/** The one version of the full picture's record this build reads and writes. */
export const PROFILE_SOURCE_SCHEMA_VERSION = 1

/** The window of the full picture the crop is cut through, in the full picture's pixels. */
export type ProfileFrame = CropWindow

/** The record kept beside the full picture. */
export interface ProfileSourceRecord {
  schemaVersion: number
  frame: ProfileFrame
}

/** The full picture as a read answers it; a frame that could not be read comes back null. */
export interface ProfileSource {
  image: Uint8Array<ArrayBuffer>
  frame: ProfileFrame | null
}

/** What a write keeps beside the crop: the frame, and the full picture as base64 where it changed. */
export interface ProfileSourceWrite {
  image?: string
  frame: ProfileFrame
}

/** Whether a value read back from a record or a backup is a frame. */
export function isProfileFrame(value: unknown): value is ProfileFrame {
  if (typeof value !== 'object' || value === null) return false
  const { x, y, width, height } = value as Partial<ProfileFrame>
  return [x, y, width, height].every((side) => typeof side === 'number' && Number.isFinite(side))
}

/** How the full picture's record is checked once it has been parsed. */
export const PROFILE_SOURCE_READ: ValidateRecordOptions<ProfileSourceRecord> = {
  label: 'That profile picture record',
  malformed: {
    code: 'PROFILE_SOURCE_MALFORMED',
    message: 'That profile picture record could not be read.'
  },
  schemaVersion: { code: 'PROFILE_SOURCE_SCHEMA_VERSION' },
  expects: PROFILE_SOURCE_SCHEMA_VERSION,
  required: { schemaVersion: true, frame: true },
  check(record, where) {
    if (!isProfileFrame(record.frame)) {
      throw appError(
        'PROFILE_SOURCE_MALFORMED',
        'That profile picture record could not be read.',
        where
      )
    }
  }
}

/** Refuses bytes that are no picture, or past the cap, before either build keeps them. */
export function assertProfileSource(bytes: Uint8Array): void {
  if (imageTypeOf(bytes) === null) {
    throw appError(
      'PROFILE_PICTURE_INVALID',
      'That picture could not be used.',
      'The full picture is not a PNG, JPEG or WebP.'
    )
  }
  if (bytes.length > PROFILE_SOURCE_MAX_BYTES) {
    throw appError(
      'PROFILE_PICTURE_INVALID',
      'That picture could not be used.',
      `The full picture is ${String(bytes.length)} bytes, past the ${String(PROFILE_SOURCE_MAX_BYTES)} one may be.`
    )
  }
}

/** Refuses bytes that are not a PNG within the cap, before either build writes them. */
export function assertProfilePicture(bytes: Uint8Array): void {
  if (imageTypeOf(bytes) !== 'image/png') {
    throw appError(
      'PROFILE_PICTURE_INVALID',
      'That picture could not be used.',
      'The encoded picture is not a PNG.'
    )
  }
  if (bytes.length > PROFILE_PICTURE_MAX_BYTES) {
    throw appError(
      'PROFILE_PICTURE_INVALID',
      'That picture could not be used.',
      `The encoded picture is ${String(bytes.length)} bytes, past the ${String(PROFILE_PICTURE_MAX_BYTES)} a profile picture may be.`
    )
  }
}
