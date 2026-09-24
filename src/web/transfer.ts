import { unzipSync } from 'fflate'
import {
  CHARACTER_FILE_NAME,
  isCharFileRel,
  namedRel,
  shippedRel,
  STAGING_DIR
} from '@shared/characterFiles'
import { readCharacterRecord } from '@shared/characterRules'
import {
  adoptStamp,
  buildManifest,
  classifyImportEntry,
  exportFileName,
  MANIFEST_MISSING,
  MANIFEST_NAME,
  MANIFEST_UNREADABLE,
  portableOf,
  readManifestRecord,
  stripWrapper
} from '@shared/characterTransfer'
import { appError, messageOf } from '@shared/errors'
import { imageTypeOf } from '@shared/imageBytes'
import { randomId } from '@shared/uuid'
import {
  checkArchiveContent,
  checkZipListing,
  MAX_ZIP_BYTES,
  MAX_ZIP_ENTRIES,
  type ZipEntry
} from '@shared/zipRules'
import type { Character } from '@shared/types'
import { imageBlob } from './blob'
import { getCharacter } from './chars'
import { adoptCharacter, type FileWrite } from './db/chars'
import { offerDownload } from './download'
import { portableImages } from './files'
import { forgetImages } from './images'
import { buildPack, isShipped, packBytes } from './packs'

/** Moving one character between installs, as a zip in the package format both builds read. */

/** What a character package is offered and accepted as. */
export const ZIP_TYPE = 'application/zip'

/** One JSON value as an archive entry. */
export function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value, null, 2))
}

/**
 * Opens the browser's file picker from inside the click that asked for it, and answers `null`
 * where the player picked nothing. Not every browser fires `cancel`, so coming back to the
 * window with an empty picker is the other half of how a dismissal is noticed.
 */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.style.display = 'none'
    document.body.appendChild(input)

    let settled = false
    const done = (file: File | null): void => {
      if (settled) return
      settled = true
      window.removeEventListener('focus', onFocus)
      input.remove()
      resolve(file)
    }
    /** The window coming back: whatever the picker holds a moment later is the answer. */
    const onFocus = (): void => {
      setTimeout(() => done(input.files?.[0] ?? null), 500)
    }

    input.addEventListener('change', () => done(input.files?.[0] ?? null))
    input.addEventListener('cancel', () => done(null))
    // After the click's own focus change, or the picker would answer before it opened.
    setTimeout(() => window.addEventListener('focus', onFocus, { once: true }), 0)
    input.click()
  })
}

/** The archive's listing, read without unpacking a byte of it. */
function listingOf(bytes: Uint8Array): ZipEntry[] {
  const entries: ZipEntry[] = []
  unzipSync(bytes, {
    filter: (file) => {
      entries.push({ path: file.name, size: file.originalSize, attributes: '' })
      return false
    }
  })
  return entries
}

/** Reads one archive, refusing it by the same rules the desktop's unpacker refuses one by. */
export function openArchive(
  bytes: Uint8Array,
  limits: { maxEntries: number; maxTotalBytes: number } = {
    maxEntries: MAX_ZIP_ENTRIES,
    maxTotalBytes: MAX_ZIP_BYTES
  }
): Record<string, Uint8Array> {
  let entries: ZipEntry[]
  try {
    entries = listingOf(bytes)
  } catch (err) {
    throw appError('ZIP_LIST_FAILED', 'That zip could not be read.', messageOf(err))
  }

  const reason = checkZipListing(entries, limits)
  if (reason !== null) {
    throw appError('ZIP_REFUSED', 'That archive holds something it may not.', reason)
  }

  try {
    return unzipSync(bytes)
  } catch (err) {
    throw appError('ZIP_LIST_FAILED', 'That zip could not be read.', messageOf(err))
  }
}

/** The archive's entries with the one wrapper folder a hand-rezipped package has taken off. */
function unwrapped(entries: Record<string, Uint8Array>): Record<string, Uint8Array> {
  const wrapper = stripWrapper(Object.keys(entries))
  if (wrapper === null) return entries

  const prefix = `${wrapper}/`
  const flat: Record<string, Uint8Array> = {}
  for (const [name, data] of Object.entries(entries)) {
    // The wrapper's own row is the folder being taken off, not an entry inside it.
    if (name === wrapper || name === prefix) continue
    if (name.startsWith(prefix)) flat[name.slice(prefix.length)] = data
  }
  return flat
}

