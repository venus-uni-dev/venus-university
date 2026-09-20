import { affectionFor } from '@shared/relationship'
import type { EventCancellation } from '@shared/types'
import {
  isAwayForSpringBreak,
  pickSpringBreakLeavers,
  SPRING_BREAK_LEAVE,
  SPRING_BREAK_NOTICE,
  SPRING_BREAK_RETURN
} from '../../prompts/springBreak'
import { useGameStore } from '../gameStore'

/** Who leaves campus for spring break, where the pick meets the store. */

/** Settles the roster's spring break, once per playthrough. */
export function settleSpringBreak(): EventCancellation[] {
  const game = useGameStore.getState()
  if (game.springBreakAway !== null || game.date < SPRING_BREAK_NOTICE) return []

  const away = pickSpringBreakLeavers(game.chars, (charId) =>
    affectionFor(game.charInfo[charId], game.date, game.characters[charId])
  )
  game.setSpringBreakAway(away)
  if (away.length === 0) return []

  // Every date she already had in the week she will be out of the country, cancelled now.
  const cancellations: EventCancellation[] = []
  for (const event of game.events) {
    if (event.date < SPRING_BREAK_LEAVE || event.date >= SPRING_BREAK_RETURN) continue
    for (const charId of event.charIds) {
      if (!isAwayForSpringBreak(away, charId, event.date)) continue
      cancellations.push({ charId, date: event.date, time: event.time, reason: 'away' })
    }
  }
  useGameStore
    .getState()
    .withdrawFromEvents(away, SPRING_BREAK_LEAVE, SPRING_BREAK_RETURN)
  return cancellations
}
