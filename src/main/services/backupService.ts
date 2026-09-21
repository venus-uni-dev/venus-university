import { mkdir, rename, rm, writeFile } from 'fs/promises'
import { basename, dirname, join } from 'path'
import {
  BACKUP_NAME,
  BACKUP_READ,
  BACKUP_SCHEMA_VERSION,
  BACKUP_ZIP_LIMITS,
  CHARACTERS_DIR,
  charFileEntry,
  classifyBackupEntry,
  endingArtEntry,
  type BackupFile,
  type BackupPlaythrough,
  type BackupSave
} from '@shared/backup'
import { isCharFileRel, STAGING_DIR } from '@shared/characterFiles'
import { CHARACTER_NOT_FOUND, SAFE_CHAR_ID } from '@shared/characterRules'
import { appError, messageOf } from '@shared/errors'
import {
  ENROLLMENT_NOT_FOUND,
  RECORD_NOT_FOUND,
  SAFE_NUMERIC_ID,
  SAVE_NOT_FOUND
} from '@shared/saveRules'
import { AUTOSAVE_ID, type AppError, type Character } from '@shared/types'
import {
  isPregenChar,
  getCharacterFilePath,
  getCharacterPath,
  getCharactersPath,
  getEndingArtPath,
  getEnrollmentPath,
  getPlaythroughRecordPath,
  getSaveFilePath,
  getSavesPath
} from '../paths'
import {
  checkExtractedContent,
  copyInto,
  createZip,
  discard,
  extractZip,
  relPathsUnder,
  scratchDir
} from './archiveService'
import { getCharacter, ownCharIds } from './characterService'
import { readEndingArt } from './endingArtService'
import { getGrabBags, setGrabBags } from './grabBagService'
import { sniffImageFile } from './imageFiles'
import { readValidatedJson, writeAtomicJson } from './jsonFile'
import {
  loadSave,
  playthroughIds,
  readEnrollment,
  readPlaythroughRecord,
  saveIdsOf
} from './saveService'
import { applySettingsPatch, getRendererSettings, setRemovedDefaults } from './settingsService'

/** The data folder as one backup zip, and one backup zip back over the data folder. */

/** What a step of a restore raises when it cannot write where it has to. */
const RESTORE_FAILED = {
  code: 'BACKUP_RESTORE_FAILED',
  message: 'Could not put the backup back.'
}

/**
 * One file the backup can do without: never written answers null quietly, and anything else
 * answers null with a warning, so one bad file costs the backup that file and nothing else.
 */
async function optional<T>(
  what: string,
  missingCode: string,
  read: () => Promise<T>
): Promise<T | null> {
  try {
    return await read()
  } catch (err) {
    const error = err as AppError
    if (error.code !== missingCode) {
      console.warn(`[backup] leaving out ${what}:`, error.message ?? err)
    }
    return null
  }
}

/**
 * Every file under a character's folder as a forward-slash relative path; a folder that is not
 * there has none.
 */
async function charFilesUnder(root: string): Promise<string[]> {
  try {
    return await relPathsUnder(root)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw appError('CHARACTERS_UNREADABLE', 'Could not read the characters folder.', messageOf(err))
  }
}

/** Which of a character's files a backup carries: her images, never a staged run's. */
function isBackedUpFile(rel: string): boolean {
  return isCharFileRel(rel) && !rel.startsWith(`${STAGING_DIR}/`)
}

/** Everything one playthrough folder carries, minus whatever could not be read. */
async function backupPlaythrough(playthroughId: string): Promise<BackupPlaythrough> {
  return {
    record: await optional(`${playthroughId}'s record`, RECORD_NOT_FOUND.code, () =>
      readPlaythroughRecord(playthroughId)
    ),
    enrollment: await optional(`${playthroughId}'s registration`, ENROLLMENT_NOT_FOUND.code, () =>
      readEnrollment(playthroughId)
    ),
    // Folder names are mint timestamps, so the name is when the playthrough began.
    createdAt: Number(playthroughId)
  }
}

