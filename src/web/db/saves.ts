import { appError } from '@shared/errors'
import { validateRecord } from '@shared/jsonValidate'
import {
  assertSafePlaythroughId,
  assertSafeSaveId,
  atLocation,
  ENROLLMENT_NOT_FOUND,
  ENROLLMENT_READ,
  mintId,
  prunedSlotIds,
  RECORD_NOT_FOUND,
  RECORD_READ,
  SAVE_NOT_FOUND,
  SAVE_READ,
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
import { database, partRange, storage, type PlaythroughRow } from './open'

/**
 * Saves, playthrough records and enrollments in the browser's storage. One row per playthrough
 * holds its record or the enrollment standing in for one, and every save is its own row under
 * a `[playthroughId, saveId]` key.
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

/** The save ids one playthrough holds: whether it has an autosave, and its slots newest-first. */
async function saveIdsOf(playthroughId: string): Promise<{ autosave: boolean; slots: string[] }> {
  const keys = await storage('read the saves', async () =>
    (await database()).getAllKeys('saves', partRange(playthroughId))
  )

  const slots: string[] = []
  let autosave = false
  for (const [, saveId] of keys) {
    if (saveId === AUTOSAVE_ID) autosave = true
    else slots.push(saveId)
  }
  return { autosave, slots: sortSlotIds(slots) }
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

/**
 * Lists every playthrough in creation order, each summarised from its newest readable save;
 * one with no readable save is listed with the reason instead, and one with no save at all
 * from the enrollment waiting in it. A row holding neither is skipped.
 */
export async function listPlaythroughs(): Promise<PlaythroughSummary[]> {
  const summaries: PlaythroughSummary[] = []

  for (const playthroughId of await playthroughIds()) {
    const row = await rowOf(playthroughId)
    if (!row) continue

    const { autosave, slots } = await saveIdsOf(playthroughId)
    // The autosave is always newer than every slot-save when it exists.
    const saveIds = autosave ? [AUTOSAVE_ID, ...slots] : slots

    const base = {
      playthroughId,
      label: `Playthrough ${summaries.length + 1}`,
      saveCount: slots.length,
      hasAutosave: autosave
    }

    // Nothing has been played yet: the row stands for the semester still at the registrar,
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
        savedAt: row.createdAt,
        unloadable: reason
      }
    )
  }

  return summaries
}

/**
 * Lists one playthrough's saves newest-first with the record they are read against, each
 * carrying its error where the row was refused.
 */
export async function listSaves(playthroughId: string): Promise<PlaythroughListing> {
  assertSafePlaythroughId(playthroughId)
  const { autosave, slots } = await saveIdsOf(playthroughId)
  const createdAt = (await rowOf(playthroughId))?.createdAt ?? 0

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
      saves.push({ saveId, savedAt: createdAt, save: null, error: err as AppError })
    }
  }

  return { record, error, saves }
}

/** Mints the next free playthrough id. */
async function mintPlaythroughId(): Promise<string> {
  return mintId(new Set(await playthroughIds()))
}

/**
 * Writes a semester that has no timetable yet into a row of its own, so the registrar
 * offering it can be left and come back to.
 */
export async function writeEnrollment(draft: EnrollmentDraft): Promise<CreatedEnrollment> {
  const now = Date.now()
  const playthroughId = await mintPlaythroughId()
  const enrollment = stampEnrollment(draft, now)

  await storage('save the class registration', async () =>
    (await database()).put(
      'playthroughs',
      { record: null, enrollment, createdAt: now },
      playthroughId
    )
  )
  return { playthroughId, enrollment }
}

/**
 * Starts a new playthrough: its record and its opening slot-save, into the row its enrollment
 * minted or a freshly minted one. The record replaces the enrollment in the same put, so the
 * two are never both there and never both gone.
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
  // Load Game may have deleted the row while the registrar stood open.
  const createdAt = (await rowOf(folder))?.createdAt ?? Number(folder)

  await storage('start the playthrough', async () => {
    const tx = (await database()).transaction(['playthroughs', 'saves'], 'readwrite')
    // Both puts are database requests, so the transaction is still open for the second.
    void tx.objectStore('playthroughs').put({ record, enrollment: null, createdAt }, folder)
    void tx.objectStore('saves').put(save, [folder, folder])
    await tx.done
  })

  return { record, save }
}

/**
 * Writes the slot-boundary save: mints a new id, clears the autosave, and prunes the slot
 * saves back to their window, all in one transaction.
 */
export async function writeSlotSave(playthroughId: string, draft: SaveDraft): Promise<GameSave> {
  assertSafePlaythroughId(playthroughId)

  return storage('write the save', async () => {
    const tx = (await database()).transaction('saves', 'readwrite')
    const store = tx.store
    // Read and writes are all database requests, so the transaction lives to the end of them.
    const keys = await store.getAllKeys(partRange(playthroughId))
    const slots = keys.map(([, saveId]) => saveId).filter((saveId) => saveId !== AUTOSAVE_ID)

    const saved = stampSave(draft, playthroughId, mintId(new Set(slots)), Date.now())
    void store.put(saved, [playthroughId, saved.saveId])
    void store.delete([playthroughId, AUTOSAVE_ID])
    // `slots` was read before this write, so the window is what the new save pushes out of it.
    for (const stale of prunedSlotIds(slots)) void store.delete([playthroughId, stale])

    await tx.done
    return saved
  })
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

/** Writes one save row, stamping the fields this module owns. */
async function writeSave(
  playthroughId: string,
  saveId: string,
  draft: SaveDraft
): Promise<GameSave> {
  const next = stampSave(draft, playthroughId, saveId, Date.now())
  await storage('write the save', async () =>
    (await database()).put('saves', next, [playthroughId, saveId])
  )
  return next
}

/** Deletes one save. Already-gone is success, not an error. */
export async function deleteSave(playthroughId: string, saveId: string): Promise<void> {
  assertSafePlaythroughId(playthroughId)
  assertSafeSaveId(saveId)
  await storage('delete the save', async () =>
    (await database()).delete('saves', [playthroughId, saveId])
  )
}

/** Deletes a whole playthrough: its row, every save in it and its graduation picture. */
export async function deletePlaythrough(playthroughId: string): Promise<void> {
  assertSafePlaythroughId(playthroughId)

  await storage('delete the playthrough', async () => {
    const tx = (await database()).transaction(
      ['playthroughs', 'saves', 'endingArt'],
      'readwrite'
    )
    // Three deletes, all database requests, so the transaction sees all of them.
    void tx.objectStore('playthroughs').delete(playthroughId)
    void tx.objectStore('saves').delete(partRange(playthroughId))
    void tx.objectStore('endingArt').delete(playthroughId)
    await tx.done
  })
}

/** The graduation picture already stored, or `null` where there is none. */
export async function readEndingArt(playthroughId: string): Promise<Uint8Array | null> {
  assertSafePlaythroughId(playthroughId)
  const blob = await storage('read the graduation picture', async () =>
    (await database()).get('endingArt', playthroughId)
  )
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null
}

/** Keeps the graduation picture beside the playthrough it belongs to. */
export async function writeEndingArt(playthroughId: string, blob: Blob): Promise<void> {
  assertSafePlaythroughId(playthroughId)
  await storage('save the graduation picture', async () =>
    (await database()).put('endingArt', blob, playthroughId)
  )
}
