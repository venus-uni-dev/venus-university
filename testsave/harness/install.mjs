import { copyFile, mkdir, readdir, readFile, rm, stat, utimes } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Copies `testsave/<id>/` onto a real saves folder, or removes exactly the copy it made — so a
 * packaged or dev build can load the fixture playthrough without any other change to `data/`.
 *
 * Usage: `node testsave/harness/install.mjs [--target <savesDir>] [--remove]` — `--target`
 * defaults to this repo's own `data/saves`; the playthrough id defaults to the single numeric
 * folder under `testsave/`.
 */

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const TESTSAVE_DIR = join(REPO_ROOT, 'testsave')
const DEFAULT_TARGET = join(REPO_ROOT, 'data', 'saves')

const NUMERIC_NAME = /^[0-9]+$/

function parseArgs(argv) {
  let target = DEFAULT_TARGET
  let remove = false
  let folder
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--target') {
      target = argv[++i]
      if (!target) throw new Error('--target needs a path')
    } else if (arg === '--remove') {
      remove = true
    } else if (!arg.startsWith('--')) {
      folder = arg
    } else {
      throw new Error(`unknown flag: ${arg}`)
    }
  }
  return { target, remove, folder }
}

/** The single numeric folder under `testsave/`, when none is named on the command line. */
async function defaultFolder() {
  const entries = await readdir(TESTSAVE_DIR, { withFileTypes: true })
  const numeric = entries.filter((e) => e.isDirectory() && NUMERIC_NAME.test(e.name))
  if (numeric.length !== 1) {
    throw new Error(
      `expected exactly one numeric folder under testsave/, found ${numeric.length}` +
        (numeric.length > 0 ? ` (${numeric.map((e) => e.name).join(', ')})` : '')
    )
  }
  return numeric[0].name
}

async function pathExists(path) {
  return stat(path).then(
    () => true,
    () => false
  )
}

/** A save file's own `saveDate` (ms), or null for a file this build does not date that way. */
async function saveDateOf(path) {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'))
    return typeof parsed.saveDate === 'number' ? parsed.saveDate : null
  } catch {
    return null
  }
}

async function main() {
  const { target, remove, folder: folderArg } = parseArgs(process.argv.slice(2))
  const folder = folderArg ?? (await defaultFolder())
  if (!NUMERIC_NAME.test(folder)) throw new Error(`${folder} is not a numeric playthrough id`)

  // Always exactly this one playthrough's folder — never a parent of it.
  const targetDir = join(target, folder)

  if (remove) {
    if (!(await pathExists(targetDir))) {
      console.log(`${targetDir} does not exist; nothing to remove.`)
      return
    }
    await rm(targetDir, { recursive: true, force: true })
    console.log(`Removed ${targetDir}`)
    return
  }

  const sourceDir = join(TESTSAVE_DIR, folder)
  if (!(await pathExists(sourceDir))) throw new Error(`${sourceDir} does not exist`)
  if (await pathExists(targetDir)) {
    throw new Error(`${targetDir} already exists; refusing to overwrite it`)
  }

  await mkdir(targetDir, { recursive: true })
  const entries = (await readdir(sourceDir, { withFileTypes: true })).filter((e) => e.isFile())
  for (const entry of entries) {
    const from = join(sourceDir, entry.name)
    const to = join(targetDir, entry.name)
    await copyFile(from, to)

    // The desktop lists a playthrough's newest save by file mtime (`newestWrittenFirst` in
    // `src/main/services/saveService.ts`), so a copied save file is dated with its own
    // `saveDate` rather than left at the moment this script ran.
    const saveDate = await saveDateOf(to)
    if (saveDate !== null) {
      const seconds = saveDate / 1000
      await utimes(to, seconds, seconds)
    }
  }

  console.log(`Installed ${sourceDir} -> ${targetDir} (${entries.length} file(s))`)
}

main().catch((err) => {
  console.error(`install failed: ${err.message}`)
  process.exitCode = 1
})
