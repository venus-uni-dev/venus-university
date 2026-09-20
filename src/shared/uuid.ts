/**
 * The one id minter for anything that needs a unique string and is not a save id: job ids,
 * request ids, the names of things nothing on disk has to sort.
 */

/**
 * A random v4 UUID. `crypto.randomUUID` is absent outside a secure context, so the same
 * shape is assembled from random bytes there.
 */
export function randomId(): string {
  const source = globalThis.crypto
  if (typeof source.randomUUID === 'function') return source.randomUUID()

  const bytes = new Uint8Array(16)
  source.getRandomValues(bytes)
  // The version and variant nibbles v4 fixes.
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
