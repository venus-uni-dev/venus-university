import { appError } from './errors'
import type { PoseEntry, PoseManifest, QuickstartBundle } from './types'

/** The shape checks the two shipped JSON files pass, wherever they are read from. */

/** The record fields the quickstart bundle is nothing without; each one is a map by charId or code. */
const QUICKSTART_MAPS = ['classes', 'perChar', 'jobs', 'haunts', 'feeds', 'springBreakPlans'] as const

/**
 * The pose manifest a parsed `pose.json` amounts to: an entry without a tag list is dropped
 * with a warning, and one without a description keeps its key.
 */
export function validatePoseManifest(parsed: unknown, where: string): PoseManifest {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw appError(
      'POSE_MANIFEST_INVALID',
      'The pose manifest must be an object of pose key to tag list.',
      where
    )
  }

  const manifest: PoseManifest = {}
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const entry = value as Partial<PoseEntry> | null
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      console.warn(`[assets] pose "${key}" is not an entry object — ignoring it.`)
      continue
    }
    const { tags, description } = entry
    if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== 'string')) {
      console.warn(`[assets] pose "${key}" has no list of tag strings — ignoring it.`)
      continue
    }
    // A missing description warns rather than drops: the pose still renders.
    if (typeof description !== 'string' || !description.trim()) {
      console.warn(`[assets] pose "${key}" has no description — the LLM will see the bare key.`)
    }
    manifest[key] = {
      tags,
      description: typeof description === 'string' ? description.trim() : ''
    }
  }

  return manifest
}

/** The canned semester a parsed `quickstart.json` amounts to; a missing map is refused by name. */
export function validateQuickstart(parsed: unknown, where: string): QuickstartBundle {
  const invalid = (detail: string): never => {
    throw appError('QUICKSTART_INVALID', 'The quickstart game is not usable.', `${where}: ${detail}`)
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    invalid('the file is not an object')
  }
  const bundle = parsed as Record<string, unknown>

  if (!Array.isArray(bundle.chars) || bundle.chars.length === 0) {
    invalid('`chars` is not a non-empty array')
  }
  if ((bundle.chars as unknown[]).some((charId) => typeof charId !== 'string')) {
    invalid('`chars` holds something that is not a charId')
  }
  for (const field of QUICKSTART_MAPS) {
    const value = bundle[field]
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      invalid(`\`${field}\` is not an object`)
    }
  }
  if (!Array.isArray(bundle.occasions)) {
    invalid('`occasions` is not an array')
  }

  return bundle as unknown as QuickstartBundle
}
