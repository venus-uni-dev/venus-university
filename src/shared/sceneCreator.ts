import { appError } from './errors'
import type { ReaderPronouns } from './gender'
import { assertSafeId, validateRecord } from './jsonValidate'
import { genderOf } from './gender'
import {
  isFreeToDate,
  npcPartnersOf,
  pairKeyOf,
  type NpcRelationshipMap
} from './npcRelationships'
import { HONEYMOON_DAYS } from './odds'
import { STAT_KEYS, type StatKey, type StatTier, pointsForTier, type PlayerStats } from './playerStats'
import { affectionOfDisposition, emptyFlags, type Disposition } from './relationship'
import { hasTrait } from './traits'
import type {
  Attraction,
  CharFlags,
  Character,
  OutfitLock,
  SceneGift,
  SceneLine,
  TimeSlot
} from './types'
import { WEATHER_SLOTS, type Weather } from './weather'

/**
 * The Scene Creator's setup and its saved scenes: what the player picks for one scene played
 * outside any playthrough, the rules that keep those picks from contradicting each other, and
 * the record a finished scene is kept as.
 */

/** The milestones the setup offers, in the order the modal lists them. */
export const SCENE_MILESTONES = [
  'met',
  'lovers',
  'crush',
  'kissed',
  'sex',
  'broke_up',
  'friendzoned_by_reader',
  'friendzoned_reader',
  'agreed_to_harem'
] as const
export type SceneMilestone = (typeof SCENE_MILESTONES)[number]
export type SceneMilestones = Record<SceneMilestone, boolean>

/**
 * How two girls in the scene stand with each other; strangers have never met, and two dating
 * are friends past their honeymoon.
 */
export const SCENE_RELATIONS = ['dating', 'friends', 'acquaintances', 'strangers', 'enemies'] as const
export type SceneRelation = (typeof SCENE_RELATIONS)[number]

/** The relation a pair nobody has set stands at. */
const DEFAULT_RELATION: SceneRelation = 'friends'

/** Every disposition tier, warmest first — the order the setup's dropdown lists them. */
export const SCENE_DISPOSITIONS: readonly Disposition[] = [
  'devoted',
  'trusted',
  'friendly',
  'neutral',
  'annoyed',
  'hostile'
]

/** Who the reader is in a created scene. */
export interface SceneReader {
  firstName: string
  lastName: string
  /** Absent on a scene saved before pronouns were asked, read as he/him. */
  pronouns?: ReaderPronouns
  tiers: Record<StatKey, StatTier>
  bio: string
}

/** One girl in the scene and everything set about her. */
export interface SceneCastEntry {
  charId: string
  /** The wardrobe she starts the scene in. */
  outfit: OutfitLock
  disposition: Disposition
  milestones: SceneMilestones
  /** Closes her CAST entry as a contact page's notes do; empty is none. */
  notes: string
}

/** Everything a created scene is played from, and what a saved one is rebuilt from. */
export interface SceneSetup {
  reader: SceneReader
  cast: SceneCastEntry[]
  /** Keyed by `pairKeyOf`; a pair with no entry stands at {@link DEFAULT_RELATION}. */
  pairs: Record<string, SceneRelation>
  date: number
  time: TimeSlot
  weather: Weather
  /** The background it opens on; absent is the writer's pick. */
  bg?: string
  /** The reader's opening action. */
  prompt: string
}

/** On-disk saved scene — `/data/scenes/{id}.json`. */
export interface SavedScene {
  schemaVersion: 1
  /** A v4 UUID, which is also the file name. */
  id: string
  name: string
  /** Epoch ms. */
  savedAt: number
  setup: SceneSetup
  /** The cast's full names as they were when it was saved, in cast order — what the list names a deleted girl by. */
  castNames: string[]
  /** Every line delivered, the reader's own included, in order. */
  transcript: SceneLine[]
  /** The gift the scene handed over, if one was. */
  gifts?: SceneGift[]
  /** The scene ran to its goodbye; false is one left part-way. */
  ended: boolean
}

export const SAVED_SCENE_SCHEMA_VERSION = 1

/** A saved scene as the Load scene list reads it: everything but its lines. */
export type SavedSceneSummary = Omit<SavedScene, 'transcript' | 'gifts'>

/** The list's half of a saved scene. */
export function summaryOfScene(scene: SavedScene): SavedSceneSummary {
  const { transcript: _transcript, gifts: _gifts, ...summary } = scene
  return summary
}

