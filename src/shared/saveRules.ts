import { appError } from './errors'
import { assertSafeId, type ValidateRecordOptions } from './jsonValidate'
import {
  AUTOSAVE_ID,
  MANUAL_SAVE_SLOTS,
  MAX_SLOT_SAVES,
  READER_SPEAKER,
  type Enrollment,
  type EnrollmentDraft,
  type GameSave,
  type PlaythroughDraft,
  type PlaythroughRecord,
  type SaveDraft,
  type SaveSummary,
  type SceneLine,
  type SceneState
} from './types'

/**
 * What a save, a playthrough record and an enrollment must be, whichever store holds them:
 * the versions this build reads, the fields each one carries, the ids that are safe to make a
 * key out of, the three kinds of save id, and the slot-save window.
 */

/** Schema version this build reads and writes for a save. */
export const SAVE_SCHEMA_VERSION = 12

/** The playthrough record's own version, apart from the saves'. */
export const RECORD_SCHEMA_VERSION = 3

/** The enrollment's own version, apart from both. */
export const ENROLLMENT_SCHEMA_VERSION = 2

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

/** What a playthrough record must carry; where it is kept names the playthrough. */
const RECORD_REQUIRED: Record<keyof PlaythroughRecord, true> = {
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
const ENROLLMENT_REQUIRED: Record<keyof Omit<Enrollment, 'bio' | 'tokensGenerated'>, true> = {
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
  required: SAVE_REQUIRED
}

/** Raised when a save is there but cannot be read. */
export const SAVE_UNREADABLE = { code: 'SAVE_UNREADABLE', message: 'Could not read the save file.' }

/** Raised when there is no such save. */
export const SAVE_NOT_FOUND = { code: 'SAVE_NOT_FOUND', message: 'That save no longer exists.' }

/** How a playthrough record is checked once it has been read. */
export const RECORD_READ: ValidateRecordOptions<PlaythroughRecord> = {
  label: 'That playthrough',
  malformed: {
    code: 'PLAYTHROUGH_MALFORMED',
    message: 'That playthrough record is not valid JSON.'
  },
  schemaVersion: { code: 'PLAYTHROUGH_SCHEMA_VERSION' },
  expects: RECORD_SCHEMA_VERSION,
  required: RECORD_REQUIRED
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
  required: ENROLLMENT_REQUIRED
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

/** Ids that are a bare decimal number: playthrough ids and slot save ids. */
export const SAFE_NUMERIC_ID = /^[0-9]+$/

/** A manual save's id: `manual` and its slot as two digits, 01 to 90. */
const MANUAL_ID = /^manual(0[1-9]|[1-8][0-9]|90)$/

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
  if (MANUAL_ID.test(saveId)) return 'manual'
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

/** The slot a manual save's id names, or `null` for any other id. */
export function manualSlotOf(saveId: string): number | null {
  const match = MANUAL_ID.exec(saveId)
  return match ? Number(match[1]) : null
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
  return summary
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

/** One enrollment with its version and the moment it was set aside stamped on it. */
export function stampEnrollment(draft: EnrollmentDraft, savedAt: number): Enrollment {
  return { ...draft, schemaVersion: ENROLLMENT_SCHEMA_VERSION, savedAt }
}
