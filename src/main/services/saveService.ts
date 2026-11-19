import { access, mkdir, readdir, rm, stat } from 'fs/promises'
import type { Application, ApplicationDraft, KeptApplication } from '@shared/application'
import { appError, messageOf, toAppError } from '@shared/errors'
import {
  idsMissingFrom,
  replayIdOf,
  replayIdsOf,
  replaysToDelete,
  type SlotReplay
} from '@shared/replays'
import {
  hasSemester,
  recordReplayIds,
  SEMESTER_NOT_FOUND,
  semesterOf,
  withTransfers
} from '@shared/semesters'
import {
  APPLICATION_INVALID,
  APPLICATION_NOT_FOUND,
  APPLICATION_PLAYTHROUGH_GONE,
  APPLICATION_READ,
  APPLICATION_SETTLED,
  APPLICATION_UNREADABLE,
  applicationSummary,
  assertManualSlot,
  assertSafePlaythroughId,
  assertSafeSaveId,
  assertSemesters,
  atLocation,
  ENROLLMENT_NOT_FOUND,
  ENROLLMENT_READ,
  ENROLLMENT_UNREADABLE,
  groupSaveIds,
  listedSaveIds,
  manualSaveId,
  maskedField,
  mintId,
  playthroughLabel,
  prunedSlotIds,
  readApplicationRecord,
  RECORD_NOT_FOUND,
  RECORD_READ,
  RECORD_UNREADABLE,
  renamedRecord,
  SAFE_NUMERIC_ID,
  SAVE_NOT_FOUND,
  SAVE_READ,
  SAVE_UNREADABLE,
  stampApplication,
  stampEnrollment,
  stampRecord,
  stampSave,
  summaryOf,
  withApplication,
  withPlaythroughName,
  withRegistration,
  type SaveIdGroups
} from '@shared/saveRules'
import {
  AUTOSAVE_ID,
  FIRST_SLOT,
  type AppError,
  type CreatedEnrollment,
  type CreatedPlaythrough,
  type Enrollment,
  type EnrollmentDraft,
  type GameSave,
  type PlaythroughDraft,
  type PlaythroughListing,
  type PlaythroughRecord,
  type PlaythroughSummary,
  type SaveDraft,
  type SaveEntry,
  type SaveReadResult,
  type SemesterRecord
} from '@shared/types'
import {
  getApplicationPath,
  getEnrollmentPath,
  getPlaythroughPath,
  getPlaythroughRecordPath,
  getSaveFilePath,
  getSavesPath
} from '../paths'
import { readValidatedJson, writeAtomicJson } from './jsonFile'
import { deleteReplay, listReplayIds, writeReplay } from './replayService'

/**
 * Saves, playthrough records, enrollments and applications on disk; what each one must be is a
 * shared rule.
 */

export { assertSafePlaythroughId }

/** Reads and validates a playthrough's record; a missing field is refused by name. */
export async function readPlaythroughRecord(playthroughId: string): Promise<PlaythroughRecord> {
  assertSafePlaythroughId(playthroughId)
  const path = getPlaythroughRecordPath(playthroughId)

  return readValidatedJson<PlaythroughRecord>(path, {
    ...RECORD_READ,
    unreadable: RECORD_UNREADABLE,
    onMissing: () => {
      throw appError(RECORD_NOT_FOUND.code, RECORD_NOT_FOUND.message, path)
    }
  })
}

/** Writes the record, stamping the version this build owns. */
async function writePlaythroughRecord(
  playthroughId: string,
  draft: PlaythroughDraft
): Promise<PlaythroughRecord> {
  const record = stampRecord(draft)
  await writeAtomicJson(getPlaythroughRecordPath(playthroughId), record, {
    code: 'PLAYTHROUGH_UNWRITABLE',
    message: 'Could not write the playthrough record.'
  })
  return record
}

/** Reads and validates one folder's enrollment; a missing field is refused by name. */
export async function readEnrollment(playthroughId: string): Promise<Enrollment> {
  assertSafePlaythroughId(playthroughId)
  const path = getEnrollmentPath(playthroughId)

  return readValidatedJson<Enrollment>(path, {
    ...ENROLLMENT_READ,
    unreadable: ENROLLMENT_UNREADABLE,
    onMissing: () => {
      throw appError(ENROLLMENT_NOT_FOUND.code, ENROLLMENT_NOT_FOUND.message, path)
    }
  })
}

/** Reads and validates one folder's application; a missing field is refused by name. */
export async function readApplication(playthroughId: string): Promise<Application> {
  assertSafePlaythroughId(playthroughId)
  const path = getApplicationPath(playthroughId)

  return readValidatedJson<Application>(path, {
    ...APPLICATION_READ,
    unreadable: APPLICATION_UNREADABLE,
    onMissing: () => {
      throw appError(APPLICATION_NOT_FOUND.code, APPLICATION_NOT_FOUND.message, path)
    }
  })
}

