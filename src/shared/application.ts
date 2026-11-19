import type { ClassKind } from './academics'
import type { DormId } from './dorms'
import { genderOf, type ReaderPronouns } from './gender'
import { pairKeyOf } from './npcRelationships'
import type { PlayerStats } from './playerStats'
import { storedMemoryDesc } from './readerVoice'
import { affectionFor, dispositionOf, refreshedFlags, type Disposition } from './relationship'
import {
  defaultMilestones,
  flagsOfEntry,
  lockedMilestones,
  normalizeMilestones,
  SCENE_MILESTONES,
  type SceneMilestone,
  type SceneMilestones,
  type SceneRelation
} from './sceneCreator'
import { SECRET_TIERS } from './secrets'
import type {
  Character,
  CharMemory,
  ClassCategory,
  CharSecret,
  CharStart,
  FeedAssignment,
  FixedOccasionEdits,
  HiddenScheduleAssignment,
  JobAssignment,
  Occasion,
  RomanceSetting,
  ScheduleResult,
  Season,
  SecretTier,
  SemesterHandoff,
  TimeSlot
} from './types'

/**
 * The application: a New Game in progress, from its first screen to the enrollment that replaces
 * it. What the player entered on every screen, the occasion plan drawn for it, and each reply its
 * calls have banked, with the rules that say which of it is filled and which is left to generate.
 */

/** The flow's screens, in the order the player passes them. */
export const APPLICATION_SCREENS = [
  'setting',
  'occasions',
  'characters',
  'profiles',
  'classes',
  'loading',
  'finalize'
] as const
export type ApplicationScreen = (typeof APPLICATION_SCREENS)[number]

/** New Game's calls, in the order the wait names them. */
export const NEW_GAME_CALLS = ['occasions', 'profiles', 'secrets', 'classes'] as const
export type NewGameCall = (typeof NEW_GAME_CALLS)[number]

/** The screen whose Next sends each call, and whose Skip generation skips it. */
export const CALL_SCREEN: Record<NewGameCall, ApplicationScreen> = {
  occasions: 'occasions',
  profiles: 'profiles',
  secrets: 'profiles',
  classes: 'classes'
}

/**
 * The call a banked reply's part answers: a part's id opens with its call's name, and a reply
 * banked before calls were sent in parts carries the bare name.
 */
export function callOfPart(id: string): string {
  return id.split(':')[0]
}

/** The calls a screen's Next sends and its Skip generation skips. */
export function callsOfScreen(screen: ApplicationScreen): NewGameCall[] {
  return NEW_GAME_CALLS.filter((call) => CALL_SCREEN[call] === screen)
}

/** Where a screen stands in the flow. */
export function screenIndex(screen: ApplicationScreen): number {
  return APPLICATION_SCREENS.indexOf(screen)
}

/** Whether the player has gone past `screen`'s Next. */
export function screenPassed(at: ApplicationScreen, screen: ApplicationScreen): boolean {
  return screenIndex(at) > screenIndex(screen)
}

/** One occasion the semester invents, placed on the calendar before anything is written for it. */
export interface PlannedOccasion {
  /** The id the resulting occasion carries, and its property in the call's schema. */
  id: string
  startDate: number
  endDate: number
  /** The half it takes on each of its days, or null for the whole of each. */
  time: TimeSlot | null
  /** What kind of thing this is, given to the model verbatim; only the four named events carry one. */
  brief?: string
  /** A small thing rather than one of the four named events. */
  filler?: true
  /** This filler falls inside the semester's week off, and the prompt says so. */
  breakWeek?: true
  /** This occasion's inspiration word. */
  seed: string
}

/** What the player wrote for one planned occasion. */
export interface OccasionEntry {
  title: string
  description: string
}

/** One catalog entry as the player wrote it; `kind` is a course's alone, never PE's. */
export interface CatalogEntry {
  code: string
  title: string
  description: string
  kind?: ClassKind
}

/** The catalog's pools that are not tied to a major or a girl. */
export const CATALOG_POOLS = ['pe', 'humanities', 'arts', 'misc'] as const
export type CatalogPool = (typeof CATALOG_POOLS)[number]

/** How many classes each pool holds, and each major. */
export const POOL_SIZES: Record<CatalogPool, number> = { pe: 10, humanities: 5, arts: 5, misc: 5 }
export const CLASSES_PER_MAJOR = 4

/** Every catalog entry the player wrote, by pool. */
export interface CatalogEntries {
  pe: CatalogEntry[]
  humanities: CatalogEntry[]
  arts: CatalogEntry[]
  misc: CatalogEntry[]
  /** By the major's name. */
  major: Record<string, CatalogEntry[]>
  /** Each girl's interest class, by charId. */
  interest: Record<string, CatalogEntry>
}

