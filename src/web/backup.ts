import type { Application } from '@shared/application'
import {
  applicationsFromBackup,
  BACKUP_NAME,
  BACKUP_READ,
  BACKUP_SCHEMA_VERSION,
  BACKUP_ZIP_LIMITS,
  backgroundEntry,
  backgroundsFromBackup,
  backupName,
  charFileEntry,
  charFileOf,
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
  type BackupFile,
  type BackupPhoto,
  type BackupPlaythrough,
  type BackupReplay,
  type BackupSave,
  type SemesterPicture
} from '@shared/backup'
import { namedRel, storedRel } from '@shared/characterFiles'
import { SAFE_CHAR_ID } from '@shared/characterRules'
import {
  BG_VARIANTS,
  readCustomBackground,
  REQUIRED_BG_VARIANTS,
  type BgVariant,
  type CustomBackground
} from '@shared/customBackgrounds'
import { imageTypeOf } from '@shared/imageBytes'
import { validateRecord } from '@shared/jsonValidate'
import { readLorebookRecord, type LorebookRecord } from '@shared/lorebookRecord'
import { assertSafePhotoId } from '@shared/photos'
import type { ProfileFrame } from '@shared/profilePicture'
import { validateReplay } from '@shared/replays'
import { validateSavedScene, type SavedScene } from '@shared/sceneCreator'
import { readApplicationRecord, SAFE_NUMERIC_ID } from '@shared/saveRules'
import { settingsFromBackup } from '@shared/settingsRules'
import { checkArchiveContent } from '@shared/zipRules'
import { forgetBackgroundUrls } from './backgrounds'
import { imageBlob } from './blob'
import { forgetRels } from './db/chars'
import { database, storage } from './db/open'
import { offerDownload } from './download'
import { revokeAll } from './images'
import { isPackRead, loadCopied } from './copies'
import { buildPack } from './packs'
import { currentSettings, forgetSettings, rendererSettings, rowFor } from './settings'
import { encodeJson, openArchive, packagedRel, pickFile, readJsonEntry, ZIP_TYPE } from './transfer'

/**
 * The player's whole browser storage as one zip. A browser's storage belongs to the host and
 * not to the game — every other game on the same host can clear it — so a copy the player
 * keeps is the only thing standing between them and losing a semester.
 */

/** One blob's bytes. */
async function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer())
}