/** A parsed save, with the size and write time of the file it was read from or written to. */
interface ParsedSave {
  mtimeMs: number
  size: number
  save: GameSave
}

/** What the parse cache may hold, counted in the bytes of the files behind it. */
const PARSED_BUDGET_BYTES = 64 * 1024 * 1024

/**
 * Parsed saves by path, least recently used first. A save in it is handed to every reader as
 * the same object, so nothing may change one.
 */
const parsed = new Map<string, ParsedSave>()
let parsedBytes = 0

/** Save writes begun since launch, and the writes running now by path. */
let writesBegun = 0
const writesRunning = new Map<string, number>()

/** A file's size and write time, or `null` where it cannot be read. */
async function stampOf(path: string): Promise<{ mtimeMs: number; size: number } | null> {
  return stat(path)
    .then(({ mtimeMs, size }) => ({ mtimeMs, size }))
    .catch(() => null)
}

/** Drops the parsed save kept for one path. */
function forgetParsed(path: string): void {
  const entry = parsed.get(path)
  if (!entry) return
  parsed.delete(path)
  parsedBytes -= entry.size
}

/** Empties the parse cache, for when the saves folder is replaced under it. */
export function forgetParsedSaves(): void {
  parsed.clear()
  parsedBytes = 0
}

/** Keeps one parsed save as the most recent, dropping the least recent past the budget. */
function rememberParsed(path: string, entry: ParsedSave): void {
  forgetParsed(path)
  if (entry.size > PARSED_BUDGET_BYTES) return
  parsed.set(path, entry)
  parsedBytes += entry.size
  for (const [oldest, { size }] of parsed) {
    if (parsedBytes <= PARSED_BUDGET_BYTES) break
    parsed.delete(oldest)
    parsedBytes -= size
  }
}

/**
 * Marks a write to `path` begun and drops its parsed save; answers the mark the write checks
 * before priming the cache, or `null` when another write to the same file is already running.
 */
function beginWrite(path: string): number | null {
  const alone = !writesRunning.has(path)
  writesBegun += 1
  writesRunning.set(path, (writesRunning.get(path) ?? 0) + 1)
  forgetParsed(path)
  return alone ? writesBegun : null
}

/** Marks a write to `path` finished. */
function endWrite(path: string): void {
  const left = (writesRunning.get(path) ?? 1) - 1
  if (left > 0) writesRunning.set(path, left)
  else writesRunning.delete(path)
}

/**
 * Whether no save write has begun since `mark` and only `own` writes to `path` are running —
 * the condition for keeping what a read or write of it parsed.
 */
function unchallenged(path: string, mark: number | null, own: number): boolean {
  return mark === writesBegun && (writesRunning.get(path) ?? 0) === own
}

/**
 * Reads and validates one save file; a missing field is refused by name. A file whose size and
 * write time are what they were when it was last parsed here is not read again.
 */
export async function loadSave(playthroughId: string, saveId: string): Promise<GameSave> {
  assertSafePlaythroughId(playthroughId)
  assertSafeSaveId(saveId)
  const path = getSaveFilePath(playthroughId, saveId)

  const mark = writesRunning.has(path) ? null : writesBegun
  const stamp = await stampOf(path)
  const cached = parsed.get(path)
  if (stamp && cached && cached.mtimeMs === stamp.mtimeMs && cached.size === stamp.size) {
    rememberParsed(path, cached)
    return cached.save
  }
  forgetParsed(path)

  const candidate = await readValidatedJson<GameSave>(path, {
    ...SAVE_READ,
    unreadable: SAVE_UNREADABLE,
    onMissing: () => {
      throw appError(SAVE_NOT_FOUND.code, SAVE_NOT_FOUND.message, path)
    }
  })

  // Location on disk wins over what the file carries.
  const save = atLocation(candidate, playthroughId, saveId)
  if (stamp && unchallenged(path, mark, 0)) rememberParsed(path, { ...stamp, save })
  return save
}

/** Whether `playthroughId`'s own folder is on disk — never made by a write beside it. */
export async function playthroughExists(playthroughId: string): Promise<boolean> {
  try {
    await access(getPlaythroughPath(playthroughId))
    return true
  } catch {
    return false
  }
}

/** A file's modification time — what stands in for `saveDate` when the file cannot be read. */
async function mtimeOf(path: string): Promise<number> {
  return stat(path).then((info) => info.mtimeMs).catch(() => 0)
}

