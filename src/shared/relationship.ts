import { likedPostBonus, likedPostWindowOf } from './feed'
import {
  MAX_TIER,
  pointsForTier,
  STAT_KEYS,
  STAT_LABELS,
  tierNameOf,
  tierOf,
  type PlayerStats,
  type StatKey,
  type StatTier
} from './playerStats'
import { secondPerson } from './readerVoice'
import { markedLine } from './statusMark'
import { hasTrait } from './traits'
import type {
  Character,
  CharacterBehavior,
  CharFlags,
  CharInfo,
  CharMemory,
  CrushHint,
  Emotion,
  MemoryType,
  RelationshipEvent,
  SceneLine,
  TextMark
} from './types'

/** Affection scoring, disposition tiers and flag transitions. */

/** Memories kept per character; older ones are dropped as new ones arrive. */
export const MEMORY_CAP = 20

const POINTS: Record<MemoryType, number> = { loved: 2, liked: 1, disliked: -1, hated: -2 }

/** Recency weight: this week hits hardest, last month barely registers. */
function weightFor(daysAgo: number): number {
  if (daysAgo <= 7) return 4
  if (daysAgo <= 30) return 2
  return 1
}

/**
 * Splices one entry in **after** the last entry not newer than it, so a scene memory from the
 * same slot still reads first.
 */
function spliceByDate(
  memories: readonly CharMemory[],
  entry: CharMemory
): readonly CharMemory[] {
  let at = memories.length
  while (at > 0 && memories[at - 1].date > entry.date) at--
  return [...memories.slice(0, at), entry, ...memories.slice(at)]
}

/**
 * A character's memories with the three lists kept beside them spliced in at their own dates;
 * every reader reads it folded ({@link dedupedMemoriesFor}), affection raw.
 */
export function mergedMemories(
  memories: readonly CharMemory[],
  textMemory: CharMemory | undefined,
  jealousy: readonly CharMemory[] = [],
  gifts: readonly CharMemory[] = []
): readonly CharMemory[] {
  let merged = memories
  if (textMemory) merged = spliceByDate(merged, textMemory)
  for (const entry of jealousy) merged = spliceByDate(merged, entry)
  for (const entry of gifts) merged = spliceByDate(merged, entry)
  return merged
}

/** {@link mergedMemories} straight off a `CharInfo`, absent lists included. */
export function memoriesFor(
  info:
    | Pick<CharInfo, 'memories' | 'textMemory' | 'jealousyMemories' | 'giftMemories'>
    | undefined
): readonly CharMemory[] {
  return mergedMemories(
    info?.memories ?? [],
    info?.textMemory,
    info?.jealousyMemories,
    info?.giftMemories
  )
}

/** The four places on a `CharInfo` a memory can be kept. */
export type MemoryHolders = Pick<
  CharInfo,
  'memories' | 'textMemory' | 'jealousyMemories' | 'giftMemories'
>

/** Whether two memories are one — the same date, verb and words, the key the fold dedupes on. */
function sameMemory(a: CharMemory, b: CharMemory): boolean {
  return a.date === b.date && a.type === b.type && a.desc === b.desc
}

/** `list` with every copy of `match` swapped for `next`, or dropped for null; undefined if none. */
function replacedIn(
  list: readonly CharMemory[] | undefined,
  match: CharMemory,
  next: CharMemory | null
): CharMemory[] | undefined {
  if (!list?.some((entry) => sameMemory(entry, match))) return undefined
  const replaced: CharMemory[] = []
  for (const entry of list) {
    if (!sameMemory(entry, match)) replaced.push(entry)
    else if (next) replaced.push(next)
  }
  return replaced
}

/**
 * Her memories with every copy of `match` rewritten to `next`, or forgotten where `next` is
 * null; null when she holds no copy or `next` changes nothing, and untouched lists keep identity.
 */
