import { appError } from './errors'
import { imageTypeOf } from './imageBytes'

/**
 * What every archive the app opens has to be before a byte of it is unpacked, and what an
 * unpacked archive's entries have to be before they are kept.
 */

/** One row of an archive's listing. */
export interface ZipEntry {
  /** Archive-relative path as 7-Zip prints it. */
  path: string
  /** Uncompressed size in bytes; 0 for a directory row. */
  size: number
  /** 7-Zip's attributes column, empty when it prints none for the row. */
  attributes: string
}

/** Throws `IMPORT_BAD_CONTENT` unless every entry classifies as one this build keeps or ignores. */
export function checkArchiveContent(
  entries: Record<string, Uint8Array>,
  classify: (name: string) => string,
  noun: string
): void {
  for (const [name, data] of Object.entries(entries)) {
    const role = classify(name)
    if (role === 'skip') continue
    if (role === 'reject' || (role === 'image' && !imageTypeOf(data))) {
      throw appError('IMPORT_BAD_CONTENT', `That ${noun} holds a file that is not one of ours.`, name)
    }
  }
}

/** Entries a zip the app opens may hold; a custom node's source tree is about 130. */
export const MAX_ZIP_ENTRIES = 4096

/** Uncompressed bytes a zip the app opens may hold; a character export is 42-67 MB. */
export const MAX_ZIP_BYTES = 512 * 1024 * 1024

/** Basenames Windows reserves for devices, whatever extension follows them. */
const RESERVED_BASENAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`)
])

/** True when a path holds a character no filesystem should be handed. */
function hasControlChar(path: string): boolean {
  return [...path].some((char) => char.charCodeAt(0) < 0x20)
}

/** True when 7-Zip's attributes column carries a Unix mode with `l` in the type position. */
function marksLink(attributes: string): boolean {
  return attributes.split(/\s+/).some((token) => /^l[-rwxsStT]{9}$/.test(token))
}

/**
 * Why an archive may not be unpacked, or null when it may: nothing in it may be absolute,
 * climb out of the destination, repeat a name, be unopenable on Windows or be a link, and
 * the listing as a whole has to fit both caps.
 */
export function checkZipListing(
  entries: readonly ZipEntry[],
  limits: { maxEntries: number; maxTotalBytes: number }
): string | null {
  if (entries.length > limits.maxEntries) {
    return `it holds ${entries.length} entries and the limit is ${limits.maxEntries}`
  }

  let total = 0
  const seen = new Set<string>()

  for (const entry of entries) {
    total += entry.size
    if (total > limits.maxTotalBytes) {
      return `it unpacks to more than ${limits.maxTotalBytes} bytes by ${entry.path}`
    }

    const path = entry.path.replace(/\\/g, '/')
    if (path === '') return 'it holds an entry with no name'
    if (path.startsWith('/')) return `${entry.path} is an absolute path`
    if (/^[A-Za-z]:/.test(path)) return `${entry.path} names a drive`
    if (path.split('/').includes('..')) return `${entry.path} climbs out of the folder`
    if (hasControlChar(path)) return `${entry.path} holds a control character`

    const basename = path.slice(path.lastIndexOf('/') + 1)
    if (RESERVED_BASENAMES.has(basename.split('.')[0].toUpperCase())) {
      return `${entry.path} is named after a Windows device`
    }
    if (/[. ]$/.test(basename)) return `${entry.path} ends in a dot or a space`

    const key = path.toLowerCase()
    if (seen.has(key)) return `${entry.path} appears twice`
    seen.add(key)

    if (marksLink(entry.attributes)) return `${entry.path} is a link`
  }

  return null
}