/** Save ids ordered by when each file was last written, newest first; a tie keeps their order. */
async function newestWrittenFirst(playthroughId: string, saveIds: string[]): Promise<string[]> {
  const written = await Promise.all(
    saveIds.map(async (saveId) => ({
      saveId,
      at: await mtimeOf(getSaveFilePath(playthroughId, saveId))
    }))
  )
  return written.sort((a, b) => b.at - a.at).map(({ saveId }) => saveId)
}

/** The save ids in one playthrough folder by kind; a file no save is written under is skipped. */
export async function saveIdsOf(playthroughId: string): Promise<SaveIdGroups> {
  let entries: string[]
  try {
    entries = await readdir(getPlaythroughPath(playthroughId))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { autosave: false, slots: [], manual: [] }
    }
    throw appError('SAVES_UNREADABLE', 'Could not read the playthrough folder.', messageOf(err))
  }

  return groupSaveIds(
    entries
      .filter((entry) => entry.toLowerCase().endsWith('.json'))
      .map((entry) => entry.slice(0, -5))
  )
}

/** Every playthrough folder's id in creation order; with no saves folder there are none. */
export async function playthroughIds(): Promise<string[]> {
  let entries: Array<{ name: string; isDirectory: () => boolean }>
  try {
    entries = await readdir(getSavesPath(), { withFileTypes: true })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw appError('SAVES_UNREADABLE', 'Could not read the saves folder.', messageOf(err))
  }

  return entries
    .filter((entry) => entry.isDirectory() && SAFE_NUMERIC_ID.test(entry.name))
    .map((entry) => entry.name)
    // Folder names are mint timestamps, so numeric order is creation order.
    .sort((a, b) => Number(a) - Number(b))
}

/**
 * Lists every playthrough in creation order, each summarised from its newest readable save of
 * any kind; one with no readable save is listed with the reason instead, and one with no save
 * at all from the enrollment or the application waiting in it. A folder holding none of them
 * is skipped.
 */
export async function listPlaythroughs(): Promise<PlaythroughSummary[]> {
  const ids = await playthroughIds()

  const summaries: PlaythroughSummary[] = []
  for (const playthroughId of ids) {
    const groups = await saveIdsOf(playthroughId)
    const saveIds = listedSaveIds(groups)

    const position = summaries.length + 1
    const base = {
      playthroughId,
      label: playthroughLabel(null, position),
      position,
      saveCount: groups.slots.length,
      manualCount: groups.manual.length,
      hasAutosave: groups.autosave
    }

    // Nothing has been played yet: the folder stands for the semester still at the registrar,
    // opening where every playthrough does, or for nothing at all.
    if (saveIds.length === 0) {
      try {
        const enrollment = await readEnrollment(playthroughId)
        const semesterIndex = enrollment.continued?.index ?? 0
        // A later semester's New Game written after the registration stands over it.
        summaries.push(
          withApplication(
            {
              ...base,
              enrolling: true,
              chars: enrollment.chars,
              ...maskedField(enrollment.chars, enrollment.masked),
              date: FIRST_SLOT.date,
              time: FIRST_SLOT.time,
              ...(semesterIndex > 0
                ? { semesterIndex, registration: { savedAt: enrollment.savedAt, semesterIndex } }
                : {}),
              savedAt: enrollment.savedAt,
              unloadable: null
            },
            await applicationBeside(playthroughId),
            await readPlaythroughRecord(playthroughId).catch(() => null),
            enrollment.continued?.id
          )
        )
      } catch (err) {
        if ((err as AppError).code !== ENROLLMENT_NOT_FOUND.code) {
          summaries.push({
            ...base,
            enrolling: true,
            chars: [],
            date: FIRST_SLOT.date,
            time: FIRST_SLOT.time,
            savedAt: await mtimeOf(getPlaythroughPath(playthroughId)),
            unloadable: (err as AppError).message
          })
        } else {
          const applying = await applicationSummaryOf(playthroughId, base)
          if (applying) summaries.push(applying)
        }
      }
      continue
    }

    // Everything the folder settled once; refused, nothing in it can be loaded.
    let record: PlaythroughRecord | null = null
    let reason = ''
    try {
      record = await readPlaythroughRecord(playthroughId)
    } catch (err) {
      reason = (err as AppError).message
    }
    const named = withPlaythroughName(base, record)

    let summary: PlaythroughSummary | null = null
    // Whichever file was written last stands for the playthrough, a manual save included.
    for (const saveId of await newestWrittenFirst(playthroughId, saveIds)) {
      try {
        const save = await loadSave(playthroughId, saveId)
        // The roster and the semester the save is in, whoever transferred in joined on; one the
        // record does not hold is unreadable.
        const semester = record ? withTransfers(semesterOf(record, save.semester), save) : null
        summary = {
          ...named,
          chars: semester?.chars ?? [],
          // A pick New Game left masked stays masked until she has been met.
          ...(semester ? maskedField(semester.chars, semester.masked, save.charInfo) : {}),
          date: save.date,
          time: save.time,
          ...(semester && semester.index > 0 ? { semesterIndex: semester.index } : {}),
          savedAt: save.saveDate,
          // A refused record outranks a readable save: without it nothing resolves.
          unloadable: record ? null : reason
        }
        break
      } catch (err) {
        if (!reason) reason = (err as AppError).message
      }
    }
    const registration = await registrationBeside(playthroughId)
    summaries.push(
      withApplication(
        withRegistration(
          summary ?? {
            ...named,
            chars: [],
            date: 0,
            time: 0,
            savedAt: await mtimeOf(getPlaythroughPath(playthroughId)),
            unloadable: reason
          },
          registration
        ),
        await applicationBeside(playthroughId),
        record,
        registration?.continued?.id
      )
    )
  }

  return summaries
}

