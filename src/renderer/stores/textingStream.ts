import { createArrayExtractor, stringElement } from './jsonStream'

/**
 * Incremental preview reader for streaming `TextingResponse` JSON — the texting
 * counterpart of `sceneStream.ts`.
 */

/** A reader that turns a growing JSON prefix into the texts completed so far. */
export interface TextExtractor {
  /** Appends a delta and returns only the message strings that closed within it. */
  feed: (delta: string) => string[]
}

/** Creates a {@link TextExtractor} — the `messages` array of strings (see `jsonStream.ts`). */
export function createTextExtractor(): TextExtractor {
  return createArrayExtractor<string>('messages', stringElement, '[texting]')
}