/** A saved scene's id: the v4 UUID `randomId` mints, nothing that could leave its folder. */
const SAFE_SCENE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Refuses an id that is not one a saved scene could have been written under. */
export function assertSceneId(id: string): void {
  assertSafeId(id, SAFE_SCENE_ID, 'SCENE_ID_INVALID', 'That is not a saved scene id.')
}

/** Raised when no saved scene is kept under the id asked for. */
export const SCENE_NOT_FOUND = { code: 'SCENE_NOT_FOUND', message: 'That saved scene no longer exists.' }

/** The most a scene's name may hold. */
export const SCENE_NAME_MAX = 48

/** A name as it is kept: one line, spaces collapsed, cut to {@link SCENE_NAME_MAX}. */
export function sceneNameOf(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, SCENE_NAME_MAX).trim()
}

/** The days a created scene may be set on: the first day's and graduation's slots are scripted. */
export const SCENE_FIRST_DATE = 1
export const SCENE_LAST_DATE = 122

/** The date the setup opens on — Friday, March 20, a day nothing is happening. */
export const DEFAULT_SCENE_DATE = 60

/** Every milestone unset but `met`. */
export function defaultMilestones(): SceneMilestones {
  return {
    met: true,
    lovers: false,
    crush: false,
    kissed: false,
    sex: false,
    broke_up: false,
    friendzoned_by_reader: false,
    friendzoned_reader: false,
    agreed_to_harem: false
  }
}

/** Her disposition as the scene plays it: a girl he has not met is held at neutral. */
export function effectiveDisposition(
  entry: Pick<SceneCastEntry, 'disposition' | 'milestones'>
): Disposition {
  return entry.milestones.met ? entry.disposition : 'neutral'
}

/** Sleeping together without being lovers, as the game derives it at the act. */
function benefitsOf(milestones: SceneMilestones, disposition: Disposition): boolean {
  return (
    milestones.sex && !milestones.lovers && !milestones.broke_up && disposition !== 'hostile'
  )
}

/**
 * The milestones a setup cannot leave as picked, each with the value it is held at: unmet
 * clears everything; lovers clears a crush and either friendzone; a crush cannot stand below
 * neutral; sex is a kiss too; sharing only means something to a lover, a crush or a friend with
 * benefits, and a Promiscuous girl always shares.
 */
export function lockedMilestones(
  milestones: SceneMilestones,
  disposition: Disposition,
  character: Pick<Character, 'traits'> | undefined
): Partial<SceneMilestones> {
  const locked: Partial<SceneMilestones> = {}
  const promiscuous = hasTrait(character, 'Promiscuous')
  if (!milestones.met) {
    for (const key of SCENE_MILESTONES) if (key !== 'met') locked[key] = false
    if (promiscuous) locked.agreed_to_harem = true
    return locked
  }
  if (milestones.lovers) {
    locked.crush = false
    locked.friendzoned_by_reader = false
    locked.friendzoned_reader = false
  }
  if (disposition === 'annoyed' || disposition === 'hostile') locked.crush = false
  if (milestones.sex) locked.kissed = true
  if (promiscuous) locked.agreed_to_harem = true
  else {
    const crush = locked.crush ?? milestones.crush
    if (!milestones.lovers && !crush && !benefitsOf(milestones, disposition)) {
      locked.agreed_to_harem = false
    }
  }
  return locked
}

/** The milestones with every lock applied — what the scene is actually played with. */
export function normalizeMilestones(
  milestones: SceneMilestones,
  disposition: Disposition,
  character: Pick<Character, 'traits'> | undefined
): SceneMilestones {
  return { ...milestones, ...lockedMilestones(milestones, disposition, character) }
}

/**
 * One box ticked or cleared, the two friendzones being one answer or the other, then every lock
 * applied.
 */
export function withMilestone(
  milestones: SceneMilestones,
  key: SceneMilestone,
  value: boolean,
  disposition: Disposition,
  character: Pick<Character, 'traits'> | undefined
): SceneMilestones {
  const next = { ...milestones, [key]: value }
  if (value && key === 'friendzoned_by_reader') next.friendzoned_reader = false
  if (value && key === 'friendzoned_reader') next.friendzoned_by_reader = false
  return normalizeMilestones(next, disposition, character)
}

/** Her flags as the game would hold them had the setup's milestones been reached in play. */
export function flagsOfEntry(
  entry: Pick<SceneCastEntry, 'disposition' | 'milestones'>,
  character: Pick<Character, 'traits'> | undefined
): CharFlags {
  const disposition = effectiveDisposition(entry)
  const m = normalizeMilestones(entry.milestones, disposition, character)
  return {
    ...emptyFlags(),
    hasMet: m.met,
    hasCrush: m.crush,
    friendZoned: m.friendzoned_by_reader,
    friendZonedBy: m.friendzoned_reader,
    isLover: m.lovers,
    brokenUp: m.broke_up ? 1 : 0,
    hasKissed: m.kissed,
    hadSex: m.sex,
    benefits: benefitsOf(m, disposition),
    harem: m.agreed_to_harem,
    knowsLoveLife: m.lovers
  }
}

