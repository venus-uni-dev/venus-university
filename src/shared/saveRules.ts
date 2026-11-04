import {
  APPLICATION_SCREENS,
  CATALOG_POOLS,
  maskedOf,
  NEW_GAME_CALLS,
  type Application,
  type ApplicationDraft
} from './application'
import { appError } from './errors'
import { assertSafeId, validateRecord, type ValidateRecordOptions } from './jsonValidate'
import {
  AUTOSAVE_ID,
  FIRST_SLOT,
  MANUAL_SAVE_SLOTS,
  MAX_SLOT_SAVES,
  READER_SPEAKER,
  type CharState,
  type Enrollment,
  type EnrollmentDraft,
  type GameSave,
  type PlaythroughDraft,
  type PlaythroughRecord,
  type PlaythroughSummary,
  type SaveDraft,
  type SaveSummary,
  type SceneLine,
  type SceneState,
  type SemesterRecord
} from './types'

/**
 * What a save, a playthrough record, an enrollment and an application must be, whichever store
 * holds them:
 * the versions this build reads, the fields each one carries, the ids that are safe to make a
 * key out of, the three kinds of save id, and the slot-save window.
 */

/** Schema version this build reads and writes for a save. */
export const SAVE_SCHEMA_VERSION = 13

/** The playthrough record's own version, apart from the saves'. */
export const RECORD_SCHEMA_VERSION = 3

/** The enrollment's own version, apart from both. */
export const ENROLLMENT_SCHEMA_VERSION = 3

/** The application's own version, apart from the rest. */
export const APPLICATION_SCHEMA_VERSION = 1

/**
 * A record of `from` brought up to `to` with nothing else changed, for a version whose only
 * difference is fields the older one never wrote; anything else comes back untouched.
 */
function versionStep(from: number, to: number): (record: object) => object {
  return (record) =>
    (record as { schemaVersion?: unknown }).schemaVersion === from
      ? { ...record, schemaVersion: to }
      : record
}

/**
 * What a save must carry; `playthroughId`/`saveId` are stamped from where it was found, and
 * the fields a save written before them lacks, or only some saves carry, are optional on the
 * type and omitted here.
 */
const SAVE_REQUIRED: Record<
  keyof Omit<
    GameSave,
    | 'playthroughId'
    | 'saveId'
    | 'npcFriendships'
    | 'slotRumor'
    | 'bunnybotSeenTipSent'
    | 'occasionsDeclined'
    | 'bio'
    | 'tallies'
    | 'thumbnail'
    | 'replays'
    | 'semester'
    | 'formerJobs'
    | 'transcript'
    | 'homecomingVisitor'
    | 'breakupsOwed'
    | 'sceneEventsFired'
    | 'readerCold'
    | 'readerColdsHad'
  >,
  true
> = {
  schemaVersion: true,
  saveDate: true,
  stats: true,
  money: true,
  date: true,
  time: true,
  charInfo: true,
  playerSchedule: true,
  history: true,
  bunnyboard: true,
  events: true,
  job: true,
  jobsClosed: true,
  inventory: true,
  classRecords: true,
  gradesStanding: true,
  expelled: true,
  midtermStandingDone: true,
  finalsScoresShown: true,
  venusThrough: true,
  bunnybotThrough: true,
  bunnymapUnlocked: true,
  bunnyshopUnlocked: true,
  venusJobIntroSent: true,
  bunnybotContactIntroSent: true,
  bunnybotFirstPostNudgeSent: true,
  bunnybotTwoTimingTipSent: true,
  bunnybotDeferred: true,
  droppedClasses: true,
  addedClasses: true,
  npcRelationships: true,
  npcOverlay: true,
  lastSlotCast: true,
  weekendOutings: true,
  outingSlots: true,
  springBreakAway: true,
  feedExtras: true,
  graduationSeen: true,
  farewellsDone: true,
  endingArtWanted: true,
  scene: true
}

/**
 * What a playthrough record must carry; where it is kept names the playthrough, and the name
 * the player gives it is optional on the type and omitted here.
 */
const RECORD_REQUIRED: Record<
  keyof Omit<PlaythroughRecord, 'name' | 'semesters' | 'fixedEdits' | 'masked'>,
  true
