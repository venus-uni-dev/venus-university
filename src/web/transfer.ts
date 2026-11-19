import { unzipSync } from 'fflate'
import {
  CHARACTER_FILE_NAME,
  isCharFileRel,
  namedRel,
  storedRel,
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
  memberName,
  packMembers,
  packRefusal,
  portableOf,
  readManifestRecord,
  stripWrapper,
  type RefusedMember
} from '@shared/characterTransfer'
import { appError, messageOf, toAppError } from '@shared/errors'
import { imageTypeOf } from '@shared/imageBytes'
import { randomId } from '@shared/uuid'
import {
  checkArchiveContent,
  checkZipListing,
  MAX_ZIP_BYTES,
  MAX_ZIP_ENTRIES,
  PACK_ZIP_LIMITS,
  type ZipEntry
} from '@shared/zipRules'
import type { Character, CharacterImport } from '@shared/types'
import { imageBlob } from './blob'
import { getCharacter } from './chars'
import { adoptCharacter, type FileWrite } from './db/chars'
import { offerDownload } from './download'
import { portableImages } from './files'
import { forgetImages } from './images'
import { isPackRead } from './copies'
import { buildPack, packBytes } from './packs'

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

/** The archive's listing, or the error saying it could not be read. */
function readListing(bytes: Uint8Array): ZipEntry[] {
  try {
    return listingOf(bytes)
  } catch (err) {
    throw appError('ZIP_LIST_FAILED', 'That zip could not be read.', messageOf(err))
  }
}

/** Refuses a listing by the same rules the desktop's unpacker refuses one by. */
function checkListing(
  entries: readonly ZipEntry[],
  limits: { maxEntries: number; maxTotalBytes: number }
): void {
  const reason = checkZipListing(entries, limits)
  if (reason !== null) {
    throw appError('ZIP_REFUSED', 'That archive holds something it may not.', reason)
  }
}

/** Reads one archive, refusing it by the same rules the desktop's unpacker refuses one by. */
export function openArchive(
  bytes: Uint8Array,
  limits: { maxEntries: number; maxTotalBytes: number } = {
    maxEntries: MAX_ZIP_ENTRIES,
    maxTotalBytes: MAX_ZIP_BYTES
  }
): Record<string, Uint8Array> {
  checkListing(readListing(bytes), limits)

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
  return imageTypeOf(bytes) === 'image/webp' ? storedRel(rel) : rel
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
  // A shipped character still read out of her pack is that pack, already a package in this format.
  const bytes = isPackRead(charId) ? await packBytes(charId) : buildPack(await packageOf(character))
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
    // An archive holding both twins of one picture keeps the WebP, which a folder reads first.
    const twin = storedRel(name)
    if (twin !== name && (entries[twin]?.length ?? 0) > 0) continue
    if (!isCharFileRel(rel) || data.length === 0) continue
    files.push({ rel, blob: imageBlob(data) })
  }
  return files
}

/**
 * Adopts a package's character under a fresh identity, stamped `adoptedAt`, and keeps every
 * image it carries.
 */
async function adoptPackage(
  entries: Record<string, Uint8Array>,
  adoptedAt: number
): Promise<Character> {
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
  const character = adoptStamp({ ...record, charId }, adoptedAt)
  await adoptCharacter(character, imagesOf(entries))
  forgetImages(charId)
  return character
}

/** Adopts one character zip's character, stamped `adoptedAt`. */
async function importPackage(bytes: Uint8Array, adoptedAt: number): Promise<Character> {
  const entries = unwrapped(openArchive(bytes))
  checkArchiveContent(entries, classifyImportEntry, 'export')
  return adoptPackage(entries, adoptedAt)
}

/**
 * Adopts every member of a pack that passes, in name order, and names the rest in one error.
 * Each member is pulled out of the pack on its own, so only one is held beside the pack at once.
 */
async function importPack(
  bytes: Uint8Array,
  listing: readonly ZipEntry[],
  members: readonly string[]
): Promise<CharacterImport> {
  checkListing(listing, PACK_ZIP_LIMITS)

  const characters: Character[] = []
  const refused: RefusedMember[] = []
  const start = Date.now()
  for (const [i, member] of members.entries()) {
    try {
      const data = unzipSync(bytes, { filter: (file) => file.name === member })[member]
      characters.push(await importPackage(data, start + i))
    } catch (err) {
      const error = toAppError(err, 'IMPORT_FAILED')
      console.warn(`[transfer] refused ${memberName(member)}: ${error.code} ${error.message}`)
      refused.push({ name: memberName(member), error })
    }
  }
  return { characters, refused: packRefusal(members.length, refused) }
}

/**
 * Picks a character zip, or a pack of them, and adopts what it holds; `null` means the picker
 * was dismissed.
 */
export async function importCharacter(): Promise<CharacterImport | null> {
  const file = await pickFile(`.zip,${ZIP_TYPE}`)
  if (!file) return null

  const bytes = new Uint8Array(await file.arrayBuffer())
  const listing = readListing(bytes)
  const members = packMembers(listing.map((entry) => entry.path))
  if (members === null) {
    return { characters: [await importPackage(bytes, Date.now())], refused: null }
  }
  return importPack(bytes, listing, members)
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