/** The affinity each relation is held at, inside the band `zoneOf` reads it as. */
const RELATION_AFFINITY: Record<Exclude<SceneRelation, 'strangers'>, number> = {
  dating: 5,
  friends: 5,
  acquaintances: 0,
  enemies: -5
}

/** What a setup knows of each character for deciding whether she may be set to dating, by charId. */
export type SetupPeople = Readonly<
  Record<
    string,
    | { character?: Pick<Character, 'traits'>; flags?: Pick<CharFlags, 'isLover' | 'harem'> }
    | undefined
  >
>

/**
 * `map` with every pair the player set laid over it: each relation but dating first, then each
 * pair set to dating, in key order, as a couple where both may still start dating on what has
 * been laid so far, and as friends where either may not. A couple starts past its honeymoon.
 */
function layPairs(
  map: NpcRelationshipMap,
  pairs: Readonly<Record<string, SceneRelation>>,
  date: number,
  people: SetupPeople
): NpcRelationshipMap {
  const dating: string[] = []
  for (const [key, relation] of Object.entries(pairs)) {
    delete map[key]
    if (relation === 'dating') dating.push(key)
    else if (relation !== 'strangers') map[key] = { affinity: RELATION_AFFINITY[relation] }
  }
  const free = (charId: string): boolean =>
    isFreeToDate(map, charId, people[charId]?.character, people[charId]?.flags)
  for (const key of dating.sort()) {
    const [a, b] = key.split('|')
    map[key] =
      free(a) && free(b)
        ? { affinity: RELATION_AFFINITY.dating, dating: date - HONEYMOON_DAYS }
        : { affinity: RELATION_AFFINITY.friends }
  }
  return map
}

/** The relation one pair of the cast stands at. */
export function relationOf(
  pairs: Readonly<Record<string, SceneRelation>>,
  a: string,
  b: string
): SceneRelation {
  return pairs[pairKeyOf(a, b)] ?? DEFAULT_RELATION
}

/**
 * The cast's pair map on `date`: every pair at its relation, strangers having no entry, and a
 * pair set to dating a couple where {@link layPairs} lets it be one.
 */
export function npcRelationshipsOf(
  cast: readonly string[],
  pairs: Readonly<Record<string, SceneRelation>>,
  date = 0,
  people: SetupPeople = {}
): NpcRelationshipMap {
  const every: Record<string, SceneRelation> = {}
  for (let i = 0; i < cast.length; i++) {
    for (let j = i + 1; j < cast.length; j++) {
      every[pairKeyOf(cast[i], cast[j])] = relationOf(pairs, cast[i], cast[j])
    }
  }
  return layPairs({}, every, date, people)
}

/**
 * A rolled or carried pair map with every pair the player set laid over it on `date`:
 * strangers have no entry, the rest stand at their relation's affinity, and a pair set to dating
 * is a couple where {@link layPairs} lets it be one.
 */
export function pairsOver(
  rolled: Readonly<NpcRelationshipMap>,
  pairs: Readonly<Record<string, SceneRelation>>,
  date = 0,
  people: SetupPeople = {}
): NpcRelationshipMap {
  return layPairs({ ...rolled }, pairs, date, people)
}

/**
 * The picks as they will be laid over `base`: a pair set to dating that cannot hold reads as
 * friends. The same object where every one holds.
 */
export function pairsAsLaid(
  base: Readonly<NpcRelationshipMap>,
  pairs: Readonly<Record<string, SceneRelation>>,
  people: SetupPeople
): Record<string, SceneRelation> {
  const laid = pairsOver(base, pairs, 0, people)
  let shown: Record<string, SceneRelation> | null = null
  for (const [key, relation] of Object.entries(pairs)) {
    if (relation !== 'dating' || laid[key]?.dating !== undefined) continue
    shown ??= { ...pairs }
    shown[key] = 'friends'
  }
  return shown ?? (pairs as Record<string, SceneRelation>)
}

/**
 * Whether `a` and `b` may be set to dating over `base` and the other picks: both may still
 * start dating once every other pair is laid.
 */