> = {
  schemaVersion: true,
  chars: true,
  playerFirstName: true,
  playerLastName: true,
  classes: true,
  occasions: true,
  jobClosures: true,
  weather: true,
  profiles: true
}

/**
 * What an enrollment must carry; where it is kept names the playthrough it will become, and
 * the fields an enrollment written before them lacks are optional on the type and omitted here.
 */
const ENROLLMENT_REQUIRED: Record<
  keyof Omit<
    Enrollment,
    | 'bio'
    | 'tokensGenerated'
    | 'continued'
    | 'secrets'
    | 'starts'
    | 'pairs'
    | 'fixedEdits'
    | 'masked'
  >,
  true
> = {
  schemaVersion: true,
  savedAt: true,
  chars: true,
  classes: true,
  perChar: true,
  jobs: true,
  haunts: true,
  feeds: true,
  springBreakPlans: true,
  occasions: true,
  playerFirstName: true,
  playerLastName: true,
  stats: true
}

/** How a save is checked once it has been read. */
export const SAVE_READ: ValidateRecordOptions<GameSave> = {
  label: 'That save',
  malformed: { code: 'SAVE_MALFORMED', message: 'That save file is not valid JSON.' },
  schemaVersion: { code: 'SAVE_SCHEMA_VERSION' },
  expects: SAVE_SCHEMA_VERSION,
  required: SAVE_REQUIRED,
  // A version-12 save is one from before semesters: it lacks only fields a save may lack.
  upgrade: versionStep(12, SAVE_SCHEMA_VERSION)
}

/** Raised when a save is there but cannot be read. */
export const SAVE_UNREADABLE = { code: 'SAVE_UNREADABLE', message: 'Could not read the save file.' }

/** Raised when there is no such save. */
export const SAVE_NOT_FOUND = { code: 'SAVE_NOT_FOUND', message: 'That save no longer exists.' }

/** What every semester past the first must carry: the record's own fields for it and its log. */
const SEMESTER_REQUIRED: Record<
  keyof Omit<SemesterRecord, 'parent' | 'fallGraduate' | 'breakDecay' | 'fixedEdits' | 'masked'>,
  true
> = {
  index: true,
  chars: true,
  alumni: true,
  classes: true,
  occasions: true,
  jobClosures: true,
  weather: true,
  profiles: true,
  before: true
}

/**
 * Refuses a record whose semesters do not hold together: an id that is not a bare number, a
 * missing field, or a semester that is not one past the semester it continued from.
 */
export function assertSemesters(record: PlaythroughRecord, where: string): void {
  const semesters = record.semesters
  if (semesters === undefined) return
  const malformed = (detail: string): never => {
    throw appError(
      'PLAYTHROUGH_MALFORMED',
      'That playthrough record has a semester it cannot read.',
      `${where}: ${detail}`
    )
  }
  if (typeof semesters !== 'object' || semesters === null) malformed('semesters')
  for (const [id, semester] of Object.entries(semesters)) {
    if (!SAFE_NUMERIC_ID.test(id)) malformed(`semester id ${id}`)
    if (typeof semester !== 'object' || semester === null) malformed(`semester ${id}`)
    for (const key of Object.keys(SEMESTER_REQUIRED)) {
      if (!(key in semester)) malformed(`semester ${id} is missing "${key}"`)
    }
    const parentIndex =
      semester.parent === undefined ? 0 : (semesters[semester.parent]?.index ?? Number.NaN)
    if (semester.index !== parentIndex + 1) malformed(`semester ${id} index ${semester.index}`)
  }
}

/** How a playthrough record is checked once it has been read. */
export const RECORD_READ: ValidateRecordOptions<PlaythroughRecord> = {
  label: 'That playthrough',
  malformed: {
    code: 'PLAYTHROUGH_MALFORMED',
    message: 'That playthrough record is not valid JSON.'
  },
  schemaVersion: { code: 'PLAYTHROUGH_SCHEMA_VERSION' },
  expects: RECORD_SCHEMA_VERSION,
  required: RECORD_REQUIRED,
  check: assertSemesters
}

/** Raised when a playthrough record is there but cannot be read. */
export const RECORD_UNREADABLE = {
  code: 'PLAYTHROUGH_UNREADABLE',
  message: 'Could not read the playthrough record.'
}

