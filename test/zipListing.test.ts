import { describe, expect, it } from 'vitest'
import { checkZipListing, type ZipEntry } from '../src/shared/zipRules'

/**
 * The gate every zip the app opens passes before a byte of it is unpacked. The
 * character import reads a file nobody in this build wrote, so an entry that escapes its
 * folder overwrites whatever it names and one that never ends fills the disk.
 */

/** One listing row; a directory row is size 0, and 7-Zip prints no attributes for most files. */
function entry(path: string, size = 0, attributes = ''): ZipEntry {
  return { path, size, attributes }
}

const LIMITS = { maxEntries: 8, maxTotalBytes: 1000 }

/** What a real export's listing looks like: a wrapper folder and the files under it. */
const EXPORT: ZipEntry[] = [
  entry('Mina_Aoki', 0, 'D'),
  entry('Mina_Aoki/manifest.json', 120),
  entry('Mina_Aoki/character.json', 400),
  entry('Mina_Aoki/expressions', 0, 'D'),
  entry('Mina_Aoki/expressions/neutral.png', 300)
]

describe('checkZipListing', () => {
  it('accepts a listing an export would write', () => {
    expect(checkZipListing(EXPORT, LIMITS)).toBeNull()
  })

  it('refuses a name that repeats in a different case', () => {
    const entries = [...EXPORT, entry('mina_aoki/CHARACTER.JSON', 5)]
    expect(checkZipListing(entries, LIMITS)).toContain('appears twice')
  })

  it('refuses a path that climbs out of the destination', () => {
    expect(checkZipListing([entry('../escaped.txt', 7)], LIMITS)).toContain('climbs out')
  })

  it('refuses an absolute path', () => {
    expect(checkZipListing([entry('/abs', 7)], LIMITS)).toContain('absolute')
    expect(checkZipListing([entry('C:/abs', 7)], LIMITS)).toContain('drive')
    expect(checkZipListing([entry('\\\\server\\share\\x', 7)], LIMITS)).toContain('absolute')
  })

  it('refuses a name Windows reserves for a device', () => {
    expect(checkZipListing([entry('a/CON.txt', 7)], LIMITS)).toContain('Windows device')
  })

  it('refuses more entries than the cap allows', () => {
    const many = Array.from({ length: 9 }, (_, i) => entry(`f${i}`, 1))
    expect(checkZipListing(many, LIMITS)).toContain('9 entries')
  })

  it('refuses on the running total, naming the entry that crosses it', () => {
    const entries = [entry('a', 600), entry('b', 300), entry('c', 200)]
    expect(checkZipListing(entries, LIMITS)).toContain('by c')
  })

  it('accepts a total that stops just under the cap', () => {
    expect(checkZipListing([entry('a', 600), entry('b', 399)], LIMITS)).toBeNull()
  })

  it('refuses an entry whose attributes make it a link', () => {
    expect(checkZipListing([entry('pwned', 53, 'lrwxrwxrwx')], LIMITS)).toContain('is a link')
  })
})
