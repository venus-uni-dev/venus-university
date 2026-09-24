import { describe, expect, it } from 'vitest'
import type { CharMemory, MemoryType } from '@shared/types'
import {
  memoryEditRows,
  memoryEditsOf,
  type MemoryAnswer,
  type MemoryEditRow
} from '../src/renderer/stores/loop/memoryEdit'

/**
 * The boundary's memory question: a row standing for the wrong memory, or an answer read as the
 * wrong edit, rewrites or forgets a memory the player never touched, and the save keeps it.
 */

describe('memoryEditRows lines up one row per memory the ledger filed', () => {
  it('keeps cast order and gives a girl the ledger said nothing about a blank row', () => {
    const rows = memoryEditRows(
      ['a', 'b', 'c'],
      [
        { charId: 'c', type: 'liked', desc: 'the reader was kind' },
        { charId: 'a', type: 'hated', desc: 'the reader was late' },
        { charId: 'a', type: 'liked', desc: 'the reader apologised' }
      ],
      9
    )
    expect(rows).toEqual([
      { charId: 'a', applied: { date: 9, type: 'hated', desc: 'the reader was late' } },
      { charId: 'a', applied: { date: 9, type: 'liked', desc: 'the reader apologised' } },
      { charId: 'b', applied: null },
      { charId: 'c', applied: { date: 9, type: 'liked', desc: 'the reader was kind' } }
    ])
  })

  it('folds a memory filed twice into one row', () => {
    const filed = { charId: 'a', type: 'liked' as const, desc: 'the reader was kind' }
    expect(memoryEditRows(['a'], [filed, { ...filed }], 9)).toHaveLength(1)
  })

  it('appends a girl the ledger filed for who is not in the cast', () => {
    const rows = memoryEditRows(['a'], [{ charId: 'z', type: 'liked', desc: 'x' }], 9)
    expect(rows.map((row) => row.charId)).toEqual(['a', 'z'])
  })
})

describe('memoryEditsOf reads each answer as the edit it makes', () => {
  const filed: CharMemory = { date: 4, type: 'liked', desc: 'the reader was kind' }
  const rows: MemoryEditRow[] = [
    { charId: 'a', applied: filed },
    { charId: 'b', applied: null }
  ]
  const answer = (type: MemoryType, desc: string): MemoryAnswer => ({ type, desc })

  it('makes no edit for an answer left as it was filed', () => {
    const answers = [answer('liked', 'the reader was kind'), answer('liked', '')]
    expect(memoryEditsOf(rows, answers, 9)).toEqual([])
  })

  it('rewrites a memory whose verb alone changed, keeping its date', () => {
    const answers = [answer('loved', 'the reader was kind'), answer('liked', ' ')]
    expect(memoryEditsOf(rows, answers, 9)).toEqual([
      { charId: 'a', match: filed, next: { date: 4, type: 'loved', desc: 'the reader was kind' } }
    ])
  })

  it('forgets a memory whose words were blanked', () => {
    const answers = [answer('liked', '  '), answer('liked', '')]
    expect(memoryEditsOf(rows, answers, 9)).toEqual([{ charId: 'a', match: filed, next: null }])
  })

  it('records a filled blank row on the boundary’s date, typed words in the reader’s voice', () => {
    const answers = [answer('liked', 'the reader was kind'), answer('disliked', 'you were late')]
    expect(memoryEditsOf(rows, answers, 9)).toEqual([
      { charId: 'b', match: null, next: { date: 9, type: 'disliked', desc: 'the reader was late' } }
    ])
  })
})