/**
 * A folder with no save and no enrollment, listed as the New Game still being set up in it, or
 * with the reason its application cannot be read; null where the folder holds none.
 */
async function applicationSummaryOf(
  playthroughId: string,
  base: Omit<PlaythroughSummary, 'chars' | 'date' | 'time' | 'savedAt' | 'unloadable'>
): Promise<PlaythroughSummary | null> {
  try {
    return applicationSummary(base, await readApplication(playthroughId))
  } catch (err) {
    if ((err as AppError).code === APPLICATION_NOT_FOUND.code) return null
    return {
      ...base,
      applying: true,
      chars: [],
      date: FIRST_SLOT.date,
      time: FIRST_SLOT.time,
      savedAt: await mtimeOf(getPlaythroughPath(playthroughId)),
      unloadable: (err as AppError).message
    }
  }
}

/**
 * The next semester waiting at the registrar beside a playthrough's saves, or null; one that
 * cannot be read is passed over, the saves beside it still standing for the playthrough.
 */
async function registrationBeside(playthroughId: string): Promise<Enrollment | null> {
  try {
    return await readEnrollment(playthroughId)
  } catch (err) {
    const error = toAppError(err)
    if (error.code !== ENROLLMENT_NOT_FOUND.code) {
      console.warn(`[saves] ${playthroughId}'s class registration is unreadable:`, error.message)
    }
    return null
  }
}

/**
 * The New Game in progress beside a playthrough's saves, or null; one that cannot be read is
 * passed over, the saves beside it still standing for the playthrough.
 */
async function applicationBeside(playthroughId: string): Promise<Application | null> {
  try {
    return await readApplication(playthroughId)
  } catch (err) {
    const error = toAppError(err)
    if (error.code !== APPLICATION_NOT_FOUND.code) {
      console.warn(`[saves] ${playthroughId}'s new game in progress is unreadable:`, error.message)
    }
    return null
  }
}

/**
 * Lists one playthrough's saves — the autosave, the boundary saves newest-first, then the
 * manual saves by slot — with the record they are read against, each summarised, or carrying
 * its error where the file was refused.
 */
export async function listSaves(playthroughId: string): Promise<PlaythroughListing> {
  assertSafePlaythroughId(playthroughId)
  const saveIds = listedSaveIds(await saveIdsOf(playthroughId))

  let record: PlaythroughRecord | null = null
  let error: AppError | null = null
  try {
    record = await readPlaythroughRecord(playthroughId)
  } catch (err) {
    error = err as AppError
  }

  const saves: SaveEntry[] = []
  for (const saveId of saveIds) {
    try {
      const save = await loadSave(playthroughId, saveId)
      if (record && !hasSemester(record, save.semester)) {
        throw appError(SEMESTER_NOT_FOUND.code, SEMESTER_NOT_FOUND.message, `${playthroughId}/${saveId}`)
      }
      saves.push({ saveId, savedAt: save.saveDate, summary: summaryOf(save), error: null })
    } catch (err) {
      saves.push({
        saveId,
        savedAt: await mtimeOf(getSaveFilePath(playthroughId, saveId)),
        summary: null,
        error: err as AppError
      })
    }
  }

  return { record, error, saves }
}

/** One save with the record it is read against: everything loading it needs. */
export async function readSave(playthroughId: string, saveId: string): Promise<SaveReadResult> {
  const record = await readPlaythroughRecord(playthroughId)
  const save = await loadSave(playthroughId, saveId)
  if (!hasSemester(record, save.semester)) {
    throw appError(SEMESTER_NOT_FOUND.code, SEMESTER_NOT_FOUND.message, `${playthroughId}/${saveId}`)
  }
  return { record, save }
}

