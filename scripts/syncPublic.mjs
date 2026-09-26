import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { zipSync } from 'fflate'

/**
 * The snapshot mirror of this repo onto a public one. Each run replays HEAD's
 * tracked tree, minus everything `isPublic` rejects, as a single squashed commit
 * on the public `main`, authored by the public account and carrying a
 * `Source-Commit:` trailer so the next run knows where the last one stopped.
 *
 * `isPublic` is the only gate deciding what goes public; nothing else filters.
 * The cast under `assets/characters`, which it rejects file by file, is instead
 * replaced by one stored zip per character, `assets/characters/<id>.zip`, built
 * from HEAD's blobs so GitHub cannot preview the sprites.
 */

const REPO = resolve(fileURLToPath(new URL('..', import.meta.url)))

const PUBLIC_REPO = process.env.PUBLIC_REPO || 'git@github.com:venus-uni-dev/venus-university.git'
const PUBLIC_GIT_NAME = process.env.PUBLIC_GIT_NAME || 'Venus Dev'
const PUBLIC_GIT_EMAIL =
  process.env.PUBLIC_GIT_EMAIL || '331693195+venus-uni-dev@users.noreply.github.com'

/** Where the last published snapshot is kept locally between runs. */
const MIRROR_REF = 'refs/public/main'

/** How many private subjects the squashed commit's body lists. */
const MAX_BODY_SUBJECTS = 100

/** How far back the mirror's history is searched for the last `Source-Commit:` trailer. */
const MAX_TRAILER_LOOKBACK = 50

/**
 * The date on every zip entry, fixed so an unchanged cast zips to the same
 * bytes, and so to the same blob and tree, and the run makes no new mirror
 * commit. A zip stores a local wall-clock time with no zone, so this is built as
 * one: an instant would fall out of the 1980-2099 range the format allows west
 * of Greenwich.
 */
const ZIP_MTIME = new Date(2000, 0, 1, 0, 0, 0, 0)

/** GitHub refuses a file at or over 100 MiB, so no character zip may reach it. */
const MAX_ZIP_BYTES = 100 * 1024 * 1024

/**
 * Whether one tracked path, as `git ls-tree` prints it, belongs in the public
 * repo. `assets/` holds gigabytes of art including explicit images, so it is
 * allowlisted: a folder added there is private until this names it. Under
 * `sound/`, the `music/` and `ambient_music/` folders stay private because
 * their licence does not allow redistribution. `private/` holds records that
 * stay in this repo.
 */
export function isPublic(path) {
  if (path.startsWith('private/')) return false
  if (path.startsWith('.github/')) return false
  if (path.startsWith('build/itch-page/')) return false
  if (path.startsWith('assets/')) {
    const rest = path.slice('assets/'.length)
    if (!rest.includes('/')) return true
    if (rest.startsWith('sound/')) {
      return !rest.startsWith('sound/music/') && !rest.startsWith('sound/ambient_music/')
    }
    return (
      rest.startsWith('workflows/') ||
      rest.startsWith('bg/') ||
      rest.startsWith('bg_thumbs/') ||
      rest.startsWith('pose/')
    )
  }
  return true
}

/**
 * The character whose folder holds one tracked path, for a path under
 * `assets/characters/<id>/`, or null. Those files never go public as they are;
 * each character's folder ships as `assets/characters/<id>.zip` instead.
 */
export function characterArchive(path) {
  const match = /^assets\/characters\/([^/]+)\/./.exec(path)
  return match ? match[1] : null
}

/** Spawns a child with no shell, writing `input` to its stdin when given. */
function run(file, argv, { input, ...opts } = {}) {
  return new Promise((ok, fail) => {
    const child = spawn(file, argv, {
      cwd: REPO,
      stdio: [input === undefined ? 'ignore' : 'pipe', 'inherit', 'inherit'],
      shell: false,
      ...opts
    })
    child.on('error', fail)
    child.on('exit', (code) => {
      if (code === 0) ok()
      else fail(new Error(`git ${argv.join(' ')} exited with ${code}`))
    })
    if (input !== undefined) child.stdin.end(input)
  })
}

/** The same, but the child's exit code and both output streams come back. */
function capture(file, argv, opts = {}) {
  return new Promise((ok, fail) => {
    const child = spawn(file, argv, {
      cwd: REPO,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      ...opts
    })
    let out = ''
    let err = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => (out += chunk))
    child.stderr.on('data', (chunk) => (err += chunk))
    child.on('error', fail)
    child.on('exit', (code) => ok({ code, out, err }))
  })
}

/**
 * The same for a binary payload: the child's stdout comes back as one Buffer,
 * and a non-zero exit fails.
 */
function captureBuffer(file, argv, { input, ...opts } = {}) {
  return new Promise((ok, fail) => {
    const child = spawn(file, argv, {
      cwd: REPO,
      stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      shell: false,
      ...opts
    })
    const chunks = []
    let err = ''
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => chunks.push(chunk))
    child.stderr.on('data', (chunk) => (err += chunk))
    child.on('error', fail)
    child.on('close', (code) => {
      if (code === 0) ok(Buffer.concat(chunks))
      else fail(new Error(`${file} ${argv.join(' ')} failed:\n${err.trim()}`))
    })
    if (input !== undefined) child.stdin.end(input)
  })
}