/**
 * One girl's profile as the player decided it, an absent field left to generate. Places are
 * location ids. A pair — the job and its shifts, the activity and its place — counts only whole,
 * and null is the decided answer "none".
 */
export interface DecidedProfile {
  year?: number
  dorm?: DormId
  major?: string
  classesTaken?: number
  majorClassesTaken?: number
  job?: { jobId?: string; count?: number } | null
  homeSlots?: number
  study?: string | null
  fun?: string[]
  activity?: { location?: string; doing?: string } | null
  meal?: string | null
  handle?: string
  /**
   * What she posted over the break before the semester: never the player's to write, so decided
   * only as none — a freshman's, or a skipped profile's.
   */
  breakPosts?: string[]
  springBreakPlans?: string
}

/** Every field of a {@link DecidedProfile}, in the order the profile call asks for them. */
export const PROFILE_FIELDS = [
  'year',
  'major',
  'classesTaken',
  'majorClassesTaken',
  'job',
  'dorm',
  'homeSlots',
  'study',
  'fun',
  'activity',
  'meal',
  'handle',
  'breakPosts',
  'springBreakPlans'
] as const satisfies readonly (keyof DecidedProfile)[]
export type ProfileField = (typeof PROFILE_FIELDS)[number]

/**
 * What the reader and she have been through before the semester: the Scene Creator's set, her
 * number, and the days a lover's and an ex's standing are dated from.
 */
export type StartMilestones = SceneMilestones & {
  contact: boolean
  /** The day they became lovers; read while they are. */
  datingSince?: number
  /** The day they broke up; read while they have and are not lovers again. */
  brokeUpOn?: number
}

/** One of the boxes the Profiles screen offers about her and the reader. */
export type StartBox = SceneMilestone | 'contact'

/** The days a start-state date may fall on: up to a year before day 0, and the day it opens on. */
export const START_DATE_FIRST = -365
export const START_DATE_LAST = -1
export const START_DATE_DEFAULT = -1

/** Everything the player set for one roster girl. */
export interface ApplicationGirl {
  profile: DecidedProfile
  /** Her secrets the player wrote, by tier. */
  secrets: Partial<Record<SecretTier, string>>
  milestones?: StartMilestones
  /** What she remembers of the reader from before the semester, dated before day 0. */
  memories: CharMemory[]
  /** The player's own notes on her, as typed; absent when there are none. */
  notes?: string
}

/** One part's reply as it landed, kept against the request it answered. */
export interface BankedReply {
  /** The hash of the request's system, user and schema. */
  key: string
  reply: unknown
}

/** The reader as the name question took him down. */
export interface ApplicationReader {
  firstName: string
  lastName: string
  /** Absent on a reader named before pronouns were asked, read as he/him. */
  pronouns?: ReaderPronouns
  stats: PlayerStats
  bio?: string
}

/**
 * What a later semester's New Game sets up from: the ending's handoff, the id the semester will be
 * written under, minted when Continue was pressed, the semester it continues from (absent when
 * that is the first), the slot save the ending stood on (absent where it stood on none), and
 * every class the semesters before it have run.
 */
export type ApplicationContinuation = SemesterHandoff & {
  id: string
  parent?: string
  ending?: string
  taken: { code: string; name: string; category?: ClassCategory; major?: string }[]
}

/** Everything the four New Game calls produce, settled together: the semester Finalize reviews. */
export interface StartResult {
  schedules: ScheduleResult
  /** Who works where, by charId — the slots themselves are picked at the registrar's Enroll. */
  jobs: Record<string, JobAssignment>
  /** Where each character likes to be, by charId — placed at the registrar's Enroll too. */
  haunts: Record<string, HiddenScheduleAssignment>
  /** Her handle and what she posted over the break, by charId — dated at the registrar's Enroll. */
  feeds: Record<string, FeedAssignment>
  /** What each of them does with spring break, by charId. */
  springBreakPlans: Record<string, string>
  occasions: Occasion[]
  /** The semester's changes to its fixed occasions, as kept. */
  fixedEdits: FixedOccasionEdits
  /** The secrets each girl starts the semester with, by charId. */
  secrets: Record<string, CharSecret[]>
  /** The player's notes on each girl new to the roster, trimmed, by charId; absent where none. */
  notes?: Record<string, string>
  /** Where each girl the reader already knows stands with him, by charId; a stranger has none. */
  starts: Record<string, CharStart>
  /** How the roster girls the player set stand with each other, by `pairKeyOf`; the rest are rolled. */
  pairs: Record<string, SceneRelation>
  /** What each graduate is doing now, by charId; a later semester's alone. */
  pursuits?: Record<string, string>
  /** The senior picked to graduate early at a fall's ceremony; a later fall's alone. */
  fallGraduate?: string
}