/** Creates the folder for a write, turning a failure into one clear error. */
async function ensureFolder(dir: string): Promise<void> {
  try {
    await mkdir(dir, { recursive: true })
  } catch (err) {
    throw appError(
      'SAVE_UNWRITABLE',
      'Could not create the saves folder.',
      `${dir}: ${messageOf(err)}`
    )
  }
}

/** Writes one save atomically, stamping the fields this service owns. */
async function writeSaveFile(
  playthroughId: string,
  saveId: string,
  draft: SaveDraft
): Promise<GameSave> {
  const next = stampSave(draft, playthroughId, saveId, Date.now())
  const path = getSaveFilePath(playthroughId, saveId)

  const mark = beginWrite(path)
  try {
    // The minting paths call `ensureFolder`; the write itself never makes the folder.
    await writeAtomicJson(path, next, {
      code: 'SAVE_UNWRITABLE',
      message: 'Could not write the save file.'
    })
    // Primed here rather than left to the next read: two writes of one file inside a
    // millisecond at the same length leave a stamp a read alone could not tell apart.
    const stamp = await stampOf(path)
    if (stamp && unchallenged(path, mark, 1)) rememberParsed(path, { ...stamp, save: next })
  } finally {
    endWrite(path)
  }

  return next
}

/** Mints the next free playthrough id and creates the empty folder it names. */
async function mintPlaythroughFolder(): Promise<string> {
  const root = getSavesPath()
  await ensureFolder(root)

  const existing = new Set(await readdir(root).catch(() => [] as string[]))
  const playthroughId = mintId(existing)
  await ensureFolder(getPlaythroughPath(playthroughId))
  return playthroughId
}

/**
 * Keeps a New Game still being set up: a first semester's first write mints the playthrough's
 * folder, the ones after it replace the application in the folder `playthroughId` names. A folder
 * that is gone is never made again, and one that already holds a record or an enrollment is
 * refused. A later semester's is only ever written beside its playthrough's record.
 */
export async function writeApplication(
  draft: ApplicationDraft,
  playthroughId?: string
): Promise<KeptApplication> {
  const application = readApplicationRecord(
    stampApplication(draft, Date.now()),
    'application',
    APPLICATION_INVALID
  )
  const unwritable = {
    code: 'APPLICATION_UNWRITABLE',
    message: 'Could not save the new game in progress.'
  }
  const continued = application.continued

  if (playthroughId === undefined) {
    if (continued) {
      throw appError(
        APPLICATION_INVALID.code,
        APPLICATION_INVALID.message,
        "application: a later semester's application needs its playthrough"
      )
    }
    const minted = await mintPlaythroughFolder()
    await writeAtomicJson(getApplicationPath(minted), application, unwritable)
    return { playthroughId: minted, application }
  }

  assertSafePlaythroughId(playthroughId)
  return inTurn(playthroughId, async () => {
    if (continued) {
      await assertContinuable(playthroughId, continued.id)
    } else {
      if (!(await playthroughExists(playthroughId))) {
        throw appError(
          APPLICATION_PLAYTHROUGH_GONE.code,
          APPLICATION_PLAYTHROUGH_GONE.message,
          playthroughId
        )
      }
      if (
        (await stampOf(getPlaythroughRecordPath(playthroughId))) !== null ||
        (await stampOf(getEnrollmentPath(playthroughId))) !== null
      ) {
        throw appError(APPLICATION_SETTLED.code, APPLICATION_SETTLED.message, playthroughId)
      }
    }
    await writeAtomicJson(getApplicationPath(playthroughId), application, unwritable)
    return { playthroughId, application }
  })
}

/**
 * Refuses a later semester's New Game its playthrough cannot take: one whose record is gone or
 * cannot be read, or whose semester the record or the registration beside it already holds.
 */
async function assertContinuable(playthroughId: string, semesterId: string): Promise<void> {
  let record: PlaythroughRecord
  try {
    record = await readPlaythroughRecord(playthroughId)
  } catch (err) {
    throw appError(
      APPLICATION_PLAYTHROUGH_GONE.code,
      APPLICATION_PLAYTHROUGH_GONE.message,
      `${playthroughId}: ${toAppError(err).message}`
    )
  }
  // A registration that cannot be read holds no semester.
  const registration = await readEnrollment(playthroughId).catch(() => null)
  if (record.semesters?.[semesterId] || registration?.continued?.id === semesterId) {
    throw appError(APPLICATION_SETTLED.code, APPLICATION_SETTLED.message, playthroughId)
  }
}

/**
 * Writes a semester that has no timetable yet, so the registrar offering it can be left and
 * come back to: a first semester into a folder of its own, or into the one whose application it
 * replaces, and a next one beside the record of the playthrough `playthroughId` names, replacing
 * any registration already waiting there and the application set up for the same semester.
 */
