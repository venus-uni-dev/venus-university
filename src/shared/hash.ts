/**
 * Cheap deterministic hashing. Presentation only: it seeds choices that must look arbitrary
 * but stay the same for the same id across sessions.
 */

/** djb2 over a string, as an unsigned 32-bit number. */
export function hashString(value: string): number {
  let hash = 5381
  for (let i = 0; i < value.length; i++) hash = ((hash << 5) + hash + value.charCodeAt(i)) >>> 0
  return hash
}

/**
 * A stream of floats in [0, 1) off one seed (mulberry32). djb2 alone isn't enough: it moves by
 * one character's code, so ids like `a_1`/`a_2` differ only in their last digit and would sort
 * by it every time. The mixing here is what makes neighbouring seeds look arbitrary.
 */
export function seededRand(seed: string): () => number {
  let state = hashString(seed)
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let mixed = state
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
}
