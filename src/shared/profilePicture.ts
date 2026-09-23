import { appError } from './errors'
import { imageTypeOf } from './imageBytes'
import { PROFILE_ASPECT } from './profileCrop'

/**
 * The reader's own picture: the shape every build cuts one to, what the picker will take off
 * the player, and the check the bytes pass before either build writes them.
 */

/** The archway's own proportions, at a size a card and a rail tile both read well from. */
export const PROFILE_PICTURE_SIZE = { width: 400, height: 480 } as const

/** The file types the picker accepts. */
export const PROFILE_PICTURE_TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/webp']

/** The largest file the picker will decode. */
export const PROFILE_PICTURE_MAX_SOURCE_BYTES = 8 * 1024 * 1024

/** The largest encoded picture either build will write. */
export const PROFILE_PICTURE_MAX_BYTES = 2 * 1024 * 1024

/** The centred 5:6 window to cut out of a `width`×`height` source, in source pixels. */
export function coverCrop(
  width: number,
  height: number
): { x: number; y: number; width: number; height: number } {
  // Flooring both sides keeps the window inside the source whichever way round the picture is.
  const cropWidth = Math.floor(Math.min(width, height * PROFILE_ASPECT))
  const cropHeight = Math.floor(cropWidth / PROFILE_ASPECT)
  return {
    x: Math.floor((width - cropWidth) / 2),
    y: Math.floor((height - cropHeight) / 2),
    width: cropWidth,
    height: cropHeight
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
