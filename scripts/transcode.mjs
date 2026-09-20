import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

/** Shipped PNG art becomes WebP at build time; this is the one encoder and its cache. */

const REPO = resolve(fileURLToPath(new URL('..', import.meta.url)))

/** Where encoded files and the mtime index live; gitignored, survives between runs. */
const CACHE_DIR = join(REPO, 'build', '.asset-cache')

const INDEX_PATH = join(CACHE_DIR, 'index.json')

/**
 * One table so the two builds can diverge later; both are quality 85 today, which
 * measured ~7x on backgrounds and ~17x on sprites.
 */
const PROFILES = {
  web: { quality: 85, effort: 4, alphaQuality: 100 },
  desktop: { quality: 85, effort: 4, alphaQuality: 100 }
}

/** Source path -> the sha256 last computed for it, keyed by its size and mtime. */
let index = null
let indexDirty = false

/** Counts and the encoder version the summary prints. */
const stats = { encoded: 0, cached: 0, bytesIn: 0, bytesOut: 0 }

/** In-flight encodes keyed by cache path, so concurrent callers share one run. */
const pending = new Map()

function loadIndex() {
  if (index !== null) return index
  index = {}
  try {
    const parsed = JSON.parse(readFileSync(INDEX_PATH, 'utf8'))
    if (parsed && typeof parsed === 'object') index = parsed
  } catch {
    // A missing or corrupt index costs a re-hash, never a wrong answer.
  }
  return index
}

/** Writes the index back if anything changed; called on exit and by `saveIndex`. */
function saveIndex() {
  if (index === null || !indexDirty) return
  mkdirSync(CACHE_DIR, { recursive: true })
  const tmp = `${INDEX_PATH}.tmp`
  writeFileSync(tmp, JSON.stringify(index))
  renameSync(tmp, INDEX_PATH)
  indexDirty = false
}

process.on('exit', () => {
  try {
    saveIndex()
  } catch {
    // The index is an optimization; losing it must not fail a build.
  }
})

/** The source's content hash, taken from the index when its size and mtime match. */
async function hashOf(srcPath) {
  const info = await stat(srcPath)
  const key = resolve(srcPath)
  const stamp = `${info.size}:${Math.round(info.mtimeMs)}`
  const known = loadIndex()[key]
  if (known && known.stamp === stamp) return known.sha

  const bytes = await readFile(srcPath)
  const sha = createHash('sha256').update(bytes).digest('hex')
  loadIndex()[key] = { stamp, sha }
  indexDirty = true
  return sha
}

/**
 * Path of the cached WebP for one PNG under the given profile, encoding it first if
 * the cache has no copy. The name is the source's content hash, so an edited source
 * gets a new entry and an unchanged one is never re-encoded.
 */
export async function webpFor(srcPath, profile = 'web') {
  const options = PROFILES[profile]
  if (!options) throw new Error(`Unknown transcode profile: ${profile}`)

  const sha = await hashOf(srcPath)
  const out = join(CACHE_DIR, `${sha}-${profile}.webp`)
  if (existsSync(out)) {
    stats.cached += 1
    return out
  }

  const running = pending.get(out)
  if (running) return running

  const run = (async () => {
    await mkdir(CACHE_DIR, { recursive: true })
    // Encoded to memory and renamed into place: a killed run must not leave a
    // truncated file that the next run would trust.
    const encoded = await sharp(srcPath).webp(options).toBuffer()
    const tmp = `${out}.${process.pid}.tmp`
    await writeFile(tmp, encoded)
    renameSync(tmp, out)
    stats.encoded += 1
    stats.bytesOut += encoded.length
    stats.bytesIn += (await stat(srcPath)).size
    return out
  })().finally(() => pending.delete(out))

  pending.set(out, run)
  return run
}

/** Encoded and cache-hit counts plus the encoder's version, for the build summary. */
export function transcodeStats() {
  const versions = sharp.versions ?? {}
  return {
    ...stats,
    sharp: versions.sharp ?? 'unknown',
    libvips: versions.vips ?? 'unknown'
  }
}

/** Standalone: `node scripts/transcode.mjs <png> [profile]` prints the cached path. */
async function main() {
  const [, , src, profile] = process.argv
  if (!src) {
    console.error('usage: node scripts/transcode.mjs <source.png> [web|desktop]')
    process.exitCode = 1
    return
  }
  console.log(await webpFor(resolve(src), profile ?? 'web'))
  console.log(transcodeStats())
}

// No top-level await: a Vite config importing this may be bundled to CommonJS.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
}
