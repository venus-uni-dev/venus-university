import { readFile, readdir, stat } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * What itch.io will accept as an HTML5 game, asserted on the folder before it is
 * zipped. Every limit prints its measured number beside the cap, pass or fail.
 */

const MAX_FILES = 1000
const MAX_TOTAL = 500 * 1024 * 1024
const MAX_FILE = 200 * 1024 * 1024
const MAX_PATH = 240

/** Text the browser loads by URL; an absolute one would 404 under itch's subfolder. */
const TEXT_EXT = /\.(html|js|css)$/i

/** Every file under `dir`, as `/`-joined paths relative to it. */
async function walk(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue
    out.push(relative(dir, join(entry.parentPath, entry.name)).replace(/\\/g, '/'))
  }
  out.sort()
  return out
}

function mb(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Checks `dir` and returns the failures as sentences; an empty array is a pass.
 * `log` receives one measured line per limit.
 */
export async function checkItchLimits(dir, log = () => {}) {
  const failures = []
  const files = await walk(dir)

  const fail = (line) => failures.push(line)
  const report = (label, measured, cap, ok) => {
    log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}: ${measured} (limit ${cap})`)
    if (!ok) fail(`${label}: ${measured}, limit ${cap}`)
  }

  const hasIndex = files.includes('index.html')
  log(`  ${hasIndex ? 'ok  ' : 'FAIL'} index.html at the root: ${hasIndex ? 'yes' : 'no'}`)
  if (!hasIndex) fail('index.html is not at the root of the folder')

  report('files', String(files.length), String(MAX_FILES), files.length <= MAX_FILES)

  let total = 0
  let largest = { path: '', size: 0 }
  for (const rel of files) {
    const size = (await stat(join(dir, rel))).size
    total += size
    if (size > largest.size) largest = { path: rel, size }
  }
  report('extracted size', mb(total), mb(MAX_TOTAL), total <= MAX_TOTAL)
  report(
    `largest file (${largest.path})`,
    mb(largest.size),
    mb(MAX_FILE),
    largest.size <= MAX_FILE
  )

  const longest = files.reduce((a, b) => (b.length > a.length ? b : a), '')
  report(`longest path (${longest})`, String(longest.length), String(MAX_PATH), longest.length <= MAX_PATH)

  // Two shapes of URL that work on a dev server and nowhere on itch.
  const absolute = []
  for (const rel of files.filter((f) => TEXT_EXT.test(f))) {
    const text = await readFile(join(dir, rel), 'utf8')
    if (text.includes('"/assets/') || text.includes('file://')) absolute.push(rel)
  }
  log(
    `  ${absolute.length === 0 ? 'ok  ' : 'FAIL'} absolute URLs in html/js/css: ${absolute.length} (limit 0)`
  )
  if (absolute.length > 0) fail(`absolute URLs in ${absolute.join(', ')}`)

  // itch unzips onto a case-insensitive store; two names differing only in case
  // would overwrite each other.
  const seen = new Map()
  const collisions = []
  for (const rel of files) {
    const key = rel.toLowerCase()
    const first = seen.get(key)
    if (first !== undefined) collisions.push(`${first} / ${rel}`)
    else seen.set(key, rel)
  }
  log(
    `  ${collisions.length === 0 ? 'ok  ' : 'FAIL'} case-insensitive name collisions: ${collisions.length} (limit 0)`
  )
  if (collisions.length > 0) fail(`names colliding ignoring case: ${collisions.join('; ')}`)

  return failures
}

async function main() {
  const dir = resolve(process.argv[2] ?? 'release/web')
  console.log(`itch.io HTML5 limits for ${dir}`)
  const failures = await checkItchLimits(dir, (line) => console.log(line))
  if (failures.length > 0) {
    console.error(`\n${failures.length} check(s) failed:`)
    for (const line of failures) console.error(`  - ${line}`)
    process.exitCode = 1
    return
  }
  console.log('\nall checks passed')
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
}
