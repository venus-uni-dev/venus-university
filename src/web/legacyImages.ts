import type { StoreKey, StoreValue } from 'idb'
import { isLosslessRel } from '@shared/characterFiles'
import { classifyImportEntry } from '@shared/characterTransfer'
import { BG_VARIANTS } from '@shared/customBackgrounds'
import { messageOf } from '@shared/errors'
import type { LegacyImageProgress, LegacyImageReport } from '@shared/types'
import { forgetBackgroundUrls } from './backgrounds'
import { forgetRels } from './db/chars'
import { database, storage, type VenusUniversityDb } from './db/open'
import { revokeAll } from './images'
import { canEncodeWebp, sniffedType, webpOf } from './webp'

/**
 * The boot's one pass over the pictures older builds kept as PNG or JPEG: each of the player's
 * own is re-encoded as WebP, a shipped character's copy among them. Every encode runs outside a
 * transaction and lands in a fresh one only where its row still holds what was read, since a
 * second tab may be running the same pass.
 */

/** How many pictures are encoded at once. */
const CONCURRENCY = 2

/** The stores a picture of the player's own is kept in. */
type PictureStore =
  | 'charFiles'
  | 'photos'
  | 'endingArt'
  | 'profilePictures'
  | 'profileSources'
  | 'backgrounds'

type Key<S extends PictureStore> = StoreKey<VenusUniversityDb, S>
type Row<S extends PictureStore> = StoreValue<VenusUniversityDb, S>

/** One picture as it was read, and how to put its WebP in its place. */
interface StoredPicture {
  /** What a warning calls it. */
  label: string
  blob: Blob
  /** Puts `next` in place of `blob` where its row still holds it, and answers whether it did. */
  replace: (next: Blob) => Promise<boolean>
}

let running: Promise<LegacyImageReport> | null = null

/** Every row of one store with the key it is kept under, both read in one transaction. */
async function rowsOf<S extends PictureStore>(store: S): Promise<[Key<S>, Row<S>][]> {
  return storage('read the pictures', async () => {
    const tx = (await database()).transaction(store)
    const [keys, rows] = await Promise.all([tx.store.getAllKeys(), tx.store.getAll()])
    await tx.done
    return keys.map((key, index): [Key<S>, Row<S>] => [key, rows[index]])
  })
}

/**
 * Rewrites one row in a fresh transaction: `next` answers the row to put back, or `null` where
 * the row no longer holds what was read. Answers whether it wrote.
 */
async function rewrite<S extends PictureStore>(
  store: S,
  key: Key<S>,
  next: (row: Row<S>) => Row<S> | null
): Promise<boolean> {
  return storage('save the converted pictures', async () => {
    const tx = (await database()).transaction(store, 'readwrite')
    // Both are database requests, so the transaction is still open for the put.
    const row = await tx.store.get(key)
    const updated = row === undefined ? null : next(row)
    if (updated !== null) void tx.store.put(updated, key)
    await tx.done
    return updated !== null
  })
}

/** Whether a row still holds the blob that was read, as far as its size and type tell. */
function holds(current: Blob | undefined, read: Blob): boolean {
  return current instanceof Blob && current.size === read.size && current.type === read.type
}

/**
 * The player's own characters' pictures, leaving out a staged run's and the editor's working
 * files, which are kept as they are; a row rewritten since keeps its write time.
 */
async function characterPictures(): Promise<StoredPicture[]> {
  const found: StoredPicture[] = []
  for (const [key, file] of await rowsOf('charFiles')) {
    const [charId, rel] = key
    if (classifyImportEntry(rel) !== 'image' || isLosslessRel(rel)) continue
    found.push({
      label: `${charId}/${rel}`,
      blob: file.blob,
      replace: (next) =>
        rewrite('charFiles', key, (row) =>
          row.updatedAt === file.updatedAt && holds(row.blob, file.blob)
            ? { blob: next, updatedAt: row.updatedAt }
            : null
        )
    })
  }
  return found
}

/** Every photo's picture and its thumbnail. */
async function photoPictures(): Promise<StoredPicture[]> {
  const found: StoredPicture[] = []
  for (const [key, photo] of await rowsOf('photos')) {
    const label = `photos/${key.join('/')}`
    const { image, thumb } = photo
    found.push({
      label,
      blob: image,
      replace: (next) =>
        rewrite('photos', key, (row) => (holds(row.image, image) ? { ...row, image: next } : null))
    })
    if (!thumb) continue
    found.push({
      label: `${label} thumbnail`,
      blob: thumb,
      replace: (next) =>
        rewrite('photos', key, (row) => (holds(row.thumb, thumb) ? { ...row, thumb: next } : null))
    })
  }
  return found
}

