import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zipSync } from 'fflate'
import { loadTs } from './ts.mjs'

/**
 * Builds `testsave/backup.zip` from one playthrough folder under `testsave/`, in the exact
 * format `src/shared/backup.ts` and the browser writer `src/web/backup.ts` read back: one
 * `backup.json` entry, stored (level 0) the way `buildPack` in `src/web/packs.ts` zips a pack.
 *
 * Usage: `node testsave/harness/makeBackup.mjs [folder]` — `folder` is a playthrough id under
 * `testsave/`; omitted, the single numeric folder there is used.
 */

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const TESTSAVE_DIR = join(REPO_ROOT, 'testsave')

const NUMERIC_NAME = /^[0-9]+$/
const SAVE_FILE = /^([0-9]+)\.json$/
const MANUAL_FILE = /^(manual(?:0[1-9]|[1-8][0-9]|90))\.json$/

/** The single numeric folder under `testsave/`, when none is named on the command line. */
async function defaultFolder() {
  const entries = await readdir(TESTSAVE_DIR, { withFileTypes: true })
  const numeric = entries.filter((e) => e.isDirectory() && NUMERIC_NAME.test(e.name))
  if (numeric.length !== 1) {
    throw new Error(
      `expected exactly one numeric folder under testsave/, found ${numeric.length}` +
        (numeric.length > 0 ? ` (${numeric.map((e) => e.name).join(', ')})` : '') +
        '; pass one explicitly: node testsave/harness/makeBackup.mjs <folder>'
    )
  }
  return numeric[0].name
}

/**
 * Every `<numeric>.json` save (a boundary save) in `dir`, ascending by id, then every
 * `manualNN.json` save, ascending by slot — the numeric ones first, matching
 * `validate.mjs`'s own order for the same folder.
 */
async function allSavesIn(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const names = entries.filter((e) => e.isFile()).map((e) => e.name)

  const boundaryIds = names
    .filter((n) => SAVE_FILE.test(n))
    .map((n) => SAVE_FILE.exec(n)[1])
    .sort((a, b) => Number(a) - Number(b))
  const manualIds = names
    .filter((n) => MANUAL_FILE.test(n))
    .map((n) => MANUAL_FILE.exec(n)[1])
    .sort((a, b) => Number(a.slice('manual'.length)) - Number(b.slice('manual'.length)))

  const saves = []
  for (const saveId of [...boundaryIds, ...manualIds]) {
    const save = JSON.parse(await readFile(join(dir, `${saveId}.json`), 'utf8'))
    saves.push({ saveId, save })
  }
  return saves
}

async function main() {
  const folder = process.argv[2] ?? (await defaultFolder())
  const dir = join(TESTSAVE_DIR, folder)
  if (!(await stat(dir)).isDirectory()) throw new Error(`${dir} is not a folder`)
  if (!NUMERIC_NAME.test(folder)) throw new Error(`${folder} is not a numeric playthrough id`)

  const playthroughId = folder
  const record = JSON.parse(await readFile(join(dir, 'playthrough.json'), 'utf8'))
  const saves = await allSavesIn(dir)
  if (saves.length === 0) {
    throw new Error(`${dir} holds no <numeric>.json or manualNN.json save; nothing to back up`)
  }

  const { BACKUP_SCHEMA_VERSION } = await loadTs('src/shared/backup.ts')
  const { defaultSettings, redactSettings } = await loadTs('src/shared/settingsRules.ts')

  const backup = {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    settings: { ...redactSettings(defaultSettings()), sfwAsked: true },
    grabbags: {},
    playthroughs: {
      [playthroughId]: { record, enrollment: null, createdAt: Number(playthroughId) }
    },
    saves: saves.map(({ saveId, save }) => ({ playthroughId, saveId, save })),
    endingArt: [],
    profilePictures: [],
    characters: []
  }

  const files = { 'backup.json': new TextEncoder().encode(JSON.stringify(backup, null, 2)) }
  const zipped = zipSync(files, { level: 0 })
  const outPath = join(TESTSAVE_DIR, 'backup.zip')
  await writeFile(outPath, zipped)

  console.log(
    `Wrote ${outPath} — playthrough ${playthroughId}, ${saves.length} save(s): ` +
      saves.map((s) => s.saveId).join(', ')
  )
}

main().catch((err) => {
  console.error(`makeBackup failed: ${err.message}`)
  process.exitCode = 1
})
