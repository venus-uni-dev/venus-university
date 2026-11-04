import { settleDating } from '@shared/dating'
import type { EditMilestone, EditMilestones } from '@shared/milestoneEdit'
import type { IntimateAct } from '@shared/types'
import { useGameStore } from './gameStore'
import { datingInputOf } from './sceneSanitizer'
import { addContact, blockContact, unblockContact } from './textingLoop'

/**
 * A girl's milestones saved from her contact page: the boxes the player changed applied as the
 * game's own transitions, then everything a scene reaching them sets off — her first impression,
 * her number's line and BunnyMap, a block's line, the dating pass with its breakups owed to the
 * next opening, and a kiss or a night on his tallies.
 */
export function saveMilestones(
  charId: string,
  opened: EditMilestones,
  picked: EditMilestones
): void {
  const game = useGameStore.getState()
  // Taken before anything writes: the dating pass is a diff across the whole save.
  const before = game.charInfo
  const on = (key: EditMilestone): boolean => !opened[key] && picked[key]

  if (on('met')) game.markMet([charId])
  // Ahead of the transitions, so `addContact` still sees her number missing and posts its line.
  if (on('contact')) addContact(charId, 0)
  if (on('blocked')) blockContact(charId, 0)
  // A block cleared because her number went is no unblocking: she is no contact of his at all.
  else if (opened.blocked && !picked.blocked && picked.contact) unblockContact(charId, 0)

  useGameStore.getState().editMilestones(charId, opened, picked)

  const live = useGameStore.getState()
  const dating = settleDating(datingInputOf(before, live.charInfo, live.date))
  live.applyDatingSettle(dating)
  useGameStore.getState().addBreakupsOwed(dating.breakups)

  const acts: IntimateAct[] = []
  if (on('kissed')) acts.push({ kind: 'kiss', inPublic: false, charIds: [charId] })
  if (on('sex')) acts.push({ kind: 'sex', inPublic: false, charIds: [charId] })
  if (acts.length > 0) useGameStore.getState().recordActs(acts)
}
