import { readFile, readdir } from 'fs/promises'
import { join } from 'path'
import { validatePoseManifest, validateQuickstart } from '@shared/assetRules'
import { appError, messageOf } from '@shared/errors'
import { assertSafeId } from '@shared/jsonValidate'
import type { PoseManifest, QuickstartBundle } from '@shared/types'
import {
  getPoseManifestPath,
  getPoseSkeletonsPath,
  getQuickstartPath,
  getSoundPath
} from '../paths'

/** Read-only, memoized access to the shipped `/assets` tree. */

/** One error code and message, the pair `readJsonFile` throws for a failed step. */
interface JsonFailure {
  code: string
  message: string
}

/** Reads a shipped JSON file and parses it, failing each step under the caller's own error code. */
async function readJsonFile(
  path: string,
  unreadable: JsonFailure,
  invalid: JsonFailure
): Promise<unknown> {
  let raw: string
  try {
    raw = await readFile(path, 'utf-8')
  } catch (err) {
    throw appError(unreadable.code, unreadable.message, `${path}: ${messageOf(err)}`)
  }

  try {
    return JSON.parse(raw)
  } catch (err) {
    throw appError(invalid.code, invalid.message, `${path}: ${messageOf(err)}`)
  }
}

/** Memoized pose promise, so concurrent callers share one scan and warning pass. */
let cachedPoses: Promise<PoseManifest> | null = null

/** Reads and shape-checks `/assets/pose/pose.json`. */
async function readPoseManifest(): Promise<PoseManifest> {
  const path = getPoseManifestPath()

  const parsed = await readJsonFile(
    path,
    { code: 'POSE_MANIFEST_UNREADABLE', message: 'The pose manifest could not be read.' },
    { code: 'POSE_MANIFEST_INVALID', message: 'The pose manifest is not valid JSON.' }
  )

  return validatePoseManifest(parsed, path)
}

/** Lists the pose keys that have a `{key}.png` skeleton on disk. */
async function readSkeletonKeys(): Promise<Set<string>> {
  const dir = getPoseSkeletonsPath()

  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch (err) {
    throw appError(
      'POSE_SKELETONS_UNREADABLE',
      'The pose skeleton folder could not be read.',
      `${dir}: ${messageOf(err)}`
    )
  }

  return new Set(
    entries.filter((name) => name.toLowerCase().endsWith('.png')).map((name) => name.slice(0, -4))
  )
}

/**
 * Returns pose manifest entries that also have skeleton PNGs; incomplete pairs
 * warn and are excluded.
 */
export function getAvailablePoses(): Promise<PoseManifest> {
  // A failed read is not cached, so a fix on disk takes effect on the next call.
  cachedPoses ??= resolveAvailablePoses().catch((err) => {
    cachedPoses = null
    throw err
  })
  return cachedPoses
}

/** Does the actual intersect-and-warn pass behind {@link getAvailablePoses}. */
async function resolveAvailablePoses(): Promise<PoseManifest> {
  const [manifest, skeletons] = await Promise.all([readPoseManifest(), readSkeletonKeys()])

  const available: PoseManifest = {}
  for (const [key, entry] of Object.entries(manifest)) {
    if (skeletons.has(key)) {
      available[key] = entry
    } else {
      console.warn(`[assets] pose "${key}" is in pose.json but has no skeletons/${key}.png.`)
    }
  }

  for (const key of skeletons) {
    if (!(key in manifest)) {
      console.warn(`[assets] skeletons/${key}.png has no entry in pose.json.`)
    }
  }

  if (Object.keys(available).length === 0) {
    console.warn('[assets] no usable poses — character generation will have nothing to pick from.')
  }

  return available
}

/** Tags for one pose, or `null` when the key is not in the available set. */
export async function getPoseTags(key: string): Promise<string[] | null> {
  const poses = await getAvailablePoses()
  return poses[key]?.tags ?? null
}

/** Memoized bundle promise, shared by concurrent callers. */
let cachedQuickstart: Promise<QuickstartBundle> | null = null

/** The canned semester behind the Main Menu's Quickstart button, read on demand. */
export function getQuickstart(): Promise<QuickstartBundle> {
  cachedQuickstart ??= readQuickstart().catch((err) => {
    cachedQuickstart = null
    throw err
  })
  return cachedQuickstart
}

/** Reads and shape-checks `/assets/quickstart.json` behind {@link getQuickstart}. */
async function readQuickstart(): Promise<QuickstartBundle> {
  const path = getQuickstartPath()

  const parsed = await readJsonFile(
    path,
    { code: 'QUICKSTART_UNREADABLE', message: 'The quickstart game could not be read.' },
    { code: 'QUICKSTART_INVALID', message: 'The quickstart game is not valid JSON.' }
  )

  return validateQuickstart(parsed, path)
}

/** The shape a sound's name must have: one of the five group folders and a lowercase `.ogg`. */
const SAFE_AUDIO_FILE = /^(music|ambient_music|ambient|nsfw|sfx)\/[a-z0-9_]+\.ogg$/

/** The bytes of one shipped sound, or `null` if it is not on disk. */
export async function readAudio(file: string): Promise<Uint8Array | null> {
  assertSafeId(file, SAFE_AUDIO_FILE, 'AUDIO_FILE_INVALID', 'That sound file name is not valid.')
  const path = join(getSoundPath(), file)

  try {
    return await readFile(path)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw appError('ASSET_UNREADABLE', 'Could not read that sound.', `${path}: ${messageOf(err)}`)
  }
}
