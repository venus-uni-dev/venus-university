import { stagedRel, STAGING_DIR } from '@shared/characterFiles'
import { readFile, relsOf } from './db/chars'
import { isShipped, packImages, shippedRels } from './packs'

/**
 * One reader over both places a character's images can be: the pack the game ships with, and
 * the browser's own storage. Which paths she has is the pack's index or her stored keys.
 */

/** Which images one character has, under the names the app asks for them by. */
export async function imageRels(charId: string): Promise<ReadonlySet<string>> {
  return isShipped(charId) ? shippedRels(charId) : relsOf(charId)
}

/** The bytes of one of a character's images, or `null` where she has none under that path. */
export async function imageBytes(
  charId: string,
  rel: string,
  staged = false
): Promise<Uint8Array | null> {
  if (isShipped(charId)) {
    // Nothing stages onto the shipped cast: it is read-only.
    if (staged) return null
    return (await packImages(charId)).get(rel) ?? null
  }

  const blob = await readFile(charId, staged ? stagedRel(rel) : rel)
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null
}

/** Every image a copy of this character carries: hers, with a dead run's staging left behind. */
export async function portableImages(charId: string): Promise<Record<string, Uint8Array>> {
  const files: Record<string, Uint8Array> = {}
  for (const rel of await imageRels(charId)) {
    if (rel.startsWith(`${STAGING_DIR}/`)) continue
    const bytes = await imageBytes(charId, rel)
    if (bytes) files[rel] = bytes
  }
  return files
}
