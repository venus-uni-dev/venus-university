import { coldPassOf, COLD_READER, type ColdContact, type ColdContactKind } from '@shared/colds'
import { globalSlotOf } from '@shared/jobs'
import {
  npcPairOf,
  type NpcEncounterGroup,
  type NpcRelationshipMap
} from '@shared/npcRelationships'
import { tierOf, type PlayerStats } from '@shared/playerStats'
import type { ColdPass, LedgerResponse } from '@shared/types'
import { isGraduationSlot } from '../../prompts/graduation'
import { useGameStore } from '../gameStore'
import { ledgerActs } from '../sceneSanitizer'
import { charAwayNow } from '../timetable'

/** Who caught a cold in the finished slot, where the pass meets the store. */

/**
 * What one encounter group was, as the odds name it: a lecture, a slot the overlay spent together,
 * or a run-in — in a dorm's shared rooms, or the pairs bumping into each other out on campus.
 */
function contactKindOf(group: NpcEncounterGroup): ColdContactKind {
  if (group.kind === 'class') return 'lecture'
  if (group.kind === 'dorm') return 'runIn'
  const { npcOverlay: overlay, date, time } = useGameStore.getState()
  const stamped = overlay && overlay.date === date && overlay.time === time ? overlay : null
  const spent = stamped?.groups.some(
    (held) =>
      held.members.length === group.members.length &&
      held.members.every((member) => group.members.includes(member))
  )
  return spent ? 'hangout' : 'runIn'
}

/**
 * One encounter group's contacts: the group as one, or, where a couple spent it together outside
 * a lecture, pair by pair, the couple's own as close as a private scene.
 */
function groupContacts(group: NpcEncounterGroup, relationships: NpcRelationshipMap): ColdContact[] {
  const kind = contactKindOf(group)
  const { members } = group
  const dating = (a: string, b: string): boolean =>
    npcPairOf(relationships, a, b)?.dating !== undefined
  const couple =
    group.kind !== 'class' &&
    members.some((a, i) => members.slice(i + 1).some((b) => dating(a, b)))
  if (!couple) return [{ kind, members }]
  const contacts: ColdContact[] = []
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const pair = [members[i], members[j]]
      contacts.push({ kind: dating(pair[0], pair[1]) ? 'private' : kind, members: pair })
    }
  }
  return contacts
}

/**
 * Rolls who caught a cold in the finished slot off everybody who was together in it — the scene,
 * its kisses and nights, and `groups`, the slot's own encounters — and whether a new strain
 * reached campus, writing nothing. `stats` are the reader's after the scene.
 */
export function rollColdPass(
  ledger: LedgerResponse | null,
  groups: readonly NpcEncounterGroup[],
  stats: PlayerStats
): ColdPass {
  const game = useGameStore.getState()
  const { date, time } = game
  // The roster alone: a graduate back for Homecoming catches nothing and passes nothing on.
  const cast = game.cast.filter((charId) => game.chars.includes(charId))

  const contacts: ColdContact[] = []
  if (cast.length > 0) {
    contacts.push({ kind: game.sceneInPublic ? 'public' : 'private', members: [COLD_READER, ...cast] })
  }
  for (const act of ledgerActs(ledger, false)) {
    const members = act.charIds.filter((charId) => cast.includes(charId))
    if (members.length > 0) contacts.push({ kind: act.kind, members: [COLD_READER, ...members] })
  }
  for (const group of groups) contacts.push(...groupContacts(group, game.npcRelationships))

  return coldPassOf({
    slot: globalSlotOf(date, time),
    // Never on the first day of a semester or its last.
    seedable: date >= 1 && !isGraduationSlot(date, time),
    present: game.chars.filter((charId) => !charAwayNow(charId, date)),
    girls: game.charInfo,
    reader: { cold: game.readerCold ?? undefined, coldsHad: game.readerColdsHad },
    bodyTier: tierOf(stats.body),
    contacts
  })
}
