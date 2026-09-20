/**
 * How sentences are cut and how a list of words is read out, for the features that have to
 * agree about it.
 */

/**
 * A sentence boundary: terminal punctuation with an optional closing quote or bracket, then a
 * capital letter or digit — not after an ellipsis, a dialogue tag's quote, or an abbreviation.
 */
const SENTENCE_BREAK =
  /(?<=[.!?]["'\u2019\u201d)\]]?)(?<!\.\.)(?<!\b(?:Mr|Mrs|Ms|Dr|St|Jr|Sr|Prof|Sgt|Lt|vs|etc)\.)\s+(?=["'\u201c\u2018(]?[A-Z0-9])/u

/**
 * One string as its sentences, in order, each trimmed and none empty. Text the rule finds no
 * break in is one sentence, which is what makes a caller's "fewer than two" test its whole guard.
 */
export function splitSentences(text: string): string[] {
  return text
    .split(SENTENCE_BREAK)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0)
}

/** `a, b and c`. */
export function andList(parts: readonly string[]): string {
  if (parts.length < 2) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/** A string as a regex that matches it literally. */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