/** The player's changes on Finalize to one invented occasion's words. */
export interface FinalOccasionEdit {
  title?: string
  description?: string
}

/** The player's changes on Finalize to one class, by the code it was composed under. */
export interface FinalClassEdit {
  code?: string
  name?: string
  description?: string
  /** A course's alone, never PE's. */
  kind?: ClassKind
}

/**
 * The player's changes on Finalize to one girl. A pair — the job and its shifts, the activity's
 * place and its phrase — is kept half by half, null being the answer "none".
 */
export interface FinalGirlEdit {
  dorm?: DormId
  homeSlots?: number
  job?: { jobId?: string; count?: number } | null
  study?: string | null
  meal?: string | null
  fun?: string[]
  activity?: { location?: string; doing?: string } | null
  handle?: string
  /** Her break posts' words, by the post's place among them. */
  posts?: Record<string, string>
  springBreakPlans?: string
  secrets?: Partial<Record<SecretTier, string>>
  /** A graduate's life since. */
  pursuit?: string
}

/**
 * The player's changes on Finalize to the semester as composed, each field kept only while it
 * differs from it and a record with nothing left in it dropped.
 */
export interface FinalEdits {
  /** By occasion id. */
  occasions?: Record<string, FinalOccasionEdit>
  /** By the code the class was composed under. */
  classes?: Record<string, FinalClassEdit>
  /** Each major's new name, by its name as composed. */
  majors?: Record<string, string>
  /** By charId. */
  girls?: Record<string, FinalGirlEdit>
}

/**
 * How many characters a semester's roster holds — exact, not a cap — between these two. The
 * registrar offers only the classes a roster girl attends, and twelve girls' loads are what leave
 * the player enough non-PE courses in distinct slots to finalize a legal schedule; twenty-four
 * stays under the thirty seats ten PE classes of three hold.
 */
export const ROSTER_MIN = 12
export const ROSTER_MAX = 24

/** A New Game in progress. */
export interface ApplicationDraft {
  /** The screen the player is on. */
  screen: ApplicationScreen
  season: Season
  /** The roster, in order, by charId. */
  chars: string[]
  /**
   * How many characters the roster holds once Characters' Next fills it, from {@link ROSTER_MIN}
   * to {@link ROSTER_MAX}; absent reads as the least.
   */
  size?: number
  /** The occasions the semester invents, placed and seeded once. */
  plan: PlannedOccasion[]
  /**
   * The player has added, deleted, moved or retyped a planned occasion, or imported a plan, since
   * the plan was last placed. Absent where the plan is as placed.
   */
  planChanged?: true
  /** The player's words for planned occasions, by plan id. */
  occasions: Record<string, OccasionEntry>
  /**
   * The player's changes to the fixed occasions, by fixed id: a field equal to the build is never
   * kept, a blank one stands for the build's. Absent where there are none.
   */
  fixedEdits?: FixedOccasionEdits
  catalog: CatalogEntries
  /** By charId; a girl with no entry has nothing set. */
  girls: Record<string, ApplicationGirl>
  /** How two roster girls stand with each other, by `pairKeyOf`; an absent pair is rolled. */
  pairs: Record<string, SceneRelation>
  reader?: ApplicationReader
  /** By part id, see {@link callOfPart}. */
  replies: Record<string, BankedReply>
  /** The calls the player skipped generation for, in call order: their blanks are filled from pools. */
  skipped?: NewGameCall[]
  /**
   * The majors a skipped profile call picked for the girls the player left without one, by
   * charId: generated content, never shown in her field, and thrown away by a Back onto Profiles.
   */
  dealtMajors?: Record<string, string>
  /**
   * The roster girls Characters' Next drew for the slots the player left empty, by charId: on
   * `chars` after the player's own picks, masked through setup until revealed, and dropped by a
   * Back onto Characters.
   */
  randomPicks?: string[]
  /** The girls the player has revealed from behind a mask, by charId: kept for the rest of setup. */
  revealed?: string[]
  /** The output tokens the application's calls have cost, every session included. */
  tokensGenerated?: number
  /**
   * A later semester's New Game: what the ending it continues handed on, and where the semester
   * will be written. Absent on a first semester's.
   */
  continued?: ApplicationContinuation
  /**
   * What the player wrote for each girl who graduated at that ending, by charId; a girl with no
   * entry is left to generate.
   */
  pursuits?: Record<string, string>
  /**
   * The semester as Loading composed it, which Finalize reviews: kept rather than composed again,
   * since composing deals the pools and rolls the seating. Absent before Finalize.
   */
  composed?: StartResult
  /** The player's changes to {@link composed} on Finalize; absent where there are none. */
  finalEdits?: FinalEdits
  /**
   * How each gender takes to the reader, as Loading asked a first semester's; absent before it
   * is asked and on a later semester's.
   */
  romance?: RomanceSetting
}

