import { likedPostBonus, likedPostWindowOf } from './feed'
import { genderOf, PRONOUNS, readerGenderOf, readerWords, type ReaderPronouns } from './gender'
import { RELATIONSHIP_SHARE, STAT_SHARE } from './odds'
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
import { shownMemoryDesc } from './readerVoice'
import { markedLine, markedRuns } from './statusMark'
import { hasTrait } from './traits'
import type {
  Attraction,
  Character,
  CharacterBehavior,
  CharFlags,
  CharInfo,
  CharMemory,
  CrushHint,
  Emotion,
  Gender,
  MemoryType,
  RelationshipEvent,
  RomanceLevel,
  RomanceSetting,
  SceneLine,
  TextMark,
  UpperHalf
} from './types'

/** Affection scoring, disposition tiers and flag transitions. */

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

/** `memory` with a new verb and words, on its own date. */
export function rewordedMemory(memory: CharMemory, type: MemoryType, desc: string): CharMemory {
  return { ...memory, type, desc }
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

/** How many of her newest stored memories her affection is read off; older ones are kept but no longer count. */
const AFFECTION_WINDOW = 20

/**
 * A character's affection off her `CharInfo`, texting memory and the likes he left on her
 * recent posts included, off only the newest {@link AFFECTION_WINDOW} of her stored memories,
 * less whatever break penalty she still holds.
 */
export function affectionFor(
  info:
    | Pick<
        CharInfo,
        'memories' | 'textMemory' | 'feed' | 'jealousyMemories' | 'giftMemories' | 'breakPenalty'
      >
    | undefined,
  today: number,
  character: Pick<Character, 'traits'> | undefined
): number {
  const windowed = mergedMemories(
    (info?.memories ?? []).slice(-AFFECTION_WINDOW),
    info?.textMemory,
    info?.jealousyMemories,
    info?.giftMemories
  )
  return (
    affectionOf(windowed, today) +
    likedPostBonus(info?.feed, likedPostWindowOf(character)) -
    breakPenaltyNow(info?.breakPenalty)
  )
}

/** A memory as a status line reads it: its desc, and the ledger's second-person words if kept. */
export type SpokenMemory = Pick<CharMemory, 'type' | 'desc'> & { youDesc?: string }

/**
 * The three parts of a memory sentence, cut where the word it is coloured by begins and ends:
 * its second-person words where it has them, else its desc with the reader called `readerName`.
 */
function memoryParts(
  name: string,
  entry: SpokenMemory,
  readerName: string,
  holder: Gender,
  reader: ReaderPronouns
): { before: string; run: string; after: string } {
  const desc = sentence(entry.youDesc ?? shownMemoryDesc(entry.desc, readerName, holder, reader))
  return { before: `${name} `, run: entry.type, after: ` that ${desc}` }
}

/**
 * `"Mika liked that Seth walked her home."` off "the reader walked her home" — the one phrasing
 * of a memory, used by the post-scene status lines and by her contact page alike.
 */
export function memorySentence(
  name: string,
  entry: Pick<CharMemory, 'type' | 'desc'>,
  readerName: string,
  holder: Gender,
  reader: ReaderPronouns
): string {
  // Only its two fields: an older save's memory may still carry second-person words on disk.
  const { before, run, after } = memoryParts(
    name,
    { type: entry.type, desc: entry.desc },
    readerName,
    holder,
    reader
  )
  return `${before}${run}${after}`
}

/** A texting memory's description with the clause that says where it came from. */
export function overTextDesc(desc: string): string {
  return `${desc.replace(/[.!?…]+$/, '')} over text.`
}

/** A texting memory with the clause that says where it came from, in both of its voices. */
export function overTextMemory<T extends Pick<SpokenMemory, 'desc' | 'youDesc'>>(entry: T): T {
  const said = { ...entry, desc: overTextDesc(entry.desc) }
  if (entry.youDesc !== undefined) said.youDesc = overTextDesc(entry.youDesc)
  return said
}

/** Which way each of the four verbs went, for the run the status box paints. */
const MEMORY_TONES: Record<MemoryType, TextMark['tone']> = {
  loved: 'gain',
  liked: 'gain',
  disliked: 'loss',
  hated: 'loss'
}

/**
 * {@link memorySentence} as the status box draws it, spoken to the reader where the ledger's
 * second-person words were kept: the verb she remembers him by in the colour of which way it went.
 */
export function memoryStatusLine(
  name: string,
  entry: SpokenMemory,
  readerName: string,
  holder: Gender,
  reader: ReaderPronouns
): SceneLine {
  const { before, run, after } = memoryParts(name, entry, readerName, holder, reader)
  return markedLine(before, run, after, MEMORY_TONES[entry.type])
}

/** Ends a clause the way {@link memorySentence} does — the app owns the stop, not the sentence. */
function sentence(text: string): string {
  const trimmed = text.trim()
  return /[.!?…]$/.test(trimmed) ? trimmed : `${trimmed}.`
}

/**
 * Her love life as the one paragraph everything that shows or injects it reads: her three prose
 * fields, the kinks left out where `kinks` is false, then her sexuality as `attraction` has it
 * and whether she is a virgin.
 */
export function loveLifeBlurb(
  character: Pick<
    Character,
    'firstName' | 'gender' | 'datingHistory' | 'datingPreference' | 'kinks' | 'isVirgin'
  >,
  flags: Pick<CharFlags, 'hadSex'>,
  attraction: Attraction,
  kinks = true
): string {
  const parts = [character.datingHistory, character.datingPreference, kinks ? character.kinks : '']
    .filter((part) => part?.trim())
    .map(sentence)
  parts.push(`${character.firstName} is ${sexualityOf(genderOf(character), attraction)}.`)
  if (character.isVirgin && !flags.hadSex) parts.push(`${character.firstName} is a virgin.`)
  return parts.join(' ')
}

/** What a sexuality is called, by her gender and who she is attracted to. */
export type Sexuality = 'straight' | 'gay' | 'lesbian' | 'bisexual'

/** Each sexuality as a page names it. */
export const SEXUALITY_LABELS: Record<Sexuality, string> = {
  straight: 'Straight',
  gay: 'Gay',
  lesbian: 'Lesbian',
  bisexual: 'Bisexual'
}

/** Her sexuality by name: both genders bisexual, her own alone gay or lesbian, else straight. */
export function sexualityOf(gender: Gender, attraction: Attraction): Sexuality {
  if (attraction.female && attraction.male) return 'bisexual'
  if (attraction[gender]) return gender === 'male' ? 'gay' : 'lesbian'
  return 'straight'
}

/** An attraction off a value that crossed the bridge or came off a record; null unless valid. */
export function asAttraction(value: unknown): Attraction | null {
  if (typeof value !== 'object' || value === null) return null
  const { female, male } = value as Record<string, unknown>
  if (typeof female !== 'boolean' || typeof male !== 'boolean') return null
  return female || male ? { female, male } : null
}

/** Who her record says she is attracted to: the other gender alone where it says nothing valid. */
export function attractionOf(
  c: Pick<Character, 'gender' | 'attractedTo'> | null | undefined
): Attraction {
  const held = asAttraction(c?.attractedTo)
  if (held) return held
  const male = genderOf(c) === 'female'
  return { female: !male, male }
}

/** Whether an attraction is what an absent field reads as, and so is left off her record. */
export function isDefaultAttraction(
  c: Pick<Character, 'gender'> | null | undefined,
  attraction: Attraction
): boolean {
  const fallback = attractionOf({ gender: c?.gender })
  return attraction.female === fallback.female && attraction.male === fallback.male
}

/**
 * Sum of every memory's points times its recency weight; a memory carried across a break ages
 * only by the days lived in a semester.
 */
export function affectionOf(memories: readonly CharMemory[], today: number): number {
  let total = 0
  for (const entry of memories) {
    const points = POINTS[entry.type]
    if (points === undefined) continue
    total += points * weightFor(Math.max(0, today - entry.date - (entry.breakDays ?? 0)))
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

/** Each disposition as a picker or a reading names it. */
export const DISPOSITION_LABELS: Record<Disposition, string> = {
  devoted: 'Devoted',
  trusted: 'Trusted',
  friendly: 'Friendly',
  neutral: 'Neutral',
  annoyed: 'Annoyed',
  hostile: 'Hostile'
}

/** One affection score inside each tier, for a disposition set by hand rather than earned. */
const DISPOSITION_AFFECTION: Record<Disposition, number> = {
  devoted: 60,
  trusted: 40,
  friendly: 22,
  neutral: 0,
  annoyed: -22,
  hostile: -40
}

/** The affection a hand-set disposition is played at; `dispositionOf` reads it back as that tier. */
export function affectionOfDisposition(disposition: Disposition): number {
  return DISPOSITION_AFFECTION[disposition]
}

/** Completes `"<FirstName> ___."` for prompt injection, one phrase per tier. */
export const DISPOSITION_PREDICATE: Record<Disposition, string> = {
  devoted: 'is devoted to the reader',
  trusted: 'trusts the reader',
  friendly: 'is friendly towards the reader',
  neutral: "doesn't particularly care about the reader",
  annoyed: 'is annoyed by the reader',
  hostile: 'hates the reader'
}

/**
 * The three tiers that read differently in their upper half: the score it starts above, its
 * tier's ceiling, what it says the first time she is in it and what it says once she has been
 * out of it, given how the line names the reader. Neutral's half is counted from where everybody
 * starts.
 */
const UPPER_HALVES: Record<
  UpperHalf,
  { from: number; to: number; first: (him: string) => string; again: (him: string) => string }
> =
  {
    neutral: {
      from: FRIENDLY_FLOOR / 2,
      to: FRIENDLY_FLOOR,
      first: () => 'is warming up to the reader',
      again: () => 'is on good terms with the reader'
    },
    friendly: {
      from: (FRIENDLY_FLOOR + TRUSTED_FLOOR) / 2,
      to: TRUSTED_FLOOR,
      first: (him) => `is friends with the reader and is confiding in ${him} more and more`,
      again: (him) => `is close friends with the reader and confides in ${him}`
    },
    trusted: {
      from: (TRUSTED_FLOOR + DEVOTED_FLOOR) / 2,
      to: DEVOTED_FLOOR,
      first: (him) => `trusts the reader deeply and is appreciating ${him} more and more`,
      again: (him) => `trusts the reader deeply and appreciates ${him}`
    }
  }

const UPPER_HALF_KEYS = Object.keys(UPPER_HALVES) as UpperHalf[]

/**
 * Her record of upper halves after one more reading of her affection: a half she is in is kept,
 * or begun; one she has dropped back under turns `again` once she has been in it, and one she is
 * above turns `again` outright, passing over it counting as having been there. Same object when
 * nothing moved.
 */
export function observedUpperHalves(
  halves: CharInfo['upperHalves'],
  affection: number
): CharInfo['upperHalves'] {
  let next = halves
  for (const key of UPPER_HALF_KEYS) {
    const { from, to } = UPPER_HALVES[key]
    const was = halves?.[key]
    let now: 'first' | 'again' | undefined
    if (affection > to) now = 'again'
    else if (affection > from) now = was ?? 'first'
    else now = was && 'again'
    if (now === undefined || now === was) continue
    next = { ...next, [key]: now }
  }
  return next
}

/**
 * Completes `"<FirstName> ___."` for how she feels: her tier's phrase, or its upper half's, read
 * as rising the first time she is there and as a level once she has been out of it. A lover's
 * neutral and friendly tiers read plain beside the status line's word on them; `holder` is her
 * gender, which decides whether the reader is named outright.
 */
export function dispositionPredicateOf(
  affection: number,
  halves: CharInfo['upperHalves'],
  isLover: boolean,
  reader: ReaderPronouns,
  holder: Gender
): string {
  const disposition = dispositionOf(affection)
  const split =
    disposition === 'trusted' ||
    (!isLover && (disposition === 'friendly' || disposition === 'neutral'))
  if (split) {
    const half = UPPER_HALVES[disposition]
    if (affection > half.from) {
      const him = readerWords(reader, holder).him
      return halves?.[disposition] === 'again' ? half.again(him) : half.first(him)
    }
  }
  return DISPOSITION_PREDICATE[disposition]
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
  'agreed_to_harem',
  'agreed_to_closed'
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
    // Clears the block rather than setting anything.
    case 'unblocked':
      return { ...flags, blocked: false }
    // Her stance on the other girls, which `became_lovers` leaves standing.
    case 'agreed_to_harem':
      return { ...flags, harem: true }
    // Takes sharing back, and only from a lover: seeing only the reader means nothing to anyone else.
    case 'agreed_to_closed':
      return flags.isLover ? { ...flags, harem: false } : flags
  }
}

/**
 * One character's info with a scene's milestones folded in: the flag transitions, the
 * memories the two biggest of them leave behind, worded for the holder's gender, and the dates
 * dating starting and ending leave on her.
 */
export function foldRelationshipEvents(
  info: CharInfo,
  events: readonly RelationshipEvent[],
  date: number,
  holder: Gender
): CharInfo {
  const before = info.flags ?? emptyFlags()
  let flags = before
  for (const event of events) flags = applyEvent(flags, event)
  const { them } = PRONOUNS[holder]

  // The milestones' own memories, stacked with whatever the ledger wrote about the scene.
  const milestones: CharMemory[] = []
  if (!before.hasKissed && flags.hasKissed) {
    milestones.push({ date, type: 'loved', desc: `the reader kissed ${them} for the first time` })
  }
  if (!before.hadSex && flags.hadSex) {
    milestones.push({
      date,
      type: 'loved',
      desc: `the reader slept with ${them} for the first time`
    })
  }
  // Keyed on the count, so a second breakup writes a second memory.
  if (flags.brokenUp > before.brokenUp) {
    milestones.push({ date, type: 'hated', desc: `things ended between the reader and ${them}` })
  }

  const folded: CharInfo = {
    ...info,
    flags,
    // Every memory is kept, the milestones after the rest.
    memories: [...info.memories, ...milestones]
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
 * What an unanswered invitation costs her, in the reader's voice: completes
 * "{Name} disliked that ..." in the memory, and with `who` "you" in the ending's status line.
 */
export function ignoredTextDesc(g: Gender, who = 'the reader'): string {
  return `${who} ignored ${PRONOUNS[g].their} text`
}

/**
 * What leaving her vent unanswered costs her, in the same voice, kept as her texting memory:
 * completes "{Name} disliked that ..." before the clause saying it was over text.
 */
export function ignoredVentDesc(g: Gender, who = 'the reader'): string {
  return `${who} ignored ${PRONOUNS[g].them} when ${PRONOUNS[g].they} wanted to vent`
}

/**
 * What answering an invitation with a no costs a lover, in the same voice: completes
 * "{Name} disliked that ..." in the memory, and with `who` "you" in the ending's status line.
 */
export function turnedDownDesc(g: Gender, who = 'the reader'): string {
  return `${who} turned down ${PRONOUNS[g].their} request to hang out`
}

/**
 * What a plan the reader stood her up on costs her, in the same voice: completes
 * "{Name} hated that ...".
 */
export function ghostedDesc(g: Gender, title: string): string {
  return `the reader ghosted ${PRONOUNS[g].them} and didn't show up for ${title}`
}

/** The status line that puts someone the reader has a plan with on his phone. */
export function contactInfoLine(name: string, g: Gender): string {
  return `${name} gave you ${PRONOUNS[g].their} contact info so you can coordinate your plans.`
}

/**
 * Every word said to the player about a milestone, one line per milestone the scene actually
 * reached, her number given in her own pronoun.
 */
export function milestoneStatusLines(
  name: string,
  before: CharFlags,
  after: CharFlags,
  holder: Gender
): string[] {
  const lines: string[] = []
  // A fixed order: escalating first, then the ways it goes wrong.
  if (!before.gaveContactInfo && after.gaveContactInfo)
    lines.push(`${name} gave you ${PRONOUNS[holder].their} contact info.`)
  if (!before.hasKissed && after.hasKissed) lines.push(`You and ${name} kissed for the first time.`)
  if (!before.hadSex && after.hadSex)
    lines.push(`You and ${name} slept together for the first time.`)
  if (!before.isLover && after.isLover) lines.push(`You and ${name} became lovers.`)
  if (!before.harem && after.harem) lines.push(`${name} agreed to an open relationship with you.`)
  if (!before.friendZoned && after.friendZoned) lines.push(`You friendzoned ${name}.`)
  if (!before.friendZonedBy && after.friendZonedBy) lines.push(`${name} friendzoned you.`)
  if (after.brokenUp > before.brokenUp) lines.push(`You and ${name} broke up.`)
  // The true→false diffs, last.
  if (before.harem && !after.harem && after.isLover)
    lines.push(`${name} agreed to a closed relationship with you.`)
  if (before.blocked && !after.blocked) lines.push(`${name} unblocked you.`)
  return lines
}

/**
 * The words a milestone sentence is read for: the phrase the modal marks, and whether it is
 * a loss. It sits beside the sentences so a reworded line and its phrase are one diff.
 */
const MILESTONE_PHRASES: readonly { phrase: string; loss: boolean }[] = [
  { phrase: 'gave you her contact info', loss: false },
  { phrase: 'gave you his contact info', loss: false },
  { phrase: 'kissed', loss: false },
  { phrase: 'slept together', loss: false },
  { phrase: 'became lovers', loss: false },
  { phrase: 'open relationship', loss: false },
  { phrase: 'closed relationship', loss: false },
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
 * Whether what the scene reached is a loss rather than a step forward — the three of the ten
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

/** The romance setting a playthrough plays under when its record carries none. */
export const DEFAULT_ROMANCE: RomanceSetting = { female: 'sexuality', male: 'sexuality' }

/** Everyone attracted to the reader: Quickstart's, and a play that is not a playthrough's own. */
export const ALL_ROMANCE: RomanceSetting = { female: 'all', male: 'all' }

/** Every romance level, in the order the steppers walk them. */
export const ROMANCE_LEVELS: readonly RomanceLevel[] = ['none', 'sexuality', 'all', 'everyone']

/** One gender's level off a stored value: one of the levels, else following her sexuality. */
function romanceLevelOf(value: unknown): RomanceLevel {
  return ROMANCE_LEVELS.includes(value as RomanceLevel) ? (value as RomanceLevel) : 'sexuality'
}

/** The romance setting a record holds, read leniently, one gender at a time. */
export function romanceOf(record: { romance?: unknown } | null | undefined): RomanceSetting {
  const held = record?.romance
  const stored = typeof held === 'object' && held !== null ? (held as Record<string, unknown>) : {}
  return { female: romanceLevelOf(stored.female), male: romanceLevelOf(stored.male) }
}

/** Attracted to both genders, which is what `everyone` makes of her. */
const EVERYONE: Attraction = { female: true, male: true }

/**
 * Who she is attracted to in this playthrough: what it settled for her, else her record, with
 * the reader's own gender added where her gender's level is `all`, and both where it is
 * `everyone`. A they/them reader adds none.
 */
export function attractionInPlay(
  c: Pick<Character, 'gender' | 'attractedTo'> | null | undefined,
  info: Pick<CharInfo, 'attractedTo'> | undefined,
  romance: RomanceSetting,
  reader: ReaderPronouns
): Attraction {
  if (romance[genderOf(c)] === 'everyone') return { ...EVERYONE }
  const attraction = asAttraction(info?.attractedTo) ?? attractionOf(c)
  const readerGender = readerGenderOf(reader)
  if (romance[genderOf(c)] !== 'all' || readerGender === null) return attraction
  return { ...attraction, [readerGender]: true }
}

/**
 * Who she is attracted to among the other characters: both genders where her gender's level is
 * `everyone`, else what the playthrough settled for her, else her record. `all` adds nothing.
 */
export function npcAttractionOf(
  c: Pick<Character, 'gender' | 'attractedTo'> | null | undefined,
  info: Pick<CharInfo, 'attractedTo'> | undefined,
  romance: RomanceSetting
): Attraction {
  if (romance[genderOf(c)] === 'everyone') return { ...EVERYONE }
  return asAttraction(info?.attractedTo) ?? attractionOf(c)
}

/**
 * Whether the reader may romance her: her gender's level is not `none` and she is attracted to
 * the reader's gender (to a they/them reader, always), or the two have already kissed, slept
 * together, dated, been friends with benefits or broken up.
 */
export function isRomanceable(
  c: Pick<Character, 'gender' | 'attractedTo'> | null | undefined,
  info: Pick<CharInfo, 'flags' | 'datingSince' | 'attractedTo'> | undefined,
  romance: RomanceSetting,
  reader: ReaderPronouns
): boolean {
  if (romance[genderOf(c)] !== 'none') {
    const readerGender = readerGenderOf(reader)
    if (readerGender === null) return true
    if (attractionInPlay(c, info, romance, reader)[readerGender]) return true
  }
  const flags: Partial<CharFlags> | undefined = info?.flags
  return (
    flags?.hasKissed === true ||
    flags?.hadSex === true ||
    flags?.isLover === true ||
    flags?.benefits === true ||
    (flags?.brokenUp ?? 0) > 0 ||
    info?.datingSince !== undefined
  )
}

/** The character half of the roll — what she is drawn to, and how hard she is to reach. */
type CrushCharacter = Pick<Character, 'traits' | 'preferredStat'> | undefined

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
 * Where one girl stands for her standards line: free to fall for the reader, taken by somebody
 * whose couple holds her odds down, or fallen for him already.
 */
export type CrushStanding = 'free' | 'taken' | 'crush'

/**
 * What the memory scroll says about one girl's standards, and what to remember having said.
 * A stat is named once per tier, and the same hint object comes back whenever
 * there is nothing new to say, which is what lets the caller skip the write. A taken girl is
 * not said to be interested until she is free or has fallen for him anyway, and a girl who has
 * fallen for him is told nothing she is waiting on.
 */
export function crushHintUpdate(
  name: string,
  character: CrushCharacter,
  stats: PlayerStats,
  hint: CrushHint | undefined,
  standing: CrushStanding = 'free'
): { line: string | null; hint: CrushHint | undefined } {
  // The terminal state: nothing takes a payoff back.
  if (hint && 'met' in hint) return { line: null, hint }
  if (hint && tierOf(stats[hint.stat]) <= hint.tier) return { line: null, hint }

  const missing = missingCrushStatOf(character, stats)
  if (missing === null) {
    // Nothing was promised, so there is no payoff to pay off.
    if (!hint) return { line: null, hint: undefined }
    // Still owed, and paid once she is single again or has a crush on him.
    if (standing === 'taken') return { line: null, hint }
    return {
      line: `Your ${hintSubject(character, hint.stat)} seem${
        hasTrait(character, 'High Standards') ? '' : 's'
      } to have caught ${name}'s interest...`,
      hint: { met: true }
    }
  }

  // Short of her bar again after a break, she already has a crush on him.
  if (standing === 'crush') return { line: null, hint }

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

/**
 * One draw against {@link crushChance}, multiplied by `factor` (what being taken does to it);
 * `rand` is injectable for tests. A factor of 0 draws nothing.
 */
export function rollsCrush(
  character: CrushCharacter,
  stats: PlayerStats,
  affection: number,
  rand: () => number = Math.random,
  factor = 1
): boolean {
  // Never at a score `refreshedFlags` would clear it at.
  if (affection < 0 || factor <= 0) return false
  return rand() < crushChance(character, stats, affection) * factor
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

/** How many scenes shared with her a new crush and a new relationship take to settle. */
const CRUSH_SETTLE_SCENES = 2
const LOVER_SETTLE_SCENES = 1

/** A running count one scene on, or absent once it reaches `settle`; absent stays absent. */
function countedScene(
  scenes: number | undefined,
  cast: boolean,
  settle: number
): number | undefined {
  if (scenes === undefined) return undefined
  const next = cast ? scenes + 1 : scenes
  return next >= settle ? undefined : next
}

/**
 * Her `romanceScenes` once a boundary has run: 0 where it made her a lover or gave her a crush,
 * the scene that did it not counting; one more for a scene she was cast in; absent once settled
 * or while she holds neither.
 */
export function romanceScenesAfter(
  before: CharFlags | undefined,
  after: CharInfo,
  cast: boolean
): number | undefined {
  const flags = after.flags ?? emptyFlags()
  if (flags.isLover) {
    return before?.isLover ? countedScene(after.romanceScenes, cast, LOVER_SETTLE_SCENES) : 0
  }
  if (flags.hasCrush) {
    return before?.hasCrush ? countedScene(after.romanceScenes, cast, CRUSH_SETTLE_SCENES) : 0
  }
  return undefined
}

/**
 * Every entry's `romanceScenes` stepped over one boundary, off the flags each crossed it with and
 * who was cast; an entry it leaves alone keeps its identity, and so does the map when none moved.
 */
export function withRomanceScenes(
  before: Readonly<Record<string, Pick<CharInfo, 'flags'> | undefined>>,
  after: Readonly<Record<string, CharInfo>>,
  cast: readonly string[]
): Readonly<Record<string, CharInfo>> {
  let next: Record<string, CharInfo> | null = null
  for (const [charId, info] of Object.entries(after)) {
    // A graduate is never cast again, so a romance with her is never counted toward settling.
    if (info.pursuing !== undefined) continue
    const scenes = romanceScenesAfter(before[charId]?.flags, info, cast.includes(charId))
    if (scenes === info.romanceScenes) continue
    const stepped = { ...info }
    if (scenes === undefined) delete stepped.romanceScenes
    else stepped.romanceScenes = scenes
    next ??= { ...after }
    next[charId] = stepped
  }
  return next ?? after
}

/** The break penalty she holds, as points off her affection: whole, then half rounded up. */
export function breakPenaltyNow(penalty: CharInfo['breakPenalty']): number {
  if (!penalty) return 0
  return penalty.halved ? Math.ceil(penalty.points / 2) : penalty.points
}

/** Where the break leaves each tier it lowers: the bottom of the tier below, friendly at zero. */
const BREAK_TARGETS: Partial<Record<Disposition, number>> = {
  devoted: TRUSTED_FLOOR + 1,
  trusted: FRIENDLY_FLOOR + 1,
  friendly: 0
}

/**
 * The penalty a later semester's start hands her off the affection she would open it on: a whole
 * one taking her to the tier below, counted off her affection without what she already holds, or
 * null below friendly, where she keeps that.
 */
export function breakPenaltyAt(
  affection: number,
  held: CharInfo['breakPenalty']
): NonNullable<CharInfo['breakPenalty']> | null {
  const target = BREAK_TARGETS[dispositionOf(affection)]
  if (target === undefined) return null
  return { points: affection + breakPenaltyNow(held) - target }
}

/**
 * Every cast girl's break penalty stepped over one boundary: halved by her first scene, gone after
 * her second. An entry it leaves alone keeps its identity, and so does the map when none moved.
 */
export function withBreakPenaltiesStepped(
  after: Readonly<Record<string, CharInfo>>,
  cast: readonly string[]
): Readonly<Record<string, CharInfo>> {
  let next: Record<string, CharInfo> | null = null
  for (const charId of cast) {
    const info = after[charId]
    // A graduate is never cast again, and so never holds one.
    if (!info?.breakPenalty || info.pursuing !== undefined) continue
    const stepped = { ...info }
    if (info.breakPenalty.halved) delete stepped.breakPenalty
    else stepped.breakPenalty = { ...info.breakPenalty, halved: true }
    next ??= { ...after }
    next[charId] = stepped
  }
  return next ?? after
}

/** The first morning's word that the break cost something, both losses in the loss colour. */
export function breakDecayLine(): SceneLine {
  return markedRuns(
    [
      'Over the break, ',
      'your skills got a bit rusty',
      ' and you may have ',
      'grown a bit distant from some of your old friends',
      '.'
    ],
    'loss'
  )
}
