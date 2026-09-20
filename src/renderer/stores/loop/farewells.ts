import { SENIOR_YEAR } from '@shared/classes'
import { affectionFor, dispositionOf, isPositive } from '@shared/relationship'
import { useGameStore } from '../gameStore'

/**
 * The graduation epilogue's roster reads, where they meet the store. Everything said on
 * that screen is `prompts/graduation.ts`'; this is only who it may be said to and about.
 */

/** One goodbye the menu can still offer. */
export interface FarewellOption {
  charId: string
  firstName: string
  /** She is graduating out of reach rather than home for the summer. */
  senior: boolean
}

/**
 * Whoever the reader is still friends with, in roster order — the epilogue's one question
 * about the roster, asked once here and subtracted from below.
 */
export function friendCharIds(): string[] {
  const game = useGameStore.getState()
  return game.chars.filter((charId) => {
    const info = game.charInfo[charId]
    const character = game.characters[charId]
    if (!info?.nameKnown || !character) return false
    return isPositive(affectionFor(info, game.date, character))
  })
}

/**
 * The goodbyes the menu can still offer: {@link friendCharIds} minus the ones already said,
 * lowest affection first, so the one he is closest to is the last goodbye. A tie keeps roster
 * order.
 */
export function farewellOptions(): FarewellOption[] {
  const game = useGameStore.getState()
  return friendCharIds()
    .filter((charId) => !game.farewellsDone.includes(charId))
    .map((charId) => ({
      option: {
        charId,
        firstName: game.characters[charId].firstName,
        senior: (game.charInfo[charId].year ?? 0) >= SENIOR_YEAR
      },
      affection: affectionFor(game.charInfo[charId], game.date, game.characters[charId])
    }))
    .sort((a, b) => a.affection - b.affection)
    .map((entry) => entry.option)
}

/** How she feels about him as the goodbye ends, for the one status line it gets. */
export function farewellDisposition(charId: string): ReturnType<typeof dispositionOf> {
  const game = useGameStore.getState()
  return dispositionOf(affectionFor(game.charInfo[charId], game.date, game.characters[charId]))
}

/**
 * The first names of everyone graduating, in roster order — who the reader watches cross the
 * stage.
 */
export function seniorNames(): string[] {
  const game = useGameStore.getState()
  return game.chars
    .filter((charId) => (game.charInfo[charId]?.year ?? 0) >= SENIOR_YEAR)
    .map((charId) => game.characters[charId]?.firstName)
    .filter((name): name is string => Boolean(name))
}