/**
 * On-disk application — `/data/saves/{playthroughId}/application.json`: a New Game in progress,
 * replaced by the enrollment its last reply composes.
 */
export interface Application extends ApplicationDraft {
  schemaVersion: 1
  savedAt: number
}

/** What `saves:apply` answers with: the folder the application is kept in, and the file as written. */
export interface KeptApplication {
  playthroughId: string
  application: Application
}

/** Everything the player enters on the flow's screens: what a Back puts back as it was. */
export type ApplicationEntries = Pick<
  ApplicationDraft,
  | 'plan'
  | 'planChanged'
  | 'occasions'
  | 'fixedEdits'
  | 'chars'
  | 'size'
  | 'catalog'
  | 'girls'
  | 'pairs'
  | 'pursuits'
>

/** What the player has entered in an application, and nothing generated or banked. */
export function entriesOf(draft: ApplicationDraft): ApplicationEntries {
  const { plan, planChanged, occasions, fixedEdits, chars, size, catalog, girls, pairs, pursuits } =
    draft
  return { plan, planChanged, occasions, fixedEdits, chars, size, catalog, girls, pairs, pursuits }
}

/**
 * How many characters the roster holds: the size picked, the least where none is, and never
 * fewer than are on it already.
 */
export function rosterSizeOf(draft: Pick<ApplicationDraft, 'size' | 'chars'>): number {
  const size = Math.min(ROSTER_MAX, draft.size ?? ROSTER_MIN)
  return Math.max(ROSTER_MIN, draft.chars.length, size)
}

/** Whether she continues from the last semester rather than joining the roster in this one. */
export function isReturning(draft: Pick<ApplicationDraft, 'continued'>, charId: string): boolean {
  return draft.continued?.continuing.includes(charId) ?? false
}

/** A catalog with nothing written in it. */
export function emptyCatalog(): CatalogEntries {
  return { pe: [], humanities: [], arts: [], misc: [], major: {}, interest: {} }
}

/** A girl with nothing set. */
export function emptyGirl(): ApplicationGirl {
  return { profile: {}, secrets: {}, memories: [] }
}

/** Whether text holds anything but space. */
function written(text: string | undefined): boolean {
  return (text ?? '').trim() !== ''
}

/** Whether an occasion entry is whole: a title and a description. */
export function occasionFilled(entry: OccasionEntry | undefined): entry is OccasionEntry {
  return entry !== undefined && written(entry.title) && written(entry.description)
}

/** Whether a catalog entry is whole: a code, a title, a description, and a course's kind. */
export function courseFilled(entry: CatalogEntry | undefined, pe: boolean): entry is CatalogEntry {
  return (
    entry !== undefined &&
    written(entry.code) &&
    written(entry.title) &&
    written(entry.description) &&
    (pe || entry.kind !== undefined)
  )
}

/** Whether anything at all was put in an entry. */
export function entryTouched(entry: OccasionEntry | CatalogEntry | undefined): boolean {
  if (!entry) return false
  return Object.values(entry).some((value) => typeof value === 'string' && value.trim() !== '')
}

/** Whether an entry holds nothing at all, not even space: every field `''` and no kind. */
function entryEmpty(entry: OccasionEntry | CatalogEntry): boolean {
  return Object.values(entry).every((value) => value === '' || value === undefined)
}

/** A record with its keys in one order whatever order they were set in, so equal ones match. */
function sortedRecord<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : 1)))
}

/** The player's occasion words with one entry's set as typed; an empty one is dropped. */
export function withOccasionWords(
  occasions: Record<string, OccasionEntry>,
  id: string,
  words: OccasionEntry
): Record<string, OccasionEntry> {
  const before = occasions[id]
  if (entryEmpty(words)) {
    if (!before) return occasions
    const { [id]: _dropped, ...rest } = occasions
    return rest
  }
  if (before && before.title === words.title && before.description === words.description) {
    return occasions
  }
  const entry = { title: words.title, description: words.description }
  return sortedRecord({ ...occasions, [id]: entry })
}

/** Where one catalog entry sits: a pool's or a major's by its place, or a girl's interest class. */
export type CatalogSpot =
  | { pool: CatalogPool; index: number }
  | { major: string; index: number }
  | { interest: string }

/** The entry at a spot, or undefined where nothing is written there. */
export function catalogEntryAt(catalog: CatalogEntries, at: CatalogSpot): CatalogEntry | undefined {
  if ('pool' in at) return catalog[at.pool][at.index]
  if ('major' in at) return catalog.major[at.major]?.[at.index]
  return catalog.interest[at.interest]
}

/** An entry with only its own fields, a kind only where one is picked. */
function cleanEntry(entry: CatalogEntry): CatalogEntry {
  const { code, title, description, kind } = entry
  return { code, title, description, ...(kind !== undefined ? { kind } : {}) }
}

