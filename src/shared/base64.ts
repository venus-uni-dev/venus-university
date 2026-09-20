/**
 * Base64 for image bytes on both processes: `btoa`/`atob` are global in the browser and in
 * Node, and the chunking keeps a multi-megabyte sprite off the argument-count limit.
 */

/** How many bytes are handed to `btoa` at a time. */
const CHUNK = 0x8000

/** Base64 for a byte array, chunked so a large image cannot overflow the call stack. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

/** The bytes a base64 string encodes. */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
