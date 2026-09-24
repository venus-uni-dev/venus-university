import type { SceneLine, SceneSummaryMark } from '@shared/types'

/**
 * How much of a running scene a continuation call reads verbatim: a tail of the transcript cut
 * to a word budget, reaching back at least as far as the running summary stops covering.
 */

/** The word budget of the transcript tail a continuation call is sent. */
export const SCENE_WINDOW_WORDS = 450

/** Where the running summary stops covering: the top mark's `at`, or 0 with none. */
export function windowFloor(marks: readonly SceneSummaryMark[]): number {
  return marks.length > 0 ? marks[marks.length - 1].at : 0
}

/** The whitespace-separated words in one line's text. */
function wordCount(line: SceneLine): number {
  const text = line.text.trim()
  return text === '' ? 0 : text.split(/\s+/).length
}

/**
 * The newest whole lines of `lines` within `maxWords`, never fewer than one; then reaching back
 * to index `floor` wherever the budget stopped short of it, since the summary does not cover
 * what lies past its mark.
 */
export function recentLines(
  lines: readonly SceneLine[],
  maxWords: number,
  floor: number
): SceneLine[] {
  if (lines.length === 0) return []
  let start = lines.length - 1
  let words = wordCount(lines[start])
  while (start > 0) {
    const more = wordCount(lines[start - 1])
    if (words + more > maxWords) break
    words += more
    start--
  }
  const bound = Math.min(Math.max(floor, 0), lines.length)
  return lines.slice(Math.min(start, bound))
}
