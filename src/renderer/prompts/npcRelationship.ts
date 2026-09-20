import { dormSpotLabel } from '@shared/dorms'
import { locationLabel, ROOM_LOCATION } from '@shared/locations'
import {
  npcBestFriendOf,
  npcPairOf,
  zoneOf,
  type NpcEncounter,
  type NpcRelationshipMap
} from '@shared/npcRelationships'
import {
  fullNameOf,
  type Character,
  type CharacterBehavior,
  type ClassEntry,
  type Haunt,
  type TimeSlot
} from '@shared/types'
import { formatWeekday } from './gameDate'

/**
 * What the cast think of *each other*, as RITA reads it. Pure formatters over the
 * pair map.
 */

/** How long an encounter is worth mentioning. Older than this and it is just history. */
const ENCOUNTER_DAYS = 7

/** `"today"`, `"yesterday"`, or the weekday it fell on. */
function whenClause(date: number, today: number): string {
  const days = today - date
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return `on ${formatWeekday(date)}`
}

/**
 * `"at the BTB Arcade"`, `"in Chloe's room"`, `"in Western Civ"`, `"in the Lowrise kitchen"`.
 */
function whereClause(
  encounter: NpcEncounter,
  classes: Record<string, ClassEntry>,
  characters: Record<string, Character>
): string {
  if (encounter.kind === 'class') {
    return `in ${classes[encounter.ref]?.name ?? encounter.ref}`
  }
  if (encounter.kind === 'dorm') {
    return `in ${dormSpotLabel(encounter.ref)}`
  }
  if (encounter.ref === ROOM_LOCATION) {
    const host = encounter.roomOf ? characters[encounter.roomOf] : undefined
    return host ? `in ${host.firstName}'s room` : 'in her room'
  }
  return `at ${locationLabel(encounter.ref)}`
}

/** The one sentence about a pair. */
function pairLine(
  a: Character,
  b: Character,
  relationships: NpcRelationshipMap,
  today: number,
  classes: Record<string, ClassEntry>,
  characters: Record<string, Character>
): string {
  const names = `${a.firstName} and ${b.firstName}`
  const pair = npcPairOf(relationships, a.charId, b.charId)
  if (!pair) return npcStandingLine(a, b, relationships)

  const zone = zoneOf(pair.affinity)
  const encounter = pair.encounter
  const fresh =
    encounter && today - encounter.date <= ENCOUNTER_DAYS && today - encounter.date >= 0
      ? encounter
      : null
  const event = fresh
    ? `${fresh.positive ? 'bonded' : 'argued'} ${whereClause(fresh, classes, characters)} ${whenClause(fresh.date, today)}`
    : null

  if (zone === 'neutral') {
    const base = npcStandingLine(a, b, relationships)
    return event ? `${base} They ${event}.` : base
  }

  const standing = zone === 'friends' ? `${names} are friends` : `${names} are enemies`
  if (!event) return `${standing}.`

  if (zone === 'friends') {
    return fresh?.positive
      ? `${standing}, and they ${event}.`
      : `${standing}, but they ${event}.`
  }
  return fresh?.positive
    ? `${standing} but they got a bit closer ${whereClause(fresh, classes, characters)} ${whenClause(fresh.date, today)}.`
    : `${standing} and they ${event}.`
}

/**
 * The bare standing between two characters — what {@link pairLine} opens with, and the
 * whole of an absent character's lorebook entry.
 */
export function npcStandingLine(
  a: Character,
  b: Character,
  relationships: NpcRelationshipMap
): string {
  const names = `${a.firstName} and ${b.firstName}`
  const pair = npcPairOf(relationships, a.charId, b.charId)
  if (!pair) return `${names} don't know each other yet.`
  const zone = zoneOf(pair.affinity)
  if (zone === 'friends') return `${names} are friends.`
  if (zone === 'enemies') return `${names} are enemies.`
  return `${names} know each other but aren't close.`
}

/** The one sentence naming a character's closest friend, or nothing at all. */
export function bestFriendLines(
  character: Character,
  roster: readonly Character[],
  relationships: NpcRelationshipMap
): string[] {
  const candidates = roster.filter((other) => other.charId !== character.charId)
  const best = npcBestFriendOf(
    relationships,
    character.charId,
    candidates.map((other) => other.charId)
  )
  const friend = candidates.find((other) => other.charId === best)
  return friend ? [`${character.firstName}'s closest friend is ${fullNameOf(friend)}.`] : []
}

