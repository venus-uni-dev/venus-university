import { mkdir, readFile, rename, rm, utimes, writeFile } from 'fs/promises'
import { basename, dirname, join } from 'path'
import {
  applicationsFromBackup,
  BACKUP_NAME,
  BACKUP_READ,
  BACKUP_SCHEMA_VERSION,
  BACKUP_ZIP_LIMITS,
  backgroundEntry,
  backgroundsFromBackup,
  CHARACTERS_DIR,
  charFileEntry,
  classifyBackupEntry,
  endingArtEntry,
  lorebooksFromBackup,
  namedReplays,
  photoEntry,
  profilePictureEntry,
  profileSourceEntry,
  profileSourcesFromBackup,
  replaysFromBackup,
  scenesFromBackup,
  semesterEndingArtEntry,
  semesterPicturesFromBackup,
  type SemesterPicture,
  type BackupFile,
  type BackupPhoto,
  type BackupPlaythrough,
  type BackupReplay,
  type BackupSave
} from '@shared/backup'
import { isCharFileRel, isStaleTwinRel, STAGING_DIR, storedRel } from '@shared/characterFiles'
import { CHARACTER_NOT_FOUND, SAFE_CHAR_ID } from '@shared/characterRules'
import { BG_VARIANTS, type BgVariant, type CustomBackground } from '@shared/customBackgrounds'
import type { Application } from '@shared/application'
import { appError, messageOf } from '@shared/errors'
import { imageTypeOf } from '@shared/imageBytes'
import type { LorebookRecord } from '@shared/lorebookRecord'
import {
  PROFILE_SOURCE_SCHEMA_VERSION,
  type ProfileFrame,
  type ProfileSourceRecord
} from '@shared/profilePicture'
import { REPLAY_NOT_FOUND } from '@shared/replays'
import { SCENE_NOT_FOUND, type SavedScene } from '@shared/sceneCreator'
import {
  APPLICATION_NOT_FOUND,
  classifySaveId,
  ENROLLMENT_NOT_FOUND,
  listedSaveIds,
  RECORD_NOT_FOUND,
  SAFE_NUMERIC_ID,
  SAVE_NOT_FOUND
} from '@shared/saveRules'
import { settingsFromBackup } from '@shared/settingsRules'
import type { AppError, Character } from '@shared/types'
import {
  castInPlace,
  hasShippedCopy,
  isPregenChar,
  markCopied,
  getApplicationPath,
  getCharacterFilePath,
  getCharacterPath,
  getCharactersPath,
  getEndingArtPath,
  getEnrollmentPath,
  getLorebookPath,
  getPhotoMetaPath,
  getPhotoPath,
  getPhotosPath,
  getPlaythroughRecordPath,
  getProfilePicturePath,
  getProfileSourcePath,
  getProfileSourceRecordPath,
  getReplayPath,
  getReplaysPath,
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
import {
  listCustomBackgrounds,
  readCustomBackgroundImage,
  restoreCustomBackground
} from './backgroundService'
import { getCharacter, ownCharIds } from './characterService'
import { endingArtSemesters, readEndingArt } from './endingArtService'
import { getGrabBags, setGrabBags } from './grabBagService'
import { dropImageTwins, sniffImageFile } from './imageFiles'
import { isHeldError, readValidatedJson, renameWithPatience, writeAtomicJson } from './jsonFile'
import { readLorebook } from './lorebookService'
import { listPhotos, readPhoto } from './photoService'
import { readProfilePicture, readProfileSource } from './profilePictureService'
import { readReplay } from './replayService'
import { listScenes, readScene, writeScene } from './sceneService'
import {
  forgetParsedSaves,
  loadSave,
  playthroughIds,
  readApplication,
  readEnrollment,
  readPlaythroughRecord,
  saveIdsOf
} from './saveService'
import { getRendererSettings, getSettings, replaceSettings } from './settingsService'

/** The data folder as one backup zip, and one backup zip back over the data folder. */

/** What a step of restoring the saves raises when it cannot write where it has to. */
const RESTORE_FAILED = {
  code: 'BACKUP_RESTORE_FAILED',
  message: 'Could not restore saves.'
}

/** What restoring a character raises when it cannot write where it has to. */
const CHARACTERS_RESTORE_FAILED = {
  code: RESTORE_FAILED.code,
  message: 'Could not restore characters.'
}

/** What a restore raises when another process will not let the live saves folder move. */
const SAVES_HELD = {
  code: 'BACKUP_SAVES_HELD',
  message:
    "Couldn't restore saves. Another program may have the saves folder currently open. Close it first, then try again."
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

/**
 * A character's backed-up files out of `rels`, less each PNG whose WebP twin is among them: the
 * WebP is the picture read, and the PNG beside it is stale.
 */
function backedUpFiles(rels: readonly string[]): string[] {
  const present = new Set(rels.map((rel) => rel.toLowerCase()))
  return rels.filter((rel) => isBackedUpFile(rel) && !isStaleTwinRel(rel, present))
}

/**
 * The name a picture out of the backup is restored under: the `.webp` twin of `named` where the
 * bytes at `entry` are WebP, and `named` itself otherwise, for the boot's pass to convert.
 */
async function restoredImageName(entry: string, named: string): Promise<string> {
  return (await sniffImageFile(entry)) === 'image/webp' ? storedRel(named) : named
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

/**
 * Copies the player's own backgrounds into `scratch` and answers the records of the ones it
 * copied. A background goes whole or not at all: a day or a night whose bytes are not a
 * picture's leaves it out, a rain render that is not one leaves out only itself.
 */
async function backupBackgrounds(scratch: string): Promise<CustomBackground[]> {
  const backgrounds: CustomBackground[] = []
  for (const { record, urls } of await listCustomBackgrounds()) {
    const pictures: Partial<Record<BgVariant, Uint8Array>> = {}
    for (const variant of BG_VARIANTS) {
      if (!urls[variant]) continue
      const bytes = await readCustomBackgroundImage(record.name, variant).catch(() => null)
      const entry = backgroundEntry(record.name, variant)
      if (bytes && imageTypeOf(bytes)) pictures[variant] = bytes
      else console.warn(`[backup] leaving out ${entry}: not an image`)
    }
    if (!pictures.day || !pictures.night) continue

    for (const variant of BG_VARIANTS) {
      const bytes = pictures[variant]
      if (!bytes) continue
      const path = join(scratch, backgroundEntry(record.name, variant))
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, bytes)
    }
    backgrounds.push(record)
  }
  return backgrounds
}

/** Every saved scene, whole; one that cannot be read is left out with a warning. */
async function backupScenes(): Promise<SavedScene[]> {
  const scenes: SavedScene[] = []
  for (const { id } of await listScenes()) {
    const scene = await optional(`scene ${id}`, SCENE_NOT_FOUND.code, () => readScene(id))
    if (scene) scenes.push(scene)
  }
  return scenes
}

/**
 * Every replay some carried save or some carried record's semester log names, whole; one that
 * cannot be read is left out with a warning.
 */
async function backupReplays(
  saves: readonly BackupSave[],
  playthroughs: Readonly<Record<string, BackupPlaythrough>>
): Promise<BackupReplay[]> {
  const replays: BackupReplay[] = []
  for (const { playthroughId, replayId } of namedReplays(saves, playthroughs)) {
    const replay = await optional(
      `replay ${playthroughId}/${replayId}`,
      REPLAY_NOT_FOUND.code,
      () => readReplay(playthroughId, replayId)
    )
    if (replay) replays.push({ playthroughId, replayId, replay })
  }
  return replays
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
    const semesterEndingArt: SemesterPicture[] = []
    const profilePictures: string[] = []
    const profileSources: Record<string, ProfileFrame> = {}
    const photos: BackupPhoto[] = []
    const lorebooks: Record<string, LorebookRecord> = {}
    const applications: Record<string, Application> = {}

    for (const playthroughId of await playthroughIds()) {
      playthroughs[playthroughId] = await backupPlaythrough(playthroughId)

      const application = await optional(
        `${playthroughId}'s new game in progress`,
        APPLICATION_NOT_FOUND.code,
        () => readApplication(playthroughId)
      )
      if (application) applications[playthroughId] = application

      // A lorebook the game would refuse is left out rather than carried into a backup a
      // restore would refuse.
      try {
        const lorebook = await readLorebook(playthroughId)
        if (lorebook) lorebooks[playthroughId] = lorebook
      } catch (err) {
        console.warn(`[backup] leaving out ${playthroughId}'s lorebook:`, err)
      }

      for (const saveId of listedSaveIds(await saveIdsOf(playthroughId))) {
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
      for (const semesterId of await endingArtSemesters(playthroughId)) {
        const later = await readEndingArt(playthroughId, semesterId)
        if (!later) continue
        const path = join(scratch, semesterEndingArtEntry(playthroughId, semesterId))
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, later)
        semesterEndingArt.push({ playthroughId, semesterId })
      }

      const picture = await readProfilePicture(playthroughId)
      if (picture) {
        // It came off the player's own files, so its bytes are sniffed like a character's:
        // a backup a restore would refuse is no backup.
        if (imageTypeOf(picture)) {
          const path = join(scratch, profilePictureEntry(playthroughId))
          await mkdir(dirname(path), { recursive: true })
          await writeFile(path, picture)
          profilePictures.push(playthroughId)
        } else {
          console.warn(`[backup] leaving out ${profilePictureEntry(playthroughId)}: not an image`)
        }
      }

      const source = await readProfileSource(playthroughId).catch(() => null)
      // One whose frame will not read is left out, which a restore reads as a crop alone.
      if (source?.frame && imageTypeOf(source.image)) {
        const path = join(scratch, profileSourceEntry(playthroughId))
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, source.image)
        profileSources[playthroughId] = source.frame
      }

      for (const entry of await listPhotos(playthroughId)) {
        const bytes = await readPhoto(playthroughId, entry.photoId).catch(() => null)
        // Bytes that are not a picture's are left out rather than packed under a name that says
        // they are one: a backup a restore would refuse is no backup.
        if (!bytes || !imageTypeOf(bytes)) continue
        const path = join(scratch, photoEntry(playthroughId, entry.photoId))
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, bytes)
        photos.push({ playthroughId, photoId: entry.photoId, meta: entry.meta })
      }
    }

    // The player's own, and the edited copies of the shipped cast: a shipped character who has
    // not been edited is the build's, and an unpackaged run edits the build itself.
    const characters: Character[] = []
    for (const charId of await ownCharIds()) {
      if (isPregenChar(charId) && !hasShippedCopy(charId)) continue
      const character = await optional(`character ${charId}`, CHARACTER_NOT_FOUND.code, () =>
        getCharacter(charId)
      )
      // Only a character whose record was read gets her images.
      if (!character) continue
      characters.push(character)

      const folder = getCharacterPath(charId)
      for (const rel of backedUpFiles(await charFilesUnder(folder))) {
        // A backup a restore would refuse is no backup: a file that is not a picture is left
        // out rather than packed under a name that says it is one.
        if (!(await sniffImageFile(join(folder, rel)))) {
          console.warn(`[backup] leaving out ${charFileEntry(charId, rel)}: not an image`)
          continue
        }
        await copyInto(join(folder, rel), join(scratch, charFileEntry(charId, rel)))
      }
    }

    const backgrounds = await backupBackgrounds(scratch)
    const scenes = await backupScenes()
    const replays = await backupReplays(saves, playthroughs)

    const record: BackupFile = {
      schemaVersion: BACKUP_SCHEMA_VERSION,
      settings,
      grabbags,
      playthroughs,
      saves,
      endingArt,
      ...(semesterEndingArt.length > 0 ? { semesterEndingArt } : {}),
      profilePictures,
      ...(Object.keys(profileSources).length > 0 ? { profileSources } : {}),
      photos,
      backgrounds,
      scenes,
      replays,
      ...(Object.keys(lorebooks).length > 0 ? { lorebooks } : {}),
      ...(Object.keys(applications).length > 0 ? { applications } : {}),
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

/**
 * Puts `staged` in place of `/data/saves`, or leaves the folder that is there where it was. A
 * folder that cannot be moved back stays where it was parked, and the error names it.
 */
async function swapSaves(staged: string): Promise<void> {
  const live = getSavesPath()
  const old = scratchDir('saves-old')

  let displaced = false
  try {
    await renameWithPatience(live, old)
    displaced = true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      const failed = isHeldError(err) ? SAVES_HELD : RESTORE_FAILED
      throw appError(failed.code, failed.message, messageOf(err))
    }
  }

  try {
    await renameWithPatience(staged, live)
  } catch (err) {
    if (displaced) {
      await renameWithPatience(old, live).catch((back: unknown) => {
        throw appError(
          'BACKUP_SAVES_STRANDED',
          `Couldn't restore saves. If they are present at data\\tmp\\${basename(old)}, quit the game and move them to data\\saves.`,
          `${messageOf(err)}\n${messageOf(back)}`
        )
      })
    }
    throw appError(RESTORE_FAILED.code, RESTORE_FAILED.message, messageOf(err))
  }

  if (displaced) await discard(old)
}

/**
 * Builds the saves folder the backup describes beside the live one, then swaps the two: every
 * playthrough the backup carries arrives at once, or none of them does.
 */
async function restoreSaves(
  scratch: string,
  record: BackupFile,
  replays: readonly BackupReplay[],
  semesterPictures: readonly SemesterPicture[],
  lorebooks: Readonly<Record<string, LorebookRecord>>,
  applications: Readonly<Record<string, Application>>,
  profileSources: Readonly<Record<string, ProfileFrame>>
): Promise<void> {
  const staged = scratchDir('saves')

  try {
    await mkdir(staged, { recursive: true })

    for (const [playthroughId, playthrough] of Object.entries(record.playthroughs)) {
      if (!SAFE_NUMERIC_ID.test(playthroughId)) continue

      const saves = record.saves.filter(
        (entry) => entry.playthroughId === playthroughId && classifySaveId(entry.saveId) !== null
      )
      // A folder with none of the four is not a playthrough anybody can be put back into.
      if (
        !playthrough.record &&
        !playthrough.enrollment &&
        !Object.hasOwn(applications, playthroughId) &&
        saves.length === 0
      ) {
        continue
      }

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
      if (Object.hasOwn(applications, playthroughId)) {
        const name = basename(getApplicationPath(playthroughId))
        await writeAtomicJson(join(folder, name), applications[playthroughId], RESTORE_FAILED)
      }
      for (const entry of saves) {
        const path = join(folder, basename(getSaveFilePath(playthroughId, entry.saveId)))
        await writeAtomicJson(path, entry.save, RESTORE_FAILED)
        // The file's write time is the save's own, so the newest file is still the newest save.
        const seconds = entry.save.saveDate / 1000
        await utimes(path, seconds, seconds).catch((err: unknown) => {
          console.warn(`[backup] could not date ${playthroughId}/${entry.saveId}:`, err)
        })
      }

      if (record.endingArt.includes(playthroughId)) {
        const from = join(scratch, endingArtEntry(playthroughId))
        const name = await restoredImageName(from, basename(getEndingArtPath(playthroughId)))
        // Named but not in the zip is one missing picture, not a failed restore.
        await rename(from, join(folder, name)).catch((err: unknown) => {
          console.warn(`[backup] no graduation picture for ${playthroughId}:`, err)
        })
      }

      for (const { semesterId } of semesterPictures.filter(
        (entry) => entry.playthroughId === playthroughId
      )) {
        const from = join(scratch, semesterEndingArtEntry(playthroughId, semesterId))
        const name = await restoredImageName(
          from,
          basename(getEndingArtPath(playthroughId, semesterId))
        )
        // Named but not in the zip is one missing picture, not a failed restore.
        await rename(from, join(folder, name)).catch((err: unknown) => {
          console.warn(`[backup] no graduation picture for ${playthroughId}/${semesterId}:`, err)
        })
      }

      if ((record.profilePictures ?? []).includes(playthroughId)) {
        const from = join(scratch, profilePictureEntry(playthroughId))
        const name = await restoredImageName(from, basename(getProfilePicturePath(playthroughId)))
        await rename(from, join(folder, name)).catch((err: unknown) => {
          console.warn(`[backup] no profile picture for ${playthroughId}:`, err)
        })
      }

      const frame = profileSources[playthroughId] as ProfileFrame | undefined
      if (frame) {
        const from = join(scratch, profileSourceEntry(playthroughId))
        const name = await restoredImageName(from, basename(getProfileSourcePath(playthroughId)))
        // Named but not in the zip is one missing picture, and a frame with no picture is nothing.
        const landed = await rename(from, join(folder, name)).then(
          () => true,
          (err: unknown) => {
            console.warn(`[backup] no full profile picture for ${playthroughId}:`, err)
            return false
          }
        )
        if (landed) {
          const recordPath = join(folder, basename(getProfileSourceRecordPath(playthroughId)))
          const kept: ProfileSourceRecord = { schemaVersion: PROFILE_SOURCE_SCHEMA_VERSION, frame }
          await writeAtomicJson(recordPath, kept, RESTORE_FAILED)
        }
      }

      const ownPhotos = (record.photos ?? []).filter(
        (entry) => entry.playthroughId === playthroughId && SAFE_NUMERIC_ID.test(entry.photoId)
      )
      if (ownPhotos.length > 0) {
        const photosDir = join(folder, basename(getPhotosPath(playthroughId)))
        await mkdir(photosDir, { recursive: true })
        for (const entry of ownPhotos) {
          const from = join(scratch, photoEntry(playthroughId, entry.photoId))
          const name = await restoredImageName(
            from,
            basename(getPhotoPath(playthroughId, entry.photoId))
          )
          // Named but not in the zip is one missing photo, not a failed restore.
          await rename(from, join(photosDir, name)).catch((err: unknown) => {
            console.warn(`[backup] no photo ${entry.photoId} for ${playthroughId}:`, err)
          })
          if (entry.meta) {
            const metaPath = join(photosDir, basename(getPhotoMetaPath(playthroughId, entry.photoId)))
            await writeAtomicJson(metaPath, entry.meta, RESTORE_FAILED)
          }
        }
      }

      if (Object.hasOwn(lorebooks, playthroughId)) {
        const path = join(folder, basename(getLorebookPath(playthroughId)))
        await writeAtomicJson(path, lorebooks[playthroughId], RESTORE_FAILED)
      }

      const ownReplays = replays.filter((entry) => entry.playthroughId === playthroughId)
      if (ownReplays.length > 0) {
        const replaysDir = join(folder, basename(getReplaysPath(playthroughId)))
        await mkdir(replaysDir, { recursive: true })
        for (const entry of ownReplays) {
          const path = join(replaysDir, basename(getReplayPath(playthroughId, entry.replayId)))
          await writeAtomicJson(path, entry.replay, RESTORE_FAILED)
        }
      }
    }

    await swapSaves(staged)
    forgetParsedSaves()
  } catch (err) {
    await discard(staged)
    throw err
  }
}

/**
 * Merges the player's own characters from the backup into `/data/characters`, by id, leaving
 * the rest alone. A shipped character in the backup is an edited copy and lands there as one;
 * an unpackaged run keeps the shipped cast as the build has it.
 */
async function restoreCharacters(scratch: string, record: BackupFile): Promise<void> {
  for (const character of record.characters) {
    const charId = character.charId
    if (!SAFE_CHAR_ID.test(charId)) continue
    const shipped = isPregenChar(charId)
    if (shipped && castInPlace()) continue

    const folder = join(getCharactersPath(), charId)
    // A shipped character is read from her copy only once the copy is whole, so one that fails
    // part way is taken away again rather than left to stand in for her.
    const fresh = shipped && !hasShippedCopy(charId)
    try {
      await mkdir(folder, { recursive: true })
      // Written here rather than through `writeCharacter`, which would stamp a fresh
      // `updatedAt` over the backup's and reorder the grid.
      const name = basename(getCharacterFilePath(charId))
      await writeAtomicJson(join(folder, name), character, CHARACTERS_RESTORE_FAILED)

      const from = join(scratch, CHARACTERS_DIR, charId)
      for (const rel of backedUpFiles(await charFilesUnder(from))) {
        try {
          await copyInto(join(from, rel), join(folder, rel))
          // The restored picture is the one read, not a twin the folder already held.
          await dropImageTwins(join(folder, rel))
        } catch (err) {
          throw appError(
            CHARACTERS_RESTORE_FAILED.code,
            CHARACTERS_RESTORE_FAILED.message,
            messageOf(err)
          )
        }
      }
    } catch (err) {
      if (fresh) await rm(folder, { recursive: true, force: true }).catch(() => {})
      throw err
    }
    if (shipped) markCopied(charId)
  }
}

/**
 * Merges the backup's backgrounds in by name, each replacing whatever was kept under its name,
 * a rain render the backup's copy lacks included.
 */
async function restoreBackgrounds(
  scratch: string,
  backgrounds: readonly CustomBackground[]
): Promise<void> {
  for (const background of backgrounds) {
    const pictures: Partial<Record<BgVariant, Uint8Array>> = {}
    for (const variant of BG_VARIANTS) {
      const path = join(scratch, backgroundEntry(background.name, variant))
      const bytes = await readFile(path).catch(() => null)
      if (bytes && bytes.length > 0) pictures[variant] = bytes
    }
    await restoreCustomBackground(background, pictures)
  }
}

/** Merges the backup's saved scenes in by id, each replacing the scene of its id and no other. */
async function restoreScenes(scenes: readonly SavedScene[]): Promise<void> {
  for (const scene of scenes) await writeScene(scene)
}

/**
 * Reads one backup back over everything this install holds: settings, grab bags and saves are
 * replaced by the backup's — the settings keeping this install's keys and switches — the
 * player's own characters, backgrounds and saved scenes are merged in by id and name, the
 * shipped cast's edited copies among the characters.
 */
export async function importBackup(archivePath: string): Promise<void> {
  const scratch = scratchDir('backup')

  try {
    await extractZip(archivePath, scratch, BACKUP_ZIP_LIMITS)
    await checkExtractedContent(scratch, classifyBackupEntry, 'backup')
    const record = await readBackupRecord(scratch)

    // Everything the record says is checked before anything here is written. The stored keys,
    // the dev switches and the ComfyUI build stay, being this install's own.
    const settings = settingsFromBackup(await getSettings(), record.settings, BACKUP_READ.malformed)
    const backgrounds = backgroundsFromBackup(record)
    const scenes = scenesFromBackup(record)
    const replays = replaysFromBackup(record)
    const semesterPictures = semesterPicturesFromBackup(record)
    const lorebooks = lorebooksFromBackup(record)
    const applications = applicationsFromBackup(record)
    const profileSources = profileSourcesFromBackup(record)

    // The saves go first: they are the step another program can refuse, and one refused here has
    // written nothing the player keeps.
    await restoreSaves(
      scratch,
      record,
      replays,
      semesterPictures,
      lorebooks,
      applications,
      profileSources
    )
    await replaceSettings(settings)
    await setGrabBags(record.grabbags)
    await restoreCharacters(scratch, record)
    await restoreBackgrounds(scratch, backgrounds)
    await restoreScenes(scenes)
  } finally {
    await discard(scratch)
  }
}