/** Writes everything this install keeps into `targetPath` as one zip. */
export async function exportBackup(targetPath: string): Promise<void> {
  const scratch = scratchDir('backup')

  try {
    await mkdir(scratch, { recursive: true })
    const settings = await getRendererSettings()
    const grabbags = await getGrabBags()

    const playthroughs: Record<string, BackupPlaythrough> = {}
    const saves: BackupSave[] = []
    const endingArt: string[] = []

    for (const playthroughId of await playthroughIds()) {
      playthroughs[playthroughId] = await backupPlaythrough(playthroughId)

      const { autosave, slots } = await saveIdsOf(playthroughId)
      for (const saveId of autosave ? [AUTOSAVE_ID, ...slots] : slots) {
        const save = await optional(`save ${playthroughId}/${saveId}`, SAVE_NOT_FOUND.code, () =>
          loadSave(playthroughId, saveId)
        )
        if (save) saves.push({ playthroughId, saveId, save })
      }

      const art = await readEndingArt(playthroughId)
      if (art) {
        const path = join(scratch, endingArtEntry(playthroughId))
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, art)
        endingArt.push(playthroughId)
      }
    }

    // The player's own only: the shipped cast is the build's, wherever it is read from, and a
    // folder under `/data/characters` named after one of them is already shadowed by it.
    const characters: Character[] = []
    for (const charId of await ownCharIds()) {
      if (isPregenChar(charId)) continue
      const character = await optional(`character ${charId}`, CHARACTER_NOT_FOUND.code, () =>
        getCharacter(charId)
      )
      // Only a character whose record was read gets her images.
      if (!character) continue
      characters.push(character)

      const folder = getCharacterPath(charId)
      for (const rel of await charFilesUnder(folder)) {
        if (!isBackedUpFile(rel)) continue
        // A backup a restore would refuse is no backup: a file that is not a picture is left
        // out rather than packed under a name that says it is one.
        if (!(await sniffImageFile(join(folder, rel)))) {
          console.warn(`[backup] leaving out ${charFileEntry(charId, rel)}: not an image`)
          continue
        }
        await copyInto(join(folder, rel), join(scratch, charFileEntry(charId, rel)))
      }
    }

    const record: BackupFile = {
      schemaVersion: BACKUP_SCHEMA_VERSION,
      settings,
      grabbags,
      playthroughs,
      saves,
      endingArt,
      characters
    }
    await writeAtomicJson(join(scratch, BACKUP_NAME), record, {
      code: 'BACKUP_UNWRITABLE',
      message: 'Could not write the backup record.'
    })

    // 7-Zip's `a` updates an existing archive, so an old zip must go first.
    await rm(targetPath, { force: true })
    await createZip(scratch, targetPath)
  } catch (err) {
    // A half-written zip is worse than none: it opens, and it is not the player's game.
    await rm(targetPath, { force: true }).catch(() => {})
    throw err
  } finally {
    await discard(scratch)
  }
}

/** Reads the record at the root of an extracted backup, or says why it is not one of ours. */
async function readBackupRecord(dir: string): Promise<BackupFile> {
  return readValidatedJson<BackupFile>(join(dir, BACKUP_NAME), {
    ...BACKUP_READ,
    unreadable: { code: 'BACKUP_UNREADABLE', message: 'Could not read the backup record.' },
    onMissing: () => {
      throw appError(BACKUP_READ.malformed.code, BACKUP_READ.malformed.message, BACKUP_NAME)
    }
  })
}

/** Puts `staged` in place of `/data/saves`, or leaves the folder that is there where it was. */
async function swapSaves(staged: string): Promise<void> {
  const live = getSavesPath()
  const old = scratchDir('saves-old')

  let displaced = false
  try {
    await rename(live, old)
    displaced = true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw appError(RESTORE_FAILED.code, RESTORE_FAILED.message, messageOf(err))
    }
  }

  try {
    await rename(staged, live)
  } catch (err) {
    if (displaced) await rename(old, live).catch(() => {})
    throw appError(RESTORE_FAILED.code, RESTORE_FAILED.message, messageOf(err))
  }

  if (displaced) await discard(old)
}

/**
 * Builds the saves folder the backup describes beside the live one, then swaps the two: every
 * playthrough the backup carries arrives at once, or none of them does.
 */