/** Raised when a playthrough has no record. */
export const RECORD_NOT_FOUND = {
  code: 'PLAYTHROUGH_NOT_FOUND',
  message: 'That playthrough has no record file.'
}

/** How an enrollment is checked once it has been read. */
export const ENROLLMENT_READ: ValidateRecordOptions<Enrollment> = {
  label: 'That class registration',
  malformed: {
    code: 'ENROLLMENT_MALFORMED',
    message: 'That class registration is not valid JSON.'
  },
  schemaVersion: { code: 'ENROLLMENT_SCHEMA_VERSION' },
  expects: ENROLLMENT_SCHEMA_VERSION,
  required: ENROLLMENT_REQUIRED,
  // A version-2 enrollment is a first semester's, which never carries `continued`.
  upgrade: versionStep(2, ENROLLMENT_SCHEMA_VERSION)
}

/** Raised when an enrollment is there but cannot be read. */
export const ENROLLMENT_UNREADABLE = {
  code: 'ENROLLMENT_UNREADABLE',
  message: 'Could not read the class registration.'
}

/** Raised when there is no enrollment waiting. */
export const ENROLLMENT_NOT_FOUND = {
  code: 'ENROLLMENT_NOT_FOUND',
  message: 'That class registration no longer exists.'
}

/**
 * What an application must carry; where it is kept names the playthrough it will become, and the
 * fields only some applications carry are optional on the type and omitted here.
 */
const APPLICATION_REQUIRED: Record<
  keyof Omit<
    Application,
    | 'reader'
    | 'skipped'
    | 'dealtMajors'
    | 'randomPicks'
    | 'revealed'
    | 'tokensGenerated'
    | 'continued'
    | 'pursuits'
    | 'planChanged'
    | 'fixedEdits'
    | 'composed'
    | 'finalEdits'
  >,
  true
> = {
  schemaVersion: true,
  savedAt: true,
  screen: true,
  season: true,
  chars: true,
  plan: true,
  occasions: true,
  catalog: true,
  girls: true,
  pairs: true,
  replies: true
}

/** Whether `value` is a plain object a record can be read out of. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Whether `value` is a list of strings. */
function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

/**
 * What is wrong with a later semester's continuation, by the field a resume could not stand on,
 * or null where nothing is.
 */
function continuationFault(continued: unknown): string | null {
  if (!isPlainObject(continued)) return 'continued'
  if (typeof continued.id !== 'string' || !SAFE_NUMERIC_ID.test(continued.id)) return 'continued.id'
  const { index } = continued
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 1) return 'continued.index'
  if (continued.parent !== undefined && typeof continued.parent !== 'string') {
    return 'continued.parent'
  }
  if (continued.ending !== undefined && typeof continued.ending !== 'string') {
    return 'continued.ending'
  }
  for (const key of ['continuing', 'graduated', 'alumni']) {
    if (!isStringList(continued[key])) return `continued.${key}`
  }
  for (const key of ['priorProfiles', 'jobs', 'haunts', 'majorLoads', 'carry']) {
    if (!isPlainObject(continued[key])) return `continued.${key}`
  }
  if (!Array.isArray(continued.taken)) return 'continued.taken'
  return null
}

/**
 * What is wrong with a composed semester, by the field Finalize could not stand on, or null where
 * nothing is.
 */
function composedFault(composed: unknown): string | null {
  if (!isPlainObject(composed)) return 'composed'
  const { schedules } = composed
  if (!isPlainObject(schedules)) return 'composed.schedules'
  for (const key of ['classes', 'perChar']) {
    if (!isPlainObject(schedules[key])) return `composed.schedules.${key}`
  }
  if (!Array.isArray(composed.occasions)) return 'composed.occasions'
  for (const key of [
    'jobs',
    'haunts',
    'feeds',
    'springBreakPlans',
    'fixedEdits',
    'secrets',
    'starts',
    'pairs'
  ]) {
    if (!isPlainObject(composed[key])) return `composed.${key}`
  }
  if (composed.pursuits !== undefined && !isPlainObject(composed.pursuits)) return 'composed.pursuits'
  if (composed.fallGraduate !== undefined && typeof composed.fallGraduate !== 'string') {
    return 'composed.fallGraduate'
  }
  return null
}