/** Reads git's stdout, failing the run on a non-zero exit. */
async function git(argv, opts) {
  const { code, out, err } = await capture('git', argv, opts)
  if (code !== 0) throw new Error(`git ${argv.join(' ')} failed:\n${err.trim()}`)
  return out
}

async function refExists(ref) {
  const { code } = await capture('git', ['rev-parse', '-q', '--verify', `${ref}^{commit}`])
  return code === 0
}

/** Brings `refs/public/main` up to date, answering whether the remote has a main. */
async function fetchMirror() {
  // Only the tip commit and its tree are needed (the trailer and the tree
  // comparison); the push excludes the mirror's objects by sha, so its ~2 GB
  // of art is never downloaded.
  const fetched = await capture('git', [
    'fetch',
    '--filter=blob:none',
    PUBLIC_REPO,
    `+refs/heads/main:${MIRROR_REF}`
  ])
  if (fetched.code === 0) return true
  // An empty public repo is the first-sync case; auth and network failures are not.
  if (!/couldn.t find remote ref/i.test(fetched.err)) {
    throw new Error(`git fetch ${PUBLIC_REPO} failed:\n${fetched.err.trim()}`)
  }
  if (await refExists(MIRROR_REF)) await run('git', ['update-ref', '-d', MIRROR_REF])
  return false
}

/** The private subject of every commit this snapshot publishes. */
async function bodyFor(lastSynced, head, subject) {
  if (!lastSynced) return 'Initial snapshot.'
  const known = await capture('git', ['cat-file', '-e', `${lastSynced}^{commit}`])
  if (known.code !== 0) return subject
  const log = await git([
    'log',
    `--max-count=${MAX_BODY_SUBJECTS}`,
    '--format=%s',
    `${lastSynced}..${head}`
  ])
  const subjects = log
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  return subjects.length > 0 ? subjects.join('\n') : subject
}

/** A byte count in MiB to one decimal. */
function mib(bytes) {
  return (bytes / 1024 / 1024).toFixed(1)
}

/**
 * One character's folder as a single zip blob in the object store, its entries
 * named `<id>/…` and read from HEAD's blobs rather than the working tree.
 */
