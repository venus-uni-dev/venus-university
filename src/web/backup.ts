import {
  BACKUP_NAME,
  BACKUP_READ,
  BACKUP_SCHEMA_VERSION,
  BACKUP_ZIP_LIMITS,
  backupName,
  charFileEntry,
  charFileOf,
  classifyBackupEntry,
  endingArtEntry,
  profilePictureEntry,
  type BackupFile,
  type BackupPlaythrough,
  type BackupSave
} from '@shared/backup'
import { namedRel } from '@shared/characterFiles'
import { SAFE_CHAR_ID } from '@shared/characterRules'
import { imageTypeOf } from '@shared/imageBytes'
import { validateRecord } from '@shared/jsonValidate'
import { SAFE_NUMERIC_ID } from '@shared/saveRules'
import { checkArchiveContent } from '@shared/zipRules'
import { imageBlob } from './blob'
import { forgetRels } from './db/chars'
import { database, storage } from './db/open'
import { offerDownload } from './download'
import { revokeAll } from './images'
import { buildPack } from './packs'
import { forgetSettings, rendererSettings } from './settings'
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

    const endingArt: string[] = []
    for (const key of await db.getAllKeys('endingArt')) {
      const art = await db.get('endingArt', key)
      if (!art) continue
      endingArt.push(key)
      files[endingArtEntry(key)] = await bytesOf(art)
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

    for (const key of await db.getAllKeys('charFiles')) {
      const file = await db.get('charFiles', key)
      if (!file) continue
      const bytes = await bytesOf(file.blob)
      const name = charFileEntry(key[0], packagedRel(key[1], bytes))
      // A backup a restore would refuse is no backup: the loose reference picture and anything
      // whose bytes are not a picture's are left out rather than packed.
      if (classifyBackupEntry(name) !== 'image' || !imageTypeOf(bytes)) continue
      files[name] = bytes
    }

    const backup: BackupFile = {
      schemaVersion: BACKUP_SCHEMA_VERSION,
      settings: await rendererSettings(),
      grabbags: (await db.get('grabbags', 'grabbags')) ?? {},
      playthroughs,
      saves,
      endingArt,
      profilePictures,
      characters: await db.getAll('characters')
    }
    return backup
  })

  files[BACKUP_NAME] = encodeJson(record)
  return offerDownload(backupName(), buildPack(files), ZIP_TYPE)
}

/**
 * Puts a backup back: settings, grab bags, playthroughs and saves replace what is there, and
 * characters are merged in by id. One transaction, with every blob built before it opens.
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

  // Nothing the backup does not name is written: an entry naming a path of its own choosing
  // would put a file where this build never looks for one.
  const { apiKeySet: _flag, endpointApiKeySet: _endpointFlag, ...settings } = record.settings
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
        'characters',
        'charFiles'
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

    const art = tx.objectStore('endingArt')
    void art.clear()
    for (const playthroughId of record.endingArt) {
      const bytes = entries[endingArtEntry(playthroughId)]
      if (bytes && SAFE_NUMERIC_ID.test(playthroughId)) {
        void art.put(imageBlob(bytes), playthroughId)
      }
    }

    const pictures = tx.objectStore('profilePictures')
    void pictures.clear()
    for (const playthroughId of record.profilePictures ?? []) {
      const bytes = entries[profilePictureEntry(playthroughId)]
      if (bytes && SAFE_NUMERIC_ID.test(playthroughId)) {
        void pictures.put(imageBlob(bytes), playthroughId)
      }
    }

    // Merged rather than replaced: a character made since the backup is still the player's.
    const characters = tx.objectStore('characters')
    for (const character of record.characters) {
      if (SAFE_CHAR_ID.test(character.charId)) void characters.put(character, character.charId)
    }

    const charFiles = tx.objectStore('charFiles')
    for (const [name, bytes] of Object.entries(entries)) {
      const at = charFileOf(name)
      if (!at || bytes.length === 0) continue
      const rel = namedRel(at.rel)
      // An archive holding both twins of one picture keeps the one already under the stored name.
      if (rel !== at.rel && entries[charFileEntry(at.charId, rel)]) continue
      void charFiles.put({ blob: imageBlob(bytes), updatedAt }, [at.charId, rel])
    }

    await tx.done
  })

  forgetSettings()
  forgetRels()
  revokeAll()
  return true
}