/**
 * Refuses an application whose shape a resume could not stand on: a screen or a season this build
 * has no name for, a roster that is not ids, a section that is not what a write leaves, a later
 * semester's continuation missing what its registrar reads, or a Finalize screen without the
 * semester it reviews.
 */
function assertApplication(code: string): (application: Application, where: string) => void {
  return (application, where) => {
    const refuse = (detail: string): never => {
      throw appError(code, 'That new game in progress cannot be read.', `${where}: ${detail}`)
    }
    if (!(APPLICATION_SCREENS as readonly unknown[]).includes(application.screen)) refuse('screen')
    if (application.season !== 'spring' && application.season !== 'fall') refuse('season')
    if (!Array.isArray(application.chars) || application.chars.some((id) => typeof id !== 'string')) {
      refuse('chars')
    }
    if (!Array.isArray(application.plan)) refuse('plan')
    for (const key of ['occasions', 'catalog', 'girls', 'pairs', 'replies'] as const) {
      if (!isPlainObject(application[key])) refuse(key)
    }
    const { catalog } = application
    for (const pool of CATALOG_POOLS) {
      if (!Array.isArray(catalog[pool])) refuse(`catalog.${pool}`)
    }
    for (const key of ['major', 'interest'] as const) {
      if (!isPlainObject(catalog[key])) refuse(`catalog.${key}`)
    }
    const { skipped } = application
    if (
      skipped !== undefined &&
      (!Array.isArray(skipped) ||
        skipped.some((call) => !(NEW_GAME_CALLS as readonly unknown[]).includes(call)))
    ) {
      refuse('skipped')
    }
    for (const key of ['randomPicks', 'revealed'] as const) {
      const ids = application[key]
      if (ids !== undefined && !isStringList(ids)) refuse(key)
    }
    if (application.continued !== undefined) {
      const fault = continuationFault(application.continued)
      if (fault !== null) refuse(fault)
    }
    const { pursuits } = application
    if (
      pursuits !== undefined &&
      (!isPlainObject(pursuits) || Object.values(pursuits).some((text) => typeof text !== 'string'))
    ) {
      refuse('pursuits')
    }
    const { fixedEdits } = application
    if (
      fixedEdits !== undefined &&
      (!isPlainObject(fixedEdits) || Object.values(fixedEdits).some((edit) => !isPlainObject(edit)))
    ) {
      refuse('fixedEdits')
    }
    if (application.composed !== undefined) {
      const fault = composedFault(application.composed)
      if (fault !== null) refuse(fault)
    } else if (application.screen === 'finalize') {
      refuse('composed')
    }
    const { finalEdits } = application
    if (
      finalEdits !== undefined &&
      (!isPlainObject(finalEdits) ||
        Object.values(finalEdits).some((section) => !isPlainObject(section)))
    ) {
      refuse('finalEdits')
    }
  }
}

/** How an application is checked once it has been read. */
export const APPLICATION_READ: ValidateRecordOptions<Application> = {
  label: 'That new game in progress',
  malformed: {
    code: 'APPLICATION_MALFORMED',
    message: 'That new game in progress is not valid JSON.'
  },
  schemaVersion: { code: 'APPLICATION_SCHEMA_VERSION' },
  expects: APPLICATION_SCHEMA_VERSION,
  required: APPLICATION_REQUIRED,
  check: assertApplication('APPLICATION_MALFORMED')
}

/** Raised when an application handed over to be written is not one a read would take back. */
export const APPLICATION_INVALID = {
  code: 'APPLICATION_INVALID',
  message: 'That new game in progress could not be saved.'
}

/** Checks one parsed application as a read does, every refusal under `malformed`'s code. */
export function readApplicationRecord(
  parsed: unknown,
  where: string,
  malformed = APPLICATION_READ.malformed
): Application {
  return validateRecord<Application>(parsed, where, {
    ...APPLICATION_READ,
    malformed,
    check: assertApplication(malformed.code)
  })
}

/** Raised when an application is there but cannot be read. */
export const APPLICATION_UNREADABLE = {
  code: 'APPLICATION_UNREADABLE',
  message: 'Could not read the new game in progress.'
}

/** Raised when there is no application waiting. */
export const APPLICATION_NOT_FOUND = {
  code: 'APPLICATION_NOT_FOUND',
  message: 'That new game in progress no longer exists.'
}

