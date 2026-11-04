import { readdir } from 'fs/promises'
import { basename, join } from 'path'
import { isLosslessRel } from '@shared/characterFiles'
import { SAFE_CHAR_ID } from '@shared/characterRules'
import { classifyImportEntry } from '@shared/characterTransfer'
import { isSafeBgName } from '@shared/customBackgrounds'
import { legacyPhotoThumbName, photoIdOfImage, photoThumbName } from '@shared/photos'
import { SAFE_NUMERIC_ID } from '@shared/saveRules'
import type { LegacyImageProgress, LegacyImageReport } from '@shared/types'
import {
  endingArtSemesterOf,
  getBackgroundsPath,
  getCharactersPath,
  getCustomBackgroundPath,
  getEndingArtPath,
  getPhotosPath,
  getPlaythroughPath,
  getProfilePicturePath,
  getProfileSourcePath,
  getSavesPath
} from '../paths'
import { relPathsUnder } from './archiveService'
import { canEncodeWebp, convertImageFile, reasonOf } from './imageFiles'

/**
 * Converts the pictures older builds kept as PNG or JPEG to the WebP every writer now makes:
 * once over the whole data folder at boot, before anything reads it, and over a character's
 * folder as she is imported or duplicated.
 */

/** How many pictures are encoded at once. */
const CONCURRENCY = 4

/** One picture still kept under an older name, and whether it is one of the editor's own. */
interface LegacyImage {
  path: string
  lossless: boolean
}

/** Whether a file is kept under the PNG name a picture is called by, not yet its WebP twin. */
function isPngName(name: string): boolean {
  return name.toLowerCase().endsWith('.png')
}

/** The entries of `dir`, or none where it cannot be read. */
async function namesIn(dir: string): Promise<string[]> {
  return readdir(dir).catch(() => [] as string[])
}

/** Every picture under one character's folder still under a PNG name; a staged run is not hers. */
async function characterImages(dir: string): Promise<LegacyImage[]> {
  const rels = await relPathsUnder(dir).catch(() => [] as string[])
  return rels
    .filter((rel) => isPngName(rel) && classifyImportEntry(rel) === 'image')
    .map((rel) => ({ path: join(dir, rel), lossless: isLosslessRel(rel) }))
}

/** Every one of the player's own characters' older pictures. */
async function ownCharacterImages(): Promise<LegacyImage[]> {
  const root = getCharactersPath()
  const ids = (await namesIn(root)).filter((id) => SAFE_CHAR_ID.test(id))
  return (await Promise.all(ids.map((id) => characterImages(join(root, id))))).flat()
}

/** Every picture of the player's own backgrounds still under a PNG name. */
async function backgroundImages(): Promise<LegacyImage[]> {
  const names = (await namesIn(getBackgroundsPath())).filter(isSafeBgName)
  const found = await Promise.all(
    names.map(async (name) => {
      const folder = getCustomBackgroundPath(name)
      return (await namesIn(folder))
        .filter(isPngName)
        .map((file) => ({ path: join(folder, file), lossless: false }))
    })
  )
  return found.flat()
}

/**
 * One playthrough's older pictures: its graduation pictures, the reader's own, and its photos
 * with their thumbnails, a JPEG under its own name included.
 */
async function playthroughImages(playthroughId: string): Promise<LegacyImage[]> {
  const folder = getPlaythroughPath(playthroughId)
  const ending = basename(getEndingArtPath(playthroughId))
  const profile = basename(getProfilePicturePath(playthroughId))
  const profileSource = basename(getProfileSourcePath(playthroughId))
  const pictures = (await namesIn(folder))
    .filter(
      (name) =>
        isPngName(name) &&
        (name === ending ||
          name === profile ||
          name === profileSource ||
          endingArtSemesterOf(name) !== null)
    )
    .map((name) => ({ path: join(folder, name), lossless: false }))

  const photosDir = getPhotosPath(playthroughId)
  const photos = (await namesIn(photosDir))
    .filter((name) => {
      const id = /^([0-9]+)\./.exec(name)?.[1]
      if (id === undefined) return false
      if (name === legacyPhotoThumbName(id)) return true
      return isPngName(name) && (photoIdOfImage(name) === id || name === photoThumbName(id))
    })
    .map((name) => ({ path: join(photosDir, name), lossless: false }))

  return [...pictures, ...photos]
}

/** Every playthrough's older pictures. */
async function saveImages(): Promise<LegacyImage[]> {
  const ids = (await namesIn(getSavesPath())).filter((id) => SAFE_NUMERIC_ID.test(id))
  return (await Promise.all(ids.map(playthroughImages))).flat()
}

/** A report with nothing in it yet. */
function emptyReport(total: number): LegacyImageReport {
  return {
    total,
    converted: 0,
    dropped: 0,
    left: 0,
    bytesBefore: 0,
    bytesAfter: 0,
    unavailable: false
  }
}

/**
 * Converts `images` a few at a time, tallying each into the report and saying after each how many
 * are done. One picture that fails is left as it is and never stops the rest.
 */
async function convertAll(
  images: readonly LegacyImage[],
  onProgress?: (progress: LegacyImageProgress) => void
): Promise<LegacyImageReport> {
  const report = emptyReport(images.length)
  if (images.length === 0) return report
  if (!(await canEncodeWebp())) return { ...report, left: images.length, unavailable: true }

  let next = 0
  let done = 0
  onProgress?.({ done, total: images.length })
  const worker = async (): Promise<void> => {
    for (let i = next++; i < images.length; i = next++) {
      const image = images[i]
      try {
        const result = await convertImageFile(image.path, image.lossless)
        report[result.outcome] += 1
        report.bytesBefore += result.before
        report.bytesAfter += result.after
      } catch (err) {
        console.warn(`[images] could not convert ${image.path}: ${reasonOf(err)}`)
        report.left += 1
      }
      done += 1
      onProgress?.({ done, total: images.length })
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, images.length) }, worker))
  return report
}

/** Bytes as megabytes, for the log line. */
function mb(bytes: number): string {
  return `${(bytes / 1e6).toFixed(1)} MB`
}

/**
 * Converts every picture the data folder still keeps as PNG or JPEG — the player's own
 * characters, backgrounds, graduation pictures, the reader's pictures and the photos — never
 * the shipped cast, and logs one line of what it did.
 */
export async function convertLegacyImages(
  onProgress: (progress: LegacyImageProgress) => void
): Promise<LegacyImageReport> {
  const images = [
    ...(await ownCharacterImages()),
    ...(await backgroundImages()),
    ...(await saveImages())
  ]
  const report = await convertAll(images, onProgress)
  if (report.total > 0) {
    console.log(
      report.unavailable
        ? `[images] ${report.total} older pictures kept as they are: no WebP encoder`
        : `[images] ${report.converted} pictures converted to WebP, ${report.dropped} stale twins ` +
            `removed, ${report.left} left: ${mb(report.bytesBefore)} became ${mb(report.bytesAfter)}`
    )
  }
  return report
}

/** Converts the older pictures in one character's folder — an import or a duplicate before it is hers. */
export async function convertFolderImages(dir: string): Promise<LegacyImageReport> {
  return convertAll(await characterImages(dir))
}