export function withMemoryReplaced<T extends MemoryHolders>(
  info: T,
  match: CharMemory,
  next: CharMemory | null
): T | null {
  if (next && sameMemory(match, next)) return null
  const out: T = { ...info }
  let changed = false
  const memories = replacedIn(info.memories, match, next)
  if (memories) {
    out.memories = memories
    changed = true
  }
  const jealousy = replacedIn(info.jealousyMemories, match, next)
  if (jealousy) {
    out.jealousyMemories = jealousy
    changed = true
  }
  const gifts = replacedIn(info.giftMemories, match, next)
  if (gifts) {
    out.giftMemories = gifts
    changed = true
  }
  if (info.textMemory && sameMemory(info.textMemory, match)) {
    if (next) out.textMemory = next
    else delete out.textMemory
    changed = true
  }
  return changed ? out : null
}

/**
 * The same list with exact repeats folded away — one entry per `date`/`type`/`desc`, the first
 * of each kept.
 */
export function dedupedMemories(memories: readonly CharMemory[]): readonly CharMemory[] {
  const seen = new Set<string>()
  const kept: CharMemory[] = []
  for (const entry of memories) {
    const key = JSON.stringify([entry.date, entry.type, entry.desc])
    if (seen.has(key)) continue
    seen.add(key)
    kept.push(entry)
  }
  return kept.length === memories.length ? memories : kept
}

/** {@link dedupedMemories} over {@link memoriesFor} — the folded list every reader reads. */
export function dedupedMemoriesFor(
  info:
    | Pick<CharInfo, 'memories' | 'textMemory' | 'jealousyMemories' | 'giftMemories'>
    | undefined
): readonly CharMemory[] {
  return dedupedMemories(memoriesFor(info))
}

/**
 * A character's affection off her `CharInfo`, texting memory and the likes he left on her
 * recent posts included.
 */
export function affectionFor(
  info:
    | Pick<CharInfo, 'memories' | 'textMemory' | 'feed' | 'jealousyMemories' | 'giftMemories'>
    | undefined,
  today: number,
  character: Pick<Character, 'traits'> | undefined
): number {
  return (
    affectionOf(memoriesFor(info), today) + likedPostBonus(info?.feed, likedPostWindowOf(character))
  )
}

/**
 * The three parts of a memory sentence, its desc turned to the second person, cut where the word
 * it is coloured by begins and ends.
 */
function memoryParts(
  name: string,
  entry: Pick<CharMemory, 'type' | 'desc'>
): { before: string; run: string; after: string } {
  const desc = sentence(secondPerson(entry.desc))
  return { before: `${name} `, run: entry.type, after: ` that ${desc}` }
}

/**
 * `"Mika liked that you walked her home."` off "the reader walked her home" — the one phrasing
 * of a memory, used by the post-scene status lines and by Bunnyboard's history alike.
 */
export function memorySentence(name: string, entry: Pick<CharMemory, 'type' | 'desc'>): string {
  const { before, run, after } = memoryParts(name, entry)
  return `${before}${run}${after}`
}

/** A texting memory's description with the clause that says where it came from. */
export function overTextDesc(desc: string): string {
  return `${desc.replace(/[.!?…]+$/, '')} over text.`
}

/** Which way each of the four verbs went, for the run the status box paints. */
const MEMORY_TONES: Record<MemoryType, TextMark['tone']> = {
  loved: 'gain',
  liked: 'gain',
  disliked: 'loss',
  hated: 'loss'
}

/**
 * {@link memorySentence} as the status box draws it: the verb she remembers him by in the
 * colour of which way it went.
 */
export function memoryStatusLine(
  name: string,
  entry: Pick<CharMemory, 'type' | 'desc'>
): SceneLine {
  const { before, run, after } = memoryParts(name, entry)
  return markedLine(before, run, after, MEMORY_TONES[entry.type])
}

