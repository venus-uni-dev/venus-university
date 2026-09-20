import { assertSafeId, type ValidateRecordOptions } from './jsonValidate'
import {
  AUTOSAVE_ID,
  MAX_SLOT_SAVES,
  type Enrollment,
  type EnrollmentDraft,
  type GameSave,
  type PlaythroughDraft,
  type PlaythroughRecord,
  type SaveDraft
} from './types'

/**
 * What a save, a playthrough record and an enrollment must be, whichever store holds them:
 * the versions this build reads, the fields each one carries, the ids that are safe to make a
 * key out of, and the slot-save window.
 */

/** Schema version this build reads and writes for a save. */
export const SAVE_SCHEMA_VERSION = 12

/** The playthrough record's own version, apart from the saves'. */
export const RECORD_SCHEMA_VERSION = 3

/** The enrollment's own version, apart from both. */
export const ENROLLMENT_SCHEMA_VERSION = 2

/**
 * What a save must carry; `playthroughId`/`saveId` are stamped from where it was found, and
 * the fields a save written before them lacks are optional on the type and omitted here.
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

/** What an enrollment must carry; where it is kept names the playthrough it will become. */
const ENROLLMENT_REQUIRED: Record<keyof Enrollment, true> = {
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

/** Rejects a playthroughId that could escape the folder or key space it names. */
export function assertSafePlaythroughId(playthroughId: string): void {
  assertSafeId(
    playthroughId,
    SAFE_NUMERIC_ID,
    'PLAYTHROUGH_ID_INVALID',
    'That playthrough id is not valid.'
  )
}

/** Rejects a saveId that could escape the playthrough it belongs to. */
export function assertSafeSaveId(saveId: string): void {
  // The autosave is the one save whose id is a word rather than a mint timestamp.
  if (saveId === AUTOSAVE_ID) return
  assertSafeId(saveId, SAFE_NUMERIC_ID, 'SAVE_ID_INVALID', 'That save id is not valid.')
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