/** Whether two entries say the same thing, an absent one reading as empty. */
function sameEntry(a: CatalogEntry | undefined, b: CatalogEntry): boolean {
  if (!a) return entryEmpty(b)
  return (
    a.code === b.code &&
    a.title === b.title &&
    a.description === b.description &&
    a.kind === b.kind
  )
}

/** A list with one place set, padded with blank entries up to it and none empty at its end. */
function withListEntry(
  list: readonly CatalogEntry[],
  index: number,
  entry: CatalogEntry
): CatalogEntry[] {
  const next = [...list]
  while (next.length < index) next.push({ code: '', title: '', description: '' })
  next[index] = entry
  while (next.length > 0 && entryEmpty(next[next.length - 1])) next.pop()
  return next
}

/**
 * The catalog with the entry at one spot set: a list padded with blank entries up to it and
 * trimmed of empty ones at its end, a major left with none and an empty interest class dropped.
 * The same catalog where nothing changes, and every entry not set keeps its identity.
 */
export function withCatalogEntry(
  catalog: CatalogEntries,
  at: CatalogSpot,
  entry: CatalogEntry
): CatalogEntries {
  const clean = cleanEntry(entry)
  if (sameEntry(catalogEntryAt(catalog, at), clean)) return catalog
  if ('pool' in at) {
    return { ...catalog, [at.pool]: withListEntry(catalog[at.pool], at.index, clean) }
  }
  if ('major' in at) {
    const entries = withListEntry(catalog.major[at.major] ?? [], at.index, clean)
    const { [at.major]: _dropped, ...rest } = catalog.major
    const major = entries.length > 0 ? { ...rest, [at.major]: entries } : rest
    return { ...catalog, major: sortedRecord(major) }
  }
  const { [at.interest]: _dropped, ...rest } = catalog.interest
  return {
    ...catalog,
    interest: sortedRecord(entryEmpty(clean) ? rest : { ...rest, [at.interest]: clean })
  }
}

/**
 * The codes, trimmed, that more than one whole entry the class call reads carries: each pool's
 * up to its size, each of `majors`' up to its share, and the roster's interest classes.
 */
export function repeatedCodesOf(
  catalog: CatalogEntries,
  chars: readonly string[],
  majors: ReadonlySet<string>
): Set<string> {
  const read = [
    ...CATALOG_POOLS.flatMap((pool) =>
      catalog[pool].filter((entry) => courseFilled(entry, pool === 'pe')).slice(0, POOL_SIZES[pool])
    ),
    ...Object.entries(catalog.major).flatMap(([major, entries]) =>
      majors.has(major)
        ? entries.filter((entry) => courseFilled(entry, false)).slice(0, CLASSES_PER_MAJOR)
        : []
    ),
    ...chars.flatMap((charId) => {
      const entry = catalog.interest[charId]
      return courseFilled(entry, false) ? [entry] : []
    })
  ]
  const seen = new Set<string>()
  const repeated = new Set<string>()
  for (const entry of read) {
    const code = entry.code.trim()
    if (seen.has(code)) repeated.add(code)
    seen.add(code)
  }
  return repeated
}

/** Which halves of a profile pair are set, or null where the pair is blank or "none". */
function halvesOf(profile: DecidedProfile, field: 'job' | 'activity'): [boolean, boolean] | null {
  if (field === 'job') {
    const job = profile.job
    return job ? [written(job.jobId), job.count !== undefined] : null
  }
  const activity = profile.activity
  return activity ? [written(activity.location), written(activity.doing)] : null
}

/** Whether a pair is decided: "none", or both halves. */
function pairDecided(profile: DecidedProfile, field: 'job' | 'activity'): boolean {
  if (profile[field] === null) return true
  const halves = halvesOf(profile, field)
  return halves !== null && halves[0] && halves[1]
}

/** Whether one profile field is decided; a freshman's break posts are, being none. */
export function profileFieldDecided(profile: DecidedProfile, field: ProfileField): boolean {
  switch (field) {
    case 'job':
    case 'activity':
      return pairDecided(profile, field)
    case 'major':
    case 'handle':
    case 'springBreakPlans':
      return written(profile[field])
    case 'breakPosts':
      return profile.year === 1 || profile.breakPosts !== undefined
    default:
      return profile[field] !== undefined
  }
}

/**
 * The profile fields an application asks of a girl: every one on a first semester; on a later one
 * no break posts, and in a fall no spring break plans.
 */
export function profileFieldsOf(
  draft: Pick<ApplicationDraft, 'continued' | 'season'>
): readonly ProfileField[] {
  if (!draft.continued) return PROFILE_FIELDS
  return PROFILE_FIELDS.filter(
    (field) =>
      field !== 'breakPosts' && (field !== 'springBreakPlans' || draft.season === 'spring')
  )
}

