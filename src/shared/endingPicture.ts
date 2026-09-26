import { appError } from './errors'
import { imageTypeOf } from './imageBytes'
import type { ImageSize } from './providers'

/**
 * The graduation picture's prompt — `room.ts`'s charter applied to the one image
 * the game makes about the player rather than about a place.
 */

/** The reply's resolution: the picture is shown full-screen. */
export const ENDING_PICTURE_SIZE: ImageSize = '4K'

/** The name the picture is offered under when the reader downloads their own copy. */
export const ENDING_ART_FILE_NAME = 'ending.png'

/** Nothing this app builds puts more than a full roster on one sheet. */
const MAX_ENDING_FRIENDS = 12

/** Throws `ENDING_REQUEST_INVALID` unless `friendCount` and `sheet` can be sent to the model. */
export function assertEndingRequest(friendCount: number, sheet: Uint8Array): void {
  if (!Number.isInteger(friendCount) || friendCount < 1 || friendCount > MAX_ENDING_FRIENDS) {
    throw appError(
      'ENDING_REQUEST_INVALID',
      'Failed to generate CG.',
      `${String(friendCount)} is not a number of characters.`
    )
  }

  // The sheet must be a JPEG before it reaches the model as one.
  if (imageTypeOf(sheet) !== 'image/jpeg') {
    throw appError(
      'ENDING_REQUEST_INVALID',
      'Failed to generate CG.',
      'The reference sheet is not a JPEG.'
    )
  }
}

/** The exact prompt sent with the reference sheet. */
export function endingPicturePrompt(count: number): string {
  return [
    'Create a candid photo of these characters enjoying themselves at a dorm lounge graduation party at Venus University. Don\'t keep the characters in their reference poses or have them stare at the camera: have them interact in the frame, make their poses natural, and make it lively and fun.',
    'Before you finalize your composition, check these things:',
    `- All ${count} characters in the reference image are present.`,
    '- All characters appear once; none are duplicated.',
    '- No characters other than the ones in the reference image appear.',
    '- All characters are included in activities or conversations: no loners'
  ].join('\n')
}
