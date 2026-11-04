import { create } from 'zustand'
import { roomRel } from '@shared/characterFiles'
import { appError, toAppError } from '@shared/errors'
import { imageTypeOf } from '@shared/imageBytes'
import { LINEUP_MIME_TYPE, LINEUP_QUALITY } from '@shared/lineup'
import { outfitLabelOf } from '@shared/outfits'
import {
  isReaderRow,
  PHOTO_SCHEMA_VERSION,
  PHOTO_THUMB_QUALITY,
  PHOTO_THUMB_SIZE,
  type PhotoBackground,
  type PhotoMeta,
  type PhotoModelChoice,
  type PhotoOptions,
  type PhotoRequest,
  type PhotoRow
} from '@shared/photos'
import { EMOTIONS } from '@shared/emotions'
import { ROOM_PICTURE_MAX } from '@shared/roomPicture'
import { fullNameOf, type AppError, type Character, type WardrobeTarget } from '@shared/types'
import { PHOTO_PROMPT_BRIEF, photoPrompt } from '../prompts/photo'
import { bgUrl, customBackgroundOf } from '../views/bgAssets'
import { loadWardrobeImage, readyOutfitSets } from './characterStore'
import { useGameStore } from './gameStore'
import { stitchLineup, type LineupFrame } from './lineupSheet'
import { blobToBase64, canvasToBase64, canvasToWebpOr } from './loop/encode'
import { readerReference } from './loop/profilePicture'
import { bundledImage, characterImage, customImage, roomOwnerNow } from './loop/thumbnail'
import { retrySilently } from './silentRetry'
import { useUiStore } from './uiStore'

/**
 * The Bunnyboard's photos where they meet the store: the Create Photo modal's draft, every photo
 * still being drawn, the ones that failed waiting for a moment they can be said, and the open
 * playthrough's gallery. Nothing here is reset by leaving a game — a photo sent from one finishes
 * on the menu — and nothing here survives the app closing.
 */

/** What the Create Photo modal is filled in with. */
export interface PhotoDraft {
  rows: PhotoRow[]
  options: PhotoOptions
  /** The player's own words. */
  prompt: string
  /** The place it is set in; absent is none. */
  background?: PhotoBackground
}

/** One photo on its way: the request, built once and re-sent verbatim, and what it is filed as. */
export interface PhotoJob {
  /** Also the photo's id once it is kept. */
  jobId: string
  playthroughId: string
  request: PhotoRequest
  meta: PhotoMeta
  /** The draft it was sent from, which Edit reopens the modal on. */
  draft: PhotoDraft
  startedAt: number
}

/** A photo that did not arrive, or arrived and could not be kept. */
export interface PhotoFailure {
  job: PhotoJob
  error: AppError
  /** The picture itself, when only the write failed: a retry writes it again and pays nothing. */
  bytes?: Uint8Array<ArrayBuffer>
}

/** One photo as the grid draws it. */
export interface GalleryPhoto {
  photoId: string
  meta?: PhotoMeta
  /** The square thumbnail's object URL; null while it is being rebuilt. */
  thumbUrl: string | null
}

interface PhotoStoreState {
  /** The draft Edit or Retake asks Create Photo to open on, per playthrough. */
  drafts: Record<string, PhotoDraft>
  /** The models the stored settings offer, as last asked. */
  choice: PhotoModelChoice | null
  /**
   * Each girl's wardrobes with every expression on disk, her main outfit first, as last read;
   * the nude one is the caller's to withhold.
   */
  wardrobes: Record<string, WardrobeTarget[]>
  /** Every photo still being drawn or written, oldest first. */
  jobs: PhotoJob[]
  /** The job whose Generating modal is up; its photo opens in the viewer when it lands. */
  watching: string | null
  /** The photo a watched job landed as, for the Photos tab to open once. */
  landed: string | null
  /** Asks the Photos tab to open Create Photo on the playthrough's draft — Edit and Retake. */
  composing: boolean
  /** Failures waiting to be said, oldest first. */
  failures: PhotoFailure[]
  /** The open playthrough's photos, newest first; null while no Photos tab is showing. */
  gallery: { playthroughId: string; photos: GalleryPhoto[] } | null

