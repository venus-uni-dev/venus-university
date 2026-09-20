import { imageTypeOf } from '@shared/imageBytes'

/** Bytes as a blob, for the browser APIs that take one rather than an array. */

/** One blob over bytes this build is holding; they never sit on a shared buffer. */
export function blobOf(bytes: Uint8Array, type = ''): Blob {
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type })
}

/** One picture as a blob, typed off its own first bytes. */
export function imageBlob(bytes: Uint8Array): Blob {
  return blobOf(bytes, imageTypeOf(bytes) ?? '')
}
