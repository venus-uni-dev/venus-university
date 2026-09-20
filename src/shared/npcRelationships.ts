import type { Character, TimeSlot } from './types'
import { hasTrait } from './traits'

/**
 * How the roster feels about *each other* — the pair map, its zones, and every roll
 * that moves one.
 */

/** The band an affinity falls in. Strangers are the absence of an entry, not a band. */
export type NpcZone = 'friends' | 'neutral' | 'enemies'

/** The affinity a pair can hold, inclusive both ends. */
export const MIN_AFFINITY = -6
export const MAX_AFFINITY = 6

/** At or above is friends; at or below `-FRIENDS_AT` is enemies. */
const FRIENDS_AT = 4

/** The widest an affinity rolled at a first off-screen meeting can be. */
const MEETING_SPREAD = 4

/** What one pair did together, and how it went — at most one, newest overwriting. */
export interface NpcEncounter {
  /** The game date it happened, which is what ages it out of the cast block. */
  date: number
  kind: 'class' | 'hangout' | 'dorm'
  /**
   * A class code for `class`; a location id or `'room'` for `hangout`; a dorm spot id
   * for `dorm`.
   */
  ref: string
  /** It went well. False is an argument, which is what the prose reads off. */
  positive: boolean
  /** For `ref === 'room'`: whose room it was, so the line can name her. */
  roomOf?: string
}

/** One pair's standing. */
export interface NpcRelationship {
  /** {@link MIN_AFFINITY} to {@link MAX_AFFINITY}, inclusive. */
  affinity: number
  encounter?: NpcEncounter
}

/** Keyed by {@link pairKeyOf} — one entry per unordered pair, never two. */
export type NpcRelationshipMap = Record<string, NpcRelationship>

/** A set of characters spending one slot in one place. */
export interface NpcGroup {
  /** A location id, or `'room'` when they are in the host's room. */
  location: string
  /** Whose haunt or room this is; absent for a night out, which is nobody's. */
  host?: string
  /** charIds, one to three of them, the host included when there is one. */
  members: string[]
}

/** Who is with whom this slot, stamped with the slot it was rolled for. */
export interface NpcSlotOverlay {
  /** The slot this describes. */
  date: number
  time: TimeSlot
  groups: NpcGroup[]
  /**
   * Who spent this slot out — the weekend-fatigue debit. Not everyone in `groups`: being
   * pulled along costs nothing.
   */
  wentOut: string[]
}

