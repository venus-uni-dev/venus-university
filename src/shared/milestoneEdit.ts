import { dispositionOf, emptyFlags, foldRelationshipEvents } from './relationship'
import { lockedMilestones, type SceneMilestone } from './sceneCreator'
import { hasTrait } from './traits'
import type { CharFlags, CharInfo, Character, RelationshipEvent } from './types'

/**
 * A girl's milestones set by hand from her contact page: the boxes read off her flags, the rule
 * that keeps them from contradicting each other in a game being played, and her entry with the
 * boxes the player changed applied as the game's own transitions.
 */

/** The milestones the edit offers, in the order the modal lists them. */
export const EDIT_MILESTONES = [
  'met',
  'contact',
  'lovers',
  'crush',
  'kissed',
  'sex',
  'broke_up',
  'friendzoned_by_reader',
  'friendzoned_reader',
  'agreed_to_harem',
  'blocked'
] as const satisfies readonly (SceneMilestone | 'contact' | 'blocked')[]
export type EditMilestone = (typeof EDIT_MILESTONES)[number]
export type EditMilestones = Record<EditMilestone, boolean>

/** What the rule reads about her besides the boxes themselves. */
export interface EditStanding {
  affection: number
  character: Pick<Character, 'traits'> | undefined
  /** A plan of the reader's with her is on the calendar from this slot on. */
  planAhead: boolean
}

/** Her boxes as her flags stand, an older save's missing flag reading as unset. */
export function milestonesOfFlags(flags: Partial<CharFlags> | undefined): EditMilestones {
  return {
    met: flags?.hasMet === true,
    contact: flags?.gaveContactInfo === true,
    lovers: flags?.isLover === true,
    crush: flags?.hasCrush === true,
    kissed: flags?.hasKissed === true,
    sex: flags?.hadSex === true,
    broke_up: (flags?.brokenUp ?? 0) > 0,
    friendzoned_by_reader: flags?.friendZoned === true,
    friendzoned_reader: flags?.friendZonedBy === true,
    agreed_to_harem: flags?.harem === true,
    blocked: flags?.blocked === true
  }
}

/**
 * The boxes the edit cannot leave as picked, each with the value it is held at: the Scene
 * Creator's rule but for sharing, which outlasts the relationship it was agreed in; no crush
 * below nothing, where her next scene would clear it; her number while a plan with her stands
 * ahead; and a block only on a number.
 */
export function editLocksOf(milestones: EditMilestones, standing: EditStanding): Partial<EditMilestones> {
  const locked: Partial<EditMilestones> = lockedMilestones(
    milestones,
    dispositionOf(standing.affection),
    standing.character
  )
  if (milestones.met && !hasTrait(standing.character, 'Promiscuous')) delete locked.agreed_to_harem
  if (standing.affection < 0 && !('crush' in locked)) locked.crush = false
  if (standing.planAhead) locked.contact = true
  if (!(locked.contact ?? milestones.contact)) locked.blocked = false
  return locked
}

/** The boxes with every lock applied. */
export function normalizedEditMilestones(
  milestones: EditMilestones,
  standing: EditStanding
): EditMilestones {
  return { ...milestones, ...editLocksOf(milestones, standing) }
}

/**
 * One box ticked or cleared, the two friendzones being one answer or the other, then every lock
 * applied.
 */
export function withEditMilestone(
  milestones: EditMilestones,
  key: EditMilestone,
  value: boolean,
  standing: EditStanding
): EditMilestones {
  const next = { ...milestones, [key]: value }
  if (value && key === 'friendzoned_by_reader') next.friendzoned_reader = false
  if (value && key === 'friendzoned_reader') next.friendzoned_by_reader = false
  return normalizedEditMilestones(next, standing)
}

/**
 * Her entry with every box that differs between `opened` and `picked` applied, the rest left as
 * they stand. A box ticked is the event a scene would report, folded as the ledger folds it, its
 * memories and dates included; Lovers cleared with Broke up ticked is a breakup, and alone is
 * never having dated; any other box cleared clears its milestone and no memory.
 */
export function withMilestonesEdited(
  info: CharInfo,
  opened: EditMilestones,
  picked: EditMilestones,
  date: number
): CharInfo {
  const on = (key: EditMilestone): boolean => !opened[key] && picked[key]
  const off = (key: EditMilestone): boolean => opened[key] && !picked[key]

  // Filled out first: an older save's flags can lack a key the transitions count on.
  const flags: CharFlags = { ...emptyFlags(), ...info.flags }
  if (off('met')) flags.hasMet = false
  if (on('met')) flags.hasMet = true
  if (off('kissed')) flags.hasKissed = false
  if (off('sex')) {
    flags.hadSex = false
    flags.benefits = false
  }
  if (off('crush')) flags.hasCrush = false
  if (on('crush')) flags.hasCrush = true
  if (off('friendzoned_by_reader')) flags.friendZoned = false
  if (off('friendzoned_reader')) flags.friendZonedBy = false
  if (off('agreed_to_harem')) flags.harem = false
  if (off('contact')) flags.gaveContactInfo = false
  if (opened.blocked !== picked.blocked) flags.blocked = picked.blocked
  if (off('broke_up')) flags.brokenUp = 0
  // Broken up before and his lover now: the count, with nothing ending today.
  if (on('broke_up') && picked.lovers) flags.brokenUp = Math.max(1, flags.brokenUp)
  const neverDated = off('lovers') && !picked.broke_up
  if (neverDated) flags.isLover = false

  let next: CharInfo = { ...info, flags }
  if (off('broke_up') || neverDated) {
    next = { ...next }
    delete next.brokeUpOn
    delete next.leftFor
    if (!picked.lovers) delete next.datingSince
  }

  // In the order the ledger's events are listed, so a night before getting together leaves no
  // benefits behind, as in a scene.
  const events: RelationshipEvent[] = []
  if (on('kissed')) events.push('kissed')
  if (on('sex')) events.push('sex')
  if (on('lovers')) events.push('became_lovers')
  // A breakup off a girl who was not his lover: the fold counts it but dates only a lover's.
  const exNow = on('broke_up') && !picked.lovers && !off('lovers')
  if ((off('lovers') && picked.broke_up) || exNow) events.push('broke_up')
  if (on('friendzoned_by_reader')) events.push('friendzoned_by_reader')
  if (on('friendzoned_reader')) events.push('friendzoned_reader')
  if (on('contact')) events.push('gave_contact_info')
  if (on('agreed_to_harem')) events.push('agreed_to_harem')
  if (events.length > 0) next = foldRelationshipEvents(next, events, date)
  if (exNow) next = { ...next, brokeUpOn: date }

  // Her number is a contact of his, and a contact is somebody whose name he knows.
  if (on('contact')) next = { ...next, nameKnown: true }

  // Told as new as a boundary that made it would tell it; a graduate is never counted again.
  if (next.pursuing === undefined && (on('lovers') || (on('crush') && !picked.lovers))) {
    next = { ...next, romanceScenes: 0 }
  }
  if (!next.flags.isLover && !next.flags.hasCrush && next.romanceScenes !== undefined) {
    next = { ...next }
    delete next.romanceScenes
  }
  return next
}