  /** Asks the bridge which models a photo may be drawn on. */
  loadChoice: () => Promise<void>
  /** Reads which wardrobes each of these girls has whole on disk. */
  loadWardrobes: (charIds: readonly string[]) => Promise<void>
  /**
   * Builds the reference pictures and the request from `draft` and sends it, watched: one picture
   * per girl, or one lineup sheet of them all where `maxReferences`, the pictures the model takes,
   * leaves no room for that beside the background. False, with the reason already on screen,
   * where a picture could not be built.
   */
  create: (playthroughId: string, draft: PhotoDraft, maxReferences: number) => Promise<boolean>
  /** Puts a job's Generating modal up, or takes it down (`null`) leaving the job running. */
  watch: (jobId: string | null) => void
  /** Stops one job; a picture it had already been handed is dropped unwritten. */
  cancel: (jobId: string) => Promise<void>
  /** Stops every job of one playthrough and forgets its failures and draft, then settles. */
  cancelFor: (playthroughId: string) => Promise<void>
  /** Stops every job and forgets every failure, then settles. */
  cancelAll: () => Promise<void>
  /** Sends a failed photo again verbatim, or writes it again where only the write failed. */
  retry: (failure: PhotoFailure, watch: boolean) => void
  dismiss: (failure: PhotoFailure) => void
  /** Drops the failure and asks for Create Photo on the draft it was sent from. */
  edit: (failure: PhotoFailure) => void
  /** Asks for Create Photo on a kept photo's own rows, options and words. */
  retake: (playthroughId: string, meta: PhotoMeta) => void
  setComposing: (composing: boolean) => void
  clearLanded: () => void
  /** Reads a playthrough's photos into the grid, rebuilding any thumbnail that is missing. */
  loadGallery: (playthroughId: string) => Promise<void>
  /** Lets go of the grid and every URL behind it. */
  dropGallery: () => void
  deletePhoto: (playthroughId: string, photoId: string) => Promise<void>
  /** One photo's picture for the viewer, or null where it could not be read. */
  readPhoto: (playthroughId: string, photoId: string) => Promise<Uint8Array<ArrayBuffer> | null>
  exportPhoto: (playthroughId: string, photoId: string) => Promise<void>
}

/**
 * The draft a new photo opens on: nobody in it and the brief, drawn the way the playthrough's
 * newest photo was — one still being drawn or one that failed included — or the defaults where
 * it has none. Photo ids are mint timestamps, so the greatest is the newest.
 */
export function newPhotoDraft(playthroughId: string): PhotoDraft {
  const state = usePhotoStore.getState()
  const taken: Array<{ id: string; options: PhotoOptions }> = [
    ...state.jobs
      .filter((job) => job.playthroughId === playthroughId)
      .map((job) => ({ id: job.jobId, options: job.draft.options })),
    ...state.failures
      .filter((failure) => failure.job.playthroughId === playthroughId)
      .map((failure) => ({ id: failure.job.jobId, options: failure.job.draft.options })),
    ...(state.gallery?.playthroughId === playthroughId
      ? state.gallery.photos.flatMap((photo) =>
          photo.meta ? [{ id: photo.photoId, options: photo.meta.options }] : []
        )
      : [])
  ]
  const newest = taken.reduce<{ id: string; options: PhotoOptions } | null>(
    (best, entry) => (best === null || Number(entry.id) > Number(best.id) ? entry : best),
    null
  )
  return {
    rows: [],
    options: newest ? { ...newest.options } : { aspectRatio: '16:9' },
    prompt: PHOTO_PROMPT_BRIEF
  }
}

