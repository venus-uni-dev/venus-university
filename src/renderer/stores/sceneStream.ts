import { createArrayExtractor, objectElement } from './jsonStream'

/**
 * Incremental preview reader for streaming `SceneResponse` JSON: emits complete `lines`
 * objects early; the resolved response remains authoritative.
 */

/** A reader that turns a growing JSON prefix into the scene lines completed so far. */
export interface LineExtractor {
  /** Appends a delta and returns only the line objects that closed within it. */
  feed: (delta: string) => unknown[]
}

/** Creates a {@link LineExtractor} — the `lines` array of objects (see `jsonStream.ts`). */
export function createLineExtractor(): LineExtractor {
  return createArrayExtractor<unknown>('lines', objectElement, '[scene]')
}