/** Ends a clause the way {@link memorySentence} does — the app owns the stop, not the sentence. */
function sentence(text: string): string {
  const trimmed = text.trim()
  return /[.!?…]$/.test(trimmed) ? trimmed : `${trimmed}.`
}

/**
 * Her four love-life fields as the one paragraph everything that shows or injects them reads.
 */
export function loveLifeBlurb(
  character: Pick<Character, 'firstName' | 'datingHistory' | 'datingPreference' | 'kinks' | 'isVirgin'>,
  flags: Pick<CharFlags, 'hadSex'>
): string {
  const parts = [character.datingHistory, character.datingPreference, character.kinks]
    .filter((part) => part?.trim())
    .map(sentence)
  if (character.isVirgin && !flags.hadSex) parts.push(`${character.firstName} is a virgin.`)
  return parts.join(' ')
}

/** Sum of every memory's points times its recency weight. */
export function affectionOf(memories: readonly CharMemory[], today: number): number {
  let total = 0
  for (const entry of memories) {
    const points = POINTS[entry.type]
    if (points === undefined) continue
    total += points * weightFor(Math.max(0, today - entry.date))
  }
  return total
}

/** How a character feels about the reader right now — an affection tier. */
export type Disposition = 'devoted' | 'trusted' | 'friendly' | 'neutral' | 'annoyed' | 'hostile'

/** The tier floors; `isPositive`, `isNegative` and the crush roll test against them too. */
const FRIENDLY_FLOOR = 15
const TRUSTED_FLOOR = 30
const DEVOTED_FLOOR = 50

/** Tier floors, richest first; the first one the score clears wins. */
const TIERS: ReadonlyArray<readonly [number, Disposition]> = [
  [DEVOTED_FLOOR, 'devoted'],
  [TRUSTED_FLOOR, 'trusted'],
  [FRIENDLY_FLOOR, 'friendly'],
  [-FRIENDLY_FLOOR, 'neutral'],
  [-TRUSTED_FLOOR, 'annoyed']
]

/** The disposition tier an affection score falls in. */
export function dispositionOf(affection: number): Disposition {
  for (const [floor, tier] of TIERS) {
    if (affection > floor) return tier
  }
  return 'hostile'
}

/** Completes `"<FirstName> ___ the reader."` for prompt injection. */
export const DISPOSITION_PHRASE: Record<Disposition, string> = {
  devoted: 'is devoted to',
  trusted: 'trusts',
  friendly: 'is friendly towards',
  neutral: "doesn't particularly care about",
  annoyed: 'is annoyed by',
  hostile: 'hates'
}

/** What the reader calls her on her contact profile, by tier. */
const RELATIONSHIP_TAG: Record<Disposition, string> = {
  devoted: 'BFF',
  trusted: 'Best Friend',
  friendly: 'Friend',
  neutral: 'Acquaintance',
  annoyed: 'Enemies',
  hostile: 'Enemies'
}

/** The tag the contact profile shows; `isLover` answers ahead of the tier. */
export function relationshipTagOf(flags: CharFlags, affection: number): string {
  if (flags.isLover) return 'Lover'
  return RELATIONSHIP_TAG[dispositionOf(affection)]
}

/** The reader's own standing, in the dates and names the READER block prints. */
export interface ReaderStanding {
  /** Who he is with, oldest relationship first, and who he left for each of them. */
  lovers: { name: string; since?: number; harem: boolean; leftFor: string[] }[]
  /** Who he used to be with, by name; `from` is absent on a save written before it was kept. */
  exes: { name: string; from?: number; to: number }[]
}

/**
 * Where the reader stands with the whole roster: who he is dating and since when, whether she
 * shares him, who he left for her, and who he used to be with between which dates. A girl with
 * no name yet is left out.
 */
