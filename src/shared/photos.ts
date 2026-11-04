import { appError } from './errors'
import { imageExtensionOf, imageTypeOf } from './imageBytes'
import { assertSafeId, type ValidateRecordOptions } from './jsonValidate'
import { THINKING_LEVELS, isImageSize, type ImageModelCaps, type ImageSize, type ThinkingLevel } from './providers'
import { SAFE_NUMERIC_ID } from './saveRules'
import type { Emotion, TimeSlot, WardrobeTarget } from './types'

/**
 * The Bunnyboard's photos: pictures the cloud image model draws of the reader's contacts from their
 * sprites, kept beside the playthrough they were taken in. The rules both builds keep —
 * shapes, file names, and the checks a request and an id pass — live here.
 */

/** The one version of a photo's sidecar this build reads and writes. */
export const PHOTO_SCHEMA_VERSION = 1

/** No roster holds more than twelve girls, and no photo holds more than twelve people. */
export const MAX_PHOTO_CHARACTERS = 12

/** The longest prompt a photo may be sent with. */
export const PHOTO_PROMPT_MAX = 8000

/** The most the player may write in the form, under {@link PHOTO_PROMPT_MAX}. */
export const PHOTO_WORDS_MAX = 6000

/** How long one photo may take before it counts as lost, in ms. */
export const PHOTO_TIMEOUT_MS = 5 * 60_000

/**
 * The square thumbnail the grid draws, in pixels, and the quality it is cut at: WebP, or JPEG
 * where the browser cannot encode WebP.
 */
export const PHOTO_THUMB_SIZE = 384
export const PHOTO_THUMB_QUALITY = 0.85

/** The folder a playthrough's photos sit in, beside its saves. */
export const PHOTOS_DIR = 'photos'

/**
 * The `charId` of the row standing for the reader, whose picture the player uploaded. No character
 * id can match it, and its wardrobe and face are never read.
 */
export const PHOTO_READER_ROW = '@me'

/** Whether a row stands for the reader rather than a girl. */
export function isReaderRow(row: { charId: string }): boolean {
  return row.charId === PHOTO_READER_ROW
}

/** One person in a photo: a girl, in which wardrobe, wearing which face, or the reader. */
export interface PhotoRow {
  charId: string
  set: WardrobeTarget
  emotion: Emotion
}

/** How a photo is drawn; each optional field is sent only where the model takes it. */
export interface PhotoOptions {
  /** The image model picked among the ones the stored settings offer. */
  model?: string
  imageSize?: ImageSize
  aspectRatio: string
  thinkingLevel?: ThinkingLevel
  quality?: string
}

/** The place a photo is set in: a background id as the scene picker names one, in one sky. */
export interface PhotoBackground {
  /** A listed background's name, or a character's room id. */
  bg: string
  half: 'day' | 'night'
  /** The place's rain render rather than its dry picture. */
  rain: boolean
}

/** A photo's sidecar: when it was taken in the game, and everything a retake starts from. */
export interface PhotoMeta {
  schemaVersion: number
  /** The in-game day and half it was taken on. */
  date: number
  time: TimeSlot
  /** Which semester of the playthrough it was taken in, from 0; absent in the first. */
  semesterIndex?: number
  rows: PhotoRow[]
  /** The player's own words. */
  prompt: string
  options: PhotoOptions
  /** The place it was set in, where one was sent. */
  background?: PhotoBackground
}

/** One photo as the model is asked for it: built once, and re-sent verbatim. */
export interface PhotoRequest {
  prompt: string
  /**
   * The reference pictures, JPEGs as base64 with no `data:` prefix: one per row in the rows'
   * order, or one lineup sheet of them all where the model takes too few pictures for that.
   */
  references: string[]
  /** The background picture, a JPEG in the same form, sent after the references. */
  background?: string
  /** How many people are in the photo. */
  count: number
  options: PhotoOptions
}

/** One photo as a playthrough's list answers it; the sidecar and thumbnail only where they read. */
export interface PhotoEntry {
  photoId: string
  meta?: PhotoMeta
  thumb?: Uint8Array<ArrayBuffer>
}

/** The models a photo may be drawn on under the stored settings. */
export interface PhotoModelChoice {
  /** Every model on offer, the default first. */
  models: ImageModelCaps[]
}

/** How a photo's sidecar is checked once it has been parsed. */
export const PHOTO_META_READ: ValidateRecordOptions<PhotoMeta> = {
  label: 'That photo record',
  malformed: { code: 'PHOTO_META_MALFORMED', message: 'That photo record could not be read.' },
  schemaVersion: { code: 'PHOTO_META_SCHEMA_VERSION' },
  expects: PHOTO_SCHEMA_VERSION,
  required: {
    schemaVersion: true,
    date: true,
    time: true,
    rows: true,
    prompt: true,
    options: true
  }
}

/** Rejects a photo id that could escape the folder or key it names: a mint timestamp. */
export function assertSafePhotoId(photoId: string): void {
  assertSafeId(photoId, SAFE_NUMERIC_ID, 'PHOTO_ID_INVALID', 'That photo id is not valid.')
}

