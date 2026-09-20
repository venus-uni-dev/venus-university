import { profileRel, stagedRel } from '@shared/characterFiles'
import { imageBlob } from './blob'
import { readFile } from './db/chars'
import { isShipped, packImages, shippedProfileUrl, shippedRels } from './packs'

/**
 * A character's picture in the browser: a blob URL from her shipped pack, or from the browser's
 * own storage for the player's own. The renderer gets a URL at once — a not-yet-fetched image is
 * handed a blank that names it and is filled in as the bytes land.
 */

/** A 1×1 transparent PNG: what an `<img>` shows while its own picture is on its way. */
const BLANK =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII='

/** The registry: one minted URL per image, and `''` for one that is not there at all. */
const urls = new Map<string, string>()

/** Which characters' packs and which single images are being fetched right now. */
const loading = new Set<string>()

/** Which characters' packs have been opened, so an image no pack holds is asked for once. */
const opened = new Set<string>()

/** Where a landed picture is announced, wired at boot; see `boot.ts`. */
let sink: ((charId: string) => void) | null = null

/** Registers what to tell the renderer when a character's pictures arrive. Called once. */
export function setImagesLoadedSink(fn: (charId: string) => void): void {
  sink = fn
}

/** The key one image is registered under, staging included. */
function keyOf(charId: string, rel: string, staged: boolean): string {
  return `${charId}/${staged ? stagedRel(rel) : rel}`
}

/** The blank, carrying the key of the picture it is standing in for. */
function blankFor(key: string): string {
  return `${BLANK}#${key}`
}

/** Mints one image's URL, typed off its own first bytes. */
function mint(key: string, bytes: Uint8Array): void {
  urls.set(key, URL.createObjectURL(imageBlob(bytes)))
}

/**
 * Puts the picture into every `<img>` still showing the blank it was handed. The version bump
 * beside it re-renders every caller that asks for a URL with a sprite version; this is what
 * reaches the ones that ask without.
 */
function fillBlanks(): void {
  for (const image of document.images) {
    if (!image.src.startsWith(`${BLANK}#`)) continue
    const url = urls.get(image.src.slice(BLANK.length + 1))
    if (url) image.src = url
  }
}

/** What a character's pictures having arrived does to what is already on screen. */
function arrived(charId: string): void {
  fillBlanks()
  sink?.(charId)
}

/** Opens one shipped character's pack and mints a URL for every image in it. */
async function openPack(charId: string): Promise<void> {
  if (loading.has(charId) || opened.has(charId)) return
  loading.add(charId)
  try {
    const images = await packImages(charId)
    for (const [rel, bytes] of images) mint(keyOf(charId, rel, false), bytes)
    opened.add(charId)
    arrived(charId)
  } catch (err) {
    console.warn(`[images] ${charId}: could not open her pack —`, err)
  } finally {
    loading.delete(charId)
  }
}

/** Reads one of the player's own images out of storage and mints a URL for it. */
async function openOwn(charId: string, rel: string, staged: boolean): Promise<void> {
  const key = keyOf(charId, rel, staged)
  if (loading.has(key)) return
  loading.add(key)
  try {
    const blob = await readFile(charId, staged ? stagedRel(rel) : rel)
    // An absent picture is recorded as absent, so nothing asks for it twice.
    if (!blob) {
      urls.set(key, '')
      return
    }
    urls.set(key, URL.createObjectURL(blob))
    arrived(charId)
  } catch (err) {
    console.warn(`[images] ${charId}/${rel}: could not be read —`, err)
  } finally {
    loading.delete(key)
  }
}

/**
 * The URL for one of a character's images. `version` is the caller's own cache-buster and
 * changes nothing here: a written image is dropped from the registry by the write itself.
 */
export function resolveImage(
  charId: string,
  rel: string,
  _version: number,
  staged: boolean
): string {
  // The shipped cast is read-only, so it has no staged twin of anything.
  if (isShipped(charId)) {
    // Her portrait is a file of its own, so a roster of faces opens no packs at all.
    if (rel === profileRel()) return shippedProfileUrl(charId) ?? BLANK
    const key = keyOf(charId, rel, false)
    const held = urls.get(key)
    if (held !== undefined) return held === '' ? BLANK : held
    if (!opened.has(charId) && shippedRels(charId).has(rel)) void openPack(charId)
    return blankFor(key)
  }

  const key = keyOf(charId, rel, staged)
  const held = urls.get(key)
  if (held !== undefined) return held === '' ? BLANK : held
  void openOwn(charId, rel, staged)
  return blankFor(key)
}

/** Lets go of one key's minted URL. */
function drop(key: string): void {
  const held = urls.get(key)
  if (held) URL.revokeObjectURL(held)
  urls.delete(key)
}

/**
 * Lets go of what has been minted for one character — one image where `rel` names it, all of
 * hers otherwise — so the next request mints from what storage holds now. Every write calls it.
 */
export function forgetImages(charId: string, rel?: string, staged = false): void {
  if (rel !== undefined) {
    drop(keyOf(charId, rel, staged))
    return
  }
  for (const key of [...urls.keys()]) {
    if (key.startsWith(`${charId}/`)) drop(key)
  }
  opened.delete(charId)
}

/** Lets go of every minted URL. */
export function revokeAll(): void {
  for (const key of [...urls.keys()]) drop(key)
  opened.clear()
}

// A hot reload builds a second registry; the first one's URLs would be held for the session.
import.meta.hot?.dispose(revokeAll)
