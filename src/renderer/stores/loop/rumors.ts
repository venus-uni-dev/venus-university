import { globalSlotOf } from '@shared/jobs'
import { rumorPass, upsertJealousyMemory, type RumorPassOutcome } from '@shared/rumors'
import type { CharInfo, LedgerResponse, TimeSlot } from '@shared/types'
import { stageContextOf, useGameStore } from '../gameStore'
import { ledgerActs } from '../sceneSanitizer'
import { stageAt } from '../stageStep'
import { charHiddenLocationNow, charUnavailableNow } from '../timetable'

/** What the campus saw, where it meets the store. */

/** Who could have walked past: available, placed nowhere by her week, and not in the scene. */
function looseNow(date: number, time: TimeSlot): string[] {
  const game = useGameStore.getState()
  return game.chars.filter(
    (charId) =>
      !game.cast.includes(charId) &&
      !charUnavailableNow(charId, date, time) &&
      charHiddenLocationNow(charId, date, time) === null
  )
}

/** Who each girl spent the finished slot with, off the overlay that was rolled for it. */
function groupmatesNow(date: number, time: TimeSlot): Record<string, string[]> {
  const overlay = useGameStore.getState().npcOverlay
  if (!overlay || overlay.date !== date || overlay.time !== time) return {}
  const groupmates: Record<string, string[]> = {}
  for (const group of overlay.groups) {
    for (const member of group.members) {
      const held = (groupmates[member] ??= [])
      for (const other of group.members) {
        if (other !== member && !held.includes(other)) held.push(other)
      }
    }
  }
  return groupmates
}

/**
 * Rolls what the hour was seen to be — who watched the reader with whom, who they told, what
 * it cost him and what has expired — and returns it, writing nothing.
 */
export function rollRumorPass(
  ledger: LedgerResponse | null,
  charInfo: Readonly<Record<string, CharInfo>> = useGameStore.getState().charInfo
): RumorPassOutcome {
  const game = useGameStore.getState()
  const firstNames: Record<string, string> = {}
  for (const charId of game.chars) {
    const character = game.characters[charId]
    if (character) firstNames[charId] = character.firstName
  }
  return rumorPass({
    slot: globalSlotOf(game.date, game.time),
    date: game.date,
    acts: ledgerActs(ledger, false),
    cast: game.cast,
    // The scene's departures as written, read and queued alike, so a rewind that stepped back
    // across one cannot un-settle it.
    departed: stageAt([...game.sceneLog, ...game.pendingLines], stageContextOf(game)).departed,
    roster: game.chars,
    charInfo,
    npcRelationships: game.npcRelationships,
    groupmates: groupmatesNow(game.date, game.time),
    loose: looseNow(game.date, game.time),
    firstNames
  })
}

/**
 * Files a rolled pass. Idempotent, so the boundary can replay off its own save: every list is
 * a replacement for what she was holding, and a memory she already carries, in either voice, is
 * only re-dated and reworded.
 */
export function applyRumorPass(outcome: RumorPassOutcome): void {
  // Only what the pass touched is written, so every other `CharInfo` keeps its identity.
  for (const [charId, records] of Object.entries(outcome.suspicions)) {
    useGameStore.getState().setSuspicions(charId, records)
  }
  for (const { charId, memory } of outcome.memories) {
    const held = useGameStore.getState().charInfo[charId]?.jealousyMemories
    useGameStore.getState().setJealousyMemories(charId, upsertJealousyMemory(held, memory))
  }
}
