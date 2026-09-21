import { appError } from '@shared/errors'
import type { BuildManifest, FileStamp, UpdatePlan } from '@shared/types'

/**
 * The pure half of updating: how two version strings compare, what the channel's reply says,
 * and which files an update puts in place and takes away. No electron, no disk.
 */

/** One dotted part as a number; anything that is not one reads as 0. */
function partAt(parts: readonly string[], index: number): number {
  const value = Number.parseInt(parts[index] ?? '0', 10)
  return Number.isNaN(value) ? 0 : value
}

/** Numeric dotted compare, missing parts read as 0, so `1.0` and `1.0.0` are one version. */
export function compareVersions(a: string, b: string): number {
  const left = a.split('.')
  const right = b.split('.')
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const difference = partAt(left, index) - partAt(right, index)
    if (difference !== 0) return difference < 0 ? -1 : 1
  }
  return 0
}

/** The user-version out of the channel's reply, or null when the build was pushed without one. */
export function parseLatest(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null
  const latest = (body as { latest?: unknown }).latest
  if (typeof latest !== 'string') return null
  const trimmed = latest.trim()
  return trimmed === '' ? null : trimmed
}

/** True for one manifest row: a path, a byte count and a hash. */
function isFileStamp(value: unknown): value is FileStamp {
  if (typeof value !== 'object' || value === null) return false
  const stamp = value as Partial<FileStamp>
  return (
    typeof stamp.rel === 'string' &&
    typeof stamp.size === 'number' &&
    typeof stamp.sha256 === 'string'
  )
}

/** True when a parsed file is a build manifest an update can be planned from. */
export function isBuildManifest(value: unknown): value is BuildManifest {
  if (typeof value !== 'object' || value === null) return false
  const manifest = value as Partial<BuildManifest>
  return (
    manifest.schemaVersion === 1 &&
    typeof manifest.version === 'string' &&
    Array.isArray(manifest.files) &&
    manifest.files.every(isFileStamp)
  )
}

/** The key one manifest path is matched by: forward slashes, lowercased. */
function keyOf(rel: string): string {
  return rel.replace(/\\/g, '/').toLowerCase()
}

/** True for a path under the install's own `data` folder, which no update may touch. */
function underData(rel: string): boolean {
  const key = keyOf(rel)
  return key === 'data' || key.startsWith('data/')
}

/** Refuses a staged path that is anything but a plain relative path beside the exe. */
function assertSafeRel(rel: string): void {
  const path = rel.replace(/\\/g, '/')
  const refuse = (reason: string): never => {
    throw appError(
      'UPDATE_BUILD_INVALID',
      'The new build lists a file it may not write.',
      `${rel} ${reason}`
    )
  }
  if (path === '') refuse('has no name')
  if (path.startsWith('/')) refuse('is an absolute path')
  if (/^[A-Za-z]:/.test(path)) refuse('names a drive')
  if (path.split('/').includes('..')) refuse('climbs out of the app folder')
  if (underData(path)) refuse('is under the data folder')
}

/**
 * What the update does to the install: `install` is every staged file the install does not
 * already hold byte for byte, `remove` every file the installed build shipped and the new one
 * dropped. An install with no manifest of its own gets every file and loses none.
 */
export function planUpdate(
  next: readonly FileStamp[],
  current: readonly FileStamp[] | null
): UpdatePlan {
  const staged = new Set<string>()
  for (const file of next) {
    assertSafeRel(file.rel)
    staged.add(keyOf(file.rel))
  }

  const installed =
    current === null ? null : new Map(current.map((file) => [keyOf(file.rel), file]))

  const install: string[] = []
  for (const file of next) {
    const held = installed?.get(keyOf(file.rel))
    if (
      held === undefined ||
      held.size !== file.size ||
      held.sha256.toLowerCase() !== file.sha256.toLowerCase()
    ) {
      install.push(file.rel)
    }
  }

  const remove: string[] = []
  for (const file of current ?? []) {
    if (!staged.has(keyOf(file.rel)) && !underData(file.rel)) remove.push(file.rel)
  }

  return { install, remove }
}