/** Offers everything the browser is holding as one zip, and answers with its name. */
export async function exportBackup(): Promise<string> {
  const files: Record<string, Uint8Array> = {}

  const record = await storage('read the game data', async () => {
    const db = await database()

    const saves: BackupSave[] = []
    for (const key of await db.getAllKeys('saves')) {
      const save = await db.get('saves', key)
      if (save) saves.push({ playthroughId: key[0], saveId: key[1], save })
    }

    const playthroughs: Record<string, BackupPlaythrough> = {}
    for (const key of await db.getAllKeys('playthroughs')) {
      const row = await db.get('playthroughs', key)
      if (row) playthroughs[key] = row
    }

    // Only a replay some carried save or record names travels; one a restore would refuse costs
    // only itself.
    const replays: BackupReplay[] = []
    for (const { playthroughId, replayId } of namedReplays(saves, playthroughs)) {
      const row = await db.get('replays', [playthroughId, replayId])
      if (row === undefined) continue
      try {
        const replay = validateReplay(row, `${playthroughId}/${replayId}`)
        replays.push({ playthroughId, replayId, replay })
      } catch (err) {
        console.warn(`[backup] leaving out replay ${playthroughId}/${replayId}:`, err)
      }
    }

    // A first semester's picture is kept under its playthrough's id, a later one's under
    // `{playthroughId}.{semesterId}`.
    const endingArt: string[] = []
    const semesterEndingArt: SemesterPicture[] = []
    for (const key of await db.getAllKeys('endingArt')) {
      const art = await db.get('endingArt', key)
      if (!art) continue
      const [playthroughId, semesterId] = String(key).split('.')
      if (semesterId === undefined) {
        endingArt.push(key)
        files[endingArtEntry(key)] = await bytesOf(art)
      } else {
        semesterEndingArt.push({ playthroughId, semesterId })
        files[semesterEndingArtEntry(playthroughId, semesterId)] = await bytesOf(art)
      }
    }

    const profilePictures: string[] = []
    for (const key of await db.getAllKeys('profilePictures')) {
      const picture = await db.get('profilePictures', key)
      if (!picture) continue
      const bytes = await bytesOf(picture)
      // The picture came off the player's own files, so anything whose bytes are not a
      // picture's is left out rather than packed: a backup a restore would refuse is no backup.
      if (!imageTypeOf(bytes)) continue
      profilePictures.push(key)
      files[profilePictureEntry(key)] = bytes
    }

    const profileSources: Record<string, ProfileFrame> = {}
    for (const key of await db.getAllKeys('profileSources')) {
      const source = await db.get('profileSources', key)
      if (!source) continue
      const bytes = await bytesOf(source.image)
      if (!imageTypeOf(bytes)) continue
      profileSources[key] = source.frame
      files[profileSourceEntry(key)] = bytes
    }

    const photos: BackupPhoto[] = []
    for (const key of await db.getAllKeys('photos')) {
      const row = await db.get('photos', key)
      if (!row) continue
      const bytes = await bytesOf(row.image)
      // Bytes that are not a picture's are left out rather than packed under a name that says
      // they are one: a backup a restore would refuse is no backup.
      if (!imageTypeOf(bytes)) continue
      const [playthroughId, photoId] = key
      photos.push({ playthroughId, photoId, meta: row.meta })
      files[photoEntry(playthroughId, photoId)] = bytes
    }

    // A shipped character travels only once the player has changed her; until then she is the
    // build's, record and images alike.
    for (const key of await db.getAllKeys('charFiles')) {
      if (isPackRead(key[0])) continue
      const file = await db.get('charFiles', key)
      if (!file) continue
      const bytes = await bytesOf(file.blob)
      const name = charFileEntry(key[0], packagedRel(key[1], bytes))
      // A backup a restore would refuse is no backup: the loose reference picture and anything
      // whose bytes are not a picture's are left out rather than packed.
      if (classifyBackupEntry(name) !== 'image' || !imageTypeOf(bytes)) continue
      files[name] = bytes
    }

    // Each background goes whole or not at all: a day or a night whose bytes are not a picture's
    // leaves it out, a rain render that is not one leaves out only itself.
    const backgrounds: CustomBackground[] = []
    for (const row of await db.getAll('backgrounds')) {
      // A record a restore would refuse would cost the whole backup, so it costs only itself.
      let background: CustomBackground
      try {
        background = readCustomBackground(row.record, 'backgrounds')
      } catch {
        continue
      }
      const pictures: Partial<Record<BgVariant, Uint8Array>> = {}
      for (const variant of BG_VARIANTS) {
        const blob = row.images?.[variant]
        if (!(blob instanceof Blob)) continue
        const bytes = await bytesOf(blob)
        if (imageTypeOf(bytes)) pictures[variant] = bytes
      }
      if (REQUIRED_BG_VARIANTS.some((variant) => !pictures[variant])) continue
      for (const variant of BG_VARIANTS) {
        const bytes = pictures[variant]
        if (bytes) files[backgroundEntry(background.name, variant)] = bytes
      }
      backgrounds.push(background)
    }

    // A scene a restore would refuse would cost the whole backup, so it costs only itself.
    const scenes: SavedScene[] = []
    for (const key of await db.getAllKeys('scenes')) {
      try {
        scenes.push(validateSavedScene(await db.get('scenes', key), key))
      } catch (err) {
        console.warn(`[backup] leaving out scene ${key}:`, err)
      }
    }

    // A lorebook a restore would refuse would cost the whole backup, so it costs only itself.
    const lorebooks: Record<string, LorebookRecord> = {}
    for (const key of await db.getAllKeys('lorebooks')) {
      try {
        lorebooks[key] = readLorebookRecord(await db.get('lorebooks', key), `lorebooks/${key}`)
      } catch (err) {
        console.warn(`[backup] leaving out lorebook ${key}:`, err)
      }
    }

    // An application a restore would refuse would cost the whole backup, so it costs only itself.
    const applications: Record<string, Application> = {}
    for (const key of await db.getAllKeys('applications')) {
      try {
        applications[key] = readApplicationRecord(
          await db.get('applications', key),
          `applications/${key}`
        )
      } catch (err) {
        console.warn(`[backup] leaving out application ${key}:`, err)
      }
    }

    const backup: BackupFile = {
      schemaVersion: BACKUP_SCHEMA_VERSION,
      settings: await rendererSettings(),
      grabbags: (await db.get('grabbags', 'grabbags')) ?? {},
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
      characters: (await db.getAll('characters')).filter(
        (character) => !isPackRead(character.charId)
      )
    }
    return backup
  })

  files[BACKUP_NAME] = encodeJson(record)
  return offerDownload(backupName(), buildPack(files), ZIP_TYPE)
}