export function readerStandingOf(
  roster: readonly string[],
  charInfo: Readonly<
    Record<string, Pick<CharInfo, 'flags' | 'datingSince' | 'brokeUpOn' | 'leftFor'> | undefined>
  >,
  firstNames: Readonly<Record<string, string>>
): ReaderStanding {
  const named = roster.filter((charId) => Boolean(firstNames[charId]))
  const standing: ReaderStanding = { lovers: [], exes: [] }
  for (const charId of named) {
    const info = charInfo[charId]
    const name = firstNames[charId]
    if (info?.flags?.isLover) {
      const leftFor = named
        .filter((other) => charInfo[other]?.leftFor === charId)
        .map((other) => firstNames[other])
        .sort()
      standing.lovers.push({
        name,
        ...(info.datingSince !== undefined ? { since: info.datingSince } : {}),
        harem: info.flags.harem === true,
        leftFor
      })
    } else if (info?.brokeUpOn !== undefined) {
      standing.exes.push({
        name,
        ...(info.datingSince !== undefined ? { from: info.datingSince } : {}),
        to: info.brokeUpOn
      })
    }
  }
  standing.lovers.sort((a, b) => {
    if (a.since !== b.since) {
      if (a.since === undefined) return 1
      if (b.since === undefined) return -1
      return a.since - b.since
    }
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
  })
  standing.exes.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  return standing
}

/** True for `friendly` and up — the gate for `withFriends`, the traits and the preferred-stat reveals. */
export function isPositive(affection: number): boolean {
  return affection > FRIENDLY_FLOOR
}

/** True for `trusted` and up — the gate for the backstory reveal. */
export function isTrusted(affection: number): boolean {
  return affection > TRUSTED_FLOOR
}

/** True for `annoyed` and down — the gate for `withEnemy`. */
export function isNegative(affection: number): boolean {
  return affection <= -FRIENDLY_FLOOR
}

/** Picks which {@link CharacterBehavior} stage is live; first match wins. */
export function behaviorLevelOf(
  flags: CharFlags,
  affection: number
): keyof CharacterBehavior {
  if (flags.isLover) return 'withLover'
  if (flags.hasCrush) return 'withCrush'
  if (isNegative(affection) || flags.brokenUp > 0) return 'withEnemy'
  if (isPositive(affection)) return 'withFriends'
  return 'withStrangers'
}

/** Every milestone unset — a character the reader has not met. */
export function emptyFlags(): CharFlags {
  return {
    hasMet: false,
    hasCrush: false,
    friendZoned: false,
    friendZonedBy: false,
    isLover: false,
    brokenUp: 0,
    hasKissed: false,
    hadSex: false,
    benefits: false,
    harem: false,
    gaveContactInfo: false,
    blocked: false,
    knowsTraits: false,
    knowsBackstory: false,
    knowsLoveLife: false
  }
}

/**
 * The flags a character starts a playthrough on: {@link emptyFlags}, plus `harem` for
 * a `Promiscuous` girl.
 */
export function initialFlags(character: Pick<Character, 'traits'> | undefined): CharFlags {
  const flags = emptyFlags()
  if (hasTrait(character, 'Promiscuous')) flags.harem = true
  return flags
}

const RELATIONSHIP_EVENTS: readonly RelationshipEvent[] = [
  'kissed',
  'sex',
  'became_lovers',
  'broke_up',
  'friendzoned_by_reader',
  'friendzoned_reader',
  'gave_contact_info',
  'unblocked',
  'agreed_to_harem'
]

/** Guard for a relationship event echoed back by the LLM. */
export function isRelationshipEvent(value: unknown): value is RelationshipEvent {
  return RELATIONSHIP_EVENTS.includes(value as RelationshipEvent)
}