/** Raised when an application would be written beside the playthrough it has already become. */
export const APPLICATION_SETTLED = {
  code: 'APPLICATION_SETTLED',
  message: 'That new game has already been started.'
}

/** Raised when an application would be written into a playthrough that is gone. */
export const APPLICATION_PLAYTHROUGH_GONE = {
  code: 'APPLICATION_PLAYTHROUGH_GONE',
  message: 'That playthrough no longer exists.'
}

/** Ids that are a bare decimal number: playthrough ids and slot save ids. */
export const SAFE_NUMERIC_ID = /^[0-9]+$/

/**
 * A manual save's id: `manual` and its slot padded to two digits and no further, so a slot is
 * only ever spelled one way.
 */
const MANUAL_ID = /^manual(0[1-9]|[1-9][0-9]{1,3})$/

/** Which kind of save an id names: the scene autosave, a boundary save, or a manual save. */
export type SaveIdKind = 'autosave' | 'boundary' | 'manual'

/** The save ids one playthrough holds, by kind, each group in the order it is listed. */
export interface SaveIdGroups {
  autosave: boolean
  /** Boundary saves, newest-first. */
  slots: string[]
  /** Manual saves, by slot. */
  manual: string[]
}

/** Rejects a playthroughId that could escape the folder or key space it names. */
export function assertSafePlaythroughId(playthroughId: string): void {
  assertSafeId(
    playthroughId,
    SAFE_NUMERIC_ID,
    'PLAYTHROUGH_ID_INVALID',
    'That playthrough id is not valid.'
  )
}

/** The kind of save an id names, or `null` for an id no save is ever written under. */
export function classifySaveId(saveId: string): SaveIdKind | null {
  if (saveId === AUTOSAVE_ID) return 'autosave'
  if (SAFE_NUMERIC_ID.test(saveId)) return 'boundary'
  if (manualSlotOf(saveId) !== null) return 'manual'
  return null
}

/** Rejects a saveId that could escape the playthrough it belongs to. */
export function assertSafeSaveId(saveId: string): void {
  if (classifySaveId(saveId) === null) {
    throw appError('SAVE_ID_INVALID', 'That save id is not valid.', saveId)
  }
}

/** Whether an id names a boundary save — the only kind the slot window mints and prunes. */
export function isSlotSaveId(saveId: string): boolean {
  return classifySaveId(saveId) === 'boundary'
}

/** The id of manual slot `slot`, its number padded to two digits. */
export function manualSaveId(slot: number): string {
  return `manual${String(slot).padStart(2, '0')}`
}

/** The slot a manual save's id names, or `null` for any other id and for a slot past the last. */
export function manualSlotOf(saveId: string): number | null {
  const match = MANUAL_ID.exec(saveId)
  if (!match) return null
  const slot = Number(match[1])
  return slot <= MANUAL_SAVE_SLOTS ? slot : null
}

/** Manual save ids by slot, lowest first. */
export function sortManualIds(ids: readonly string[]): string[] {
  return [...ids].sort((a, b) => (manualSlotOf(a) ?? 0) - (manualSlotOf(b) ?? 0))
}

/** Refuses a manual slot number outside 1 to {@link MANUAL_SAVE_SLOTS}. */
export function assertManualSlot(slot: number): void {
  if (!Number.isInteger(slot) || slot < 1 || slot > MANUAL_SAVE_SLOTS) {
    throw appError('SAVE_SLOT_INVALID', 'That save slot is not valid.', String(slot))
  }
}

/** Sorts the save ids a store holds into their kinds, dropping any that names no save. */
export function groupSaveIds(ids: Iterable<string>): SaveIdGroups {
  const slots: string[] = []
  const manual: string[] = []
  let autosave = false
  for (const saveId of ids) {
    const kind = classifySaveId(saveId)
    if (kind === 'autosave') autosave = true
    else if (kind === 'boundary') slots.push(saveId)
    else if (kind === 'manual') manual.push(saveId)
  }
  return { autosave, slots: sortSlotIds(slots), manual: sortManualIds(manual) }
}

/** Every id in listing order: the autosave, then the boundary saves, then the manual saves. */
export function listedSaveIds({ autosave, slots, manual }: SaveIdGroups): string[] {
  return [...(autosave ? [AUTOSAVE_ID] : []), ...slots, ...manual]
}