/** The draft Edit or Retake left for a playthrough, or a new photo's where there is none. */
export function photoDraftOf(playthroughId: string): PhotoDraft {
  return usePhotoStore.getState().drafts[playthroughId] ?? newPhotoDraft(playthroughId)
}

/** The oldest failure of one playthrough, or of any where `playthroughId` is null. */
export function firstPhotoFailure(
  failures: readonly PhotoFailure[],
  playthroughId: string | null
): PhotoFailure | null {
  return (
    failures.find(
      (failure) => playthroughId === null || failure.job.playthroughId === playthroughId
    ) ?? null
  )
}

/** Each job's cancel group, so stopping one stops nothing else. */
function groupOf(jobId: string): string {
  return `photo:${jobId}`
}

/**
 * The failures a silent resend may answer: the ones no vendor bills for. An empty reply, a
 * malformed one or a timeout may have been drawn and charged, so those wait for the player.
 */
function unbilled(code: string): boolean {
  return (
    code === 'LLM_NETWORK' ||
    code === 'LLM_HTTP' ||
    code === 'LLM_RATE_LIMITED' ||
    code === 'LLM_OVERLOADED'
  )
}

/** Every job's settling, so a cancel can wait for the one it stopped. */
const running = new Map<string, Promise<void>>()
/** Jobs whose picture is to be dropped unwritten, whenever it arrives. */
const cancelled = new Set<string>()
/** The backoff sleep a job is parked in, to wake it on a cancel. */
const sleepers = new Map<string, () => void>()
/** The last id minted, so two photos sent in one millisecond still differ. */
let lastMint = 0
/** Every object URL the grid is drawing. */
const galleryUrls = new Set<string>()
/** Bumped by every gallery read, so a slower earlier one cannot land over a later one. */
let galleryReads = 0

/** A fresh photo id: a mint timestamp, like a playthrough's. */
function mintPhotoId(): string {
  lastMint = Math.max(Date.now(), lastMint + 1)
  return String(lastMint)
}

/** An object URL the grid owns, released with the grid. */
function galleryUrl(blob: Blob): string {
  const url = URL.createObjectURL(blob)
  galleryUrls.add(url)
  return url
}

/** Releases one of the grid's URLs. */
function releaseUrl(url: string | null): void {
  if (!url) return
  URL.revokeObjectURL(url)
  galleryUrls.delete(url)
}

/**
 * The picture cut to the grid's square, centred across and from the top down, as a WebP — a JPEG
 * where the browser cannot encode one.
 */
async function cutThumb(bytes: Uint8Array<ArrayBuffer>): Promise<Blob> {
  const bitmap = await createImageBitmap(new Blob([bytes]))
  try {
    const side = Math.min(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = PHOTO_THUMB_SIZE
    canvas.height = PHOTO_THUMB_SIZE
    const ctx = canvas.getContext('2d')
    if (!ctx) throw appError('PHOTO_UNWRITABLE', 'The photo could not be read.')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      0,
      side,
      side,
      0,
      0,
      PHOTO_THUMB_SIZE,
      PHOTO_THUMB_SIZE
    )
    return await canvasToWebpOr(canvas, PHOTO_THUMB_QUALITY, 'image/jpeg')
  } finally {
    bitmap.close()
  }
}

/**
 * One row's frame for the sheet, the reader's being `reader`, the picture read for him; a picture
 * that will not read loads as nothing.
 */
function frameOf(row: PhotoRow, reader: Blob | null): LineupFrame {
  return async () => {
    try {
      if (isReaderRow(row)) return reader ? await createImageBitmap(reader) : null
      return await loadWardrobeImage(row.charId, row.set === 'default' ? null : row.set, row.emotion)
    } catch {
      return null
    }
  }
}

/** What a row's sprite is called in the sentence saying it is missing. */
function spriteWords(row: PhotoRow, character: Character | undefined): string {
  const who = character ? fullNameOf(character) : 'A character'
  const outfit =
    row.set === 'default'
      ? 'main outfit'
      : character
        ? outfitLabelOf(character, row.set)
        : row.set
  return `${who}'s ${row.emotion} sprite in her ${outfit}`
}

