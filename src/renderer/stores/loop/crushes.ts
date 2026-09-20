import { affectionFor, rollsCrush } from '@shared/relationship'
import type { PlayerStats } from '@shared/playerStats'
import type { CharInfo, LedgerResponse } from '@shared/types'
import { useGameStore } from '../gameStore'
import { likedCharIds } from '../sceneSanitizer'

/** Who fell for the reader this slot, where it meets the store. */

/**
 * Rolls for every girl the scene left something good with and returns whoever fell, writing
 * nothing. The two overrides are the ending's, which rolls off a projected save.
 */
export function rollCrushSettle(
  ledger: LedgerResponse | null,
  charInfo: Readonly<Record<string, CharInfo>> = useGameStore.getState().charInfo,
  stats: PlayerStats = useGameStore.getState().stats
): string[] {
  const game = useGameStore.getState()
  const fell: string[] = []

  for (const charId of likedCharIds(ledger)) {
    const info = charInfo[charId]
    if (!info) continue
    // A girl already carrying one has nothing to roll for, and a lover is past the stage.
    const flags = info.flags
    if (flags?.hasCrush || flags?.isLover) continue
    const character = game.characters[charId]
    if (rollsCrush(character, stats, affectionFor(info, game.date, character))) fell.push(charId)
  }

  return fell
}

/**
 * Files a rolled pass. Idempotent, which is what lets the boundary replay off its own save:
 * `setCrush` latches and no-ops on a girl who already has one.
 */
export function applyCrushSettle(charIds: readonly string[]): void {
  for (const charId of charIds) useGameStore.getState().setCrush(charId)
}