export async function writeEnrollment(
  draft: EnrollmentDraft,
  playthroughId?: string
): Promise<CreatedEnrollment> {
  if (playthroughId !== undefined && draft.continued === undefined) {
    assertSafePlaythroughId(playthroughId)
    return inTurn(playthroughId, async () => {
      if (!(await playthroughExists(playthroughId))) {
        throw appError(
          'ENROLLMENT_PLAYTHROUGH_GONE',
          'That playthrough no longer exists.',
          playthroughId
        )
      }
      if ((await stampOf(getPlaythroughRecordPath(playthroughId))) !== null) {
        throw appError('PLAYTHROUGH_EXISTS', 'That playthrough has already begun.', playthroughId)
      }
      const enrollment = stampEnrollment(draft, Date.now())
      await writeAtomicJson(getEnrollmentPath(playthroughId), enrollment, {
        code: 'ENROLLMENT_UNWRITABLE',
        message: 'Could not write the class registration.'
      })
      await removeApplication(playthroughId)
      return { playthroughId, enrollment }
    })
  }
  if (playthroughId !== undefined) {
    assertSafePlaythroughId(playthroughId)
    return inTurn(playthroughId, async () => {
      // A next semester belongs to a playthrough that has begun.
      await readPlaythroughRecord(playthroughId)
      const enrollment = stampEnrollment(draft, Date.now())
      await writeAtomicJson(getEnrollmentPath(playthroughId), enrollment, {
        code: 'ENROLLMENT_UNWRITABLE',
        message: 'Could not write the class registration.'
      })
      // The application this semester was set up on is spent; one that cannot be read is kept.
      const semesterId = draft.continued?.id
      const waiting = await readApplication(playthroughId).catch(() => null)
      if (semesterId !== undefined && waiting?.continued?.id === semesterId) {
        await removeApplication(playthroughId)
      }
      return { playthroughId, enrollment }
    })
  }
  const minted = await mintPlaythroughFolder()
  const enrollment = stampEnrollment(draft, Date.now())
  await writeAtomicJson(getEnrollmentPath(minted), enrollment, {
    code: 'ENROLLMENT_UNWRITABLE',
    message: 'Could not write the class registration.'
  })
  return { playthroughId: minted, enrollment }
}

/** Removes a folder's class registration; already gone is success. */
async function removeEnrollment(playthroughId: string): Promise<void> {
  await rm(getEnrollmentPath(playthroughId), { force: true }).catch((err: unknown) => {
    console.warn('[saves] the class registration could not be removed', err)
  })
}

/** Removes a folder's application; already gone is success. */
async function removeApplication(playthroughId: string): Promise<void> {
  await rm(getApplicationPath(playthroughId), { force: true }).catch((err: unknown) => {
    console.warn('[saves] the new game in progress could not be removed', err)
  })
}

/**
 * The record is written before the save: a save without a record can't be loaded, while a
 * record without a save sits in a folder the listing skips. A folder whose playthrough has
 * already begun is refused, so a registrar reopened on it can never write over its record.
 */
export async function createPlaythrough(
  playthrough: PlaythroughDraft,
  draft: SaveDraft,
  playthroughId?: string
): Promise<CreatedPlaythrough> {
  let folder: string
  if (playthroughId === undefined) {
    folder = await mintPlaythroughFolder()
  } else {
    assertSafePlaythroughId(playthroughId)
    folder = playthroughId
  }

  return inTurn(folder, async () => {
    if ((await stampOf(getPlaythroughRecordPath(folder))) !== null) {
      throw appError('PLAYTHROUGH_EXISTS', 'That playthrough has already begun.', folder)
    }
    // Load Game may have deleted the folder while the registrar stood open.
    await ensureFolder(getPlaythroughPath(folder))
    const record = await writePlaythroughRecord(folder, playthrough)
    const save = await writeSaveFile(folder, folder, draft)
    // The playthrough is complete either way, and its registration is spent.
    await removeEnrollment(folder)
    await removeApplication(folder)
    return { record, save }
  })
}

/**
 * Begins a next semester in a playthrough: the semester added to the record read fresh, so a
 * rename since is kept, then its opening save written into the boundary window, then the
 * registration it came from removed. A semester id the record already holds is refused and its
 * registration removed with it, so a semester is never written twice under a save naming it.
 */