/** A line the player has nothing to read on — whatever else it carries. */
export function isSilentLine(line: SceneLine | null): boolean {
  return line !== null && line.text.trim() === ''
}

/**
 * The lines a load of `scene` plays before it waits: none where it resumes on its own line,
 * otherwise the queue's reader lines passed over up to and including the first line that says
 * something.
 */
export function openingLinesOf(scene: SceneState): SceneLine[] {
  if (scene.resumeOnLine === true && scene.currentLine !== null) return []
  const lines: SceneLine[] = []
  for (const line of scene.pendingLines) {
    if (line.speaker === READER_SPEAKER) continue
    lines.push(line)
    if (!isSilentLine(line)) break
  }
  return lines
}

/** The last background `lines` names, or null when none of them does. */
function lastBgOf(lines: readonly SceneLine[]): string | null {
  let bg: string | null = null
  for (const line of lines) {
    if (line.bg !== undefined) bg = line.bg
  }
  return bg
}

/** What the load grid shows of one save. */
export function summaryOf(save: GameSave): SaveSummary {
  const summary: SaveSummary = {
    date: save.date,
    time: save.time,
    graduationSeen: save.graduationSeen,
    midScene: save.scene !== null,
    bg:
      (save.scene ? lastBgOf(openingLinesOf(save.scene)) : null) ??
      save.scene?.bgOverride ??
      save.scene?.bg ??
      null
  }
  if (save.thumbnail) summary.thumbnail = save.thumbnail
  if (save.semester) summary.semester = save.semester
  return summary
}

/**
 * The masks a listing row wears: the random picks New Game left masked who are on `chars`, less
 * any `charInfo` says the reader has met; absent where none is left.
 */
export function maskedField(
  chars: readonly string[],
  masked: unknown,
  charInfo?: Record<string, CharState>
): Pick<PlaythroughSummary, 'masked'> {
  if (!isStringList(masked)) return {}
  const roster = new Set(chars)
  const left = masked.filter(
    (charId) => roster.has(charId) && charInfo?.[charId]?.flags?.hasMet !== true
  )
  return left.length > 0 ? { masked: left } : {}
}

/**
 * A playthrough's summary with the registration waiting beside its saves: always noted, and
 * standing for the playthrough unless a save was written after it — a registration is only ever
 * written after the saves it continues from, so a tie is its.
 */
export function withRegistration(
  summary: PlaythroughSummary,
  registration: Enrollment | null
): PlaythroughSummary {
  if (!registration) return summary
  const semesterIndex = registration.continued?.index ?? 0
  const noted = { ...summary, registration: { savedAt: registration.savedAt, semesterIndex } }
  if (registration.savedAt < summary.savedAt) return noted
  const { masked: _masked, ...rest } = noted
  return {
    ...rest,
    enrolling: true,
    chars: registration.chars,
    ...maskedField(registration.chars, registration.masked),
    date: FIRST_SLOT.date,
    time: FIRST_SLOT.time,
    ...(semesterIndex > 0 ? { semesterIndex } : {}),
    savedAt: registration.savedAt
  }
}

/** A playthrough with nothing in it but a New Game still being set up, as the listing shows it. */
export function applicationSummary(
  base: Omit<PlaythroughSummary, 'chars' | 'date' | 'time' | 'savedAt' | 'unloadable'>,
  application: Application
): PlaythroughSummary {
  const masked = [...maskedOf(application)]
  return {
    ...base,
    applying: true,
    chars: application.chars,
    ...(masked.length > 0 ? { masked } : {}),
    date: FIRST_SLOT.date,
    time: FIRST_SLOT.time,
    ...(application.continued ? { semesterIndex: application.continued.index } : {}),
    savedAt: application.savedAt,
    unloadable: null
  }
}

/**
 * A playthrough's summary with a later semester's New Game waiting beside its saves: noted, and
 * standing for the playthrough unless something was written after it, a tie being its. One with
 * no semester to continue, or whose semester the record or the registration (`registered`, its
 * semester's id) already holds, is passed over.
 */