/** Applies one milestone, returning a new flag set. */
export function applyEvent(flags: CharFlags, event: RelationshipEvent): CharFlags {
  switch (event) {
    case 'kissed':
      return { ...flags, hasKissed: true }
    case 'sex':
      return { ...flags, hadSex: true, hasKissed: true, benefits: !flags.isLover }
    // Voids every lesser arrangement; `knowsLoveLife` is owed to reaching it, not holding it.
    case 'became_lovers':
      return {
        ...flags,
        isLover: true,
        hasCrush: false,
        friendZoned: false,
        friendZonedBy: false,
        benefits: false,
        knowsLoveLife: true
      }
    case 'broke_up':
      return { ...flags, isLover: false, brokenUp: flags.brokenUp + 1 }
    case 'friendzoned_by_reader':
      return { ...flags, friendZoned: true, isLover: false }
    case 'friendzoned_reader':
      return { ...flags, friendZonedBy: true, isLover: false }
    // One-way; `blocked` is its own flag.
    case 'gave_contact_info':
      return { ...flags, gaveContactInfo: true }
    // The one milestone that clears a flag rather than setting one.
    case 'unblocked':
      return { ...flags, blocked: false }
    // Her stance on the other girls, which `became_lovers` leaves standing.
    case 'agreed_to_harem':
      return { ...flags, harem: true }
  }
}

/**
 * One character's info with a scene's milestones folded in: the flag transitions, the
 * memories the two biggest of them leave behind, and the dates dating starting and ending
 * leave on her.
 */
export function foldRelationshipEvents(
  info: CharInfo,
  events: readonly RelationshipEvent[],
  date: number
): CharInfo {
  const before = info.flags ?? emptyFlags()
  let flags = before
  for (const event of events) flags = applyEvent(flags, event)

  // The milestones' own memories, stacked with whatever the ledger wrote about the scene.
  const milestones: CharMemory[] = []
  if (!before.hasKissed && flags.hasKissed) {
    milestones.push({ date, type: 'loved', desc: 'the reader kissed her for the first time' })
  }
  if (!before.hadSex && flags.hadSex) {
    milestones.push({ date, type: 'loved', desc: 'the reader slept with her for the first time' })
  }
  // Keyed on the count, so a second breakup writes a second memory.
  if (flags.brokenUp > before.brokenUp) {
    milestones.push({ date, type: 'hated', desc: 'things ended between the reader and her' })
  }

  const folded: CharInfo = {
    ...info,
    flags,
    memories: [...info.memories, ...milestones].slice(-MEMORY_CAP)
  }

  // However it ended, the day it ended on is what the exes line counts to.
  if (before.isLover && !flags.isLover) return { ...folded, brokeUpOn: date }
  // Getting together is dated, and getting back together takes the ending off her.
  if (!before.isLover && flags.isLover) {
    const together = { ...folded, datingSince: date }
    delete together.brokeUpOn
    delete together.leftFor
    return together
  }
  return folded
}

/**
 * Every word said to the player about a milestone, one line per milestone the scene actually
 * reached.
 */
export function milestoneStatusLines(name: string, before: CharFlags, after: CharFlags): string[] {
  const lines: string[] = []
  // A fixed order: escalating first, then the ways it goes wrong.
  if (!before.gaveContactInfo && after.gaveContactInfo)
    lines.push(`${name} gave you her contact info.`)
  if (!before.hasKissed && after.hasKissed) lines.push(`You and ${name} kissed for the first time.`)
  if (!before.hadSex && after.hadSex)
    lines.push(`You and ${name} slept together for the first time.`)
  if (!before.isLover && after.isLover) lines.push(`You and ${name} became lovers.`)
  if (!before.harem && after.harem) lines.push(`${name} agreed to an open relationship with you.`)
  if (!before.friendZoned && after.friendZoned) lines.push(`You friendzoned ${name}.`)
  if (!before.friendZonedBy && after.friendZonedBy) lines.push(`${name} friendzoned you.`)
  if (after.brokenUp > before.brokenUp) lines.push(`You and ${name} broke up.`)
  // The one true→false diff, and last.
  if (before.blocked && !after.blocked) lines.push(`${name} unblocked you.`)
  return lines
}

