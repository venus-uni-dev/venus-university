import { isCharFileRel } from './characterFiles'
import { SAFE_CHAR_ID } from './characterRules'
import { isArchiveCruft } from './characterTransfer'
import type { ValidateRecordOptions } from './jsonValidate'
import { SAFE_NUMERIC_ID } from './saveRules'
import type {
  Character,
  Enrollment,
  GameSave,
  GrabBags,
  PlaythroughRecord,
  RendererSettings
} from './types'

/**
 * Everything one install keeps, as a zip either build writes and reads back. Settings are
 * carried as the renderer sees them, so no backup ever carries the API key.
 */

/** The record at the root of a backup; every image sits beside it under its character. */
export const BACKUP_NAME = 'backup.json'
export const BACKUP_SCHEMA_VERSION = 1

/** Where each kind of file sits inside a backup. */
export const CHARACTERS_DIR = 'characters'
const ENDING_ART_DIR = 'endingArt'
const PROFILE_PICTURES_DIR = 'profilePictures'

/** One save, with where it belongs written beside it. */
export interface BackupSave {
  playthroughId: string
  saveId: string
  save: GameSave
}

/** One playthrough: the record it settled on, or the enrollment still waiting for one. */
export interface BackupPlaythrough {
  record: PlaythroughRecord | null
  enrollment: Enrollment | null
  createdAt: number
}

/** Everything a backup carries beside the images. */
export interface BackupFile {
  schemaVersion: number
  /** As the renderer sees them, so no backup can ever carry the API key. */
  settings: RendererSettings
  grabbags: GrabBags
  playthroughs: Record<string, BackupPlaythrough>
  saves: BackupSave[]
  /** The playthroughs whose graduation picture is in the zip. */
  endingArt: string[]
  /** The playthroughs whose profile picture is in the zip; absent in backups from before it. */
  profilePictures?: string[]
  characters: Character[]
}

/** How a backup is checked once it has been read. */
export const BACKUP_READ: ValidateRecordOptions<BackupFile> = {
  label: BACKUP_NAME,
  malformed: { code: 'BACKUP_MALFORMED', message: 'That zip is not a Venus University backup.' },
  schemaVersion: { code: 'BACKUP_SCHEMA_VERSION' },
  expects: BACKUP_SCHEMA_VERSION,
  required: {
    schemaVersion: true,
    settings: true,
    grabbags: true,
    playthroughs: true,
    saves: true,
    endingArt: true,
    characters: true
  }
}

/**
 * What a backup may hold before a byte of it is unpacked: it carries a whole cast, so the caps
 * a single character export is opened under would refuse one.
 */
export const BACKUP_ZIP_LIMITS = { maxEntries: 16384, maxTotalBytes: 8 * 1024 ** 3 }

/** What a backup is called: `venus-university-backup-<local date>.zip`. */
export function backupName(at = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  const date = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
  return `venus-university-backup-${date}.zip`
}

/** Where one of a character's images sits inside a backup. */
export function charFileEntry(charId: string, rel: string): string {
  return `${CHARACTERS_DIR}/${charId}/${rel}`
}

/** Where one playthrough's graduation picture sits; the PNG bytes keep no extension. */
export function endingArtEntry(playthroughId: string): string {
  return `${ENDING_ART_DIR}/${playthroughId}`
}

/** Where one playthrough's profile picture sits; the PNG bytes keep no extension. */
export function profilePictureEntry(playthroughId: string): string {
  return `${PROFILE_PICTURES_DIR}/${playthroughId}`
}

/** One character image out of a backup: whose it is and where it goes, or null for anything else. */
export function charFileOf(name: string): { charId: string; rel: string } | null {
  if (!name.startsWith(`${CHARACTERS_DIR}/`)) return null
  const rest = name.slice(CHARACTERS_DIR.length + 1)
  const cut = rest.indexOf('/')
  if (cut <= 0) return null

  const charId = rest.slice(0, cut)
  const rel = rest.slice(cut + 1)
  return SAFE_CHAR_ID.test(charId) && isCharFileRel(rel) ? { charId, rel } : null
}

/** Whether `name` is one playthrough's picture in `dir`: a bare playthrough id and nothing under it. */
function isPlaythroughPicture(name: string, dir: string): boolean {
  if (!name.startsWith(`${dir}/`)) return false
  const id = name.slice(dir.length + 1)
  return SAFE_NUMERIC_ID.test(id) && !id.includes('/')
}

/**
 * What one entry of an arriving backup is: the record, one of a character's pictures, a
 * graduation picture or a profile picture, something the archive carries that no unpack keeps,
 * or something this build never wrote.
 */
export function classifyBackupEntry(name: string): 'record' | 'image' | 'skip' | 'reject' {
  if (name === BACKUP_NAME) return 'record'
  if (isArchiveCruft(name)) return 'skip'
  if (charFileOf(name)) return 'image'
  if (isPlaythroughPicture(name, ENDING_ART_DIR)) return 'image'
  if (isPlaythroughPicture(name, PROFILE_PICTURES_DIR)) return 'image'
  return 'reject'
}
