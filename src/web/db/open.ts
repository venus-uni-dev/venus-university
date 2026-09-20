import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { APP_ID } from '@shared/appId'
import type { BackupPlaythrough } from '@shared/backup'
import { appError, messageOf } from '@shared/errors'
import type { Character, GameSave, GrabBags, Settings } from '@shared/types'

/**
 * The browser build's whole disk: one IndexedDB database, one store per kind of file the
 * desktop keeps. Every routine gathers what it needs *before* opening a transaction — a
 * transaction commits itself the moment the microtask queue drains, and anything awaited that
 * isn't a database request drops it.
 */

/** The settings row: everything the desktop file holds, the key only while it is remembered. */
export type StoredSettings = Omit<Settings, 'apiKey'> & { apiKey?: string }

/** One playthrough's row: the record it settled on, or the enrollment still waiting for one. */
export type PlaythroughRow = BackupPlaythrough

/** One of a character's images as the database keeps it. */
interface CharFile {
  blob: Blob
  updatedAt: number
}

/** Every store, the key each one is written under, and what it holds. */
export interface VenusUniversityDb extends DBSchema {
  settings: { key: 'settings'; value: StoredSettings }
  grabbags: { key: 'grabbags'; value: GrabBags }
  playthroughs: { key: string; value: PlaythroughRow }
  saves: { key: [string, string]; value: GameSave }
  endingArt: { key: string; value: Blob }
  characters: { key: string; value: Character }
  charFiles: { key: [string, string]; value: CharFile }
  log: { key: 'log'; value: string }
}

/** The stores this version creates; there is no migration path, as on disk. */
const STORES = [
  'settings',
  'grabbags',
  'playthroughs',
  'saves',
  'endingArt',
  'characters',
  'charFiles',
  'log'
] as const

const DB_VERSION = 1

let opened: Promise<IDBPDatabase<VenusUniversityDb>> | null = null

/** The one database handle, opened on first use. */
export function database(): Promise<IDBPDatabase<VenusUniversityDb>> {
  opened ??= openDB<VenusUniversityDb>(APP_ID, DB_VERSION, {
    upgrade(db) {
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name)
      }
    }
  })
  return opened
}

/** True for the one failure the player can do something about: no room left. */
function isQuota(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'QuotaExceededError'
}

/**
 * Runs one database operation, naming a full browser store as what it is; `what` completes
 * "Could not …".
 */
export async function storage<T>(what: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (err) {
    if (isQuota(err)) {
      throw appError(
        'STORAGE_FULL',
        'There is no room left to save in this browser.',
        `${what}: ${messageOf(err)}`
      )
    }
    throw appError('STORAGE_FAILED', `Could not ${what}.`, messageOf(err))
  }
}

/**
 * The key range covering every `[id, ...]` row of a two-part key: an array sorts after every
 * string, so an empty one is the bound past the last of them.
 */
export function partRange(id: string): IDBKeyRange {
  return IDBKeyRange.bound([id], [id, []])
}