/**
 * The words a milestone sentence is read for: the phrase the modal marks, and whether it is
 * a loss. It sits beside the sentences so a reworded line and its phrase are one diff.
 */
const MILESTONE_PHRASES: readonly { phrase: string; loss: boolean }[] = [
  { phrase: 'gave you her contact info', loss: false },
  { phrase: 'kissed', loss: false },
  { phrase: 'slept together', loss: false },
  { phrase: 'became lovers', loss: false },
  { phrase: 'open relationship', loss: false },
  { phrase: 'friendzoned', loss: true },
  { phrase: 'broke up', loss: true },
  { phrase: 'unblocked', loss: false }
]

/**
 * Where one of {@link milestoneStatusLines}' sentences carries its milestone, as a mark the modal
 * paints; null for a line naming none.
 */
export function milestoneMarkOf(text: string): TextMark | null {
  for (const { phrase, loss } of MILESTONE_PHRASES) {
    const at = text.indexOf(phrase)
    if (at === -1) continue
    return { start: at, end: at + phrase.length, tone: loss ? 'loss' : 'gain' }
  }
  return null
}

/**
 * Whether what the scene reached is a loss rather than a step forward — the three of the nine
 * milestones that go the wrong way. Lives beside the phrases so there's one place deciding which
 * are bad, not two. **A set holding any one of them is negative however much else it reached.**
 */
export function milestoneSoured(before: CharFlags, after: CharFlags): boolean {
  return (
    (!before.friendZoned && after.friendZoned) ||
    (!before.friendZonedBy && after.friendZonedBy) ||
    after.brokenUp > before.brokenUp
  )
}

/**
 * The face the milestone screen gives her: a loss ahead of everything, then a first time,
 * then a kiss or a love, else nothing.
 */
export function milestoneEmotionOf(before: CharFlags, after: CharFlags): Emotion {
  if (milestoneSoured(before, after)) return 'sad'
  if (!before.hadSex && after.hadSex) return 'aroused'
  if ((!before.hasKissed && after.hasKissed) || (!before.isLover && after.isLover)) return 'happy'
  return 'neutral'
}

/** The character half of the roll — what she is drawn to, and how hard she is to reach. */
type CrushCharacter = Pick<Character, 'traits' | 'preferredStat'> | undefined

/**
 * How the crush roll splits its two questions: most of it is how she already feels about
 * him, the rest is whether he is her type at all.
 */
const RELATIONSHIP_SHARE = 0.6
const STAT_SHARE = 0.4

/** The tier what she goes for has to reach, and the tier `High Standards` asks of the other two. */
const PREFERRED_TIER: StatTier = 3
const OTHER_TIER: StatTier = 2

/** The points her preferred stat has to reach before she will look at him at all. */
const CRUSH_FLOOR = pointsForTier(PREFERRED_TIER)

/** Clamps a weight into [0, 1], so neither half of the roll can pay past its share. */
function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/** Her preferred stat; charm for a character no longer on disk. */
function preferredStatOf(character: CrushCharacter): StatKey {
  return character?.preferredStat ?? 'heart'
}

/**
 * Whether the reader clears her bar at all — the gate in front of the dice: `Good` in
 * what she is drawn to, and `Decent` in everything else for `High Standards`.
 */
export function meetsCrushStandards(character: CrushCharacter, stats: PlayerStats): boolean {
  return missingCrushStatOf(character, stats) === null
}

/** The first stat keeping the reader below her crush requirements, for prompt guidance. */
export function missingCrushStatOf(
  character: CrushCharacter,
  stats: PlayerStats
): StatKey | null {
  const preferred = preferredStatOf(character)
  if (stats[preferred] < CRUSH_FLOOR) return preferred
  if (!hasTrait(character, 'High Standards')) return null
  return STAT_KEYS.find((key) => key !== preferred && tierOf(stats[key]) < OTHER_TIER) ?? null
}