/** The key for one unordered pair: sorted, so `(a, b)` and `(b, a)` are one entry. */
export function pairKeyOf(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

/** Holds an affinity inside the range; a step off either end is simply the end. */
function clampAffinity(affinity: number): number {
  return Math.max(MIN_AFFINITY, Math.min(MAX_AFFINITY, Math.round(affinity)))
}

/** Which band an affinity sits in. */
export function zoneOf(affinity: number): NpcZone {
  if (affinity >= FRIENDS_AT) return 'friends'
  if (affinity <= -FRIENDS_AT) return 'enemies'
  return 'neutral'
}

/** The pair's standing, or `undefined` for two strangers. */
export function npcPairOf(
  map: NpcRelationshipMap | undefined,
  a: string,
  b: string
): NpcRelationship | undefined {
  return map?.[pairKeyOf(a, b)]
}

/** Are these two friends? The one test the hangout passes are built on. */
export function areNpcFriends(map: NpcRelationshipMap | undefined, a: string, b: string): boolean {
  const pair = npcPairOf(map, a, b)
  return pair !== undefined && zoneOf(pair.affinity) === 'friends'
}

/**
 * One pair's **first** crossing into {@link zoneOf}'s friends band, stamped with the slot
 * it happened in — a permanent record on the save, which is what makes the feed say it once.
 */
export interface NpcFriendship {
  /** The pair, in {@link pairKeyOf}'s own order: `a < b`. */
  a: string
  b: string
  date: number
  time: TimeSlot
}

/**
 * Which pairs the settle just made friends **for the first time**: friends after, not before,
 * unrecorded. Pure. **The before-reading makes this a crossing, not a census**: without it every
 * standing friendship on a save with no record yet would report itself the next boundary.
 */
export function newFriendships(
  before: NpcRelationshipMap,
  after: NpcRelationshipMap,
  recorded: readonly Pick<NpcFriendship, 'a' | 'b'>[]
): Pick<NpcFriendship, 'a' | 'b'>[] {
  const known = new Set(recorded.map((pair) => pairKeyOf(pair.a, pair.b)))
  const fresh: Pick<NpcFriendship, 'a' | 'b'>[] = []
  for (const [key, pair] of Object.entries(after)) {
    if (zoneOf(pair.affinity) !== 'friends' || known.has(key)) continue
    const was = before[key]
    if (was !== undefined && zoneOf(was.affinity) === 'friends') continue
    // Every key here was minted by `pairKeyOf`, so the split is always the two ids.
    const [a, b] = key.split('|')
    fresh.push({ a, b })
  }
  return fresh
}

/**
 * Who each character spent the slot with, off the slot's encounter groups: the other
 * members of every group she is in, deduped, herself excluded.
 */
export function listenersOf(groups: readonly NpcEncounterGroup[]): Record<string, string[]> {
  const listeners: Record<string, Set<string>> = {}
  for (const group of groups) {
    for (const member of group.members) {
      const set = (listeners[member] ??= new Set())
      for (const other of group.members) {
        if (other !== member) set.add(other)
      }
    }
  }
  const result: Record<string, string[]> = {}
  for (const [charId, set] of Object.entries(listeners)) {
    result[charId] = [...set]
  }
  return result
}

/** Everyone `charId` counts as a friend, in roster order. */
export function npcFriendsOf(
  map: NpcRelationshipMap | undefined,
  charId: string,
  roster: readonly string[]
): string[] {
  return roster.filter((other) => other !== charId && areNpcFriends(map, charId, other))
}

/** Everyone `charId` counts as an enemy, in roster order — {@link npcFriendsOf}'s mirror. */
export function npcEnemiesOf(
  map: NpcRelationshipMap | undefined,
  charId: string,
  roster: readonly string[]
): string[] {
  const enemy = (other: string): boolean => {
    const pair = npcPairOf(map, charId, other)
    return pair !== undefined && zoneOf(pair.affinity) === 'enemies'
  }
  return roster.filter((other) => other !== charId && enemy(other))
}

/**
 * Whoever out of `candidates` `charId` is closest to, or null where none of them is a friend
 * at all — the one the prompts name as her best friend.
 */
export function npcBestFriendOf(
  map: NpcRelationshipMap | undefined,
  charId: string,
  candidates: readonly string[]
): string | null {
  let best: string | null = null
  let bestAffinity = -Infinity
  for (const other of npcFriendsOf(map, charId, candidates)) {
    const affinity = npcPairOf(map, charId, other)?.affinity ?? 0
    if (affinity <= bestAffinity) continue
    best = other
    bestAffinity = affinity
  }
  return best
}

/** One character as the initial deal reads her: her id and her year. */
export interface NpcRosterEntry {
  charId: string
  year: number
}

/** The relationships a playthrough starts with, rolled once at New Game. */
export function rollInitialNpcRelationships(
  roster: readonly NpcRosterEntry[],
  rand: () => number = Math.random
): NpcRelationshipMap {
  const map: NpcRelationshipMap = {}
  for (let i = 0; i < roster.length; i++) {
    for (let j = i + 1; j < roster.length; j++) {
      const a = roster[i]
      const b = roster[j]
      if (a.year === 1 || b.year === 1) continue
      if (rand() < 0.5) continue
      map[pairKeyOf(a.charId, b.charId)] = { affinity: rollAffinitySpread(rand, MAX_AFFINITY) }
    }
  }
  return map
}

/** A uniform integer in `[-spread, spread]`. */
function rollAffinitySpread(rand: () => number, spread: number): number {
  return Math.floor(rand() * (spread * 2 + 1)) - spread
}

/** What two strangers who just met off-screen think of each other, within ±MEETING_SPREAD. */
export function rollMeetingAffinity(rand: () => number = Math.random): number {
  return rollAffinitySpread(rand, MEETING_SPREAD)
}

/**
 * The base odds by where the pair already stands, in percentage points: making up is easier
 * than becoming close, and a friendship takes upkeep.
 */
const UP_PERCENT = { sour: 65, warming: 60, close: 50 }

/** What either of the two social traits is worth on top, in the same points. */
const TRAIT_PERCENT = 10

/**
 * The odds an encounter between these two goes *well* — where they already stand, and what
 * the two social traits do to it.
 */
export function affinityUpChance(
  a: Character | undefined,
  b: Character | undefined,
  affinity: number
): number {
  const base =
    affinity >= FRIENDS_AT
      ? UP_PERCENT.close
      : affinity < 0
        ? UP_PERCENT.sour
        : UP_PERCENT.warming
  const disagreeable = hasTrait(a, 'Disagreeable') || hasTrait(b, 'Disagreeable')
  const goodNatured = hasTrait(a, 'Good-natured') || hasTrait(b, 'Good-natured')
  if (disagreeable === goodNatured) return base / 100
  return (base + (goodNatured ? TRAIT_PERCENT : -TRAIT_PERCENT)) / 100
}

/** One set of people who were together this slot, as the settle pass reads it. */
export interface NpcEncounterGroup {
  kind: NpcEncounter['kind']
  /** The class code or the location id — what the encounter records and the prose prints. */
  ref: string
  members: readonly string[]
  /** Whose room, when `ref` is `'room'`. */
  host?: string
}

/** Everything {@link settleNpcPairs} folds over. Pure in, pure out. */
export interface NpcSettleInput {
  /** The date the encounters are stamped with — the slot that just finished. */
  date: number
  relationships: NpcRelationshipMap
  /** The scene's cast, whose pairs the roll does not touch. */
  cast: readonly string[]
  /**
   * Whoever came out of the scene liking the reader — the cast members whose memories of it
   * are net positive.
   */
  bonded?: readonly string[]
  groups: readonly NpcEncounterGroup[]
  characters: Record<string, Character>
}

/**
 * The slot's affinity movement: who met, who got on, and what each pair now thinks of
 * the other.
 */
export function settleNpcPairs(
  input: NpcSettleInput,
  rand: () => number = Math.random
): NpcRelationshipMap {
  const { date, cast, groups, characters } = input
  const next: NpcRelationshipMap = { ...input.relationships }
  const inScene = new Set(cast)

  // Two strangers who shared the scene have met, whatever else the hour did.
  for (let i = 0; i < cast.length; i++) {
    for (let j = i + 1; j < cast.length; j++) {
      const key = pairKeyOf(cast[i], cast[j])
      if (next[key] === undefined) next[key] = { affinity: 0 }
    }
  }

  // Everybody the hour went well for, with each other: cast only, one step up, no encounter.
  const bonded = (input.bonded ?? []).filter((charId) => inScene.has(charId))
  for (let i = 0; i < bonded.length; i++) {
    for (let j = i + 1; j < bonded.length; j++) {
      const key = pairKeyOf(bonded[i], bonded[j])
      const current = next[key]
      next[key] = { ...current, affinity: clampAffinity((current?.affinity ?? 0) + 1) }
    }
  }

  for (const group of groups) {
    const members = group.members
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const [a, b] = [members[i], members[j]]
        if (inScene.has(a) || inScene.has(b)) continue

        const key = pairKeyOf(a, b)
        const current = next[key]
        const encounter: NpcEncounter = {
          date,
          kind: group.kind,
          ref: group.ref,
          positive: true,
          ...(group.host ? { roomOf: group.host } : {})
        }

        if (current === undefined) {
          // A first meeting rolls its own start.
          const affinity = rollMeetingAffinity(rand)
          next[key] = { affinity, encounter: { ...encounter, positive: affinity >= 0 } }
          continue
        }

        const up = rand() < affinityUpChance(characters[a], characters[b], current.affinity)
        next[key] = {
          affinity: clampAffinity(current.affinity + (up ? 1 : -1)),
          encounter: { ...encounter, positive: up }
        }
      }
    }
  }

  return next
}