/** The background's own picture in its sky: the player's own, a character's room, or the bundle's. */
async function backgroundBytes({ bg, half, rain }: PhotoBackground): Promise<Blob | null> {
  if (customBackgroundOf(bg)) return customImage(bg, rain ? `${half}_rain` : half)
  const owner = roomOwnerNow(bg)
  if (owner) return characterImage(owner, roomRel(half))
  const url = bgUrl(bg, half, rain)
  return url ? bundledImage(url) : null
}

/** The background as a JPEG the model takes, shrunk to the stage where larger; null where it will not read. */
async function backgroundReference(background: PhotoBackground): Promise<string | null> {
  try {
    const blob = await backgroundBytes(background)
    if (!blob) return null
    const bitmap = await createImageBitmap(blob)
    try {
      const scale = Math.min(
        1,
        ROOM_PICTURE_MAX.width / bitmap.width,
        ROOM_PICTURE_MAX.height / bitmap.height
      )
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(bitmap.width * scale))
      canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      return await canvasToBase64(canvas, LINEUP_MIME_TYPE, LINEUP_QUALITY)
    } finally {
      bitmap.close()
    }
  } catch (err) {
    console.warn(`[photo] the background ${background.bg} would not read:`, err)
    return null
  }
}

/** The reader's own picture as a JPEG the model takes, at its own size on black; null where it will not read. */
async function readerJpeg(picture: Blob): Promise<string | null> {
  try {
    const bitmap = await createImageBitmap(picture)
    try {
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(bitmap, 0, 0)
      return await canvasToBase64(canvas, LINEUP_MIME_TYPE, LINEUP_QUALITY)
    } finally {
      bitmap.close()
    }
  } catch (err) {
    console.warn('[photo] the profile picture would not read:', err)
    return null
  }
}

/** Takes one job out of the running list, and its Generating modal down with it. */
function forget(jobId: string): void {
  usePhotoStore.setState((state) => ({
    jobs: state.jobs.filter((job) => job.jobId !== jobId),
    watching: state.watching === jobId ? null : state.watching
  }))
}

/** Files a failure to be said, unless the job was stopped on purpose. */
function fail(job: PhotoJob, error: AppError, bytes?: Uint8Array<ArrayBuffer>): void {
  if (cancelled.has(job.jobId)) return
  forget(job.jobId)
  // Stopped from outside the store: nobody is waiting to hear about it.
  if (error.code === 'CANCELLED') return
  console.warn(`[photo] ${job.jobId} failed:`, error.code, error.message)
  usePhotoStore.setState((state) => ({
    failures: [...state.failures, bytes ? { job, error, bytes } : { job, error }]
  }))
}

/** Cuts the thumbnail and writes the photo beside its playthrough, then shows it where it is open. */
async function keep(job: PhotoJob, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
  let thumb: Blob
  let image: string
  let thumbData: string
  try {
    thumb = await cutThumb(bytes)
    ;[image, thumbData] = await Promise.all([blobToBase64(new Blob([bytes])), blobToBase64(thumb)])
  } catch (err) {
    fail(job, toAppError(err, 'PHOTO_UNWRITABLE'), bytes)
    return
  }
  if (cancelled.has(job.jobId)) return

  const written = await window.api.photos.write(
    job.playthroughId,
    job.jobId,
    image,
    thumbData,
    job.meta
  )
  if (cancelled.has(job.jobId)) return
  if (!written.ok) {
    // Deleted under it: there is nowhere left to keep it, and nobody to tell.
    if (written.error.code === 'PHOTO_PLAYTHROUGH_GONE') {
      forget(job.jobId)
      return
    }
    fail(job, written.error, bytes)
    return
  }

  const watched = usePhotoStore.getState().watching === job.jobId
  forget(job.jobId)
  usePhotoStore.setState((state) => {
    const gallery =
      state.gallery?.playthroughId === job.playthroughId
        ? {
            playthroughId: job.playthroughId,
            photos: [
              { photoId: job.jobId, meta: job.meta, thumbUrl: galleryUrl(thumb) },
              ...state.gallery.photos.filter((photo) => photo.photoId !== job.jobId)
            ]
          }
        : state.gallery
    return watched ? { gallery, landed: job.jobId } : { gallery }
  })
}

