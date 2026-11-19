import { affectionFor, dispositionOf, isPositive } from '@shared/relationship'
import { LAST_SEMESTER } from '@shared/semesters'
import { useGameStore } from '../gameStore'

/**
 * The graduation epilogue's roster reads, where they meet the store. Everything said on
 * that screen is `prompts/graduation.ts`'; this is only who it may be said to and about.
 */

/** One goodbye the menu can still offer. */
export interface FarewellOption {
  charId: string
  firstName: string
  /** One of them is graduating out of the other's reach, rather than going home for the break. */
  forAWhile: boolean
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
 * The `limit` friends he is closest to, in roster order: who the graduation picture draws when
 * more friends than it holds are his. A tie keeps the earlier girl.
 */
export function closestFriendCharIds(limit: number): string[] {
  const game = useGameStore.getState()
  const friends = friendCharIds()
  if (friends.length <= limit) return friends
  const kept = new Set(
    friends
      .map((charId) => ({
        charId,
        affection: affectionFor(game.charInfo[charId], game.date, game.characters[charId])
      }))
      // The sort is stable, so a tie stays in roster order.
      .sort((a, b) => b.affection - a.affection)
      .slice(0, limit)
      .map((entry) => entry.charId)
  )
  return friends.filter((charId) => kept.has(charId))
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
        forAWhile: partsForAWhile(charId)
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

/** Whether the reader and `charId` part for longer than a break: she graduates, or he does. */
export function partsForAWhile(charId: string): boolean {
  const game = useGameStore.getState()
  return game.semesterIndex === LAST_SEMESTER || game.graduating.includes(charId)
}

/**
 * The first names of everyone graduating whose name the reader knows, in roster order — who he
 * watches cross the stage.
 */
export function graduatingNames(): string[] {
  const game = useGameStore.getState()
  return game.graduating
    .filter((charId) => game.charInfo[charId]?.nameKnown)
    .map((charId) => game.characters[charId]?.firstName)
    .filter((name): name is string => Boolean(name))
}
