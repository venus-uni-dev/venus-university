import { mkdir, readdir, rm, stat } from 'fs/promises'
import { appError, messageOf } from '@shared/errors'
import {
  assertSafePlaythroughId,
  assertSafeSaveId,
  atLocation,
  ENROLLMENT_NOT_FOUND,
  ENROLLMENT_READ,
  ENROLLMENT_UNREADABLE,
  mintId,
  prunedSlotIds,
  RECORD_NOT_FOUND,
  RECORD_READ,
  RECORD_UNREADABLE,
  SAFE_NUMERIC_ID,
  SAVE_NOT_FOUND,
  SAVE_READ,
  SAVE_UNREADABLE,
  sortSlotIds,
  stampEnrollment,
  stampRecord,
  stampSave
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
  type SaveEntry
} from '@shared/types'
import {
  getEnrollmentPath,
  getPlaythroughPath,
  getPlaythroughRecordPath,
  getSaveFilePath,
  getSavesPath
} from '../paths'
import { readValidatedJson, writeAtomicJson } from './jsonFile'

/** Saves, playthrough records and enrollments on disk; what each one must be is a shared rule. */

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

/** Reads and validates one save file; a missing field is refused by name. */
export async function loadSave(playthroughId: string, saveId: string): Promise<GameSave> {
  assertSafePlaythroughId(playthroughId)
  assertSafeSaveId(saveId)
  const path = getSaveFilePath(playthroughId, saveId)

  const candidate = await readValidatedJson<GameSave>(path, {
    ...SAVE_READ,
    unreadable: SAVE_UNREADABLE,
    onMissing: () => {
      throw appError(SAVE_NOT_FOUND.code, SAVE_NOT_FOUND.message, path)
    }
  })

  // Location on disk wins over what the file carries.
  return atLocation(candidate, playthroughId, saveId)
}

/** A file's modification time — what stands in for `saveDate` when the file cannot be read. */
async function mtimeOf(path: string): Promise<number> {
  return stat(path).then((info) => info.mtimeMs).catch(() => 0)
}