export async function continueSemester(
  playthroughId: string,
  semesterId: string,
  semester: SemesterRecord,
  draft: SaveDraft
): Promise<CreatedPlaythrough> {
  assertSafePlaythroughId(playthroughId)
  if (!SAFE_NUMERIC_ID.test(semesterId)) {
    throw appError('SEMESTER_ID_INVALID', 'That semester id is not valid.', semesterId)
  }
  return inTurn(playthroughId, async () => {
    const current = await readPlaythroughRecord(playthroughId)
    if (current.semesters?.[semesterId]) {
      await removeEnrollment(playthroughId)
      throw appError('SEMESTER_EXISTS', 'That semester has already begun.', semesterId)
    }
    const { schemaVersion: _stamped, ...rest } = current
    const next = { ...rest, semesters: { ...current.semesters, [semesterId]: semester } }
    // Checked as a read would check it, before anything is written.
    assertSemesters(stampRecord(next), getPlaythroughRecordPath(playthroughId))
    const record = await writePlaythroughRecord(playthroughId, next)
    const save = await writeBoundarySave(playthroughId, draft)
    await removeEnrollment(playthroughId)
    return { record, save }
  })
}

/** Each playthrough's save writes and deletes still to settle, as the tail of one chain. */
const turns = new Map<string, Promise<void>>()

/**
 * Runs `run` once every save write or delete queued before it on the same playthrough has
 * settled, so no replay scan reads a folder another of them is changing.
 */
function inTurn<T>(playthroughId: string, run: () => Promise<T>): Promise<T> {
  const result = (turns.get(playthroughId) ?? Promise.resolve()).then(run)
  const settled = result.then(
    () => undefined,
    () => undefined
  )
  turns.set(playthroughId, settled)
  void settled.then(() => {
    if (turns.get(playthroughId) === settled) turns.delete(playthroughId)
  })
  return result
}

/** The replay ids one save names; a save that is gone or cannot be read names none. */
async function replayIdsIn(playthroughId: string, saveId: string): Promise<Set<string>> {
  try {
    return replayIdsOf((await loadSave(playthroughId, saveId)).replays)
  } catch {
    return new Set()
  }
}

/**
 * Deletes each of `dropped` that no save left in the playthrough names and `keep` does not hold,
 * and with them any other replay file no save names. A save that cannot be read might name any
 * of them, so then nothing is deleted; a failure here costs a stray file, never the write before.
 */
async function dropReplays(
  playthroughId: string,
  dropped: readonly string[],
  keep: readonly string[] = []
): Promise<void> {
  if (dropped.length === 0) return
  try {
    const files = await listReplayIds(playthroughId)
    const onDisk = new Set(files)
    if (!dropped.some((id) => onDisk.has(id) && !keep.includes(id))) return

    // The replays a finished semester left for the calendar stay as long as the playthrough.
    const named: Set<string>[] = []
    try {
      named.push(recordReplayIds(await readPlaythroughRecord(playthroughId)))
    } catch (err) {
      const error = toAppError(err)
      if (error.code !== RECORD_NOT_FOUND.code) {
        console.warn(
          `[saves] ${playthroughId}'s record could not be read, so no replay is deleted:`,
          error.message
        )
        return
      }
    }
    for (const saveId of listedSaveIds(await saveIdsOf(playthroughId))) {
      try {
        named.push(replayIdsOf((await loadSave(playthroughId, saveId)).replays))
      } catch (err) {
        const error = toAppError(err)
        if (error.code === SAVE_NOT_FOUND.code) continue
        console.warn(
          `[saves] ${playthroughId}/${saveId} could not be read, so no replay is deleted:`,
          error.message
        )
        return
      }
    }
    for (const replayId of replaysToDelete(files, named, keep)) {
      await deleteReplay(playthroughId, replayId)
    }
  } catch (err) {
    console.warn(
      `[saves] the replays of ${playthroughId} could not be tidied:`,
      toAppError(err).message
    )
  }
}

/**
 * Writes the slot-boundary save: mints a new id and prunes the slot saves back to their window.
 * A `replay` the draft names is written first, and a replay only the pruned saves named goes.
 * The autosave stands: it is the last decision point reached, and only the next one replaces it.
 */
export async function writeSlotSave(
  playthroughId: string,
  draft: SaveDraft,
  replay?: SlotReplay
): Promise<GameSave> {
  assertSafePlaythroughId(playthroughId)
  return inTurn(playthroughId, () => writeBoundarySave(playthroughId, draft, replay))
}

