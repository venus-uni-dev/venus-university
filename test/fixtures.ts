import { rollProfessor } from '@shared/academics'
import { EMOTIONS } from '@shared/emotions'
import { pairKeyOf, type NpcRelationshipMap } from '@shared/npcRelationships'
import { allFollowMain } from '@shared/outfits'
import { DEFAULT_PLAYER_STATS, type PlayerStats } from '@shared/playerStats'
import { emptyFlags } from '@shared/relationship'
import type { ItemDef } from '@shared/shop'
import type {
  CalendarEvent,
  CharInfo,
  CharJob,
  Character,
  CourseEntry,
  Emotion,
  EnrollmentDraft,
  PeClassEntry,
  PlaythroughDraft,
  PlaythroughRecord,
  SceneLine
} from '@shared/types'
import type { VenusUniversityApi } from '../src/preload/api'

/** Test fixtures. Nothing here is read at runtime — it only feeds the suite. */

/** A complete `Character` so store code that reads `pose` or names finds them. */
export function character(over: Partial<Character> = {}): Character {
  const expressionTags = {} as Record<Emotion, string[]>
  for (const emotion of EMOTIONS) expressionTags[emotion] = ['smile']

  return {
    schemaVersion: 3,
    charId: 'char-1',
    firstName: 'Sarah',
    lastName: 'Rose',
    personality: 'warm',
    behavior: {
      withStrangers: 'polite',
      withFriends: 'warm',
      withCrush: 'shy',
      withLover: 'doting',
      withEnemy: 'cold'
    },
    backstory: 'grew up behind the counter of her family bakery',
    datingHistory: 'one long relationship that ended badly',
    datingPreference: 'She wants something that lasts',
    kinks: 'She fantasizes about being praised',
    isVirgin: false,
    likes: ['quiet mornings', 'strong coffee'],
    dislikes: ['being interrupted'],
    giftPreferences: { liked: ['cozy'], disliked: ['edgy'] },
    traits: [],
    preferredStat: 'heart',
    height: 0.97,
    generationSeed: 1,
    seedFollowsMain: allFollowMain(),
    setSeeds: {},
    baseAppearance: ['long_hair'],
    pose: 'standing',
    outfit: ['coat'],
    peOutfit: ['navy_buruma', 'buruma'],
    swimOutfit: ['red_bikini', 'bikini'],
    expressionTags,
    roomPrompt: 'with fairy lights and a cluttered desk.',
    ...over
  }
}

/** Keys a set of characters by charId, the shape `gameStore.characters` holds. */
export function charactersById(...list: Character[]): Record<string, Character> {
  const map: Record<string, Character> = {}
  for (const char of list) map[char.charId] = char
  return map
}

/** One character's save state. Callers override whatever their assertions read. */
export function charInfo(over: Partial<CharInfo> = {}): CharInfo {
  return {
    memories: [],
    flags: emptyFlags(),
    nameKnown: false,
    year: 1,
    dorm: 'lowrise_1',
    major: 'Biology',
    schedule: {},
    ...over
  }
}

/**
 * One character's part-time job. Defaults to a job already in force —
 * `startsOn` is the freshman case and callers who want it say so.
 */
export function charJob(over: Partial<CharJob> = {}): CharJob {
  return { jobId: 'cutetea', shifts: [11], ...over }
}

/** One thing the reader can buy and give. Callers override whatever their assertions read. */
export function item(over: Partial<ItemDef> = {}): ItemDef {
  return {
    id: 'item-1',
    shopId: 'shop-1',
    name: 'Test Item',
    emoji: '🎁',
    price: 20,
    description: 'A present.',
    categories: ['cozy'],
    ...over
  }
}

/** A decorated course, carrying everything a generated one always has. */
export function classEntry(over: Partial<CourseEntry> = {}): CourseEntry {
  return {
    code: 'BIO 210',
    name: 'Cell Biology',
    description: 'Cells.',
    category: 'major',
    slot: 0,
    kind: 'lecture',
    difficulty: 'medium',
    professor: rollProfessor(['Okafor'], () => 0),
    ...over
  }
}