/** The profile fields among `fields` left to generate for her. */
export function profileBlanks(
  profile: DecidedProfile,
  fields: readonly ProfileField[] = PROFILE_FIELDS
): ProfileField[] {
  return fields.filter((field) => !profileFieldDecided(profile, field))
}

/**
 * Her profile with only the fields among `fields` she has decided, a freshman's break posts as
 * none.
 */
export function decidedFieldsOf(
  profile: DecidedProfile,
  fields: readonly ProfileField[] = PROFILE_FIELDS
): DecidedProfile {
  const out: Record<string, unknown> = {}
  for (const field of fields) {
    if (!profileFieldDecided(profile, field)) continue
    out[field] = field === 'breakPosts' ? (profile.breakPosts ?? []) : profile[field]
  }
  return out as DecidedProfile
}

/** The lowest year her decided dorm allows: Elysium Village is a junior's or a senior's. */
export function yearFloorOf(profile: Pick<DecidedProfile, 'dorm'>): number {
  return profile.dorm === 'elysium' ? 3 : 1
}

/**
 * Her profile with one field set as the screen gives it, `undefined` leaving it to generate. The
 * fields stay in one order, so equal profiles read alike; the same profile where nothing changes.
 */
export function withProfileField<F extends ProfileField>(
  profile: DecidedProfile,
  field: F,
  value: DecidedProfile[F] | undefined
): DecidedProfile {
  const merged: DecidedProfile = { ...profile, [field]: value }
  const out: Record<string, unknown> = {}
  for (const key of PROFILE_FIELDS) if (merged[key] !== undefined) out[key] = merged[key]
  return JSON.stringify(out) === JSON.stringify(profile) ? profile : (out as DecidedProfile)
}

/**
 * The player's words for the graduates with one girl's set as typed: an empty one dropped, the
 * keys in one order, the same record where nothing changes, and none once every one is dropped.
 */
export function withPursuit(
  pursuits: Record<string, string> | undefined,
  charId: string,
  text: string
): Record<string, string> | undefined {
  if ((pursuits?.[charId] ?? '') === text) return pursuits
  const { [charId]: _dropped, ...rest } = pursuits ?? {}
  const next = text === '' ? rest : { ...rest, [charId]: text }
  return Object.keys(next).length > 0 ? sortedRecord(next) : undefined
}

/** Her secrets with one tier set as typed, an empty one dropped, in tier order. */
export function withSecret(
  secrets: ApplicationGirl['secrets'],
  tier: SecretTier,
  text: string
): ApplicationGirl['secrets'] {
  if ((secrets[tier] ?? '') === text) return secrets
  const merged = { ...secrets, [tier]: text }
  const out: ApplicationGirl['secrets'] = {}
  for (const key of SECRET_TIERS) if (merged[key]) out[key] = merged[key]
  return out
}

/** Her with her notes as typed, empty ones dropped; the same girl where nothing changes. */
export function withNotes(girl: ApplicationGirl, text: string): ApplicationGirl {
  if ((girl.notes ?? '') === text) return girl
  const { notes: _dropped, ...rest } = girl
  return text === '' ? rest : { ...rest, notes: text }
}

/** Whether nothing at all is set for her. */
function girlEmpty(girl: ApplicationGirl): boolean {
  return (
    Object.keys(girl.profile).length === 0 &&
    Object.keys(girl.secrets).length === 0 &&
    girl.milestones === undefined &&
    girl.memories.length === 0 &&
    girl.notes === undefined
  )
}

/**
 * The girls with one changed: her entry is made where she has none, dropped once nothing is set,
 * and the keys kept in one order. The same record where nothing changes.
 */
export function withGirlChanged(
  girls: Record<string, ApplicationGirl>,
  charId: string,
  change: (girl: ApplicationGirl) => ApplicationGirl
): Record<string, ApplicationGirl> {
  const before = girls[charId] ?? emptyGirl()
  const after = change(before)
  if (after === before) return girls
  const { [charId]: _dropped, ...rest } = girls
  return sortedRecord(girlEmpty(after) ? rest : { ...rest, [charId]: after })
}

/** How two roster girls stand, or `null` to roll it; one entry per pair, keys in one order. */
export function withPair(
  pairs: Record<string, SceneRelation>,
  a: string,
  b: string,
  relation: SceneRelation | null
): Record<string, SceneRelation> {
  const key = pairKeyOf(a, b)
  if ((pairs[key] ?? null) === relation) return pairs
  const { [key]: _dropped, ...rest } = pairs
  return sortedRecord(relation === null ? rest : { ...rest, [key]: relation })
}

/** Every box off, `met` included: a girl the reader has never met. */
export function emptyStartMilestones(): StartMilestones {
  return { ...defaultMilestones(), met: false, contact: false }
}

