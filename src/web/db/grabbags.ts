import type { GrabBags } from '@shared/types'
import { database, storage } from './open'

/** The grab bags' set-aside keys: one row, read at boot and written behind every draw. */

/** Every bag's set-aside keys, or none where nothing has been drawn yet. */
export async function readGrabBags(): Promise<GrabBags> {
  const stored = await storage('read the grab bags', async () =>
    (await database()).get('grabbags', 'grabbags')
  )
  return stored ?? {}
}

/** Replaces every bag's set-aside keys. */
export async function writeGrabBags(bags: GrabBags): Promise<void> {
  await storage('save the grab bags', async () =>
    (await database()).put('grabbags', bags, 'grabbags')
  )
}