export function datingOffered(
  base: Readonly<NpcRelationshipMap>,
  pairs: Readonly<Record<string, SceneRelation>>,
  a: string,
  b: string,
  people: SetupPeople
): boolean {
  const { [pairKeyOf(a, b)]: _own, ...others } = pairs
  const laid = pairsOver(base, others, 0, people)
  delete laid[pairKeyOf(a, b)]
  return [a, b].every((charId) =>
    isFreeToDate(laid, charId, people[charId]?.character, people[charId]?.flags)
  )
}

/**
 * Who `charId` is attracted to once everybody she is dating on `map` is counted: their genders
 * added to `attraction`. The same object where she is dating nobody it leaves out.
 */
export function withDatingAttraction(
  attraction: Attraction,
  charId: string,
  map: Readonly<NpcRelationshipMap>,
  characters: Readonly<Record<string, Pick<Character, 'gender'> | undefined>>
): Attraction {
  let next: Attraction | null = null
  for (const partner of npcPartnersOf(map, charId, Object.keys(characters))) {
    const gender = genderOf(characters[partner])
    if ((next ?? attraction)[gender]) continue
    next = { ...(next ?? attraction), [gender]: true }
  }
  return next ?? attraction
}

/** The pairs kept for a cast: only those whose two girls are both still in it. */
export function pairsWithin(
  cast: readonly string[],
  pairs: Readonly<Record<string, SceneRelation>>
): Record<string, SceneRelation> {
  const kept: Record<string, SceneRelation> = {}
  for (const [key, relation] of Object.entries(pairs)) {
    const [a, b] = key.split('|')
    if (cast.includes(a) && cast.includes(b)) kept[key] = relation
  }
  return kept
}

/** A semester's sky that is clear everywhere but the scene's own slot. */
export function weatherTableOf(date: number, time: TimeSlot, weather: Weather): Weather[] {
  const table = Array<Weather>(WEATHER_SLOTS).fill('clear')
  table[date * 2 + time] = weather
  return table
}

/** The reader's stats as points, each tier at the fewest points that buy it. */
export function statsOfReader(reader: Pick<SceneReader, 'tiers'>): PlayerStats {
  const stats = {} as PlayerStats
  for (const key of STAT_KEYS) stats[key] = pointsForTier(reader.tiers[key])
  return stats
}

/** Whether Start can be pressed: somebody is cast and the opening says something. */
export function setupStartable(setup: Pick<SceneSetup, 'cast' | 'prompt'>): boolean {
  return setup.cast.length > 0 && setup.prompt.trim() !== ''
}

/**
 * Checks one parsed saved scene and hands it back typed; `where` is the path or key it came
 * from. The setup is checked as deep as a scene needs it to be entered.
 */
export function validateSavedScene(parsed: unknown, where: string): SavedScene {
  const scene = validateRecord<SavedScene>(parsed, where, {
    label: 'That saved scene',
    malformed: { code: 'SCENE_MALFORMED', message: 'A saved scene is damaged.' },
    schemaVersion: { code: 'SCENE_SCHEMA_VERSION' },
    expects: SAVED_SCENE_SCHEMA_VERSION,
    required: {
      schemaVersion: true,
      id: true,
      name: true,
      savedAt: true,
      setup: true,
      castNames: true,
      transcript: true,
      ended: true
    }
  })
  const setup = scene.setup as Partial<SceneSetup> | null
  const shaped =
    typeof scene.id === 'string' &&
    SAFE_SCENE_ID.test(scene.id) &&
    typeof scene.name === 'string' &&
    typeof scene.savedAt === 'number' &&
    typeof scene.ended === 'boolean' &&
    Array.isArray(scene.castNames) &&
    scene.castNames.every((name) => typeof name === 'string') &&
    Array.isArray(scene.transcript) &&
    typeof setup === 'object' &&
    setup !== null &&
    Array.isArray(setup.cast) &&
    setup.cast.every(
      (entry) => typeof entry?.charId === 'string' && typeof entry.milestones === 'object'
    ) &&
    typeof setup.reader === 'object' &&
    typeof setup.pairs === 'object' &&
    typeof setup.date === 'number' &&
    (setup.time === 0 || setup.time === 1) &&
    typeof setup.weather === 'string' &&
    typeof setup.prompt === 'string'
  if (!shaped) {
    throw appError('SCENE_MALFORMED', 'A saved scene is damaged.', where)
  }
  return scene
}

/** Each girl's affection as her disposition sets it, by charId. */
export function affectionsOf(setup: Pick<SceneSetup, 'cast'>): Record<string, number> {
  return Object.fromEntries(
    setup.cast.map((entry) => [entry.charId, affectionOfDisposition(effectiveDisposition(entry))])
  )
}