export function withApplication(
  summary: PlaythroughSummary,
  application: Application | null,
  record: PlaythroughRecord | null,
  registered: string | undefined
): PlaythroughSummary {
  const continued = application?.continued
  if (
    !application ||
    !continued ||
    record?.semesters?.[continued.id] ||
    continued.id === registered
  ) {
    return summary
  }
  const semesterIndex = continued.index
  const noted = { ...summary, application: { savedAt: application.savedAt, semesterIndex } }
  if (application.savedAt < summary.savedAt) return noted
  const { enrolling: _enrolling, masked: _masked, ...rest } = noted
  const masked = [...maskedOf(application)]
  return {
    ...rest,
    applying: true,
    chars: application.chars,
    ...(masked.length > 0 ? { masked } : {}),
    date: FIRST_SLOT.date,
    time: FIRST_SLOT.time,
    semesterIndex,
    savedAt: application.savedAt
  }
}

/** Finds the first unused `{Date.now()+n}` id not already taken in `taken`. */
export function mintId(taken: ReadonlySet<string>): string {
  let candidate = Date.now()
  while (taken.has(candidate.toString())) candidate += 1
  return candidate.toString()
}

/** Slot ids newest-first; they are mint timestamps, so numeric order is chronological order. */
export function sortSlotIds(slotIds: readonly string[]): string[] {
  return [...slotIds].sort((a, b) => Number(b) - Number(a))
}

/**
 * Which of the slot ids a playthrough already holds are pushed out of the
 * {@link MAX_SLOT_SAVES} window by the slot save about to be written.
 */
export function prunedSlotIds(slotIds: readonly string[]): string[] {
  return sortSlotIds(slotIds).slice(MAX_SLOT_SAVES - 1)
}

/** One save with the fields its writer owns stamped on it. */
export function stampSave(
  draft: SaveDraft,
  playthroughId: string,
  saveId: string,
  savedAt: number
): GameSave {
  return { ...draft, playthroughId, saveId, schemaVersion: SAVE_SCHEMA_VERSION, saveDate: savedAt }
}

/** Where a save was found wins over what it carries. */
export function atLocation(save: GameSave, playthroughId: string, saveId: string): GameSave {
  return { ...save, playthroughId, saveId }
}

/** One playthrough record with this build's version stamped on it. */
export function stampRecord(draft: PlaythroughDraft): PlaythroughRecord {
  return { ...draft, schemaVersion: RECORD_SCHEMA_VERSION }
}

/** The longest name the player may give a playthrough. */
export const PLAYTHROUGH_NAME_MAX = 32

/**
 * A playthrough name as it is kept: one line, its spaces collapsed and trimmed, cut to
 * {@link PLAYTHROUGH_NAME_MAX} characters. Null for a blank one and for anything not a string.
 */
export function playthroughNameOf(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const name = Array.from(
    raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  )
    .slice(0, PLAYTHROUGH_NAME_MAX)
    .join('')
    .trim()
  return name === '' ? null : name
}

/** What Load Game calls a playthrough: the player's name for it, or its place in creation order. */
export function playthroughLabel(name: string | null | undefined, position: number): string {
  return name ?? `Playthrough ${position}`
}

/** A listing's fields with the player's name for the playthrough, where its record gives one. */
export function withPlaythroughName<T extends Pick<PlaythroughSummary, 'label' | 'position'>>(
  fields: T,
  record: PlaythroughRecord | null
): T & Pick<PlaythroughSummary, 'name'> {
  const name = playthroughNameOf(record?.name)
  return name === null ? fields : { ...fields, name, label: playthroughLabel(name, fields.position) }
}

/** The record with the player's name for it set, or dropped where the name is blank. */
export function renamedRecord(record: PlaythroughRecord, raw: string): PlaythroughRecord {
  const { name: _previous, ...rest } = record
  const name = playthroughNameOf(raw)
  return name === null ? rest : { ...rest, name }
}

/** One enrollment with its version and the moment it was set aside stamped on it. */
export function stampEnrollment(draft: EnrollmentDraft, savedAt: number): Enrollment {
  return { ...draft, schemaVersion: ENROLLMENT_SCHEMA_VERSION, savedAt }
}

/** One application with its version and the moment it was written stamped on it. */
export function stampApplication(draft: ApplicationDraft, savedAt: number): Application {
  return { ...draft, schemaVersion: APPLICATION_SCHEMA_VERSION, savedAt }
}