/** Her milestones as kept: every box in one order with its date after, absent once nothing is set. */
export function keptStartMilestones(milestones: StartMilestones): StartMilestones | undefined {
  const out = {} as StartMilestones
  for (const key of SCENE_MILESTONES) out[key] = milestones[key]
  out.contact = milestones.contact
  if (milestones.datingSince !== undefined) out.datingSince = milestones.datingSince
  if (milestones.brokeUpOn !== undefined) out.brokeUpOn = milestones.brokeUpOn
  const anything =
    SCENE_MILESTONES.some((key) => out[key]) ||
    out.contact ||
    out.datingSince !== undefined ||
    out.brokeUpOn !== undefined
  return anything ? out : undefined
}

/** Every memory she starts the semester with, as the player wrote it: those with words, oldest first. */
export function writtenStartMemories(girl: Pick<ApplicationGirl, 'memories'>): CharMemory[] {
  return girl.memories.filter((memory) => written(memory.desc)).sort((a, b) => a.date - b.date)
}

/**
 * What she remembers of the reader as the semester opens: every memory with words, each filed in
 * the reader's voice as her own gender and the reader's pronouns hold it, oldest first.
 */
export function startMemoriesOf(
  girl: Pick<ApplicationGirl, 'memories'>,
  character: Pick<Character, 'gender'> | undefined,
  reader: ReaderPronouns
): CharMemory[] {
  const holder = genderOf(character)
  return writtenStartMemories(girl).map((memory) => ({
    date: memory.date,
    type: memory.type,
    desc: storedMemoryDesc(memory.desc, holder, reader)
  }))
}

/** Her affection on day 0, off exactly the memories the first save is written with. */
function startAffectionOf(
  girl: Pick<ApplicationGirl, 'memories'>,
  character: Pick<Character, 'traits' | 'gender'> | undefined
): number {
  return affectionFor({ memories: writtenStartMemories(girl) }, 0, character)
}

/**
 * Her milestones as the semester opens them: met wherever she has a memory; no crush while her
 * affection is below nothing, which her first scene would clear; then the Scene Creator's rule
 * read at her predicted disposition; her number and the dates only once met, each date where it
 * applies.
 */
export function startMilestonesOf(
  girl: Pick<ApplicationGirl, 'memories' | 'milestones'>,
  character: Pick<Character, 'traits' | 'gender'> | undefined
): StartMilestones {
  const set = girl.milestones ?? emptyStartMilestones()
  const affection = startAffectionOf(girl, character)
  const met = set.met || writtenStartMemories(girl).length > 0
  const scene = normalizeMilestones(
    { ...set, met, crush: set.crush && affection >= 0 },
    dispositionOf(affection),
    character
  )
  const out = {} as StartMilestones
  for (const key of SCENE_MILESTONES) out[key] = scene[key]
  out.contact = scene.met && set.contact
  if (out.lovers) out.datingSince = set.datingSince ?? START_DATE_DEFAULT
  else if (out.broke_up) out.brokeUpOn = set.brokeUpOn ?? START_DATE_DEFAULT
  return out
}

/** Her disposition as the semester opens, or null for a girl the reader has not met. */
export function startDispositionOf(
  girl: Pick<ApplicationGirl, 'memories' | 'milestones'>,
  character: Pick<Character, 'traits' | 'gender'> | undefined
): Disposition | null {
  if (!startMilestonesOf(girl, character).met) return null
  return dispositionOf(startAffectionOf(girl, character))
}

/** The boxes the screen holds where the others put them, each with the value it is held at. */
export function startLocksOf(
  girl: Pick<ApplicationGirl, 'memories' | 'milestones'>,
  character: Pick<Character, 'traits' | 'gender'> | undefined
): Partial<Record<StartBox, boolean>> {
  const shown = startMilestonesOf(girl, character)
  const affection = startAffectionOf(girl, character)
  const locked: Partial<Record<StartBox, boolean>> = lockedMilestones(
    shown,
    dispositionOf(affection),
    character
  )
  if (writtenStartMemories(girl).length > 0) locked.met = true
  if (affection < 0 && !('crush' in locked)) locked.crush = false
  if (!shown.met) locked.contact = false
  return locked
}

/**
 * Her milestones with one box ticked or cleared, the two friendzones being one answer or the
 * other, as they are to be kept.
 */
export function startMilestonesWith(
  girl: Pick<ApplicationGirl, 'memories' | 'milestones'>,
  character: Pick<Character, 'traits' | 'gender'> | undefined,
  box: StartBox,
  value: boolean
): StartMilestones {
  const next: StartMilestones = { ...startMilestonesOf(girl, character), [box]: value }
  if (value && box === 'friendzoned_by_reader') next.friendzoned_reader = false
  if (value && box === 'friendzoned_reader') next.friendzoned_by_reader = false
  return startMilestonesOf({ memories: girl.memories, milestones: next }, character)
}

