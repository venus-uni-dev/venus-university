import { readerCrushFactorOf } from '@shared/npcRelationships'
import { affectionFor, isRomanceable, rollsCrush } from '@shared/relationship'
import type { PlayerStats } from '@shared/playerStats'
import type { CharInfo, LedgerResponse } from '@shared/types'
import { useGameStore } from '../gameStore'
import { likedCharIds } from '../sceneSanitizer'

/** Who fell for the reader this slot, where it meets the store. */

/**
 * Rolls for every girl the scene left something good with and the reader may romance, read off
 * `charInfo`, and returns whoever fell, writing nothing. The two overrides are the ending's, which
 * rolls off a projected save, so a first kiss in the scene itself counts.
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
    // A girl already carrying one has nothing to roll for, and a lover is past the stage; a
    // graduate is gone from Veridan, and one is never rolled for her.
    const flags = info.flags
    if (flags?.hasCrush || flags?.isLover || info.pursuing !== undefined) continue
    const character = game.characters[charId]
    // Somebody of a gender the playthrough leaves out is never rolled for, until the two of
    // them have been further than that.
    if (!isRomanceable(character, info, game.romance, game.playerPronouns)) continue
    // Somebody happy with another character is not looking, and one in a rocky couple barely.
    const taken = readerCrushFactorOf(game.npcRelationships, charId, character, game.date)
    const affection = affectionFor(info, game.date, character)
    if (rollsCrush(character, stats, affection, Math.random, taken)) fell.push(charId)
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
