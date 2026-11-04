import type { IDBPTransaction } from 'idb'
import type { Application, ApplicationDraft, KeptApplication } from '@shared/application'
import { appError } from '@shared/errors'
import { validateRecord } from '@shared/jsonValidate'
import type { ProfileFrame, ProfileSource } from '@shared/profilePicture'
import {
  idsMissingFrom,
  replayIdOf,
  replayIdsOf,
  replaysToDelete,
  validateReplay,
  type SlotReplay
} from '@shared/replays'
import { hasSemester, recordReplayIds, SEMESTER_NOT_FOUND, semesterOf } from '@shared/semesters'
import {
  APPLICATION_INVALID,
  APPLICATION_NOT_FOUND,
  APPLICATION_PLAYTHROUGH_GONE,
  APPLICATION_SETTLED,
  applicationSummary,
  assertManualSlot,
  assertSafePlaythroughId,
  assertSafeSaveId,
  assertSemesters,
  atLocation,
  classifySaveId,
  ENROLLMENT_NOT_FOUND,
  ENROLLMENT_READ,
  groupSaveIds,
  isSlotSaveId,
  listedSaveIds,
  manualSaveId,
  maskedField,
  mintId,
  playthroughLabel,
  prunedSlotIds,
  readApplicationRecord,
  RECORD_NOT_FOUND,
  RECORD_READ,
  renamedRecord,
  SAFE_NUMERIC_ID,
  SAVE_NOT_FOUND,
  SAVE_READ,
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
import { storedBlob } from '../webp'
import {
  database,
  partRange,
  storage,
  type PlaythroughRow,
  type VenusUniversityDb
} from './open'

/**
 * Saves, playthrough records, enrollments and applications in the browser's storage. One row per
 * playthrough holds its record or the enrollment standing in for one, a New Game still being set
 * up is a row of its own beside an empty playthrough row, and every save is its own row under a
 * `[playthroughId, saveId]` key.
 */

/** The row one playthrough keeps, or `null` where there is none. */
async function rowOf(playthroughId: string): Promise<PlaythroughRow | undefined> {
  return storage('read the playthrough', async () =>
    (await database()).get('playthroughs', playthroughId)
  )
}

/** Every playthrough id in creation order; the ids are mint timestamps. */
async function playthroughIds(): Promise<string[]> {
  const keys = await storage('read the playthroughs', async () =>
    (await database()).getAllKeys('playthroughs')
  )
  return keys.sort((a, b) => Number(a) - Number(b))
}

/** The save ids one playthrough holds by kind; a key no save is written under is skipped. */
async function saveIdsOf(playthroughId: string): Promise<SaveIdGroups> {
  const keys = await storage('read the saves', async () =>
    (await database()).getAllKeys('saves', partRange(playthroughId))
  )
  return groupSaveIds(keys.map(([, saveId]) => saveId))
}

/** Reads and validates one playthrough's record; a missing field is refused by name. */
export async function readPlaythroughRecord(playthroughId: string): Promise<PlaythroughRecord> {
  assertSafePlaythroughId(playthroughId)
  const record = (await rowOf(playthroughId))?.record
  if (!record) {
    throw appError(RECORD_NOT_FOUND.code, RECORD_NOT_FOUND.message, playthroughId)
  }
  return validateRecord<PlaythroughRecord>(record, playthroughId, RECORD_READ)
}

/** Reads and validates the enrollment waiting in one playthrough. */
export async function readEnrollment(playthroughId: string): Promise<Enrollment> {
  assertSafePlaythroughId(playthroughId)
  const enrollment = (await rowOf(playthroughId))?.enrollment
  if (!enrollment) {
    throw appError(ENROLLMENT_NOT_FOUND.code, ENROLLMENT_NOT_FOUND.message, playthroughId)
  }
  return validateRecord<Enrollment>(enrollment, playthroughId, ENROLLMENT_READ)
}

/** Reads and validates the New Game in progress kept for one playthrough. */
export async function readApplication(playthroughId: string): Promise<Application> {
  assertSafePlaythroughId(playthroughId)
  const application = await storage('read the new game in progress', async () =>
    (await database()).get('applications', playthroughId)
  )
  if (application === undefined) {
    throw appError(APPLICATION_NOT_FOUND.code, APPLICATION_NOT_FOUND.message, playthroughId)
  }
  return readApplicationRecord(application, playthroughId)
}

/** Reads and validates one save; where it was found wins over what it carries. */
export async function loadSave(playthroughId: string, saveId: string): Promise<GameSave> {
  assertSafePlaythroughId(playthroughId)
  assertSafeSaveId(saveId)
  const where = `${playthroughId}/${saveId}`

  const stored = await storage('read the save', async () =>
    (await database()).get('saves', [playthroughId, saveId])
  )
  if (stored === undefined) {
    throw appError(SAVE_NOT_FOUND.code, SAVE_NOT_FOUND.message, where)
  }
  return atLocation(validateRecord<GameSave>(stored, where, SAVE_READ), playthroughId, saveId)
}

/** A save the record does not hold the semester of, refused as one that cannot be read. */
function assertSaveSemester(record: PlaythroughRecord | null, save: GameSave, where: string): void {
  if (record && !hasSemester(record, save.semester)) {
    throw appError(SEMESTER_NOT_FOUND.code, SEMESTER_NOT_FOUND.message, where)
  }
}

/**
 * The next semester waiting at the registrar in a playthrough's row beside its saves, or null;
 * one that cannot be read is passed over, the saves beside it still standing for the playthrough.
 */
function registrationIn(row: PlaythroughRow, playthroughId: string): Enrollment | null {
  if (!row.enrollment) return null
  try {
    return validateRecord<Enrollment>(row.enrollment, playthroughId, ENROLLMENT_READ)
  } catch (err) {
    console.warn(`[saves] ${playthroughId}'s class registration is unreadable:`, err)
    return null
  }
}

/**
 * The New Game in progress kept beside a playthrough's saves, or null; one that cannot be read is
 * passed over, the saves beside it still standing for the playthrough.
 */
async function applicationBeside(playthroughId: string): Promise<Application | null> {
  try {
    return await readApplication(playthroughId)
  } catch (err) {
    if ((err as AppError).code !== APPLICATION_NOT_FOUND.code) {
      console.warn(`[saves] ${playthroughId}'s new game in progress is unreadable:`, err)
    }
    return null
  }
}

/**
 * The newest readable save of one playthrough by `saveDate`, or the first refusal met where none
 * reads. A row the index cannot place, missing a field it is keyed on, is still read by its id.
 */
async function newestSave(
  playthroughId: string,
  saveIds: readonly string[],
  record: PlaythroughRecord | null
): Promise<{ save: GameSave | null; reason: string }> {
  let reason = ''
  const indexed = await storage('read the saves', async () => {
    const index = (await database()).transaction('saves').store.index('byDate')
    const range = IDBKeyRange.bound([playthroughId, -Infinity], [playthroughId, Infinity])
    // Validation is synchronous, so the transaction stays open from one row to the next.
    let cursor = await index.openCursor(range, 'prev')
    for (; cursor; cursor = await cursor.continue()) {
      const [owner, saveId] = cursor.primaryKey
      if (owner !== playthroughId || classifySaveId(saveId) === null) continue
      try {
        const save = validateRecord<GameSave>(cursor.value, `${owner}/${saveId}`, SAVE_READ)
        assertSaveSemester(record, save, `${owner}/${saveId}`)
        return atLocation(save, playthroughId, saveId)
      } catch (err) {
        if (!reason) reason = (err as AppError).message
      }
    }
    return null
  })
  if (indexed) return { save: indexed, reason }

  for (const saveId of saveIds) {
    try {
      const save = await loadSave(playthroughId, saveId)
      assertSaveSemester(record, save, `${playthroughId}/${saveId}`)
      return { save, reason }
    } catch (err) {
      if (!reason) reason = (err as AppError).message
    }
  }
  return { save: null, reason }
}

/**
 * Lists every playthrough in creation order, each summarised from its newest readable save of
 * any kind; one with no readable save is listed with the reason instead, and one with no save
 * at all from the enrollment waiting in it, or failing that the New Game in progress. A row
 * holding none of them is skipped.
 */
export async function listPlaythroughs(): Promise<PlaythroughSummary[]> {
  const summaries: PlaythroughSummary[] = []

  for (const playthroughId of await playthroughIds()) {
    const row = await rowOf(playthroughId)
    if (!row) continue

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

    // Nothing has been played yet: the row stands for the semester still at the registrar,
    // opening where every playthrough does, for the New Game still being set up, or for nothing
    // at all.
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
        if ((err as AppError).code === ENROLLMENT_NOT_FOUND.code) {
          try {
            summaries.push(applicationSummary(base, await readApplication(playthroughId)))
          } catch (applicationErr) {
            if ((applicationErr as AppError).code === APPLICATION_NOT_FOUND.code) continue
            summaries.push({
              ...base,
              applying: true,
              chars: [],
              date: FIRST_SLOT.date,
              time: FIRST_SLOT.time,
              savedAt: row.createdAt,
              unloadable: (applicationErr as AppError).message
            })
          }
          continue
        }
        summaries.push({
          ...base,
          enrolling: true,
          chars: [],
          date: FIRST_SLOT.date,
          time: FIRST_SLOT.time,
          savedAt: row.createdAt,
          unloadable: (err as AppError).message
        })
      }
      continue
    }

    // Everything the playthrough settled once; refused, nothing in it can be loaded.
    let record: PlaythroughRecord | null = null
    let reason = ''
    try {
      record = await readPlaythroughRecord(playthroughId)
    } catch (err) {
      reason = (err as AppError).message
    }

    const named = withPlaythroughName(base, record)

    const newest = await newestSave(playthroughId, saveIds, record)
    if (!reason) reason = newest.reason
    // The roster and the semester the newest save is in.
    const semester = newest.save && record ? semesterOf(record, newest.save.semester) : null
    const registration = registrationIn(row, playthroughId)
    summaries.push(
      withApplication(
        withRegistration(
          newest.save
            ? {
                ...named,
                chars: semester?.chars ?? [],
                // A pick New Game left masked stays masked until she has been met.
                ...(semester
                  ? maskedField(semester.chars, semester.masked, newest.save.charInfo)
                  : {}),
                date: newest.save.date,
                time: newest.save.time,
                ...(semester && semester.index > 0 ? { semesterIndex: semester.index } : {}),
                savedAt: newest.save.saveDate,
                // A refused record outranks a readable save: without it nothing resolves.
                unloadable: record ? null : reason
              }
            : {
                ...named,
                chars: [],
                date: 0,
                time: 0,
                savedAt: row.createdAt,
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
 * Lists one playthrough's saves — the autosave, the boundary saves newest-first, then the
 * manual saves by slot — with the record they are read against, each summarised, or carrying
 * its error where the row was refused.
 */
export async function listSaves(playthroughId: string): Promise<PlaythroughListing> {
  assertSafePlaythroughId(playthroughId)
  const saveIds = listedSaveIds(await saveIdsOf(playthroughId))
  const createdAt = (await rowOf(playthroughId))?.createdAt ?? 0

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
      assertSaveSemester(record, save, `${playthroughId}/${saveId}`)
      saves.push({ saveId, savedAt: save.saveDate, summary: summaryOf(save), error: null })
    } catch (err) {
      saves.push({ saveId, savedAt: createdAt, summary: null, error: err as AppError })
    }
  }

  return { record, error, saves }
}

/** One save with the record it is read against: everything loading it needs. */
export async function readSave(playthroughId: string, saveId: string): Promise<SaveReadResult> {
  const record = await readPlaythroughRecord(playthroughId)
  const save = await loadSave(playthroughId, saveId)
  assertSaveSemester(record, save, `${playthroughId}/${saveId}`)
  return { record, save }
}

/** Mints the next free playthrough id. */
async function mintPlaythroughId(): Promise<string> {
  return mintId(new Set(await playthroughIds()))
}

/**
 * Keeps the New Game in progress: a first semester's first write mints a playthrough row to hold
 * it, and a later one names that playthrough and replaces it. A playthrough that is gone, or that
 * has already become a registration or a record, is refused and nothing is written. A later
 * semester's is written only beside its playthrough's record, and refused once that semester is
 * on the record or at the registrar.
 */
export async function writeApplication(
  draft: ApplicationDraft,
  playthroughId?: string
): Promise<KeptApplication> {
  const now = Date.now()
  // Checked before any transaction opens, which an await outside the database would close.
  const application = readApplicationRecord(
    stampApplication(draft, now),
    'application',
    APPLICATION_INVALID
  )
  const semesterId = application.continued?.id

  if (playthroughId === undefined) {
    if (semesterId !== undefined) {
      throw appError(
        APPLICATION_INVALID.code,
        APPLICATION_INVALID.message,
        "application: a later semester's application needs its playthrough"
      )
    }
    const minted = await mintPlaythroughId()
    await storage('save the new game in progress', async () => {
      const tx = (await database()).transaction(['playthroughs', 'applications'], 'readwrite')
      // Both puts are database requests, so the transaction is still open for the second.
      const row = { record: null, enrollment: null, createdAt: now }
      void tx.objectStore('playthroughs').put(row, minted)
      void tx.objectStore('applications').put(application, minted)
      await tx.done
    })
    return { playthroughId: minted, application }
  }

  assertSafePlaythroughId(playthroughId)
  const outcome = await storage('save the new game in progress', async () => {
    const tx = (await database()).transaction(['playthroughs', 'applications'], 'readwrite')
    const row = await tx.objectStore('playthroughs').get(playthroughId)
    // A later semester's belongs beside a record; a first semester's, beside nothing settled.
    if (!row || (semesterId !== undefined && !row.record)) {
      await tx.done
      return 'gone' as const
    }
    const settled =
      semesterId === undefined
        ? Boolean(row.record || row.enrollment)
        : Boolean(row.record?.semesters?.[semesterId]) ||
          row.enrollment?.continued?.id === semesterId
    if (settled) {
      await tx.done
      return 'settled' as const
    }
    void tx.objectStore('applications').put(application, playthroughId)
    await tx.done
    return 'kept' as const
  })
  if (outcome === 'gone') {
    throw appError(
      APPLICATION_PLAYTHROUGH_GONE.code,
      APPLICATION_PLAYTHROUGH_GONE.message,
      playthroughId
    )
  }
  if (outcome === 'settled') {
    throw appError(APPLICATION_SETTLED.code, APPLICATION_SETTLED.message, playthroughId)
  }
  return { playthroughId, application }
}

/**
 * Writes a semester that has no timetable yet, so the registrar offering it can be left and
 * come back to: a first semester into a row of its own, or into the playthrough
 * `playthroughId` names where its New Game in progress is replaced by it, and a next one beside
 * the record of the playthrough `playthroughId` names, replacing any registration waiting there
 * and the New Game in progress set up for the same semester.
 */
export async function writeEnrollment(
  draft: EnrollmentDraft,
  playthroughId?: string
): Promise<CreatedEnrollment> {
  if (playthroughId !== undefined && draft.continued === undefined) {
    assertSafePlaythroughId(playthroughId)
    const enrollment = stampEnrollment(draft, Date.now())
    const outcome = await storage('save the class registration', async () => {
      const tx = (await database()).transaction(['playthroughs', 'applications'], 'readwrite')
      const row = await tx.objectStore('playthroughs').get(playthroughId)
      if (!row) {
        await tx.done
        return 'gone' as const
      }
      if (row.record) {
        await tx.done
        return 'begun' as const
      }
      // Both are database requests, so the registration and the removal land together.
      void tx.objectStore('playthroughs').put({ ...row, enrollment }, playthroughId)
      void tx.objectStore('applications').delete(playthroughId)
      await tx.done
      return 'kept' as const
    })
    if (outcome === 'gone') {
      throw appError(
        'ENROLLMENT_PLAYTHROUGH_GONE',
        'That playthrough no longer exists.',
        playthroughId
      )
    }
    if (outcome === 'begun') {
      throw appError('PLAYTHROUGH_EXISTS', 'That playthrough has already begun.', playthroughId)
    }
    return { playthroughId, enrollment }
  }
  if (playthroughId !== undefined) {
    assertSafePlaythroughId(playthroughId)
    const enrollment = stampEnrollment(draft, Date.now())
    const semesterId = draft.continued?.id
    const written = await storage('save the class registration', async () => {
      const tx = (await database()).transaction(['playthroughs', 'applications'], 'readwrite')
      const row = await tx.objectStore('playthroughs').get(playthroughId)
      // A next semester belongs to a playthrough that has begun.
      if (!row?.record) return false
      const waiting = await tx.objectStore('applications').get(playthroughId)
      // Both are database requests, so the registration and the removal land together.
      void tx.objectStore('playthroughs').put({ ...row, enrollment }, playthroughId)
      // The New Game in progress this semester was set up on is spent.
      if (semesterId !== undefined && waiting?.continued?.id === semesterId) {
        void tx.objectStore('applications').delete(playthroughId)
      }
      await tx.done
      return true
    })
    if (!written) throw appError(RECORD_NOT_FOUND.code, RECORD_NOT_FOUND.message, playthroughId)
    return { playthroughId, enrollment }
  }
  const now = Date.now()
  const minted = await mintPlaythroughId()
  const enrollment = stampEnrollment(draft, now)

  await storage('save the class registration', async () =>
    (await database()).put('playthroughs', { record: null, enrollment, createdAt: now }, minted)
  )
  return { playthroughId: minted, enrollment }
}

/**
 * Starts a new playthrough: its record and its opening slot-save, into the row its enrollment
 * minted or a freshly minted one. The record replaces the enrollment in the same put, so the
 * two are never both there and never both gone, and a stray application goes with it.
 */
export async function createPlaythrough(
  playthrough: PlaythroughDraft,
  draft: SaveDraft,
  playthroughId?: string
): Promise<CreatedPlaythrough> {
  let folder: string
  if (playthroughId === undefined) {
    folder = await mintPlaythroughId()
  } else {
    assertSafePlaythroughId(playthroughId)
    folder = playthroughId
  }

  const record = stampRecord(playthrough)
  const save = stampSave(draft, folder, folder, Date.now())

  const started = await storage('start the playthrough', async () => {
    const tx = (await database()).transaction(
      ['playthroughs', 'saves', 'applications'],
      'readwrite'
    )
    // A row whose playthrough has already begun is never written over.
    const existing = await tx.objectStore('playthroughs').get(folder)
    if (existing?.record) {
      tx.abort()
      await tx.done.catch(() => {})
      return false
    }
    // Load Game may have deleted the row while the registrar stood open.
    const createdAt = existing?.createdAt ?? Number(folder)
    // Both puts are database requests, so the transaction is still open for the second.
    void tx.objectStore('playthroughs').put({ record, enrollment: null, createdAt }, folder)
    void tx.objectStore('saves').put(save, [folder, folder])
    // A stray application goes with the enrollment it was spent for.
    void tx.objectStore('applications').delete(folder)
    await tx.done
    return true
  })
  if (!started) throw appError('PLAYTHROUGH_EXISTS', 'That playthrough has already begun.', folder)

  return { record, save }
}

/**
 * Begins a next semester in a playthrough, in one transaction: the semester added to the record
 * read fresh, so a rename since is kept, its opening save written into the boundary window, and
 * the registration it came from removed. A semester id the record already holds is refused and
 * its registration removed with it, so a semester is never written twice under a save naming it.
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
  const now = Date.now()

  const outcome = await storage('begin the semester', async () => {
    const tx = (await database()).transaction(['playthroughs', 'saves', 'replays'], 'readwrite')
    const rows = tx.objectStore('playthroughs')
    const row = await rows.get(playthroughId)
    if (!row?.record) {
      await tx.done
      return { kind: 'missing' as const }
    }
    const current = validateRecord<PlaythroughRecord>(row.record, playthroughId, RECORD_READ)
    if (current.semesters?.[semesterId]) {
      // The registration is spent either way.
      void rows.put({ ...row, enrollment: null }, playthroughId)
      await tx.done
      return { kind: 'exists' as const }
    }
    const { schemaVersion: _stamped, ...rest } = current
    const record = stampRecord({
      ...rest,
      semesters: { ...current.semesters, [semesterId]: semester }
    })
    // Checked as a read would check it, before anything is written.
    assertSemesters(record, playthroughId)
    void rows.put({ ...row, record, enrollment: null }, playthroughId)
    const save = await writeBoundaryIn(tx, playthroughId, draft, now)
    await tx.done
    return { kind: 'begun' as const, record, save }
  })

  if (outcome.kind === 'missing') {
    throw appError(RECORD_NOT_FOUND.code, RECORD_NOT_FOUND.message, playthroughId)
  }
  if (outcome.kind === 'exists') {
    throw appError('SEMESTER_EXISTS', 'That semester has already begun.', semesterId)
  }
  return { record: outcome.record, save: outcome.save }
}

/**
 * A save write's transaction: the saves and, beside them, the replays they name and the
 * playthrough rows whose records name the replays a finished semester left.
 */
type SaveTx = IDBPTransaction<VenusUniversityDb, ['playthroughs', 'saves', 'replays'], 'readwrite'>

/** Opens one save write's transaction over the playthroughs, the saves and the replays. */
async function saveTransaction(): Promise<SaveTx> {
  return (await database()).transaction(['playthroughs', 'saves', 'replays'], 'readwrite')
}

/**
 * Inside a save write's transaction, after its own puts and deletes: deletes each of `dropped`
 * that no save left in the playthrough names and `keep` does not hold, and with them any other
 * replay no save names. A save row that does not read as one might name any of them, so then
 * nothing is deleted.
 */
async function dropReplaysIn(
  tx: SaveTx,
  playthroughId: string,
  dropped: readonly string[],
  keep: readonly string[] = []
): Promise<void> {
  if (dropped.length === 0) return
  const replays = tx.objectStore('replays')
  const kept = (await replays.getAllKeys(partRange(playthroughId))).map(([, replayId]) => replayId)
  const present = new Set(kept)
  if (!dropped.some((replayId) => present.has(replayId) && !keep.includes(replayId))) return

  // The replays a finished semester left for the calendar stay as long as the playthrough.
  const named: Set<string>[] = []
  const row = await tx.objectStore('playthroughs').get(playthroughId)
  if (row?.record) {
    try {
      named.push(
        recordReplayIds(validateRecord<PlaythroughRecord>(row.record, playthroughId, RECORD_READ))
      )
    } catch (err) {
      console.warn(`[saves] ${playthroughId}'s record could not be read, so no replay is deleted:`, err)
      return
    }
  }

  // Requests run in order, so these reads see the write this transaction has already queued.
  const store = tx.objectStore('saves')
  const keys = await store.getAllKeys(partRange(playthroughId))
  const rows = await store.getAll(partRange(playthroughId))
  for (const [index, [, saveId]] of keys.entries()) {
    if (classifySaveId(saveId) === null) continue
    const where = `${playthroughId}/${saveId}`
    try {
      named.push(replayIdsOf(validateRecord<GameSave>(rows[index], where, SAVE_READ).replays))
    } catch (err) {
      console.warn(`[saves] ${where} could not be read, so no replay is deleted:`, err)
      return
    }
  }
  for (const replayId of replaysToDelete(kept, named, keep)) {
    void replays.delete([playthroughId, replayId])
  }
}

/** The replay a slot write keeps beside its save, or `null` where the draft names none. */
function replayToKeep(
  draft: SaveDraft,
  replay: SlotReplay | undefined
): { replayId: string; replay: SlotReplay } | null {
  if (!replay) return null
  const checked = validateReplay(replay, 'replay')
  const replayId = replayIdOf(checked)
  if (replayIdsOf(draft.replays).has(replayId)) return { replayId, replay: checked }
  console.warn(`[saves] a replay the save does not name was left unwritten: ${replayId}`)
  return null
}

/**
 * Writes the slot-boundary save: mints a new id and prunes the slot saves back to their window,
 * all in one transaction, with a `replay` the draft names and the removal of any replay only the
 * pruned saves named. The autosave stands: only the next decision point replaces it.
 */
export async function writeSlotSave(
  playthroughId: string,
  draft: SaveDraft,
  replay?: SlotReplay
): Promise<GameSave> {
  assertSafePlaythroughId(playthroughId)
  const kept = replayToKeep(draft, replay)
  const named = replayIdsOf(draft.replays)
  const now = Date.now()

  return storage('write the save', async () => {
    const tx = await saveTransaction()
    if (kept) void tx.objectStore('replays').put(kept.replay, [playthroughId, kept.replayId])
    const saved = await writeBoundaryIn(tx, playthroughId, draft, now, named)
    await tx.done
    return saved
  })
}

/**
 * Inside a save write's transaction: mints the boundary save's id, puts it, prunes the slot
 * saves back to their window and drops any replay only the pruned saves named but `named`.
 */
async function writeBoundaryIn(
  tx: SaveTx,
  playthroughId: string,
  draft: SaveDraft,
  now: number,
  named: ReadonlySet<string> = replayIdsOf(draft.replays)
): Promise<GameSave> {
  const store = tx.objectStore('saves')
  // Read and writes are all database requests, so the transaction lives to the end of them.
  const keys = await store.getAllKeys(partRange(playthroughId))
  // Boundary saves alone: the window never counts, and so never prunes, a manual save.
  const slots = keys.map(([, saveId]) => saveId).filter(isSlotSaveId)

  const saved = stampSave(draft, playthroughId, mintId(new Set(slots)), now)
  void store.put(saved, [playthroughId, saved.saveId])
  // `slots` was read before this write, so the window is what the new save pushes out of it.
  const dropped: string[] = []
  for (const stale of prunedSlotIds(slots)) {
    dropped.push(...replayIdsOf((await store.get([playthroughId, stale]))?.replays))
    void store.delete([playthroughId, stale])
  }
  await dropReplaysIn(tx, playthroughId, idsMissingFrom(dropped, named))
  return saved
}

/** Rewrites an existing slot-save in place — mints nothing, prunes nothing. */
export async function overwriteSlotSave(
  playthroughId: string,
  saveId: string,
  draft: SaveDraft
): Promise<GameSave> {
  assertSafePlaythroughId(playthroughId)
  assertSafeSaveId(saveId)

  const { slots } = await saveIdsOf(playthroughId)
  if (!slots.includes(saveId)) {
    throw appError('SAVE_NOT_FOUND', 'That save no longer exists.', `${playthroughId}/${saveId}`)
  }
  return writeSave(playthroughId, saveId, draft)
}

/** Overwrites the scene-in-progress save. Never pruned, never counted against the window. */
export async function writeAutosave(playthroughId: string, draft: SaveDraft): Promise<GameSave> {
  assertSafePlaythroughId(playthroughId)
  return writeSave(playthroughId, AUTOSAVE_ID, draft)
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
  return writeSave(playthroughId, manualSaveId(slot), draft)
}

/**
 * Writes one save row over whatever it held, stamping the fields this module owns, and drops
 * the replays only the old row named, in one transaction.
 */
async function writeSave(
  playthroughId: string,
  saveId: string,
  draft: SaveDraft
): Promise<GameSave> {
  const next = stampSave(draft, playthroughId, saveId, Date.now())
  const named = replayIdsOf(next.replays)
  await storage('write the save', async () => {
    const tx = await saveTransaction()
    const store = tx.objectStore('saves')
    const before = await store.get([playthroughId, saveId])
    void store.put(next, [playthroughId, saveId])
    await dropReplaysIn(tx, playthroughId, idsMissingFrom(replayIdsOf(before?.replays), named))
    await tx.done
  })
  return next
}

/**
 * Deletes one save, and every replay it named that no other save names and `keep` does not hold,
 * in one transaction. Already-gone is success, not an error.
 */
export async function deleteSave(
  playthroughId: string,
  saveId: string,
  keep: readonly string[] = []
): Promise<void> {
  assertSafePlaythroughId(playthroughId)
  assertSafeSaveId(saveId)
  await storage('delete the save', async () => {
    const tx = await saveTransaction()
    const store = tx.objectStore('saves')
    const before = await store.get([playthroughId, saveId])
    void store.delete([playthroughId, saveId])
    await dropReplaysIn(tx, playthroughId, [...replayIdsOf(before?.replays)], keep)
    await tx.done
  })
}

/**
 * Gives a playthrough the player's own name, or takes it away where the name is blank: the
 * record is read and checked, then put back with that one field changed.
 */
export async function renamePlaythrough(playthroughId: string, name: string): Promise<void> {
  const renamed = renamedRecord(await readPlaythroughRecord(playthroughId), name)

  const kept = await storage('rename the playthrough', async () => {
    const tx = (await database()).transaction('playthroughs', 'readwrite')
    // The read and the write are both database requests, so the transaction spans the two.
    const row = await tx.store.get(playthroughId)
    if (!row?.record) return false
    await tx.store.put({ ...row, record: renamed }, playthroughId)
    await tx.done
    return true
  })
  // Deleted between the read and the write: nothing is put back in its place.
  if (!kept) throw appError(RECORD_NOT_FOUND.code, RECORD_NOT_FOUND.message, playthroughId)
}

/**
 * Deletes a whole playthrough: its row, every save and replay in it, its lorebook,
 * its New Game in progress and both of its pictures.
 */
export async function deletePlaythrough(playthroughId: string): Promise<void> {
  assertSafePlaythroughId(playthroughId)

  await storage('delete the playthrough', async () => {
    const tx = (await database()).transaction(
      [
        'playthroughs',
        'saves',
        'endingArt',
        'profilePictures',
        'profileSources',
        'photos',
        'replays',
        'lorebooks',
        'applications'
      ],
      'readwrite'
    )
    // Ten deletes, all database requests, so the transaction sees all of them.
    void tx.objectStore('playthroughs').delete(playthroughId)
    void tx.objectStore('saves').delete(partRange(playthroughId))
    void tx.objectStore('endingArt').delete(playthroughId)
    void tx.objectStore('endingArt').delete(semesterPicturesRange(playthroughId))
    void tx.objectStore('profilePictures').delete(playthroughId)
    void tx.objectStore('profileSources').delete(playthroughId)
    void tx.objectStore('photos').delete(partRange(playthroughId))
    void tx.objectStore('replays').delete(partRange(playthroughId))
    void tx.objectStore('lorebooks').delete(playthroughId)
    void tx.objectStore('applications').delete(playthroughId)
    await tx.done
  })
}

/**
 * The key a semester's graduation picture is kept under: the playthrough's id for the first
 * semester, `{playthroughId}.{semesterId}` for a later one.
 */
export function endingArtKey(playthroughId: string, semesterId?: string): string {
  assertSafePlaythroughId(playthroughId)
  if (semesterId === undefined) return playthroughId
  if (!SAFE_NUMERIC_ID.test(semesterId)) {
    throw appError('SEMESTER_ID_INVALID', 'That semester id is not valid.', semesterId)
  }
  return `${playthroughId}.${semesterId}`
}

/** Every key a playthrough's later semesters keep their graduation pictures under. */
function semesterPicturesRange(playthroughId: string): IDBKeyRange {
  return IDBKeyRange.bound(`${playthroughId}.`, `${playthroughId}.\uffff`)
}

/** The later semesters a playthrough keeps a graduation picture for. */
export async function endingArtSemesters(playthroughId: string): Promise<string[]> {
  assertSafePlaythroughId(playthroughId)
  const keys = await storage('read the graduation pictures', async () =>
    (await database()).getAllKeys('endingArt', semesterPicturesRange(playthroughId))
  )
  return keys.map((key) => String(key).slice(playthroughId.length + 1))
}

/** A semester's graduation picture already stored, or `null` where there is none. */
export async function readEndingArt(
  playthroughId: string,
  semesterId?: string
): Promise<Uint8Array | null> {
  const key = endingArtKey(playthroughId, semesterId)
  const blob = await storage('read the graduation picture', async () =>
    (await database()).get('endingArt', key)
  )
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null
}

/** Keeps a semester's graduation picture beside the playthrough it belongs to. */
export async function writeEndingArt(
  playthroughId: string,
  picture: Blob,
  semesterId?: string
): Promise<void> {
  const key = endingArtKey(playthroughId, semesterId)
  const blob = await storedBlob(picture, false)
  await storage('save the graduation picture', async () =>
    (await database()).put('endingArt', blob, key)
  )
}

/** The crop of the reader's own picture already stored, or `null` where there is none. */
export async function readProfilePicture(playthroughId: string): Promise<Uint8Array | null> {
  assertSafePlaythroughId(playthroughId)
  const blob = await storage('read the profile picture', async () =>
    (await database()).get('profilePictures', playthroughId)
  )
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null
}

/** The full picture the crop was cut from and its frame, or `null` where only a crop was kept. */
export async function readProfileSource(playthroughId: string): Promise<ProfileSource | null> {
  assertSafePlaythroughId(playthroughId)
  const row = await storage('read the profile picture', async () =>
    (await database()).get('profileSources', playthroughId)
  )
  return row ? { image: new Uint8Array(await row.image.arrayBuffer()), frame: row.frame } : null
}

/**
 * Keeps the crop beside the playthrough it belongs to, with the frame it was cut through and the
 * full picture where a new one is handed over; `null` keeps the one stored. One transaction.
 */
export async function writeProfilePicture(
  playthroughId: string,
  crop: Blob,
  source: Blob | null,
  frame: ProfileFrame
): Promise<void> {
  assertSafePlaythroughId(playthroughId)
  const storedCrop = await storedBlob(crop, false)
  const storedSource = source ? await storedBlob(source, false) : null
  await storage('save the profile picture', async () => {
    const tx = (await database()).transaction(['profilePictures', 'profileSources'], 'readwrite')
    const sources = tx.objectStore('profileSources')
    // A database request, so the transaction is still open for the puts.
    const image = storedSource ?? (await sources.get(playthroughId))?.image
    if (image) void sources.put({ image, frame }, playthroughId)
    void tx.objectStore('profilePictures').put(storedCrop, playthroughId)
    await tx.done
  })
}

/** Removes the crop, the full picture and its frame; whatever is already gone is success. */
export async function deleteProfilePicture(playthroughId: string): Promise<void> {
  assertSafePlaythroughId(playthroughId)
  await storage('remove the profile picture', async () => {
    const tx = (await database()).transaction(['profilePictures', 'profileSources'], 'readwrite')
    void tx.objectStore('profilePictures').delete(playthroughId)
    void tx.objectStore('profileSources').delete(playthroughId)
    await tx.done
  })
}