/** A PE class: no kind and no difficulty, but a coach of her own. */
export function peClassEntry(over: Partial<PeClassEntry> = {}): PeClassEntry {
  return {
    code: 'PED 101',
    name: 'Fitness',
    description: 'Running.',
    category: 'pe',
    slot: 0,
    instructor: rollProfessor(['Okafor'], () => 0),
    ...over
  }
}

/**
 * A playthrough record — the half of a save New Game settles. Callers override whichever
 * half their assertions read.
 */
export function playthroughRecord(over: Partial<PlaythroughRecord> = {}): PlaythroughRecord {
  return {
    schemaVersion: 3,
    chars: [],
    playerFirstName: 'Seth',
    playerLastName: 'Hawke',
    classes: {},
    occasions: [],
    jobClosures: {},
    weather: [],
    profiles: {},
    ...over
  }
}

/** A planned event, dated well clear of the day it was made on. */
export function calendarEvent(over: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'e',
    date: 3,
    time: 1,
    title: 'Dinner',
    description: 'Dinner out.',
    charIds: ['a'],
    madeOn: { date: 2, time: 0 },
    ...over
  }
}

/** The record half of a new playthrough; the saves are read against it. */
export function record(over: Partial<PlaythroughDraft> = {}): PlaythroughDraft {
  const { schemaVersion: _version, ...rest } = playthroughRecord()
  return { ...rest, ...over }
}

/** A semester with nothing in it but its roster and the reader, as the registrar is offered one. */
export function enrollment(over: Partial<EnrollmentDraft> = {}): EnrollmentDraft {
  return {
    chars: ['a'],
    classes: {},
    perChar: {},
    jobs: {},
    haunts: {},
    feeds: {},
    springBreakPlans: {},
    occasions: [],
    playerFirstName: 'Seth',
    playerLastName: 'Hawke',
    stats: DEFAULT_PLAYER_STATS,
    ...over
  }
}

/** Scene lines with no speaker, one per text. */
export function sceneLines(...texts: string[]): SceneLine[] {
  return texts.map((text) => ({ speaker: '', text }))
}

/** One line, as the model streams it: a growing prefix of the reply's JSON. */
export function lineDelta(text: string): string {
  return `{"lines":[{"speaker":"","text":"${text}"}]}`
}

/** A small deterministic PRNG so draws are reproducible across runs. */
export function lcg(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff
    return state / 0x7fffffff
  }
}

/** A `rand` that hands back the listed values in order, then repeats the last one. */
export function scripted(values: readonly number[]): () => number {
  let index = 0
  return () => values[Math.min(index++, values.length - 1)]
}

/** A friends-band affinity for each named pair. */
export function friends(...pairs: readonly (readonly [string, string])[]): NpcRelationshipMap {
  const map: NpcRelationshipMap = {}
  for (const [a, b] of pairs) map[pairKeyOf(a, b)] = { affinity: 5 }
  return map
}

/** Shorthand for the three points in display order. */
export function playerStats(brain: number, body: number, heart: number): PlayerStats {
  return { brain, body, heart }
}

/** Partial to any depth, but leaving the IPC methods themselves whole. */
type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends (...args: never[]) => unknown ? T[K] : DeepPartial<T[K]>
}

/**
 * Installs a partial `window.api` for a test; {@link restoreApi} takes it away again.
 * Only the methods passed exist — anything else a store calls throws.
 */
export function stubApi(api: DeepPartial<VenusUniversityApi>): void {
  ;(globalThis as { window?: unknown }).window = { api: { platform: 'desktop', ...api } }
}

/** Removes the stubbed bridge. Call from `afterEach`, or the next suite inherits it. */
export function restoreApi(): void {
  delete (globalThis as { window?: unknown }).window
}