/** The tier a stat has to reach for her — the high bar for her own, the low for the rest. */
function crushRequirementOf(character: CrushCharacter, stat: StatKey): StatTier {
  return stat === preferredStatOf(character) ? PREFERRED_TIER : OTHER_TIER
}

/** How a status line names what she is waiting on — all three for a girl who wants all three. */
function hintSubject(character: CrushCharacter, stat: StatKey): string {
  return hasTrait(character, 'High Standards')
    ? `${STAT_LABELS.brain}, ${STAT_LABELS.body}, and ${STAT_LABELS.heart}`
    : STAT_LABELS[stat]
}

/**
 * What the memory scroll says about one girl's standards, and what to remember having said.
 * A stat is named once per tier, and the same hint object comes back whenever
 * there is nothing new to say, which is what lets the caller skip the write.
 */
export function crushHintUpdate(
  name: string,
  character: CrushCharacter,
  stats: PlayerStats,
  hint: CrushHint | undefined
): { line: string | null; hint: CrushHint | undefined } {
  // The terminal state: nothing takes a payoff back.
  if (hint && 'met' in hint) return { line: null, hint }
  if (hint && tierOf(stats[hint.stat]) <= hint.tier) return { line: null, hint }

  const missing = missingCrushStatOf(character, stats)
  if (missing === null) {
    // Nothing was promised, so there is no payoff to pay off.
    if (!hint) return { line: null, hint: undefined }
    return {
      line: `Your ${hintSubject(character, hint.stat)} seem${
        hasTrait(character, 'High Standards') ? '' : 's'
      } to have caught ${name}'s interest...`,
      hint: { met: true }
    }
  }

  return {
    line: `Your ${STAT_LABELS[missing]} needs to be at least ${tierNameOf(
      crushRequirementOf(character, missing)
    )} to catch ${name}'s interest.`,
    hint: { stat: missing, tier: tierOf(stats[missing]) }
  }
}

/**
 * Her odds of falling for the reader this scene, in [0, 1] — zero whenever her
 * standards are not met. Each half is normalized against the top of its own scale.
 */
export function crushChance(
  character: CrushCharacter,
  stats: PlayerStats,
  affection: number
): number {
  if (!meetsCrushStandards(character, stats)) return 0
  const points = stats[preferredStatOf(character)]
  return (
    RELATIONSHIP_SHARE * clamp01(affection / DEVOTED_FLOOR) +
    STAT_SHARE * clamp01((points - CRUSH_FLOOR) / (pointsForTier(MAX_TIER) - CRUSH_FLOOR))
  )
}

/** One draw against {@link crushChance}; `rand` is injectable for tests. */
export function rollsCrush(
  character: CrushCharacter,
  stats: PlayerStats,
  affection: number,
  rand: () => number = Math.random
): boolean {
  // Never at a score `refreshedFlags` would clear it at.
  if (affection < 0) return false
  return rand() < crushChance(character, stats, affection)
}

/**
 * Re-derives the affection-driven flags at scene start; a crush it only ever takes
 * away.
 */
export function refreshedFlags(flags: CharFlags, affection: number): CharFlags {
  let hasCrush = flags.hasCrush
  if (affection < 0) hasCrush = false

  const benefits = flags.benefits && dispositionOf(affection) !== 'hostile'

  const knowsTraits = flags.knowsTraits || isPositive(affection)
  const knowsBackstory = flags.knowsBackstory || isTrusted(affection)
  const knowsLoveLife = flags.knowsLoveLife || flags.isLover

  if (
    hasCrush === flags.hasCrush &&
    benefits === flags.benefits &&
    knowsTraits === flags.knowsTraits &&
    knowsBackstory === flags.knowsBackstory &&
    knowsLoveLife === flags.knowsLoveLife
  )
    return flags
  return { ...flags, hasCrush, benefits, knowsTraits, knowsBackstory, knowsLoveLife }
}
