import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zipSync } from 'fflate'
import { transcodeStats, webpFor } from './transcode.mjs'

/**
 * Turns the shipped cast under `assets/characters` into a release's two forms: a WebP mirror for
 * the desktop app's resources, and one stored zip per character, in the game's own
 * character-package format, for the browser build to fetch.
 */

const REPO = resolve(fileURLToPath(new URL('..', import.meta.url)))
const SRC_CHARS = join(REPO, 'assets', 'characters')
const DESKTOP_OUT = join(REPO, 'build', 'desktop-assets')
const WEB_OUT = join(REPO, 'build', 'web-assets')

/** Working files the editor writes beside the sprites; neither build ships them. */
const EDITOR_ONLY = new Set(['face.png', 'neutral.base.png', 'fix.png', 'hands.png'])

/** What the marker file in every package says it is. */
const MANIFEST_FORMAT = 'venus-university-character'

/**
 * A fixed stamp rather than the clock: the packs have to come out byte-identical
 * on a second run, and nothing reads this field.
 */
const EXPORTED_AT = '1970-01-01T00:00:00.000Z'

/**
 * Zip entry dates are fixed for the same reason. A zip stores a local wall-clock
 * time with no zone, so this is built as one: an instant would fall out of the
 * 1980-2099 range the format allows west of Greenwich.
 */
const ZIP_MTIME = new Date(2000, 0, 1, 0, 0, 0, 0)

/** How many encodes run at once. */
const CONCURRENCY = 4

/** Every shippable PNG under one character folder, as `/`-joined relative paths. */
async function shippableImages(dir) {
  const out = []
  async function walk(sub) {
    for (const entry of await readdir(join(dir, sub), { withFileTypes: true })) {
      const rel = sub ? `${sub}/${entry.name}` : entry.name
      // Staging is a half-finished regenerate, never part of the character.
      if (entry.isDirectory()) {
        if (entry.name !== 'staging') await walk(rel)
        continue
      }
      if (!entry.name.endsWith('.png') || EDITOR_ONLY.has(entry.name)) continue
      out.push(rel)
    }
  }
  await walk('')
  out.sort()
  return out
}

/** Runs `task` over `items` with at most `CONCURRENCY` in flight, keeping the order. */
async function pooled(items, task) {
  const results = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      results[i] = await task(items[i], i)
    }
  })
  await Promise.all(workers)
  return results
}

/** Both builds' copies of one character, plus what the two index files need of her. */
async function packOne(charId) {
  const dir = join(SRC_CHARS, charId)
  const character = JSON.parse(await readFile(join(dir, 'character.json'), 'utf8'))
  const images = await shippableImages(dir)

  const desktopDir = join(DESKTOP_OUT, 'characters', charId)
  await mkdir(desktopDir, { recursive: true })
  await writeFile(join(desktopDir, 'character.json'), JSON.stringify(character))

  const entries = {}
  const files = []
  await pooled(images, async (rel) => {
    const src = join(dir, rel)
    const webpRel = `${rel.slice(0, -'.png'.length)}.webp`

    const desktopFile = join(desktopDir, webpRel)
    await mkdir(dirname(desktopFile), { recursive: true })
    await cp(await webpFor(src, 'desktop'), desktopFile)

    entries[webpRel] = new Uint8Array(await readFile(await webpFor(src, 'web')))
    files.push(webpRel)
  })
  files.sort()

  // The package format the desktop's export writes and both importers read: the
  // character without her id, a marker file, and the images where she keeps them.
  const { charId: _identity, ...portable } = character
  entries['character.json'] = new TextEncoder().encode(JSON.stringify(portable))
  entries['manifest.json'] = new TextEncoder().encode(
    JSON.stringify({
      format: MANIFEST_FORMAT,
      schemaVersion: character.schemaVersion,
      exportedAt: EXPORTED_AT,
      firstName: character.firstName,
      lastName: character.lastName
    })
  )

  // Stored, not deflated: WebP does not compress, and a stored zip unpacks in the
  // browser for the cost of a copy.
  const withOptions = {}
  for (const name of Object.keys(entries).sort()) {
    withOptions[name] = [entries[name], { level: 0, mtime: ZIP_MTIME }]
  }
  const zip = zipSync(withOptions, { level: 0, mtime: ZIP_MTIME })

  await mkdir(join(WEB_OUT, 'packs'), { recursive: true })
  await writeFile(join(WEB_OUT, 'packs', `${charId}.zip`), zip)

  await mkdir(join(WEB_OUT, 'profiles'), { recursive: true })
  await cp(
    await webpFor(join(dir, 'expressions', 'profile.png'), 'web'),
    join(WEB_OUT, 'profiles', `${charId}.webp`)
  )

  return { charId, character, files, bytes: zip.length }
}

/** Copies the folders main reads out of `resources/assets` at runtime. Backgrounds are not among them. */
async function copyDesktopExtras() {
  for (const name of ['pose', 'workflows', 'sound']) {
    await cp(join(REPO, 'assets', name), join(DESKTOP_OUT, name), { recursive: true })
  }
  await cp(join(REPO, 'assets', 'quickstart.json'), join(DESKTOP_OUT, 'quickstart.json'))
}

/** Builds `build/desktop-assets` and `build/web-assets` from scratch. */
export async function packCharacters() {
  const started = Date.now()
  await rm(DESKTOP_OUT, { recursive: true, force: true })
  await rm(WEB_OUT, { recursive: true, force: true })

  const charIds = (await readdir(SRC_CHARS, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()

  const packed = []
  for (const charId of charIds) packed.push(await packOne(charId))

  await copyDesktopExtras()

  const characters = {}
  const chars = {}
  for (const { charId, character, files, bytes } of packed) {
    characters[charId] = character
    chars[charId] = { files, bytes }
  }
  await writeFile(join(WEB_OUT, 'characters.json'), JSON.stringify(characters))
  await writeFile(
    join(WEB_OUT, 'packs', 'index.json'),
    JSON.stringify({ schemaVersion: 1, chars })
  )

  const stats = transcodeStats()
  return {
    characters: packed.length,
    images: packed.reduce((n, p) => n + p.files.length, 0),
    packBytes: packed.reduce((n, p) => n + p.bytes, 0),
    seconds: (Date.now() - started) / 1000,
    ...stats
  }
}

/** Total bytes of a folder tree, for the summary. */
export async function folderBytes(dir) {
  let total = 0
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) total += (await stat(join(entry.parentPath, entry.name))).size
  }
  return total
}

async function main() {
  const summary = await packCharacters()
  const mb = (n) => `${(n / 1e6).toFixed(1)} MB`
  console.log(
    `packed ${summary.characters} characters, ${summary.images} images, ` +
      `${mb(summary.packBytes)} of packs in ${summary.seconds.toFixed(1)}s`
  )
  console.log(
    `  encoded ${summary.encoded}, cached ${summary.cached}, ` +
      `sharp ${summary.sharp} / libvips ${summary.libvips}`
  )
  console.log(`  desktop ${relative(REPO, DESKTOP_OUT)}, web ${relative(REPO, WEB_OUT)}`)
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
}
