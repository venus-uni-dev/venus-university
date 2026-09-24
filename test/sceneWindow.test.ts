import { describe, expect, it } from 'vitest'
import { recentLines, windowFloor } from '../src/renderer/prompts/sceneWindow'
import { sceneLines } from './fixtures'

/**
 * The transcript tail a continuation call reads verbatim. A window that stops short of where the
 * running summary stops covering hands the model a scene with a hole in it, which it then writes
 * past as though the missing lines never happened.
 */

describe('recentLines', () => {
  it('takes whole lines only, leaving out the one that would overflow and all before it', () => {
    // 1 + 2 + 3 words fit 6; the four-word line would make 10.
    const lines = sceneLines('one two three four', 'a b c', 'a b', 'a')
    expect(recentLines(lines, 6, lines.length)).toEqual(lines.slice(1))
    // A budget that falls mid-line stops at the line before it rather than splitting it.
    expect(recentLines(lines, 5, lines.length)).toEqual(lines.slice(2))
  })

  it('reaches back to the floor past the budget, and never forward of it', () => {
    const lines = sceneLines('a b c d', 'a b c d', 'a b c d', 'a b c d')
    expect(recentLines(lines, 4, 1)).toEqual(lines.slice(1))
    // A floor the budget already reaches behind changes nothing.
    expect(recentLines(lines, 100, 3)).toEqual(lines)
  })

  it('keeps at least the last line, however long', () => {
    const lines = sceneLines('a b', 'far too many words for the budget')
    expect(recentLines(lines, 2, lines.length)).toEqual([lines[1]])
    expect(recentLines([], 2, 0)).toEqual([])
  })
})

describe('windowFloor', () => {
  it('reads the top mark, and 0 with none', () => {
    expect(windowFloor([])).toBe(0)
    expect(
      windowFloor([
        { at: 3, summary: 'first' },
        { at: 9, summary: 'second' }
      ])
    ).toBe(9)
  })
})