/** {@link writeSlotSave}'s write, for a caller already in the playthrough's turn. */
async function writeBoundarySave(
  playthroughId: string,
  draft: SaveDraft,
  replay?: SlotReplay
): Promise<GameSave> {
  await ensureFolder(getPlaythroughPath(playthroughId))
  const named = replayIdsOf(draft.replays)

  let written: string | null = null
  if (replay) {
    const replayId = replayIdOf(replay)
    if (named.has(replayId)) {
      written = await writeReplay(playthroughId, replay)
    } else {
      console.warn(`[saves] a replay the save does not name was left unwritten: ${replayId}`)
    }
  }

  const { slots } = await saveIdsOf(playthroughId)
  let saved: GameSave
  try {
    saved = await writeSaveFile(playthroughId, mintId(new Set(slots)), draft)
  } catch (err) {
    if (written) await dropReplays(playthroughId, [written])
    throw err
  }

  // `slots` was read before this write, so the window is what the new save pushes out of it.
  const dropped: string[] = []
  for (const stale of prunedSlotIds(slots)) {
    dropped.push(...(await replayIdsIn(playthroughId, stale)))
    const path = getSaveFilePath(playthroughId, stale)
    await rm(path, { force: true })
    forgetParsed(path)
  }
  await dropReplays(playthroughId, idsMissingFrom(dropped, named))

  return saved
}

/** Writes one save over whatever its file held, then drops the replays only the old one named. */
async function rewriteSave(
  playthroughId: string,
  saveId: string,
  draft: SaveDraft
): Promise<GameSave> {
  const before = await replayIdsIn(playthroughId, saveId)
  const saved = await writeSaveFile(playthroughId, saveId, draft)
  await dropReplays(playthroughId, idsMissingFrom(before, replayIdsOf(saved.replays)))
  return saved
}

/** Rewrites an existing slot-save in place. */
export async function overwriteSlotSave(
  playthroughId: string,
  saveId: string,
  draft: SaveDraft
): Promise<GameSave> {
  assertSafePlaythroughId(playthroughId)
  assertSafeSaveId(saveId)
  return inTurn(playthroughId, async () => {
    const { slots } = await saveIdsOf(playthroughId)
    if (!slots.includes(saveId)) {
      throw appError('SAVE_NOT_FOUND', 'That save no longer exists.', `${playthroughId}/${saveId}`)
    }
    return rewriteSave(playthroughId, saveId, draft)
  })
}

/** Overwrites the scene-in-progress save. Never pruned, never counted against the window. */
export async function writeAutosave(playthroughId: string, draft: SaveDraft): Promise<GameSave> {
  assertSafePlaythroughId(playthroughId)
  return inTurn(playthroughId, async () => {
    await ensureFolder(getPlaythroughPath(playthroughId))
    return rewriteSave(playthroughId, AUTOSAVE_ID, draft)
  })
}

/**
 * Writes the player's own save into one manual slot, replacing whatever it held. Mints
 * nothing, prunes nothing and leaves the autosave alone.
 */
export async function writeManualSave(
  playthroughId: string,
  slot: number,
  draft: SaveDraft
): Promise<GameSave> {
  assertSafePlaythroughId(playthroughId)
  assertManualSlot(slot)
  return inTurn(playthroughId, async () => {
    await ensureFolder(getPlaythroughPath(playthroughId))
    return rewriteSave(playthroughId, manualSaveId(slot), draft)
  })
}

/**
 * Deletes one save file, and every replay it named that no other save names and `keep` does not
 * hold. Already-gone is success, not an error.
 */
export async function deleteSave(
  playthroughId: string,
  saveId: string,
  keep: readonly string[] = []
): Promise<void> {
  assertSafePlaythroughId(playthroughId)
  assertSafeSaveId(saveId)
  return inTurn(playthroughId, async () => {
    const before = await replayIdsIn(playthroughId, saveId)
    const path = getSaveFilePath(playthroughId, saveId)
    try {
      await rm(path, { force: true })
      forgetParsed(path)
    } catch (err) {
      throw appError('SAVE_UNDELETABLE', 'Could not delete the save file.', messageOf(err))
    }
    await dropReplays(playthroughId, [...before], keep)
  })
}

/**
 * Gives a playthrough the player's own name, or takes it away where the name is blank: the
 * record is read and checked, then written back with that one field changed.
 */
export async function renamePlaythrough(playthroughId: string, name: string): Promise<void> {
  assertSafePlaythroughId(playthroughId)
  // In turn, so a semester being added to the record cannot be lost to a rename read before it.
  return inTurn(playthroughId, async () => {
    const { schemaVersion: _stamped, ...draft } = renamedRecord(
      await readPlaythroughRecord(playthroughId),
      name
    )
    await writePlaythroughRecord(playthroughId, draft)
  })
}

/** Deletes a whole playthrough folder and every save in it. */
export async function deletePlaythrough(playthroughId: string): Promise<void> {
  assertSafePlaythroughId(playthroughId)
  try {
    await rm(getPlaythroughPath(playthroughId), { recursive: true, force: true })
  } catch (err) {
    throw appError('PLAYTHROUGH_UNDELETABLE', 'Could not delete the playthrough.', messageOf(err))
  }
}
