import { appError } from './errors'

/**
 * The one sniffer every picture the app did not draw itself passes through: what a cloud
 * model answered, what ComfyUI hands back over `/view`, and the shipped art, which is WebP.
 */

/** The eight bytes every PNG starts with. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** The three bytes every JPEG starts with. */
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff]

/** True where `bytes` opens with `signature` at `offset`. */
function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false
  return signature.every((byte, i) => bytes[offset + i] === byte)
}

/** The four ASCII codes of `text`, for the RIFF container's two tags. */
function asciiOf(text: string): number[] {
  return Array.from(text, (character) => character.charCodeAt(0))
}

/** A WebP is a RIFF container whose four-byte form tag is `WEBP`. */
const RIFF_TAG = asciiOf('RIFF')
const WEBP_TAG = asciiOf('WEBP')

/** The type an image's first bytes say it is, or `null` for anything it cannot name. */
export function imageTypeOf(
  bytes: Uint8Array
): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (startsWith(bytes, PNG_SIGNATURE)) return 'image/png'
  if (startsWith(bytes, JPEG_SIGNATURE)) return 'image/jpeg'
  if (startsWith(bytes, RIFF_TAG) && startsWith(bytes, WEBP_TAG, 8)) return 'image/webp'
  return null
}

/** Refuses anything that is not a PNG before it can land on a sprite or stage as a graph's input. */
export function assertPng(bytes: Uint8Array, what: string): void {
  if (startsWith(bytes, PNG_SIGNATURE)) return
  throw appError('FIX_NOT_PNG', 'The repaired images were not readable.', `${what} is not a PNG.`)
}
