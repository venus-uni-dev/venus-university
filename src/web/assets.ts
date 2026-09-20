import { validatePoseManifest, validateQuickstart } from '@shared/assetRules'
import { appError, messageOf } from '@shared/errors'
import type { PoseManifest, QuickstartBundle } from '@shared/types'
import poseJson from '../../assets/pose/pose.json'
import quickstartJson from '../../assets/quickstart.json'

/**
 * The shipped `/assets` tree as the browser reaches it: the two JSON files come through the
 * bundler and the sounds are fetched by URL, each one hashed and relative.
 */

/** Where the pose manifest was read from, for anything it is refused with. */
const POSE_PATH = 'assets/pose/pose.json'
const QUICKSTART_PATH = 'assets/quickstart.json'

/**
 * Every pose the manifest names. The skeletons a render is drawn over are a desktop-only
 * file, so nothing is intersected with them here.
 */
export function getPoseManifest(): PoseManifest {
  return validatePoseManifest(poseJson, POSE_PATH)
}

/** The canned semester behind the Main Menu's Quickstart button. */
export function getQuickstart(): QuickstartBundle {
  return validateQuickstart(quickstartJson, QUICKSTART_PATH)
}

/** Every shipped sound, keyed the way the mix names one: `<group>/<name>.ogg`. */
const SOUND_URLS = import.meta.glob<string>('../../assets/sound/*/*.ogg', {
  eager: true,
  query: '?url',
  import: 'default'
})

const SOUND_ROOT = '/sound/'

const sounds: Record<string, string> = Object.fromEntries(
  Object.entries(SOUND_URLS).map(([path, url]) => [
    path.slice(path.indexOf(SOUND_ROOT) + SOUND_ROOT.length),
    url
  ])
)

/** The bytes of one shipped sound, or `null` where the mix names one this build has not got. */
export async function readAudio(file: string): Promise<Uint8Array<ArrayBuffer> | null> {
  // The names this build ships are the whole vocabulary: one it does not know is not on disk.
  const url = sounds[file]
  if (!url) return null

  try {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return new Uint8Array(await response.arrayBuffer())
  } catch (err) {
    throw appError('ASSET_UNREADABLE', 'Could not read that sound.', `${file}: ${messageOf(err)}`)
  }
}
