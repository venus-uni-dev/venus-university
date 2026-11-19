import { genderOf } from './gender'
import {
  AFFAIR_FRIEND_DROP,
  AFFAIR_HEARD_DROP,
  AFFAIR_SEEN_DROP,
  BREAKUP_CHANCE,
  BREAKUP_CRUSH_FACTOR,
  CONFESSION_ACCEPT_CHANCE,
  COUPLE_CHANCE,
  CRUSH_CHANCE,
  HONEYMOON_DAYS,
  INITIAL_PAIR_SKIP_CHANCE,
  LONG_DISTANCE_GOOD_CHANCE,
  LONG_DISTANCE_STEP_CHANCE,
  ROMANCE_TRAIT_FACTOR,
  SEEN_TOGETHER_CHANCE,
  TAKEN_CRUSH_FACTOR,
  TRAIT_PERCENT,
  UP_PERCENT
} from './odds'
import { pick } from './shuffle'
import type { Attraction, Character, CharFlags, CharInfo, TimeSlot } from './types'
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

/** The kinds of place a pair can meet in. */
export type NpcMeetingKind = 'class' | 'hangout' | 'dorm'

/** What one pair did together, and how it went. */
export interface NpcMeeting {
  /** The game date it happened, which is what ages it out of the cast block. */
  date: number
  kind: NpcMeetingKind
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

/** The day a pair got together, or broke up. */
export interface NpcCoupleEvent {
  date: number
  kind: 'together' | 'brokeUp'
}

/** The day `by` disliked seeing the other of this pair together with `of`, her crush. */
export interface NpcJealousy {
  date: number
  kind: 'jealous'
  by: string
  of: string
}

/** The day `by` found out that the other of this pair, `by`'s partner, cheated with the reader. */
export interface NpcFoundOut {
  date: number
  kind: 'foundOut'
  by: string
}

/** The day `by` disliked that the other of this pair cheated with the reader on `of`, `by`'s friend. */
export interface NpcSided {
  date: number
  kind: 'sided'
  by: string
  of: string
}

/** The day `by` turned down the other of this pair, who had asked `by` out on the reader's advice. */
export interface NpcTurnedDown {
  date: number
  kind: 'turnedDown'
  by: string
}

/** A pair's last event — a meeting, or something that happened between them — newest overwriting. */
export type NpcEncounter =
  | NpcMeeting
  | NpcCoupleEvent
  | NpcJealousy
  | NpcFoundOut
  | NpcSided
  | NpcTurnedDown

/** Whether a pair's last event was a meeting somewhere. */
export function isNpcMeeting(encounter: NpcEncounter): encounter is NpcMeeting {
  return encounter.kind === 'class' || encounter.kind === 'hangout' || encounter.kind === 'dorm'
}

/** One pair's standing. */
export interface NpcRelationship {
  /** {@link MIN_AFFINITY} to {@link MAX_AFFINITY}, inclusive. */
  affinity: number
  encounter?: NpcEncounter
  /** Which of the two hold a crush on the other, sorted; absent rather than empty. */
  crush?: string[]
  /**
   * Which of those holders have asked the reader for advice about it, sorted; never anybody not
   * in {@link crush}, so a crush that ends and comes back may be asked about again.
   */
  crushAsked?: string[]
  /** The date the two got together, while they are dating. */
  dating?: number
  /** The date the two last broke up. */
  ended?: number
  /** Whoever of the two was found cheating on the other with the reader, and the day it was last found out; never cleared. */
  cheated?: Record<string, number>
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

/** One pair getting together, stamped with the slot it happened in — a permanent record on the save. */
export interface NpcCouple {
  /** The pair, in {@link pairKeyOf}'s own order: `a < b`. */
  a: string
  b: string
  date: number
  time: TimeSlot
}

/**
 * Which pairs the settle just made a couple: dating after on a date they were not dating on
 * before, and not recorded under that date. Pure; a pair that gets back together is new again.
 */
export function newCouples(
  before: NpcRelationshipMap,
  after: NpcRelationshipMap,
  recorded: readonly Pick<NpcCouple, 'a' | 'b' | 'date'>[]
): Pick<NpcCouple, 'a' | 'b' | 'date'>[] {
  const known = new Set(recorded.map((couple) => `${pairKeyOf(couple.a, couple.b)}@${couple.date}`))
  const fresh: Pick<NpcCouple, 'a' | 'b' | 'date'>[] = []
  for (const [key, pair] of Object.entries(after)) {
    if (pair.dating === undefined || pair.dating === before[key]?.dating) continue
    if (known.has(`${key}@${pair.dating}`)) continue
    const [a, b] = key.split('|')
    fresh.push({ a, b, date: pair.dating })
  }
  return fresh
}

/**
 * Who may date several people at once, the reader among them, and who never cheats or resents:
 * a Promiscuous character, unless she is the reader's lover and has agreed to see only him.
 */
export function isOpen(
  character: Pick<Character, 'traits'> | undefined,
  flags?: Pick<CharFlags, 'isLover' | 'harem'>
): boolean {
  return hasTrait(character, 'Promiscuous') && !(flags?.isLover === true && !flags.harem)
}

/**
 * Whether `charId` may start dating somebody on `map`: open, or neither dating anybody nor the
 * reader's lover. Who is on the roster is the caller's to test.
 */
export function isFreeToDate(
  map: NpcRelationshipMap | undefined,
  charId: string,
  character: Pick<Character, 'traits'> | undefined,
  flags?: Pick<CharFlags, 'isLover' | 'harem'>
): boolean {
  if (isOpen(character, flags)) return true
  return !isNpcTaken(map, charId) && flags?.isLover !== true
}

/** Whether `holder` has already asked the reader about her crush on `target`. */
export function crushAskedOf(
  map: NpcRelationshipMap | undefined,
  holder: string,
  target: string
): boolean {
  return npcPairOf(map, holder, target)?.crushAsked?.includes(holder) === true
}

/**
 * The map with `holder`'s crush on `target` marked as taken to the reader — the same map where
 * she holds none or it is marked already.
 */
export function withCrushAsked(
  map: NpcRelationshipMap,
  holder: string,
  target: string
): NpcRelationshipMap {
  const key = pairKeyOf(holder, target)
  const pair = map[key]
  if (!pair?.crush?.includes(holder) || pair.crushAsked?.includes(holder)) return map
  return { ...map, [key]: { ...pair, crushAsked: [...(pair.crushAsked ?? []), holder].sort() } }
}

/** The other of a pair key's two ids. */
function otherOf(key: string, charId: string): string | null {
  const [a, b] = key.split('|')
  if (a === charId) return b
  if (b === charId) return a
  return null
}

/** Everyone `charId` is dating, in `among`'s order. */
export function npcPartnersOf(
  map: NpcRelationshipMap | undefined,
  charId: string,
  among: readonly string[]
): string[] {
  return among.filter(
    (other) => other !== charId && npcPairOf(map, charId, other)?.dating !== undefined
  )
}

/** Everyone `charId` holds a crush on, in `among`'s order. */
export function npcCrushesOf(
  map: NpcRelationshipMap | undefined,
  charId: string,
  among: readonly string[]
): string[] {
  return among.filter(
    (other) =>
      other !== charId && npcPairOf(map, charId, other)?.crush?.includes(charId) === true
  )
}

/** Whether `charId` is dating anybody at all. */
export function isNpcTaken(map: NpcRelationshipMap | undefined, charId: string): boolean {
  return Object.entries(map ?? {}).some(
    ([key, pair]) => pair.dating !== undefined && otherOf(key, charId) !== null
  )
}

/**
 * Whether a couple is inside the days after getting together, when nothing can part them. An
 * affair found out since they got together ends it.
 */
export function inHoneymoon(pair: NpcRelationship, today: number): boolean {
  const since = pair.dating
  if (since === undefined || today - since >= HONEYMOON_DAYS) return false
  return !Object.values(pair.cheated ?? {}).some((day) => day >= since)
}

/** Whether a couple is happy: still in the honeymoon, or friends. Rocky otherwise. */
export function isHappyCouple(pair: NpcRelationship, today: number): boolean {
  return pair.dating !== undefined && (inHoneymoon(pair, today) || zoneOf(pair.affinity) === 'friends')
}

/**
 * What a taken character's odds of falling for the reader are multiplied by: 1 for one who is
 * single or open, nothing while every couple she is in is happy, a tenth while one is rocky.
 */
export function readerCrushFactorOf(
  map: NpcRelationshipMap | undefined,
  charId: string,
  character: Pick<Character, 'traits'> | undefined,
  today: number
): number {
  if (isOpen(character)) return 1
  const couples = Object.entries(map ?? {}).filter(
    ([key, pair]) => pair.dating !== undefined && otherOf(key, charId) !== null
  )
  if (couples.length === 0) return 1
  return couples.every(([, pair]) => isHappyCouple(pair, today)) ? 0 : TAKEN_CRUSH_FACTOR
}

/**
 * `charInfo` with the crush on the reader and the friends-with-benefits standing gone from each
 * member of a new couple who is not open — the same object where neither was set.
 */
export function withCouplesFormed(
  charInfo: Readonly<Record<string, CharInfo>>,
  couples: readonly Pick<NpcCouple, 'a' | 'b'>[],
  characters: Readonly<Record<string, Pick<Character, 'traits'> | undefined>>
): Record<string, CharInfo> {
  let projected: Record<string, CharInfo> | null = null
  for (const couple of couples) {
    for (const charId of [couple.a, couple.b]) {
      const info = (projected ?? charInfo)[charId]
      const flags = info?.flags
      if (isOpen(characters[charId], flags)) continue
      if (!info || !flags || (!flags.hasCrush && !flags.benefits)) continue
      projected ??= { ...charInfo }
      projected[charId] = { ...info, flags: { ...flags, hasCrush: false, benefits: false } }
    }
  }
  return projected ?? (charInfo as Record<string, CharInfo>)
}

/** One character leaving a character she was dating, for the reader. */
export interface NpcCoupleLeft {
  charId: string
  partner: string
}

/**
 * The map with each couple in `left` broken up on `date`, at no cost to the pair's number — the
 * same map where none of them was still dating.
 */
export function withCouplesLeft(
  map: NpcRelationshipMap,
  left: readonly NpcCoupleLeft[],
  date: number
): NpcRelationshipMap {
  let next: NpcRelationshipMap | null = null
  for (const { charId, partner } of left) {
    const key = pairKeyOf(charId, partner)
    const pair = (next ?? map)[key]
    if (pair?.dating === undefined) continue
    const { dating: _dating, ...rest } = pair
    next ??= { ...map }
    next[key] = { ...rest, ended: date, encounter: { date, kind: 'brokeUp' } }
  }
  return next ?? map
}

/** A character finding out her partner cheated on her with the reader: by seeing it, or hearing it. */
export interface NpcAffair {
  cheater: string
  partner: string
  saw: boolean
}

/** A friend of the one cheated on, who saw or heard it, holding it against the one who cheated. */
export interface NpcSiding {
  by: string
  cheater: string
  partner: string
}

/** A pair entry holding no crush while it stands below 0. */
function withCrushesSettled(pair: NpcRelationship): NpcRelationship {
  return pair.crush && pair.affinity < 0 ? withCrushHolders(pair, []) : pair
}

/**
 * The map with the slot's affairs found out: each couple drops further for one seen than for one
 * heard and records who cheated and when, and each friend of the one cheated on who knew them
 * already drops a step with the one who cheated. The same map where nothing moved.
 */
export function withAffairsFound(
  map: NpcRelationshipMap,
  affairs: readonly NpcAffair[],
  sided: readonly NpcSiding[],
  date: number
): NpcRelationshipMap {
  let next: NpcRelationshipMap | null = null
  const put = (key: string, pair: NpcRelationship): void => {
    next ??= { ...map }
    next[key] = withCrushesSettled(pair)
  }
  for (const { cheater, partner, saw } of affairs) {
    const key = pairKeyOf(cheater, partner)
    const pair = (next ?? map)[key]
    if (pair?.dating === undefined) continue
    const drop = saw ? AFFAIR_SEEN_DROP : AFFAIR_HEARD_DROP
    put(key, {
      ...pair,
      affinity: clampAffinity(pair.affinity - drop),
      cheated: { ...pair.cheated, [cheater]: date },
      encounter: { date, kind: 'foundOut', by: partner }
    })
  }
  for (const { by, cheater, partner } of sided) {
    const key = pairKeyOf(by, cheater)
    const pair = (next ?? map)[key]
    if (pair === undefined) continue
    put(key, {
      ...pair,
      affinity: clampAffinity(pair.affinity - AFFAIR_FRIEND_DROP),
      encounter: { date, kind: 'sided', by, of: partner }
    })
  }
  return next ?? map
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
 * Whoever out of `candidates` `charId` is closest to, anyone she is dating passed over, or null
 * where none of the rest is a friend at all — the one the prompts name as her best friend.
 */
export function npcBestFriendOf(
  map: NpcRelationshipMap | undefined,
  charId: string,
  candidates: readonly string[]
): string | null {
  let best: string | null = null
  let bestAffinity = -Infinity
  for (const other of npcFriendsOf(map, charId, candidates)) {
    const pair = npcPairOf(map, charId, other)
    if (pair?.dating !== undefined) continue
    const affinity = pair?.affinity ?? 0
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
      if (rand() < INITIAL_PAIR_SKIP_CHANCE) continue
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
  kind: NpcMeetingKind
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
  /** Who is on the roster, the only ones who fall for anybody; absent, nobody's love life moves. */
  roster?: readonly string[]
  /** Who has graduated, whose couples with the roster are long-distance. */
  alumni?: readonly string[]
  /** Who each character is attracted to in this playthrough, by charId. */
  attraction?: Readonly<Record<string, Attraction>>
  /** Who holds a crush on the reader. */
  readerCrush?: readonly string[]
  /** The reader's lovers. */
  readerLovers?: readonly string[]
  /** The reader's lovers who have not agreed to share him, whom a Promiscuous trait leaves closed. */
  readerClosed?: readonly string[]
  /** The slot that just finished was a night, when a long-distance couple talks. */
  night?: boolean
  /** What the reader answered each character who vented to him or asked his advice this slot. */
  advice?: readonly NpcAdvice[]
}

/**
 * The reader's answer to one character's text: `breakUp` or `talk` to one venting about `about`,
 * her partner; `yes` or `no` to one asking whether to ask out `about`, her crush.
 */
export interface NpcAdvice {
  charId: string
  about: string
  answer: 'breakUp' | 'talk' | 'yes' | 'no'
}

/** What one piece of the reader's advice came to, which she texts him about. */
export interface NpcAdviceOutcome {
  charId: string
  about: string
  result: 'together' | 'turnedDown' | 'brokeUp'
}

/** Everything one settle decided: the map, and what the texts read off it. */
export interface NpcSettleResult {
  relationships: NpcRelationshipMap
  /** The couples who argued past their honeymoon and are still together, sorted, once each. */
  argued: Pick<NpcCouple, 'a' | 'b'>[]
  outcomes: NpcAdviceOutcome[]
}

/** A pair entry with its crush holders set, the field absent where nobody holds one. */
function withCrushHolders(pair: NpcRelationship, holders: readonly string[]): NpcRelationship {
  const { crush: _crush, crushAsked: _asked, ...rest } = pair
  if (holders.length === 0) return rest
  const asked = (pair.crushAsked ?? []).filter((holder) => holders.includes(holder))
  return {
    ...rest,
    crush: [...holders].sort(),
    ...(asked.length > 0 ? { crushAsked: asked.sort() } : {})
  }
}

/**
 * The love-life half of the settle, over the map it is folding: who falls for whom, who gets
 * together, who breaks up. Every rule reads the live map, so one slot cannot give somebody who is
 * not open two partners.
 */
function loveLifeOf(
  next: NpcRelationshipMap,
  input: NpcSettleInput & { roster: readonly string[] },
  rand: () => number
) {
  const { date, characters } = input
  const roster = new Set(input.roster)
  const alumni = new Set(input.alumni ?? [])
  const readerCrush = new Set(input.readerCrush ?? [])
  const readerLovers = new Set(input.readerLovers ?? [])
  const readerClosed = new Set(input.readerClosed ?? [])
  const open = (charId: string): boolean =>
    isOpen(characters[charId]) && !readerClosed.has(charId)
  const trait = (charId: string, name: Parameters<typeof hasTrait>[1]): boolean =>
    hasTrait(characters[charId], name)

  /** Each holds the other's gender among those she is attracted to. */
  const attracted = (a: string, b: string): boolean => {
    const ofA = input.attraction?.[a]
    const ofB = input.attraction?.[b]
    return Boolean(ofA?.[genderOf(characters[b])] && ofB?.[genderOf(characters[a])])
  }
  const taken = (charId: string): boolean => isNpcTaken(next, charId)
  const freeToDate = (charId: string): boolean =>
    roster.has(charId) && (open(charId) || (!taken(charId) && !readerLovers.has(charId)))
  /** She holds a crush on somebody other than `partner`, the reader counted. */
  const crushElsewhere = (charId: string, partner: string): boolean =>
    readerCrush.has(charId) ||
    Object.entries(next).some(([key, pair]) => {
      const other = otherOf(key, charId)
      return other !== null && other !== partner && pair.crush?.includes(charId) === true
    })

  /** Takes every crush `charId` holds off the map, but the one on `except`. */
  const dropCrushesOf = (charId: string, except?: string): void => {
    for (const [key, pair] of Object.entries(next)) {
      const other = otherOf(key, charId)
      if (other === null || other === except || !pair.crush?.includes(charId)) continue
      next[key] = withCrushHolders(pair, pair.crush.filter((holder) => holder !== charId))
    }
  }

  /** A pair below 0 holds no crush either way. */
  const settleCrushes = (key: string): void => {
    next[key] = withCrushesSettled(next[key])
  }

  /** The odds `holder` falls for `target`, or 0 where she cannot. */
  const crushOdds = (holder: string, target: string): number => {
    if (!roster.has(holder) || !roster.has(target)) return 0
    if (readerLovers.has(holder) && !open(holder)) return 0
    if (!attracted(holder, target)) return 0
    let odds = CRUSH_CHANCE
    if (trait(target, 'Good-natured') || trait(holder, 'Promiscuous')) odds *= ROMANCE_TRAIT_FACTOR
    if (trait(target, 'Disagreeable') || trait(holder, 'High Standards')) odds /= ROMANCE_TRAIT_FACTOR
    if (taken(holder) && !open(holder)) odds *= TAKEN_CRUSH_FACTOR
    return odds
  }

  /** Breaks a couple up on the roll, at no further cost to the pair; true where it did. */
  const rollBreakUp = (key: string, a: string, b: string): boolean => {
    let odds = BREAKUP_CHANCE
    if ([a, b].some((id) => trait(id, 'Disagreeable') || trait(id, 'High Standards'))) {
      odds *= ROMANCE_TRAIT_FACTOR
    }
    if ([a, b].some((id) => trait(id, 'Good-natured') || trait(id, 'Promiscuous'))) {
      odds /= ROMANCE_TRAIT_FACTOR
    }
    if (crushElsewhere(a, b) || crushElsewhere(b, a)) odds *= BREAKUP_CRUSH_FACTOR
    if (rand() >= odds) return false
    const { dating: _dating, ...rest } = next[key]
    next[key] = { ...rest, ended: date, encounter: { date, kind: 'brokeUp' } }
    return true
  }

  /** Puts two together, ending every other crush of whichever of them is not open. */
  const getTogether = (key: string, a: string, b: string): void => {
    next[key] = { ...withCrushHolders(next[key], []), dating: date, encounter: { date, kind: 'together' } }
    if (!open(a)) dropCrushesOf(a, b)
    if (!open(b)) dropCrushesOf(b, a)
  }

  /** The couples who argued past their honeymoon and stayed together, by key. */
  const argued = new Set<string>()

  // Somebody the reader is dating, and not open, has nobody else in mind.
  for (const charId of readerLovers) if (!open(charId)) dropCrushesOf(charId)

  return {
    argued,

    /**
     * The reader's answers to this slot's vents and requests for advice, taken before the
     * meetings; returns what each came to that she texts him about.
     */
    advise(advice: readonly NpcAdvice[]): NpcAdviceOutcome[] {
      const outcomes: NpcAdviceOutcome[] = []
      for (const { charId, about, answer } of advice) {
        const key = pairKeyOf(charId, about)
        const pair = next[key]
        if (pair === undefined || charId === about) continue

        if (answer === 'breakUp' || answer === 'talk') {
          if (pair.dating === undefined) continue
          const kept = inHoneymoon(pair, date)
          if (answer === 'talk') {
            next[key] = { ...pair, affinity: clampAffinity(pair.affinity + 1) }
            continue
          }
          // A step down, as an argument is; a couple it leaves below friends may part.
          next[key] = { ...pair, affinity: kept ? pair.affinity : clampAffinity(pair.affinity - 1) }
          if (!kept && zoneOf(next[key].affinity) !== 'friends' && rollBreakUp(key, charId, about)) {
            outcomes.push({ charId, about, result: 'brokeUp' })
          }
          settleCrushes(key)
          continue
        }

        if (!pair.crush?.includes(charId) || pair.dating !== undefined) continue
        if (answer === 'no') {
          next[key] = withCrushHolders(pair, pair.crush.filter((holder) => holder !== charId))
          continue
        }
        // A yes to somebody who is no longer free to date, either of them, comes to nothing.
        if (!freeToDate(charId) || !freeToDate(about) || !attracted(charId, about)) continue
        let odds = CONFESSION_ACCEPT_CHANCE
        if (trait(about, 'Promiscuous')) odds *= ROMANCE_TRAIT_FACTOR
        if (trait(about, 'High Standards')) odds /= ROMANCE_TRAIT_FACTOR
        if (pair.crush.includes(about) || rand() < odds) {
          getTogether(key, charId, about)
          outcomes.push({ charId, about, result: 'together' })
          continue
        }
        next[key] = {
          ...withCrushHolders(pair, pair.crush.filter((holder) => holder !== charId)),
          affinity: clampAffinity(pair.affinity - 1),
          encounter: { date, kind: 'turnedDown', by: about }
        }
        settleCrushes(key)
        outcomes.push({ charId, about, result: 'turnedDown' })
      }
      return outcomes
    },

    /** A meeting that went well for two who already knew each other. */
    good(key: string, a: string, b: string): void {
      const pair = next[key]
      if (pair.affinity < 0 || pair.dating !== undefined) return
      const holders = pair.crush ?? []
      if (holders.includes(a) && holders.includes(b)) {
        if (!freeToDate(a) || !freeToDate(b) || rand() >= COUPLE_CHANCE) return
        getTogether(key, a, b)
        return
      }
      const fell = [a, b].filter((holder) => {
        if (holders.includes(holder)) return false
        const odds = crushOdds(holder, holder === a ? b : a)
        return odds > 0 && rand() < odds
      })
      if (fell.length > 0) next[key] = withCrushHolders(pair, [...holders, ...fell])
    },

    /** A meeting that went badly: a couple past its honeymoon and below friends may part. */
    bad(key: string, a: string, b: string): void {
      const pair = next[key]
      if (pair.dating !== undefined && !inHoneymoon(pair, date)) {
        if (zoneOf(pair.affinity) !== 'friends') rollBreakUp(key, a, b)
        if (next[key].dating !== undefined) argued.add(key)
      }
      settleCrushes(key)
    },

    /** Couples who spent the slot in one group, seen by whoever has a crush on either. */
    seenTogether(groups: readonly NpcEncounterGroup[], inScene: ReadonlySet<string>): void {
      const seen = new Set<string>()
      for (const group of groups) {
        const members = group.members.filter((charId) => !inScene.has(charId))
        for (let i = 0; i < members.length; i++) {
          for (let j = i + 1; j < members.length; j++) {
            const key = pairKeyOf(members[i], members[j])
            if (next[key]?.dating === undefined || seen.has(key)) continue
            seen.add(key)
            if (rand() >= SEEN_TOGETHER_CHANCE) continue
            const [p, q] = key.split('|')
            const admirers: { by: string; of: string; other: string }[] = []
            const sides: [string, string][] = [
              [p, q],
              [q, p]
            ]
            for (const [of, other] of sides) {
              for (const [crushKey, crushPair] of Object.entries(next)) {
                const by = otherOf(crushKey, of)
                if (by === null || by === other || inScene.has(by)) continue
                if (!crushPair.crush?.includes(by)) continue
                if (next[pairKeyOf(by, other)] === undefined) continue
                admirers.push({ by, of, other })
              }
            }
            if (admirers.length === 0) continue
            const picked = pick(admirers, rand)
            if (open(picked.by)) continue
            const resentKey = pairKeyOf(picked.by, picked.other)
            const resented = next[resentKey]
            next[resentKey] = {
              ...resented,
              affinity: inHoneymoon(resented, date)
                ? resented.affinity
                : clampAffinity(resented.affinity - 1),
              encounter: { date, kind: 'jealous', by: picked.by, of: picked.of }
            }
            settleCrushes(resentKey)
          }
        }
      }
    },

    /** Each couple with one graduate talks on a night, for better or worse. */
    longDistance(inScene: ReadonlySet<string>): void {
      for (const [key, pair] of Object.entries(next)) {
        if (pair.dating === undefined) continue
        const [a, b] = key.split('|')
        if (alumni.has(a) === alumni.has(b) || inScene.has(a) || inScene.has(b)) continue
        if (rand() >= LONG_DISTANCE_STEP_CHANCE) continue
        const up = rand() < LONG_DISTANCE_GOOD_CHANCE
        next[key] = { ...pair, affinity: clampAffinity(pair.affinity + (up ? 1 : -1)) }
        if (!up && zoneOf(next[key].affinity) !== 'friends') rollBreakUp(key, a, b)
        if (!up && next[key].dating !== undefined) argued.add(key)
        settleCrushes(key)
      }
    }
  }
}

/**
 * The slot's affinity movement: who met, who got on, and what each pair now thinks of
 * the other — and, given a roster, who fell for whom, got together or broke up.
 */
export function settleNpcPairs(
  input: NpcSettleInput,
  rand: () => number = Math.random
): NpcRelationshipMap {
  return settleNpcPairsFull(input, rand).relationships
}

/**
 * {@link settleNpcPairs} with what the texts read off it: the couples who argued and stayed
 * together, and what the reader's advice came to.
 */
export function settleNpcPairsFull(
  input: NpcSettleInput,
  rand: () => number = Math.random
): NpcSettleResult {
  const { date, cast, groups, characters } = input
  const next: NpcRelationshipMap = { ...input.relationships }
  const inScene = new Set(cast)
  const love = input.roster ? loveLifeOf(next, { ...input, roster: input.roster }, rand) : null
  // The reader's advice lands before anybody meets, on the map as the slot found it.
  const outcomes = love && input.advice ? love.advise(input.advice) : []

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
      // Two who knew each other before the scene: a good meeting like any other.
      if (input.relationships[key] !== undefined) love?.good(key, bonded[i], bonded[j])
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
        const encounter: NpcMeeting = {
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
        // An argument in a couple's honeymoon is still had, but costs the pair nothing.
        const kept = !up && inHoneymoon(current, date)
        next[key] = {
          ...current,
          affinity: kept ? current.affinity : clampAffinity(current.affinity + (up ? 1 : -1)),
          encounter: { ...encounter, positive: up }
        }
        if (up) love?.good(key, a, b)
        else love?.bad(key, a, b)
      }
    }
  }

  if (love) {
    love.seenTogether(groups, inScene)
    if (input.night) love.longDistance(inScene)
  }

  // Only a couple still together at the slot's end has anything to vent about.
  const argued = [...(love?.argued ?? [])]
    .filter((key) => next[key]?.dating !== undefined)
    .sort()
    .map((key) => {
      const [a, b] = key.split('|')
      return { a, b }
    })
  return { relationships: next, argued, outcomes }
}