/**
 * Puts a backup back: settings, grab bags, playthroughs, saves and replays replace what is
 * there, and the player's own characters (shipped ones they have changed included), backgrounds and
 * saved scenes are merged in by id and name. One transaction, with every blob built
 * before it opens.
 */
export async function importBackup(): Promise<boolean> {
  const file = await pickFile(`.zip,${ZIP_TYPE}`)
  if (!file) return false

  const entries = openArchive(new Uint8Array(await file.arrayBuffer()), BACKUP_ZIP_LIMITS)
  checkArchiveContent(entries, classifyBackupEntry, 'backup')
  const record = validateRecord<BackupFile>(
    readJsonEntry(entries[BACKUP_NAME], BACKUP_READ.malformed, BACKUP_NAME),
    BACKUP_NAME,
    BACKUP_READ
  )

  // Everything the record says is checked before anything here is written. Remembered keys
  // stay, as do the switches this build fixes and whether it remembers keys at all.
  const settings = rowFor(
    settingsFromBackup(await currentSettings(), record.settings, BACKUP_READ.malformed)
  )
  // Each background is put whole, so a rain render the backup's copy lacks goes with the old one.
  const backgrounds = backgroundsFromBackup(record).flatMap((background) => {
    const images: Partial<Record<BgVariant, Blob>> = {}
    for (const variant of BG_VARIANTS) {
      const bytes = entries[backgroundEntry(background.name, variant)]
      if (bytes && bytes.length > 0) images[variant] = imageBlob(bytes)
    }
    if (REQUIRED_BG_VARIANTS.some((variant) => !images[variant])) {
      console.warn(`[backup] ${background.name} lacks its day or night picture — not restored.`)
      return []
    }
    return [{ record: background, images }]
  })
  const scenes = scenesFromBackup(record)
  const replays = replaysFromBackup(record)
  const lorebooks = lorebooksFromBackup(record)
  const applications = applicationsFromBackup(record)
  const semesterPictures = semesterPicturesFromBackup(record)
  const profileSources = profileSourcesFromBackup(record)
  // Nothing the backup does not name is written: an entry naming a path of its own choosing
  // would put a file where this build never looks for one.
  const updatedAt = Date.now()

  await storage('restore the backup', async () => {
    const db = await database()
    const tx = db.transaction(
      [
        'settings',
        'grabbags',
        'playthroughs',
        'saves',
        'endingArt',
        'profilePictures',
        'profileSources',
        'photos',
        'characters',
        'charFiles',
        'backgrounds',
        'scenes',
        'replays',
        'lorebooks',
        'applications'
      ],
      'readwrite'
    )
    // Every value is in hand, so each step below is a database request and the transaction
    // stays open across all of them.
    void tx.objectStore('settings').put(settings, 'settings')
    void tx.objectStore('grabbags').put(record.grabbags, 'grabbags')

    const playthroughs = tx.objectStore('playthroughs')
    void playthroughs.clear()
    for (const [playthroughId, row] of Object.entries(record.playthroughs)) {
      if (SAFE_NUMERIC_ID.test(playthroughId)) void playthroughs.put(row, playthroughId)
    }

    const saves = tx.objectStore('saves')
    void saves.clear()
    for (const entry of record.saves) {
      void saves.put(entry.save, [entry.playthroughId, entry.saveId])
    }

    const keptReplays = tx.objectStore('replays')
    void keptReplays.clear()
    for (const entry of replays) {
      // A replay goes back only beside a playthrough the backup restores.
      if (!Object.hasOwn(record.playthroughs, entry.playthroughId)) continue
      void keptReplays.put(entry.replay, [entry.playthroughId, entry.replayId])
    }

    const keptLorebooks = tx.objectStore('lorebooks')
    void keptLorebooks.clear()
    for (const [playthroughId, lorebook] of Object.entries(lorebooks)) {
      // A lorebook goes back only beside a playthrough the backup restores.
      if (!Object.hasOwn(record.playthroughs, playthroughId)) continue
      void keptLorebooks.put(lorebook, playthroughId)
    }

    const keptApplications = tx.objectStore('applications')
    void keptApplications.clear()
    for (const [playthroughId, application] of Object.entries(applications)) {
      // An application goes back only beside a playthrough the backup restores.
      if (!Object.hasOwn(record.playthroughs, playthroughId)) continue
      void keptApplications.put(application, playthroughId)
    }

    const art = tx.objectStore('endingArt')
    void art.clear()
    for (const playthroughId of record.endingArt) {
      const bytes = entries[endingArtEntry(playthroughId)]
      if (bytes && SAFE_NUMERIC_ID.test(playthroughId)) {
        void art.put(imageBlob(bytes), playthroughId)
      }
    }
    for (const { playthroughId, semesterId } of semesterPictures) {
      const bytes = entries[semesterEndingArtEntry(playthroughId, semesterId)]
      if (bytes) void art.put(imageBlob(bytes), `${playthroughId}.${semesterId}`)
    }

    const pictures = tx.objectStore('profilePictures')
    void pictures.clear()
    for (const playthroughId of record.profilePictures ?? []) {
      const bytes = entries[profilePictureEntry(playthroughId)]
      if (bytes && SAFE_NUMERIC_ID.test(playthroughId)) {
        void pictures.put(imageBlob(bytes), playthroughId)
      }
    }

    const sources = tx.objectStore('profileSources')
    void sources.clear()
    for (const [playthroughId, frame] of Object.entries(profileSources)) {
      const bytes = entries[profileSourceEntry(playthroughId)]
      // A full picture goes back only beside a playthrough the backup restores.
      if (bytes && Object.hasOwn(record.playthroughs, playthroughId)) {
        void sources.put({ image: imageBlob(bytes), frame }, playthroughId)
      }
    }

    const photos = tx.objectStore('photos')
    void photos.clear()
    for (const entry of record.photos ?? []) {
      if (!SAFE_NUMERIC_ID.test(entry.playthroughId)) continue
      try {
        assertSafePhotoId(entry.photoId)
      } catch {
        continue
      }
      const bytes = entries[photoEntry(entry.playthroughId, entry.photoId)]
      if (!bytes) continue
      void photos.put({ image: imageBlob(bytes), meta: entry.meta }, [
        entry.playthroughId,
        entry.photoId
      ])
    }

    // Merged rather than replaced: a character made since the backup is still the player's. A
    // shipped character comes back as a copy under her own id.
    const characters = tx.objectStore('characters')
    for (const character of record.characters) {
      if (!SAFE_CHAR_ID.test(character.charId)) continue
      void characters.put(character, character.charId)
    }

    // Merged by name, as the characters are by id: one brought in since the backup is still kept.
    const kept = tx.objectStore('backgrounds')
    for (const row of backgrounds) void kept.put(row, row.record.name)

    // Merged by id the same way: a scene saved since the backup is still kept.
    const keptScenes = tx.objectStore('scenes')
    for (const scene of scenes) void keptScenes.put(scene, scene.id)

    const charFiles = tx.objectStore('charFiles')
    for (const [name, bytes] of Object.entries(entries)) {
      const at = charFileOf(name)
      if (!at || bytes.length === 0) continue
      const rel = namedRel(at.rel)
      // An archive holding both twins of one picture keeps the WebP, which a folder reads first.
      const twin = storedRel(at.rel)
      if (twin !== at.rel && (entries[charFileEntry(at.charId, twin)]?.length ?? 0) > 0) continue
      void charFiles.put({ blob: imageBlob(bytes), updatedAt }, [at.charId, rel])
    }

    await tx.done
  })

  forgetSettings()
  forgetRels()
  revokeAll()
  forgetBackgroundUrls()
  // The restore may have brought in copies of shipped characters, and left others as they were.
  await loadCopied()
  return true
}