/** The picture's own file, by the PNG name every image is called by and stored as its WebP twin. */
export function photoImageName(photoId: string): string {
  return `${photoId}.png`
}

/** The grid's square thumbnail, named and stored as the picture is. */
export function photoThumbName(photoId: string): string {
  return `${photoId}.thumb.png`
}

/** The thumbnail as builds before WebP kept it, a JPEG under its own name. */
export function legacyPhotoThumbName(photoId: string): string {
  return `${photoId}.thumb.jpg`
}

/** The sidecar. */
export function photoMetaName(photoId: string): string {
  return `${photoId}.json`
}

/**
 * The photo id a file in the photos folder is the picture of, or null for any other file; the
 * picture is kept as WebP, or as the PNG name it was given until the boot pass converts it.
 */
export function photoIdOfImage(fileName: string): string | null {
  const match = /^([0-9]+)\.(png|webp)$/.exec(fileName)
  return match ? match[1] : null
}

/** What a saved copy is called, under the extension its bytes actually are. */
export function photoExportName(photoId: string, bytes: Uint8Array): string {
  return `photo-${photoId}.${imageExtensionOf(bytes)}`
}

/** A ratio as both wire formats write one — `16:9`, `9:19.5` — or the word `auto`. */
export function isAspectRatio(value: unknown): value is string {
  return typeof value === 'string' && (value === 'auto' || /^\d{1,2}(\.\d)?:\d{1,2}(\.\d)?$/.test(value))
}

/** A quality word as the Images API lists one. */
function isQuality(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z]{1,16}$/.test(value)
}

/** A model id as either provider writes one: no spaces, no path games beyond a vendor prefix. */
export function isModelId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(value)
}

/** `wanted` where `offered` has it, else `preferred` where it has that, else its first; none when empty. */
function pickFrom<T extends string>(
  offered: readonly T[],
  wanted: T | undefined,
  preferred: T
): T | undefined {
  if (wanted !== undefined && offered.includes(wanted)) return wanted
  if (offered.includes(preferred)) return preferred
  return offered[0]
}

/**
 * `options` fitted to what `caps` takes: every field kept where the model offers it, moved to
 * the model's own default where it does not, and dropped where the model takes no such field.
 */
export function fitPhotoOptions(options: PhotoOptions, caps: ImageModelCaps): PhotoOptions {
  const fitted: PhotoOptions = {
    aspectRatio: pickFrom(caps.aspectRatios, options.aspectRatio, '16:9') ?? '16:9'
  }
  const imageSize = pickFrom(caps.sizes, options.imageSize, '1K')
  if (imageSize) fitted.imageSize = imageSize
  // The model's hardest thought where none is kept: the levels are listed cheapest first.
  const thinkingLevel = pickFrom(
    caps.thinkingLevels,
    options.thinkingLevel,
    caps.thinkingLevels[caps.thinkingLevels.length - 1] ?? 'high'
  )
  if (thinkingLevel) fitted.thinkingLevel = thinkingLevel
  const quality = pickFrom(caps.qualities, options.quality, 'auto')
  if (quality) fitted.quality = quality
  return fitted
}

/** Throws `PHOTO_REQUEST_INVALID` naming the first thing about `request` that cannot be sent. */
export function assertPhotoRequest(
  request: PhotoRequest,
  references: readonly Uint8Array[],
  background?: Uint8Array
): void {
  const refuse = (detail: string): never => {
    throw appError('PHOTO_REQUEST_INVALID', 'That photo could not be sent.', detail)
  }

  const { count, prompt, options } = request
  if (!Number.isInteger(count) || count < 1 || count > MAX_PHOTO_CHARACTERS) {
    refuse(`${String(count)} is not a number of characters.`)
  }
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > PHOTO_PROMPT_MAX) {
    refuse('The prompt is empty or too long.')
  }
  // One sheet, or one picture per girl.
  if (references.length !== 1 && references.length !== count) {
    refuse(`${references.length} reference pictures for ${String(count)} characters.`)
  }
  // Each must be a JPEG before it reaches the model as one.
  if (references.some((reference) => imageTypeOf(reference) !== 'image/jpeg')) {
    refuse('A reference picture is not a JPEG.')
  }
  if (background !== undefined && imageTypeOf(background) !== 'image/jpeg') {
    refuse('The background picture is not a JPEG.')
  }
  if (typeof options !== 'object' || options === null) refuse('No options.')
  if (!isAspectRatio(options.aspectRatio)) refuse(`Aspect ratio ${String(options.aspectRatio)}.`)
  if (options.imageSize !== undefined && !isImageSize(options.imageSize)) {
    refuse(`Resolution ${String(options.imageSize)}.`)
  }
  if (
    options.thinkingLevel !== undefined &&
    !THINKING_LEVELS.includes(options.thinkingLevel)
  ) {
    refuse(`Thinking level ${String(options.thinkingLevel)}.`)
  }
  if (options.quality !== undefined && !isQuality(options.quality)) {
    refuse(`Quality ${String(options.quality)}.`)
  }
  if (options.model !== undefined && !isModelId(options.model)) {
    refuse(`Model ${String(options.model)}.`)
  }
}
