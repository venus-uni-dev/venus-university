import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * The snapshot mirror of this repo onto a public one. Each run replays HEAD's
 * tracked tree, minus everything `isPublic` rejects, as a single squashed commit
 * on the public `main`, authored by the public account and carrying a
 * `Source-Commit:` trailer so the next run knows where the last one stopped.
 *
 * `isPublic` is the only gate deciding what goes public; nothing else filters.
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

/** The working notes, which stay private. */
const PRIVATE_DOCS = new Set(['CLAUDE.md', 'DESIGN_GUIDE.md', 'UI_STYLE_GUIDE.md', 'TESTING_PLAN.md'])

/**
 * Whether one tracked path, as `git ls-tree` prints it, belongs in the public
 * repo. `assets/` holds gigabytes of art including explicit images, so it is
 * allowlisted: a folder added there is private until this says otherwise, and
 * `private/` is the folder for records that stay in this repo.
 */
export function isPublic(path) {
  if (path.startsWith('private/')) return false
  if (path.startsWith('.github/')) return false
  if (path.startsWith('build/itch-page/')) return false
  if (PRIVATE_DOCS.has(path)) return false
  if (path.startsWith('assets/')) {
    const rest = path.slice('assets/'.length)
    if (!rest.includes('/')) return true
    return (
      rest.startsWith('workflows/') ||
      rest.startsWith('pose/skeletons/') ||
      rest === 'pose/pose.json'
    )
  }
  return true
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
  const fetched = await capture('git', ['fetch', PUBLIC_REPO, `+refs/heads/main:${MIRROR_REF}`])
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

/** Every blob HEAD tracks that `isPublic` keeps, sorted by path. */
async function publicEntries() {
  const raw = await git(['ls-tree', '-r', '-z', 'HEAD'])
  const kept = []
  for (const record of raw.split('\0')) {
    if (!record) continue
    const tab = record.indexOf('\t')
    const [mode, type, sha] = record.slice(0, tab).split(' ')
    const path = record.slice(tab + 1)
    if (type !== 'blob') throw new Error(`${path} is a ${type}; the mirror carries blobs only.`)
    if (isPublic(path)) kept.push({ mode, sha, path })
  }
  kept.sort((a, b) => (a.path < b.path ? -1 : 1))
  return kept
}

/** Re-checks the filtered list against the rules, so a bug in `isPublic` cannot ship. */
function assertNothingPrivate(paths) {
  for (const path of paths) {
    const underAssets = path.startsWith('assets/')
    const allowedAsset =
      /^assets\/[^/]+$/.test(path) ||
      path.startsWith('assets/workflows/') ||
      path.startsWith('assets/pose/skeletons/') ||
      path === 'assets/pose/pose.json'
    if (
      PRIVATE_DOCS.has(path) ||
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
    for (const entry of entries) console.log(entry.path)
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
