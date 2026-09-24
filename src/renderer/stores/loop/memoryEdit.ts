import { storedMemoryDesc } from '@shared/readerVoice'
import type { CharMemory, MemoryType } from '@shared/types'

/** The boundary's memory question as data — its rows off the ledger, and what the answers change. */

/** One row of the question: who, and the memory the ledger filed that the row stands for. */
export interface MemoryEditRow {
  charId: string
  applied: CharMemory | null
}

/** What the player left in a row: the verb and the words as typed. */
export interface MemoryAnswer {
  type: MemoryType
  desc: string
}

/** One change the answers make: rewrite or drop `match`, or record `next` where there was nothing. */
export interface MemoryEdit {
  charId: string
  match: CharMemory | null
  next: CharMemory | null
}

/**
 * One row per distinct memory the ledger filed for each girl in the cast, in cast order, or a
 * blank row for a girl it filed nothing for; a filed girl outside the cast follows at the end.
 */
export function memoryEditRows(
  cast: readonly string[],
  filed: readonly { charId: string; type: MemoryType; desc: string }[],
  date: number
): MemoryEditRow[] {
  const rows: MemoryEditRow[] = []
  const seen = new Set<string>()
  // Her rows: each distinct verb and wording the ledger filed for her, or one blank row.
  const rowsFor = (charId: string): void => {
    let any = false
    for (const entry of filed) {
      if (entry.charId !== charId) continue
      any = true
      const key = JSON.stringify([charId, entry.type, entry.desc])
      if (seen.has(key)) continue
      seen.add(key)
      rows.push({ charId, applied: { date, type: entry.type, desc: entry.desc } })
    }
    if (!any) rows.push({ charId, applied: null })
  }
  const named = new Set<string>()
  for (const charId of cast) {
    if (named.has(charId)) continue
    named.add(charId)
    rowsFor(charId)
  }
  for (const { charId } of filed) {
    if (named.has(charId)) continue
    named.add(charId)
    rowsFor(charId)
  }
  return rows
}

/**
 * The edits the answers make, `answers[i]` answering `rows[i]`: a filed memory blanked is
 * dropped, changed is rewritten on its own date, and a blank row filled is recorded on `date`.
 */
export function memoryEditsOf(
  rows: readonly MemoryEditRow[],
  answers: readonly MemoryAnswer[],
  date: number
): MemoryEdit[] {
  const edits: MemoryEdit[] = []
  rows.forEach(({ charId, applied }, index) => {
    const answer = answers[index]
    if (!answer) return
    const desc = storedMemoryDesc(answer.desc)
    if (applied) {
      if (!desc) {
        edits.push({ charId, match: applied, next: null })
      } else if (answer.type !== applied.type || desc !== applied.desc) {
        const next: CharMemory = { date: applied.date, type: answer.type, desc }
        edits.push({ charId, match: applied, next })
      }
    } else if (desc) {
      edits.push({ charId, match: null, next: { date, type: answer.type, desc } })
    }
  })
  return edits
}