/** One JSON entry parsed, under the caller's own name for every way it can fail. */
export function readJsonEntry(
  data: Uint8Array | undefined,
  failure: { code: string; message: string },
  where: string
): unknown {
  if (!data) throw appError(failure.code, failure.message, where)
  try {
    return JSON.parse(new TextDecoder().decode(data)) as unknown
  } catch (err) {
    throw appError(failure.code, failure.message, `${where}: ${messageOf(err)}`)
  }
}

/** The name one image is packaged under: the app's own, or WebP where the bytes are one. */
export function packagedRel(rel: string, bytes: Uint8Array): string {
  return imageTypeOf(bytes) === 'image/webp' ? shippedRel(rel) : rel
}

/** Everything one character's package carries: her images, her record and the marker. */
async function packageOf(character: Character): Promise<Record<string, Uint8Array>> {
  const files: Record<string, Uint8Array> = {}
  for (const [rel, bytes] of Object.entries(await portableImages(character.charId))) {
    // Only what an import takes: the loose reference picture is hers, and is not one of her
    // images, so a package carrying it is one this build would refuse.
    if (classifyImportEntry(rel) !== 'image' || !imageTypeOf(bytes)) continue
    files[packagedRel(rel, bytes)] = bytes
  }
  files[CHARACTER_FILE_NAME] = encodeJson(portableOf(character))
  files[MANIFEST_NAME] = encodeJson(buildManifest(character, new Date().toISOString()))
  return files
}

/** Offers one character as a zip and answers with the name it is offered under. */
export async function exportCharacter(charId: string): Promise<string> {
  const character = await getCharacter(charId)
  // A shipped character's pack already is a package in this format.
  const bytes = isShipped(charId) ? await packBytes(charId) : buildPack(await packageOf(character))
  return offerDownload(exportFileName(character), bytes, ZIP_TYPE)
}

/** The images out of a package, under the names this build keeps them by. */
function imagesOf(entries: Record<string, Uint8Array>): FileWrite[] {
  const files: FileWrite[] = []
  for (const [name, data] of Object.entries(entries)) {
    // Neither is hers: staging is a dead run's images, the marker describes the archive.
    if (name === CHARACTER_FILE_NAME || name === MANIFEST_NAME) continue
    if (name.startsWith(`${STAGING_DIR}/`)) continue
    const rel = namedRel(name)
    // An archive holding both twins of one picture keeps the one already under the stored name.
    if (rel !== name && entries[rel]) continue
    if (!isCharFileRel(rel) || data.length === 0) continue
    files.push({ rel, blob: imageBlob(data) })
  }
  return files
}

/** Adopts a package's character under a fresh identity and keeps every image it carries. */
async function adoptPackage(entries: Record<string, Uint8Array>): Promise<Character> {
  const marker = entries[MANIFEST_NAME]
  readManifestRecord(
    readJsonEntry(marker, marker ? MANIFEST_UNREADABLE : MANIFEST_MISSING, MANIFEST_NAME),
    MANIFEST_NAME
  )

  const charId = randomId()
  const record = readCharacterRecord(
    readJsonEntry(
      entries[CHARACTER_FILE_NAME],
      { code: 'IMPORT_CHARACTER_MISSING', message: 'That export holds no character.' },
      CHARACTER_FILE_NAME
    ),
    CHARACTER_FILE_NAME
  ).character

  // The id is minted here, never read off the package.
  const character = adoptStamp({ ...record, charId }, Date.now())
  await adoptCharacter(character, imagesOf(entries))
  forgetImages(charId)
  return character
}

/** Picks a character zip and adopts it; `null` means the picker was dismissed. */
export async function importCharacter(): Promise<Character | null> {
  const file = await pickFile(`.zip,${ZIP_TYPE}`)
  if (!file) return null

  const entries = unwrapped(openArchive(new Uint8Array(await file.arrayBuffer())))
  checkArchiveContent(entries, classifyImportEntry, 'export')
  return adoptPackage(entries)
}

/** Copies one character under a fresh identity — the import path with the zip taken out. */
export async function duplicateCharacter(charId: string): Promise<Character> {
  const character = await getCharacter(charId)
  const copy = adoptStamp({ ...character, charId: randomId() }, Date.now())

  const files: FileWrite[] = Object.entries(await portableImages(charId)).map(([rel, bytes]) => ({
    rel,
    blob: imageBlob(bytes)
  }))
  await adoptCharacter(copy, files)
  forgetImages(copy.charId)
  return copy
}