async function restoreSaves(scratch: string, record: BackupFile): Promise<void> {
  const staged = scratchDir('saves')

  try {
    await mkdir(staged, { recursive: true })

    for (const [playthroughId, playthrough] of Object.entries(record.playthroughs)) {
      if (!SAFE_NUMERIC_ID.test(playthroughId)) continue

      const saves = record.saves.filter(
        (entry) =>
          entry.playthroughId === playthroughId &&
          (entry.saveId === AUTOSAVE_ID || SAFE_NUMERIC_ID.test(entry.saveId))
      )
      // A folder with none of the three is not a playthrough anybody can be put back into.
      if (!playthrough.record && !playthrough.enrollment && saves.length === 0) continue

      const folder = join(staged, playthroughId)
      await mkdir(folder, { recursive: true })

      if (playthrough.record) {
        const name = basename(getPlaythroughRecordPath(playthroughId))
        await writeAtomicJson(join(folder, name), playthrough.record, RESTORE_FAILED)
      }
      if (playthrough.enrollment) {
        const name = basename(getEnrollmentPath(playthroughId))
        await writeAtomicJson(join(folder, name), playthrough.enrollment, RESTORE_FAILED)
      }
      for (const entry of saves) {
        const name = basename(getSaveFilePath(playthroughId, entry.saveId))
        await writeAtomicJson(join(folder, name), entry.save, RESTORE_FAILED)
      }

      if (record.endingArt.includes(playthroughId)) {
        const picture = join(folder, basename(getEndingArtPath(playthroughId)))
        // Named but not in the zip is one missing picture, not a failed restore.
        await rename(join(scratch, endingArtEntry(playthroughId)), picture).catch(
          (err: unknown) => {
            console.warn(`[backup] no graduation picture for ${playthroughId}:`, err)
          }
        )
      }
    }

    await swapSaves(staged)
  } catch (err) {
    await discard(staged)
    throw err
  }
}

/** Merges the backup's characters into `/data/characters`, by id, leaving the rest alone. */
async function restoreCharacters(scratch: string, record: BackupFile): Promise<void> {
  for (const character of record.characters) {
    const charId = character.charId
    if (!SAFE_CHAR_ID.test(charId)) continue

    const folder = join(getCharactersPath(), charId)
    await mkdir(folder, { recursive: true })
    // Written here rather than through `writeCharacter`, which refuses a shipped id: a copy of
    // one under `/data/characters` is simply shadowed, as the copies already there are.
    const name = basename(getCharacterFilePath(charId))
    await writeAtomicJson(join(folder, name), character, RESTORE_FAILED)

    const from = join(scratch, CHARACTERS_DIR, charId)
    for (const rel of await charFilesUnder(from)) {
      if (!isBackedUpFile(rel)) continue
      try {
        await copyInto(join(from, rel), join(folder, rel))
      } catch (err) {
        throw appError(RESTORE_FAILED.code, RESTORE_FAILED.message, messageOf(err))
      }
    }
  }
}

/**
 * Reads one backup back over everything this install holds: settings, grab bags and saves are
 * replaced by the backup's, and its characters are merged in by id.
 */
export async function importBackup(archivePath: string): Promise<void> {
  const scratch = scratchDir('backup')

  try {
    await extractZip(archivePath, scratch, BACKUP_ZIP_LIMITS)
    await checkExtractedContent(scratch, classifyBackupEntry, 'backup')
    const record = await readBackupRecord(scratch)

    // The stored key stays: a backup carries settings as the renderer sees them, so it never
    // carries one. The dev switches and the ComfyUI build stay too, being this install's own;
    // which shipped characters the player took off the roster travels with the backup, through
    // its own writer.
    const {
      apiKeySet: _flag,
      endpointApiKeySet: _endpointFlag,
      schemaVersion: _version,
      removedDefaults,
      freezeSeeds: _seeds,
      editPregens: _pregens,
      forceTime: _clock,
      serviceTier: _tier,
      streamResponses: _stream,
      comfyGpu: _gpu,
      ...patch
    } = record.settings

    await applySettingsPatch(patch)
    await setRemovedDefaults(removedDefaults)
    await setGrabBags(record.grabbags)
    await restoreSaves(scratch, record)
    await restoreCharacters(scratch, record)
  } finally {
    await discard(scratch)
  }
}
