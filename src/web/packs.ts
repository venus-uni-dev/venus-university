import { unzipSync, zipSync } from 'fflate'
import { CHARACTER_FILE_NAME, namedRel } from '@shared/characterFiles'
import { readCharacterRecord } from '@shared/characterRules'
import { appError, messageOf } from '@shared/errors'
import { MANIFEST_NAME } from '@shared/characterTransfer'
import type { Character } from '@shared/types'

/**
 * The shipped cast as the browser build carries it: one WebP zip per character, plus a portrait
 * beside it so the roster draws without opening one. Everything imports through the bundler, so
 * every URL is content-hashed and relative to wherever itch serves the game from.
 */

/** What the index says about one shipped character. */
interface PackEntry {
  /** Her images' paths inside the zip, `.webp` where the app's vocabulary says `.png`. */
  files: string[]
  /** The zip's exact size, which the fetch is checked against before it is opened. */
  bytes: number
}

/** The index the build writes beside the packs. */
interface PackIndex {
  schemaVersion: number
  chars: Record<string, PackEntry>
}

/** The one schema this build reads. */
const PACK_SCHEMA_VERSION = 1

/**
 * A glob rather than a plain import for each of these: the packs are built by the release
 * script, and the tree has to compile before that has ever run.
 */
const INDEX_JSON = import.meta.glob<PackIndex>('../../build/web-assets/packs/*.json', {
  eager: true,
  import: 'default'
})
const CHARACTERS_JSON = import.meta.glob<Record<string, Character>>(
  '../../build/web-assets/*.json',
  { eager: true, import: 'default' }
)
const PACK_URLS = import.meta.glob<string>('../../build/web-assets/packs/*.zip', {
  eager: true,
  query: '?url',
  import: 'default'
})
const PROFILE_URLS = import.meta.glob<string>('../../build/web-assets/profiles/*.webp', {
  eager: true,
  query: '?url',
  import: 'default'
})

/** A glob's entries re-keyed by bare file name without its extension. */
function byStem<T>(entries: Record<string, T>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(entries).map(([path, value]) => {
      const name = path.slice(path.lastIndexOf('/') + 1)
      return [name.slice(0, name.lastIndexOf('.')), value]
    })
  )
}

const packUrls = byStem(PACK_URLS)
const profileUrls = byStem(PROFILE_URLS)

/** Raised wherever the build's own files are not there to read. */
function missing(what: string): never {
  throw appError(
    'PACKS_MISSING',
    'The characters this game ships with are not in this build.',
    what
  )
}

const index = byStem(INDEX_JSON).index
const shipped = byStem(CHARACTERS_JSON).characters

/** The index, refused where the build wrote one this app cannot read. */
function packIndex(): PackIndex {
  if (!index) missing('packs/index.json')
  if (index.schemaVersion !== PACK_SCHEMA_VERSION) {
    missing(`packs/index.json has schemaVersion ${String(index.schemaVersion)}`)
  }
  return index
}

/** Every charId the game ships with, in the order the build wrote them. */
export function shippedCharIds(): string[] {
  return Object.keys(packIndex().chars)
}

/** True for a character the game ships with. */
export function isShipped(charId: string): boolean {
  return charId in packIndex().chars
}

/**
 * Every shipped character's record, each carrying the id it is keyed under. The bundled records
 * are checked like any other, in memory only, so a pack built by an older release still reads
 * as current; one that is refused is skipped.
 */
export function shippedCharacters(): Character[] {
  if (!shipped) missing('characters.json')
  const characters: Character[] = []
  for (const charId of shippedCharIds()) {
    try {
      characters.push({ ...readCharacterRecord(shipped[charId], charId).character, charId })
    } catch (err) {
      console.warn(`[characters] skipping "${charId}":`, err)
    }
  }
  return characters
}

/**
 * One shipped character's record, checked like any other in memory so a pack built by an older
 * release still reads as current.
 */
export function shippedCharacter(charId: string): Character {
  if (!shipped?.[charId]) missing(`characters.json has no ${charId}`)
  return { ...readCharacterRecord(shipped[charId], charId).character, charId }
}

/** Which images one shipped character has, under the names the app asks for them by. */
export function shippedRels(charId: string): ReadonlySet<string> {
  const entry = packIndex().chars[charId]
  return new Set((entry?.files ?? []).map(namedRel))
}

/** Her portrait's own URL, so a roster of faces costs no packs at all. */
export function shippedProfileUrl(charId: string): string | null {
  return profileUrls[charId] ?? null
}

/** Whichever packs have been fetched, by charId. */
const fetched = new Map<string, Promise<Uint8Array>>()

/** One shipped character's pack, exactly as the build wrote it. Fetched once. */
export function packBytes(charId: string): Promise<Uint8Array> {
  const held = fetched.get(charId)
  if (held) return held

  const entry = packIndex().chars[charId]
  const url = packUrls[charId]
  if (!entry || !url) missing(`packs/${charId}.zip`)

  const loading = (async () => {
    let buffer: ArrayBuffer
    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      buffer = await response.arrayBuffer()
    } catch (err) {
      throw appError('PACK_UNREADABLE', 'Could not load that character.', messageOf(err))
    }
    if (buffer.byteLength !== entry.bytes) {
      throw appError(
        'PACK_UNREADABLE',
        'Could not load that character.',
        `${charId}.zip is ${buffer.byteLength} bytes and should be ${entry.bytes}`
      )
    }
    return new Uint8Array(buffer)
  })()

  // A failed fetch is not kept, so a later call tries again.
  const kept = loading.catch((err: unknown) => {
    fetched.delete(charId)
    throw err
  })
  fetched.set(charId, kept)
  return kept
}

/** One shipped character's images, by the names the app asks for them by. */
export async function packImages(charId: string): Promise<Map<string, Uint8Array>> {
  const bytes = await packBytes(charId)
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(bytes)
  } catch (err) {
    throw appError('PACK_UNREADABLE', 'Could not load that character.', messageOf(err))
  }

  const images = new Map<string, Uint8Array>()
  for (const [name, data] of Object.entries(entries)) {
    // The record and the marker are the package's, not hers.
    if (name === CHARACTER_FILE_NAME || name === MANIFEST_NAME || data.length === 0) continue
    images.set(namedRel(name), data)
  }
  return images
}

/** Packs the files of a character into the one package format both builds read. */
export function buildPack(files: Record<string, Uint8Array>): Uint8Array {
  // Level 0: the art is already compressed, and a stored zip is what the desktop importer
  // and the shipped packs both are.
  return zipSync(files, { level: 0 })
}
