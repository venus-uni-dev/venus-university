import { mkdir } from 'fs/promises'
import type { GrabBags, GrabBagsFile } from '@shared/types'
import { getDataPath, getGrabBagsPath } from '../paths'
import { readValidatedJson, writeAtomicJson } from './jsonFile'

/** Schema version this build reads and writes. */
const SCHEMA_VERSION = 1

/** Reads `/data/grabbags.json`, or an empty set of bags if it does not exist yet. */
export async function getGrabBags(): Promise<GrabBags> {
  const file = await readValidatedJson<GrabBagsFile>(getGrabBagsPath(), {
    label: 'grabbags.json',
    unreadable: { code: 'GRABBAGS_UNREADABLE', message: 'Could not read grabbags.json.' },
    malformed: {
      code: 'GRABBAGS_MALFORMED',
      message: 'grabbags.json is not valid JSON. Fix or delete the file to continue.'
    },
    schemaVersion: { code: 'GRABBAGS_SCHEMA_VERSION' },
    expects: SCHEMA_VERSION,
    required: { schemaVersion: true, bags: true },
    onMissing: () => ({ schemaVersion: SCHEMA_VERSION, bags: {} })
  })
  return file.bags
}

/** Writes every bag's set-aside keys atomically. */
export async function setGrabBags(bags: GrabBags): Promise<void> {
  await mkdir(getDataPath(), { recursive: true })
  await writeAtomicJson(
    getGrabBagsPath(),
    { schemaVersion: SCHEMA_VERSION, bags },
    { code: 'GRABBAGS_UNWRITABLE', message: 'Could not save grabbags.json.' }
  )
}