/** Sends one job, spending the unbilled silent retries, then keeps or files what came back. */
async function draw(job: PhotoJob): Promise<void> {
  for (let spent = 0; ; spent++) {
    const result = await window.api.photos.generate(job.request, groupOf(job.jobId))
    if (cancelled.has(job.jobId)) return
    if (result.ok) {
      await keep(job, result.data)
      return
    }
    const again = await retrySilently('photo', result.error, spent, {
      retryable: unbilled,
      skip: () => cancelled.has(job.jobId),
      onSleep: (wake) => sleepers.set(job.jobId, wake)
    })
    sleepers.delete(job.jobId)
    if (cancelled.has(job.jobId)) return
    if (!again) {
      fail(job, result.error)
      return
    }
  }
}

/** Runs a job's work, recording its settling for a cancel to wait on. */
function track(jobId: string, work: Promise<void>): void {
  const settled = work
    .catch((err: unknown) => {
      console.warn(`[photo] ${jobId} stopped:`, err)
    })
    .finally(() => {
      if (running.get(jobId) === settled) running.delete(jobId)
    })
  running.set(jobId, settled)
}

/** Stops one job's call and its backoff, and waits for whatever it was doing to settle. */
async function stop(jobId: string): Promise<void> {
  cancelled.add(jobId)
  sleepers.get(jobId)?.()
  void window.api.jobs.cancelGroup(groupOf(jobId))
  await running.get(jobId)
}