/**
 * Where she stands with the reader as the first save opens, or null for a girl he has not met:
 * her memories, her flags as the milestones would have left them with the reveals her tier
 * opens, her name known, and the day a lover's or an ex's standing runs from. Her romance is
 * settled, its count left absent. Her memories are filed in the reader's own pronouns.
 */
export function charStartOf(
  girl: ApplicationGirl | undefined,
  character: Pick<Character, 'traits' | 'gender'> | undefined,
  reader: ReaderPronouns
): CharStart | null {
  if (!girl) return null
  const milestones = startMilestonesOf(girl, character)
  if (!milestones.met) return null
  const affection = startAffectionOf(girl, character)
  const flags = flagsOfEntry({ disposition: dispositionOf(affection), milestones }, character)
  return {
    memories: startMemoriesOf(girl, character, reader),
    flags: refreshedFlags({ ...flags, gaveContactInfo: milestones.contact }, affection),
    nameKnown: true,
    ...(milestones.datingSince !== undefined ? { datingSince: milestones.datingSince } : {}),
    ...(milestones.brokeUpOn !== undefined ? { brokeUpOn: milestones.brokeUpOn } : {})
  }
}

/** The random picks setup masks: every one the player has not revealed. */
export function maskedOf(draft: Pick<ApplicationDraft, 'randomPicks' | 'revealed'>): Set<string> {
  const revealed = new Set(draft.revealed ?? [])
  return new Set((draft.randomPicks ?? []).filter((charId) => !revealed.has(charId)))
}

/** The application with its random picks taken off the roster; what was revealed stays revealed. */
export function withoutRandomPicks<T extends Pick<ApplicationDraft, 'chars' | 'randomPicks'>>(
  draft: T
): T {
  if (draft.randomPicks === undefined) return draft
  const drawn = new Set(draft.randomPicks)
  const { randomPicks: _dropped, ...rest } = draft
  return { ...rest, chars: draft.chars.filter((charId) => !drawn.has(charId)) } as T
}

/** Whether the player skipped generation for a call. */
export function isSkipped(draft: Pick<ApplicationDraft, 'skipped'>, call: NewGameCall): boolean {
  return draft.skipped?.includes(call) ?? false
}

/** The tiers of her secrets left to generate. */
export function secretTiersBlank(secrets: ApplicationGirl['secrets']): SecretTier[] {
  return SECRET_TIERS.filter((tier) => !written(secrets[tier]))
}

/** Something the player started and did not finish, which Next generates whole instead. */
export type IncompleteEntry =
  | { kind: 'occasion'; id: string }
  | { kind: 'course'; pool: CatalogPool; index: number }
  | { kind: 'major'; major: string; index: number }
  | { kind: 'interest'; charId: string }
  | { kind: 'profile'; charId: string; field: 'job' | 'activity' }

/**
 * Everything on `screen` the player put something in without finishing it: an entry missing a
 * field, or a pair with one half. Generation overwrites each, so its Next asks first. Given
 * `majors`, only those majors' entries are named.
 */
export function incompleteOf(
  draft: ApplicationDraft,
  screen: ApplicationScreen,
  majors?: ReadonlySet<string>
): IncompleteEntry[] {
  const found: IncompleteEntry[] = []
  if (screen === 'occasions') {
    for (const planned of draft.plan) {
      const entry = draft.occasions[planned.id]
      if (entryTouched(entry) && !occasionFilled(entry)) found.push({ kind: 'occasion', id: planned.id })
    }
  }
  if (screen === 'classes') {
    for (const pool of CATALOG_POOLS) {
      draft.catalog[pool].forEach((entry, index) => {
        if (entryTouched(entry) && !courseFilled(entry, pool === 'pe')) {
          found.push({ kind: 'course', pool, index })
        }
      })
    }
    for (const [major, entries] of Object.entries(draft.catalog.major)) {
      if (majors && !majors.has(major)) continue
      entries.forEach((entry, index) => {
        if (entryTouched(entry) && !courseFilled(entry, false)) found.push({ kind: 'major', major, index })
      })
    }
    for (const charId of draft.chars) {
      const entry = draft.catalog.interest[charId]
      if (entryTouched(entry) && !courseFilled(entry, false)) found.push({ kind: 'interest', charId })
    }
  }
  if (screen === 'profiles') {
    for (const charId of draft.chars) {
      const profile = draft.girls[charId]?.profile ?? {}
      for (const field of ['job', 'activity'] as const) {
        const halves = halvesOf(profile, field)
        if (halves && halves[0] !== halves[1]) found.push({ kind: 'profile', charId, field })
      }
    }
  }
  return found
}