async function archiveCharacter(id, blobs) {
  // One cat-file answers every blob in the order asked, each as
  // `<sha> <type> <size>\n`, then its bytes and a newline.
  const out = await captureBuffer('git', ['cat-file', '--batch'], {
    input: blobs.map((blob) => blob.sha).join('\n') + '\n'
  })
  const prefix = `assets/characters/${id}/`
  const read = []
  let at = 0
  for (const blob of blobs) {
    const eol = out.indexOf(0x0a, at)
    if (eol === -1) throw new Error(`git cat-file stopped before ${blob.path}.`)
    const [sha, type, size] = out.toString('utf8', at, eol).split(' ')
    if (type !== 'blob' || sha !== blob.sha) {
      throw new Error(`git cat-file answered ${sha} ${type} for ${blob.path} (${blob.sha}).`)
    }
    const start = eol + 1
    const end = start + Number(size)
    if (end >= out.length) throw new Error(`git cat-file cut ${blob.path} short.`)
    read.push([`${id}/${blob.path.slice(prefix.length)}`, out.subarray(start, end)])
    at = end + 1
  }
  read.sort(([a], [b]) => (a < b ? -1 : 1))
  const entries = {}
  for (const [name, bytes] of read) entries[name] = bytes

  // Stored, not deflated: PNG does not shrink, and git delta-compresses a stored
  // zip well against its last version when only some entries changed.
  const zip = zipSync(entries, { level: 0, mtime: ZIP_MTIME })
  if (zip.length >= MAX_ZIP_BYTES) {
    throw new Error(
      `assets/characters/${id}.zip would be ${mib(zip.length)} MiB, which GitHub refuses ` +
        `(its cap is 100 MiB a file); ${id} has to be split.`
    )
  }

  // A dry run writes these loose objects too; nothing reaches them, and they are
  // harmless until gc reclaims them.
  const dir = await mkdtemp(join(tmpdir(), 'vu-cast-'))
  let sha
  try {
    const file = join(dir, `${id}.zip`)
    await writeFile(file, zip)
    sha = (await git(['hash-object', '-w', '--no-filters', file])).trim()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
  return { mode: '100644', sha, path: `assets/characters/${id}.zip`, bytes: zip.length }
}

/**
 * Every blob HEAD tracks that `isPublic` keeps, plus one zip per character in
 * place of its folder, sorted by path.
 */
async function publicEntries() {
  const raw = await git(['ls-tree', '-r', '-z', 'HEAD'])
  const kept = []
  const cast = new Map()
  for (const record of raw.split('\0')) {
    if (!record) continue
    const tab = record.indexOf('\t')
    const [mode, type, sha] = record.slice(0, tab).split(' ')
    const path = record.slice(tab + 1)
    if (type !== 'blob') throw new Error(`${path} is a ${type}; the mirror carries blobs only.`)
    const id = characterArchive(path)
    if (id !== null) {
      if (!cast.has(id)) cast.set(id, [])
      cast.get(id).push({ mode, sha, path })
    } else if (isPublic(path)) kept.push({ mode, sha, path })
  }
  for (const id of [...cast.keys()].sort()) kept.push(await archiveCharacter(id, cast.get(id)))
  kept.sort((a, b) => (a.path < b.path ? -1 : 1))
  return kept
}

/** Re-checks the filtered list against the rules, so a bug in `isPublic` cannot ship. */
function assertNothingPrivate(paths) {
  for (const path of paths) {
    const underAssets = path.startsWith('assets/')
    const allowedAsset =
      /^assets\/characters\/[^/]+\.zip$/.test(path) ||
      /^assets\/[^/]+$/.test(path) ||
      /^assets\/(workflows|bg|bg_thumbs|pose)\//.test(path) ||
      (/^assets\/sound\//.test(path) && !/^assets\/sound\/(music|ambient_music)\//.test(path))
    if (
      path.startsWith('private/') ||
      path.startsWith('.github/') ||
      path.startsWith('build/itch-page/') ||
      (underAssets && !allowedAsset)
    ) {
      throw new Error(`${path} nearly went public; the filter is wrong.`)
    }
  }
}

/** Builds the snapshot's tree in an index of its own, off HEAD's own blobs. */
async function writeTree(entries) {
  const dir = await mkdtemp(join(tmpdir(), 'vu-mirror-'))
  const env = { ...process.env, GIT_INDEX_FILE: join(dir, 'index') }
  try {
    const info = entries.map((e) => `${e.mode} ${e.sha}\t${e.path}\0`).join('')
    await run('git', ['update-index', '-z', '--index-info'], { input: info, env })
    return (await git(['write-tree', '--missing-ok'], { env })).trim()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')

  const head = (await git(['rev-parse', 'HEAD'])).trim()
  const subject = (await git(['log', '-1', '--format=%s', head])).trim()

  const remoteHasMain = dryRun ? await refExists(MIRROR_REF) : await fetchMirror()

  let parent = null
  let lastSynced = null
  if (remoteHasMain) {
    parent = (await git(['rev-parse', `${MIRROR_REF}^{commit}`])).trim()
    // The newest trailer wins; a commit made on the mirror itself carries none.
    const trailer = /^Source-Commit:\s*([0-9a-f]{7,40})\s*$/m.exec(
      await git(['log', `--max-count=${MAX_TRAILER_LOOKBACK}`, '--format=%B', parent])
    )
    lastSynced = trailer ? trailer[1] : null
  }

  const entries = await publicEntries()
  assertNothingPrivate(entries.map((e) => e.path))
  const tree = await writeTree(entries)

  const body = await bodyFor(lastSynced, head, subject)
  const message = `Sync ${head.slice(0, 7)}: ${subject}\n\n${body}\n\nSource-Commit: ${head}\n`

  if (dryRun) {
    for (const entry of entries) {
      console.log(entry.bytes === undefined ? entry.path : `${entry.path}  (${mib(entry.bytes)} MiB)`)
    }
    console.log(`\n${entries.length} files, tree ${tree}\n`)
    console.log(message)
  }

  let commit
  if (parent && (await git(['rev-parse', `${MIRROR_REF}^{tree}`])).trim() === tree) {
    commit = parent
    console.log(`Mirror already at ${commit}.`)
  } else {
    commit = (
      await git(['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', message], {
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: PUBLIC_GIT_NAME,
          GIT_AUTHOR_EMAIL: PUBLIC_GIT_EMAIL,
          GIT_COMMITTER_NAME: PUBLIC_GIT_NAME,
          GIT_COMMITTER_EMAIL: PUBLIC_GIT_EMAIL
        }
      })
    ).trim()
    if (!dryRun) await run('git', ['push', PUBLIC_REPO, `${commit}:refs/heads/main`])
  }

  const tags = (await git(['tag', '--points-at', head]))
    .split('\n')
    .map((line) => line.trim())
    .filter((tag) => /^v\d/.test(tag))
  for (const tag of tags) {
    if (!dryRun) await run('git', ['push', PUBLIC_REPO, `${commit}:refs/tags/${tag}`])
  }

  const tagged = tags.length > 0 ? `, tags ${tags.join(', ')}` : ''
  if (dryRun) console.log(`Dry run: nothing pushed; ${entries.length} files would go public.`)
  else if (commit === parent) console.log(`Pushed no commit${tagged}.`)
  else console.log(`Pushed ${commit} (${entries.length} files) to ${PUBLIC_REPO} main${tagged}.`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`\nSync failed: ${err.message}`)
    process.exitCode = 1
  })
}