export const usePhotoStore = create<PhotoStoreState>((set, get) => ({
  drafts: {},
  choice: null,
  wardrobes: {},
  jobs: [],
  watching: null,
  landed: null,
  composing: false,
  failures: [],
  gallery: null,

  loadChoice: async () => {
    const result = await window.api.photos.options()
    if (!result.ok) {
      console.warn('[photo] no model list:', result.error.message)
      return
    }
    set({ choice: result.data })
  },

  loadWardrobes: async (charIds) => {
    const read = await Promise.all(
      charIds.map(async (charId): Promise<[string, WardrobeTarget[]] | null> => {
        const [main, outfits] = await Promise.all([
          window.api.chars.expressions(charId),
          window.api.chars.outfits(charId)
        ])
        if (!main.ok || !outfits.ok) {
          console.warn(`[photo] could not read the wardrobes of ${charId}`)
          return null
        }
        const whole = EMOTIONS.every((emotion) => main.data[emotion])
        return [charId, [...(whole ? (['default'] as const) : []), ...readyOutfitSets(outfits.data)]]
      })
    )
    set((state) => ({
      wardrobes: {
        ...state.wardrobes,
        ...Object.fromEntries(read.filter((entry) => entry !== null))
      }
    }))
  },

  create: async (playthroughId, draft, maxReferences) => {
    if (draft.rows.length === 0) return false
    const game = useGameStore.getState()

    const unreadable = (index: number): false => {
      const row = draft.rows[index]
      if (isReaderRow(row)) {
        useUiStore
          .getState()
          .showError(
            appError(
              'PHOTO_READER_MISSING',
              'Your profile picture could not be read. Upload it again, or take yourself out of the photo.'
            )
          )
        return false
      }
      useUiStore
        .getState()
        .showError(
          appError(
            'PHOTO_SPRITE_MISSING',
            `${spriteWords(row, game.characters[row.charId])} could not be read. Pick another outfit or expression for her.`
          )
        )
      return false
    }

    const withReader = draft.rows.some(isReaderRow)
    const reader = withReader ? await readerReference(playthroughId) : null

    const background = draft.background
    // The background takes one of the model's pictures, so the girls go as one sheet sooner.
    const each = draft.rows.length <= maxReferences - (background ? 1 : 0)
    const references: string[] = []
    if (each) {
      // One at a time, so a single girl's frame is ever decoded at once.
      for (const [index, row] of draft.rows.entries()) {
        if (isReaderRow(row)) {
          const data = reader ? await readerJpeg(reader) : null
          if (data === null) return unreadable(index)
          references.push(data)
          continue
        }
        const picture = await stitchLineup([frameOf(row, reader)])
        if (!picture || !picture.drawn.includes(0)) return unreadable(index)
        references.push(picture.data)
      }
    } else {
      const sheet = await stitchLineup(draft.rows.map((row) => frameOf(row, reader)))
      const missing = draft.rows.findIndex((_, i) => !sheet?.drawn.includes(i))
      if (!sheet || missing >= 0) return unreadable(Math.max(0, missing))
      references.push(sheet.data)
    }

    let backgroundData: string | null = null
    if (background) {
      backgroundData = await backgroundReference(background)
      if (backgroundData === null) {
        useUiStore
          .getState()
          .showError(
            appError('PHOTO_BACKGROUND_MISSING', 'The background could not be read. Pick another one.')
          )
        return false
      }
    }

    const readerName = fullNameOf({
      firstName: game.playerFirstName,
      lastName: game.playerLastName
    })
    const names = draft.rows.map((row) => {
      if (isReaderRow(row)) return readerName
      const character = game.characters[row.charId]
      return character ? fullNameOf(character) : ''
    })
    const jobId = mintPhotoId()
    const job: PhotoJob = {
      jobId,
      playthroughId,
      request: {
        prompt: photoPrompt(
          draft.prompt,
          names,
          each ? 'each' : 'sheet',
          background !== undefined,
          withReader ? readerName : undefined
        ),
        references,
        ...(backgroundData !== null ? { background: backgroundData } : {}),
        count: draft.rows.length,
        options: draft.options
      },
      meta: {
        schemaVersion: PHOTO_SCHEMA_VERSION,
        date: game.date,
        time: game.time,
        ...(game.semesterIndex > 0 ? { semesterIndex: game.semesterIndex } : {}),
        rows: draft.rows,
        prompt: draft.prompt,
        options: draft.options,
        ...(background ? { background } : {})
      },
      draft,
      startedAt: Date.now()
    }
    set((state) => ({ jobs: [...state.jobs, job], watching: jobId }))
    track(jobId, draw(job))
    return true
  },

  watch: (watching) => set({ watching }),

  cancel: async (jobId) => {
    forget(jobId)
    await stop(jobId)
  },

  cancelFor: async (playthroughId) => {
    const ids = get()
      .jobs.filter((job) => job.playthroughId === playthroughId)
      .map((job) => job.jobId)
    set((state) => {
      const drafts = { ...state.drafts }
      delete drafts[playthroughId]
      return {
        drafts,
        jobs: state.jobs.filter((job) => job.playthroughId !== playthroughId),
        failures: state.failures.filter((failure) => failure.job.playthroughId !== playthroughId),
        watching: state.watching !== null && ids.includes(state.watching) ? null : state.watching
      }
    })
    await Promise.all(ids.map(stop))
  },

  cancelAll: async () => {
    const ids = get().jobs.map((job) => job.jobId)
    set({ jobs: [], failures: [], watching: null })
    await Promise.all(ids.map(stop))
  },

  retry: (failure, watch) => {
    const { job, bytes } = failure
    cancelled.delete(job.jobId)
    set((state) => ({
      failures: state.failures.filter((candidate) => candidate !== failure),
      jobs: [...state.jobs, job],
      watching: watch ? job.jobId : state.watching
    }))
    track(job.jobId, bytes ? keep(job, bytes) : draw(job))
  },

  dismiss: (failure) =>
    set((state) => ({ failures: state.failures.filter((candidate) => candidate !== failure) })),

  edit: (failure) =>
    set((state) => ({
      failures: state.failures.filter((candidate) => candidate !== failure),
      drafts: { ...state.drafts, [failure.job.playthroughId]: failure.job.draft },
      composing: true
    })),

  retake: (playthroughId, meta) =>
    set((state) => ({
      drafts: {
        ...state.drafts,
        [playthroughId]: {
          rows: meta.rows,
          options: meta.options,
          prompt: meta.prompt,
          ...(meta.background ? { background: meta.background } : {})
        }
      },
      composing: true
    })),

  setComposing: (composing) => set({ composing }),

  clearLanded: () => set({ landed: null }),

  loadGallery: async (playthroughId) => {
    const read = ++galleryReads
    const listed = await window.api.photos.list(playthroughId)
    if (read !== galleryReads) return
    if (!listed.ok) {
      console.warn('[photo] could not list the photos:', listed.error.message)
      return
    }

    for (const url of galleryUrls) URL.revokeObjectURL(url)
    galleryUrls.clear()
    set({
      gallery: {
        playthroughId,
        photos: listed.data.map((entry) => ({
          photoId: entry.photoId,
          ...(entry.meta ? { meta: entry.meta } : {}),
          thumbUrl: entry.thumb
            ? galleryUrl(new Blob([entry.thumb], { type: imageTypeOf(entry.thumb) ?? '' }))
            : null
        }))
      }
    })

    // A thumbnail the folder lost, or a backup never carried, is cut again from the picture.
    for (const entry of listed.data) {
      if (entry.thumb) continue
      const picture = await window.api.photos.read(playthroughId, entry.photoId)
      if (read !== galleryReads) return
      if (!picture.ok || !picture.data) continue
      let thumb: Blob
      try {
        thumb = await cutThumb(picture.data)
      } catch (err) {
        console.warn(`[photo] no thumbnail for ${entry.photoId}:`, err)
        continue
      }
      const written = await window.api.photos.writeThumb(
        playthroughId,
        entry.photoId,
        await blobToBase64(thumb)
      )
      if (!written.ok) console.warn(`[photo] could not keep a thumbnail:`, written.error.message)
      if (read !== galleryReads) return
      set((state) => {
        if (state.gallery?.playthroughId !== playthroughId) return state
        return {
          gallery: {
            playthroughId,
            photos: state.gallery.photos.map((photo) =>
              photo.photoId === entry.photoId ? { ...photo, thumbUrl: galleryUrl(thumb) } : photo
            )
          }
        }
      })
    }
  },

  dropGallery: () => {
    galleryReads++
    for (const url of galleryUrls) URL.revokeObjectURL(url)
    galleryUrls.clear()
    set({ gallery: null })
  },

  deletePhoto: async (playthroughId, photoId) => {
    const removed = await window.api.photos.delete(playthroughId, photoId)
    if (!removed.ok) {
      useUiStore.getState().showError(removed.error)
      return
    }
    set((state) => {
      if (state.gallery?.playthroughId !== playthroughId) return state
      const gone = state.gallery.photos.find((photo) => photo.photoId === photoId)
      releaseUrl(gone?.thumbUrl ?? null)
      return {
        gallery: {
          playthroughId,
          photos: state.gallery.photos.filter((photo) => photo.photoId !== photoId)
        }
      }
    })
  },

  readPhoto: async (playthroughId, photoId) => {
    const read = await window.api.photos.read(playthroughId, photoId)
    if (!read.ok) {
      console.warn(`[photo] could not read ${photoId}:`, read.error.message)
      return null
    }
    return read.data
  },

  exportPhoto: async (playthroughId, photoId) => {
    const result = await window.api.photos.export(playthroughId, photoId)
    if (!result.ok) useUiStore.getState().showError(result.error)
  }
}))