/** Every picture a store keeps as a bare blob: the graduation pictures, or the reader's own. */
async function barePictures(store: 'endingArt' | 'profilePictures'): Promise<StoredPicture[]> {
  return (await rowsOf(store)).map(([key, blob]) => ({
    label: `${store}/${key}`,
    blob,
    replace: (next) => rewrite(store, key, (row) => (holds(row, blob) ? next : null))
  }))
}

/** Every full picture the reader's crop was cut from. */
async function profileSourcePictures(): Promise<StoredPicture[]> {
  return (await rowsOf('profileSources')).map(([key, row]) => ({
    label: `profileSources/${key}`,
    blob: row.image,
    replace: (next) =>
      rewrite('profileSources', key, (current) =>
        holds(current.image, row.image) ? { ...current, image: next } : null
      )
  }))
}

/** Every picture of the player's own backgrounds, one per variant. */
async function backgroundPictures(): Promise<StoredPicture[]> {
  const found: StoredPicture[] = []
  for (const [name, background] of await rowsOf('backgrounds')) {
    for (const variant of BG_VARIANTS) {
      const blob = background.images?.[variant]
      if (!(blob instanceof Blob)) continue
      found.push({
        label: `backgrounds/${name}/${variant}`,
        blob,
        replace: (next) =>
          rewrite('backgrounds', name, (row) =>
            holds(row.images?.[variant], blob)
              ? { ...row, images: { ...row.images, [variant]: next } }
              : null
          )
      })
    }
  }
  return found
}

/** The pictures among `pictures` still kept as PNG or JPEG, by their own first bytes. */
async function legacyOf(pictures: StoredPicture[]): Promise<StoredPicture[]> {
  const types = await Promise.all(
    pictures.map((picture) => sniffedType(picture.blob).catch(() => null))
  )
  return pictures.filter(
    (_, index) => types[index] === 'image/png' || types[index] === 'image/jpeg'
  )
}

/** Converts one picture and tallies it; one that fails is left as it is and stops nothing. */
async function convertOne(picture: StoredPicture, report: LegacyImageReport): Promise<void> {
  try {
    const next = await webpOf(picture.blob)
    if (next === null) {
      console.warn(`[images] ${picture.label} could not be re-encoded and is kept as it is.`)
      report.left += 1
      return
    }
    // A row written since it was read keeps what was written.
    if (!(await picture.replace(next))) {
      report.left += 1
      return
    }
    report.converted += 1
    report.bytesBefore += picture.blob.size
    report.bytesAfter += next.size
  } catch (err) {
    console.warn(`[images] could not convert ${picture.label}: ${messageOf(err)}`)
    report.left += 1
  }
}

/** Bytes as megabytes, for the log line. */
function mb(bytes: number): string {
  return `${(bytes / 1e6).toFixed(1)} MB`
}

/** The pass itself: finds every older picture, converts them a few at a time and logs one line. */
async function convertAll(
  onProgress: (progress: LegacyImageProgress) => void
): Promise<LegacyImageReport> {
  const report: LegacyImageReport = {
    total: 0,
    converted: 0,
    dropped: 0,
    left: 0,
    bytesBefore: 0,
    bytesAfter: 0,
    unavailable: false
  }
  if (!(await canEncodeWebp())) return { ...report, unavailable: true }

  const pictures = await legacyOf([
    ...(await characterPictures()),
    ...(await photoPictures()),
    ...(await barePictures('endingArt')),
    ...(await barePictures('profilePictures')),
    ...(await profileSourcePictures()),
    ...(await backgroundPictures())
  ])
  const total = pictures.length
  report.total = total
  if (total === 0) return report

  let next = 0
  let done = 0
  onProgress({ done, total })
  const worker = async (): Promise<void> => {
    for (let i = next++; i < total; i = next++) {
      await convertOne(pictures[i], report)
      done += 1
      onProgress({ done, total })
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, total) }, worker))

  // Nothing minted from the older bytes may outlive them.
  if (report.converted > 0) {
    forgetRels()
    revokeAll()
    forgetBackgroundUrls()
  }
  console.log(
    `[images] ${report.converted} pictures converted to WebP, ${report.left} left: ` +
      `${mb(report.bytesBefore)} became ${mb(report.bytesAfter)}`
  )
  return report
}

/**
 * Converts every picture of the player's own still kept as PNG or JPEG, saying after each how
 * many are done. A browser whose canvas writes no WebP answers at once with nothing done; a
 * second call while one runs shares it.
 */
export function convertLegacyImages(
  onProgress: (progress: LegacyImageProgress) => void
): Promise<LegacyImageReport> {
  running ??= convertAll(onProgress).finally(() => {
    running = null
  })
  return running
}