/** What one cast member is called in a companion clause. */
export interface NpcCompanions {
  knownNames: readonly string[]
  unknown: number
}

/**
 * `"with Sarah"`, `"with Sarah and a friend"`, `"with friends"` — or `''` when she is on her
 * own.
 */
function companionClause(companions: NpcCompanions): string {
  const parts = [...companions.knownNames]
  if (companions.unknown === 1) parts.push('a friend')
  else if (companions.unknown > 1) parts.push(parts.length > 0 ? 'some friends' : 'friends')
  if (parts.length === 0) return ''
  if (parts.length === 1) return `with ${parts[0]}`
  return `with ${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/**
 * What she's doing at her own haunt, phrased by kind. `null` when there's nothing to name: a
 * room location, no haunt, a fun/grocery/room haunt, or an activity haunt left blank.
 */
export function hauntActivity(
  location: string,
  haunt: Haunt | null | undefined,
  time: TimeSlot
): string | null {
  if (location === ROOM_LOCATION || !haunt) return null
  const label = locationLabel(location)
  if (haunt.kind === 'study') return `studying at ${label}`
  if (haunt.kind === 'meal') return `having ${time === 1 ? 'dinner' : 'lunch'} at ${label}`
  if (haunt.kind === 'activity') return haunt.doing || null
  return null
}

/**
 * `"at the BTB Arcade"`, `"studying at the Kendall Library"`, `"having dinner at Bobby's Diner"`,
 * or the activity phrase itself — what she is doing where she is; a girl somewhere that is not
 * her own haunt, or with nothing to name there, is simply at it.
 */
export function hauntClause(
  location: string,
  haunt: Haunt | null | undefined,
  time: TimeSlot
): string {
  return (
    hauntActivity(location, haunt, time) ??
    (location === ROOM_LOCATION ? 'in her room' : `at ${locationLabel(location)}`)
  )
}

/**
 * The one sentence saying where a character is this hour and what she is doing there,
 * companions included — shared by texts and invitations.
 */
export function whereaboutsLine(
  firstName: string,
  location: string,
  companions: NpcCompanions,
  haunt?: Haunt | null,
  time: TimeSlot = 0
): string {
  const withWhom = companionClause(companions)
  const tail = withWhom ? ` ${withWhom}` : ''
  return `${firstName} is ${hauntClause(location, haunt, time)}${tail} right now.`
}

/** What the pair lines need, which is a slice of `ScenePromptState`. */
export interface NpcPairContext {
  date: number
  npcRelationships: NpcRelationshipMap
  classes: Record<string, ClassEntry>
  characters: Record<string, Character>
}

/** One line per pair of cast members, closing the cast block. */
export function npcPairLines(
  cast: readonly Character[],
  context: NpcPairContext
): string[] {
  if (cast.length < 2) return []
  const lines: string[] = ['']
  for (let i = 0; i < cast.length; i++) {
    for (let j = i + 1; j < cast.length; j++) {
      lines.push(
        pairLine(
          cast[i],
          cast[j],
          context.npcRelationships,
          context.date,
          context.classes,
          context.characters
        )
      )
    }
  }
  return lines
}

/** Fixed emission order, so the block does not move when the cast is reshuffled. */
const NPC_BEHAVIOR_ORDER: ReadonlyArray<keyof CharacterBehavior> = [
  'withStrangers',
  'withFriends',
  'withEnemy'
]

/**
 * How she behaves towards the *rest of the cast*, when that is not how she behaves towards the
 * reader.
 */
export function npcBehaviorLines(
  character: Character,
  cast: readonly Character[],
  relationships: NpcRelationshipMap,
  readerLevel: keyof CharacterBehavior
): string[] {
  const levels = new Set<keyof CharacterBehavior>()
  for (const other of cast) {
    if (other.charId === character.charId) continue
    const pair = npcPairOf(relationships, character.charId, other.charId)
    const zone = pair ? zoneOf(pair.affinity) : 'neutral'
    levels.add(
      zone === 'friends' ? 'withFriends' : zone === 'enemies' ? 'withEnemy' : 'withStrangers'
    )
  }
  const lines: string[] = []
  for (const level of NPC_BEHAVIOR_ORDER) {
    if (level === readerLevel || !levels.has(level)) continue
    const behavior = character.behavior[level]
    if (behavior) lines.push(behavior)
  }
  return lines
}
