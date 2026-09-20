import { CHARACTER_FILE_NAME, isCharFileRel, STAGING_DIR } from './characterFiles'
import { CHARACTER_SCHEMA_VERSION } from './characterRules'
import { appError } from './errors'
import type { ValidateRecordOptions } from './jsonValidate'
import type { Character } from './types'

/** Moving one character between installs: what the package carries, and what it must say. */

/** The marker file every export carries; an import refuses a package without one. */
export const MANIFEST_NAME = 'manifest.json'

/** The value the manifest's `format` field must hold. */
const MANIFEST_FORMAT = 'venus-university-character'

/** What the marker file says. Only the first two fields are read. */
export interface CharacterManifest {
  /** Fixed string identifying the archive as ours, whatever the file is called. */
  format: typeof MANIFEST_FORMAT
  /** The `Character` schema the export was written against. */
  schemaVersion: number
  /** ISO 8601, informational — nothing branches on it. */
  exportedAt: string
  /** Informational, so a human reading the package knows who is in it. */
  firstName: string
  /** Informational, as above. */
  lastName: string
}

/** How a manifest is checked once it has been read. */
export const MANIFEST_READ: ValidateRecordOptions<CharacterManifest> = {
  label: MANIFEST_NAME,
  malformed: { code: 'IMPORT_MANIFEST_INVALID', message: `${MANIFEST_NAME} is not valid JSON.` },
  schemaVersion: { code: 'IMPORT_SCHEMA_VERSION' },
  expects: CHARACTER_SCHEMA_VERSION,
  required: { format: true }
}

/** Raised when the manifest is there but cannot be read. */
export const MANIFEST_UNREADABLE = {
  code: 'IMPORT_MANIFEST_INVALID',
  message: 'Could not read the export manifest.'
}

/** Raised when the package carries no manifest at all. */
export const MANIFEST_MISSING = {
  code: 'IMPORT_MANIFEST_MISSING',
  message: 'That zip is not a Venus University character export.'
}

/** The marker one export writes, stamped with the schema it was written against. */
export function buildManifest(character: Character, exportedAt: string): CharacterManifest {
  return {
    format: MANIFEST_FORMAT,
    schemaVersion: CHARACTER_SCHEMA_VERSION,
    exportedAt,
    firstName: character.firstName,
    lastName: character.lastName
  }
}

/** Refuses a manifest whose `format` says the package is something else's. */
export function checkManifest(manifest: CharacterManifest): CharacterManifest {
  if (manifest.format !== MANIFEST_FORMAT) {
    throw appError(
      'IMPORT_MANIFEST_INVALID',
      'That zip is not a Venus University character export.',
      String(manifest.format)
    )
  }
  return manifest
}

/** The character record an export carries: hers minus the identity the install she leaves gave her. */
export function portableOf(character: Character): Omit<Character, 'charId'> {
  const { charId: _identity, ...portable } = character
  return portable
}

/**
 * The stamp an arriving character takes: one that kept the source install's would sort as the
 * roster's oldest.
 */
export function adoptStamp(character: Character, adoptedAt: number): Character {
  return { ...character, updatedAt: adoptedAt }
}

/** The name an export is offered under: her name, made safe for a filesystem. */
export function exportFileName(character: Character): string {
  const stem = `${character.firstName}_${character.lastName}`
    .trim()
    .replace(/[^A-Za-z0-9._ -]+/g, '_')
  return `${stem === '' || stem === '_' ? 'character' : stem}.zip`
}

/** What a Mac's zipper adds and no unpacker of ours keeps. */
const MACOS_DIR = '__MACOSX'

/** The names a desktop's file browser leaves in a folder it was asked to zip. */
const DESKTOP_CRUFT = ['.DS_Store', 'Thumbs.db', 'desktop.ini']

/** What an archive carries that no build of ours wrote and every unpack of ours ignores. */
export function isArchiveCruft(name: string): boolean {
  if (name.endsWith('/')) return true
  if (name === MACOS_DIR || name.startsWith(`${MACOS_DIR}/`)) return true
  return DESKTOP_CRUFT.includes(name.slice(name.lastIndexOf('/') + 1))
}

/**
 * The one folder a hand-rezipped package's entries all sit under, or `null` where they sit at
 * its root — the wrapper level an import flattens rather than refuses.
 */
export function stripWrapper(names: readonly string[]): string | null {
  const paths = names
    .map((name) => name.replace(/\\/g, '/').replace(/\/+$/, ''))
    .filter((name) => name !== '' && !isArchiveCruft(name))
  if (paths.length === 0) return null

  const first = paths[0].split('/')[0]
  if (paths.some((path) => path.split('/')[0] !== first)) return null
  // A single top-level file is not a folder anything sits under.
  return paths.some((path) => path.includes('/')) ? first : null
}

/**
 * What one entry of an arriving package is: the record, the marker, a staged run's image, one
 * of her pictures, something the archive carries that no unpack keeps, or something this build
 * never wrote.
 */
export function classifyImportEntry(
  rel: string
): 'record' | 'manifest' | 'staging' | 'image' | 'skip' | 'reject' {
  if (rel === CHARACTER_FILE_NAME) return 'record'
  if (rel === MANIFEST_NAME) return 'manifest'
  if (rel === STAGING_DIR || rel.startsWith(`${STAGING_DIR}/`)) return 'staging'
  if (isArchiveCruft(rel)) return 'skip'
  if (isCharFileRel(rel)) return 'image'
  return 'reject'
}