/** The save ids in one playthrough folder: `autosave` if present, then slot ids newest-first. */
export async function saveIdsOf(
  playthroughId: string
): Promise<{ autosave: boolean; slots: string[] }> {
  let entries: string[]
  try {
    entries = await readdir(getPlaythroughPath(playthroughId))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { autosave: false, slots: [] }
    throw appError('SAVES_UNREADABLE', 'Could not read the playthrough folder.', messageOf(err))
  }

  const slots: string[] = []
  let autosave = false
  for (const entry of entries) {
    if (!entry.toLowerCase().endsWith('.json')) continue
    const saveId = entry.slice(0, -5)
    if (saveId === AUTOSAVE_ID) autosave = true
    else if (SAFE_NUMERIC_ID.test(saveId)) slots.push(saveId)
  }

  return { autosave, slots: sortSlotIds(slots) }
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
 * Lists every playthrough in creation order, each summarised from its newest readable save;
 * one with no readable save is listed with the reason instead, and one with no save at all
 * from the enrollment waiting in it. A folder holding neither is skipped.
 */
export async function listPlaythroughs(): Promise<PlaythroughSummary[]> {
  const ids = await playthroughIds()

  const summaries: PlaythroughSummary[] = []
  for (const playthroughId of ids) {
    const { autosave, slots } = await saveIdsOf(playthroughId)
    // The autosave is always newer than every slot-save when it exists.
    const saveIds = autosave ? [AUTOSAVE_ID, ...slots] : slots

    const base = {
      playthroughId,
      label: `Playthrough ${summaries.length + 1}`,
      saveCount: slots.length,
      hasAutosave: autosave
    }

    // Nothing has been played yet: the folder stands for the semester still at the registrar,
    // opening where every playthrough does, or for nothing at all.
    if (saveIds.length === 0) {
      try {
        const enrollment = await readEnrollment(playthroughId)
        summaries.push({
          ...base,
          enrolling: true,
          chars: enrollment.chars,
          date: FIRST_SLOT.date,
          time: FIRST_SLOT.time,
          savedAt: enrollment.savedAt,
          unloadable: null
        })
      } catch (err) {
        if ((err as AppError).code === 'ENROLLMENT_NOT_FOUND') continue
        summaries.push({
          ...base,
          enrolling: true,
          chars: [],
          date: FIRST_SLOT.date,
          time: FIRST_SLOT.time,
          savedAt: await mtimeOf(getPlaythroughPath(playthroughId)),
          unloadable: (err as AppError).message
        })
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

    let summary: PlaythroughSummary | null = null
    for (const saveId of saveIds) {
      try {
        const save = await loadSave(playthroughId, saveId)
        summary = {
          ...base,
          chars: record?.chars ?? [],
          date: save.date,
          time: save.time,
          savedAt: save.saveDate,
          // A refused record outranks a readable save: without it nothing resolves.
          unloadable: record ? null : reason
        }
        break
      } catch (err) {
        if (!reason) reason = (err as AppError).message
      }
    }
    summaries.push(
      summary ?? {
        ...base,
        chars: [],
        date: 0,
        time: 0,
        savedAt: await mtimeOf(getPlaythroughPath(playthroughId)),
        unloadable: reason
      }
    )
  }

  return summaries
}

/**
 * Lists one playthrough's saves newest-first with the record they are read against, each
 * carrying its error where the file was refused.
 */
export async function listSaves(playthroughId: string): Promise<PlaythroughListing> {
  assertSafePlaythroughId(playthroughId)
  const { autosave, slots } = await saveIdsOf(playthroughId)

  let record: PlaythroughRecord | null = null
  let error: AppError | null = null
  try {
    record = await readPlaythroughRecord(playthroughId)
  } catch (err) {
    error = err as AppError
  }

  const saves: SaveEntry[] = []
  for (const saveId of autosave ? [AUTOSAVE_ID, ...slots] : slots) {
    try {
      const save = await loadSave(playthroughId, saveId)
      saves.push({ saveId, savedAt: save.saveDate, save, error: null })
    } catch (err) {
      saves.push({
        saveId,
        savedAt: await mtimeOf(getSaveFilePath(playthroughId, saveId)),
        save: null,
        error: err as AppError
      })
    }
  }

  return { record, error, saves }
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

  // The minting paths call `ensureFolder`; the write itself never makes the folder.
  await writeAtomicJson(getSaveFilePath(playthroughId, saveId), next, {
    code: 'SAVE_UNWRITABLE',
    message: 'Could not write the save file.'
  })

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
 * Writes a semester that has no timetable yet into a folder of its own, so the registrar
 * offering it can be left and come back to.
 */
export async function writeEnrollment(draft: EnrollmentDraft): Promise<CreatedEnrollment> {
  const playthroughId = await mintPlaythroughFolder()
  const enrollment = stampEnrollment(draft, Date.now())
  await writeAtomicJson(getEnrollmentPath(playthroughId), enrollment, {
    code: 'ENROLLMENT_UNWRITABLE',
    message: 'Could not write the class registration.'
  })
  return { playthroughId, enrollment }
}

/**
 * The record is written before the save: a save without a record can't be loaded, while a
 * record without a save sits in a folder the listing skips.
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
    // Load Game may have deleted the folder while the registrar stood open.
    await ensureFolder(getPlaythroughPath(folder))
  }

  const record = await writePlaythroughRecord(folder, playthrough)
  const save = await writeSaveFile(folder, folder, draft)
  // The playthrough is complete either way, and the listing reads an enrollment only in a
  // folder with no save in it.
  await rm(getEnrollmentPath(folder), { force: true }).catch((err: unknown) => {
    console.warn('[saves] the class registration could not be removed', err)
  })
  return { record, save }
}

/**
 * Writes the slot-boundary save: mints a new id, clears the autosave, and prunes the slot
 * saves back to their window.
 */
export async function writeSlotSave(playthroughId: string, draft: SaveDraft): Promise<GameSave> {
  assertSafePlaythroughId(playthroughId)
  await ensureFolder(getPlaythroughPath(playthroughId))

  const { slots } = await saveIdsOf(playthroughId)
  const saved = await writeSaveFile(playthroughId, mintId(new Set(slots)), draft)

  await rm(getSaveFilePath(playthroughId, AUTOSAVE_ID), { force: true })
  // `slots` was read before this write, so the window is what the new save pushes out of it.
  for (const stale of prunedSlotIds(slots)) {
    await rm(getSaveFilePath(playthroughId, stale), { force: true })
  }

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
  const { slots } = await saveIdsOf(playthroughId)
  if (!slots.includes(saveId)) {
    throw appError('SAVE_NOT_FOUND', 'That save no longer exists.', `${playthroughId}/${saveId}`)
  }
  return writeSaveFile(playthroughId, saveId, draft)
}

/** Overwrites the scene-in-progress save. Never pruned, never counted against the window. */
export async function writeAutosave(playthroughId: string, draft: SaveDraft): Promise<GameSave> {
  assertSafePlaythroughId(playthroughId)
  await ensureFolder(getPlaythroughPath(playthroughId))
  return writeSaveFile(playthroughId, AUTOSAVE_ID, draft)
}

/** Deletes one save file. Already-gone is success, not an error. */
export async function deleteSave(playthroughId: string, saveId: string): Promise<void> {
  assertSafePlaythroughId(playthroughId)
  assertSafeSaveId(saveId)
  try {
    await rm(getSaveFilePath(playthroughId, saveId), { force: true })
  } catch (err) {
    throw appError('SAVE_UNDELETABLE', 'Could not delete the save file.', messageOf(err))
  }
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
