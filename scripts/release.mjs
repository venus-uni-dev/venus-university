import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, readdir, rm, stat } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sevenBin from '7zip-bin'
import { checkItchLimits } from './checkItchLimits.mjs'
import { folderBytes, packCharacters } from './packCharacters.mjs'

/**
 * The one release command: a browser build itch.io will host and a Windows folder
 * it will serve as a download, both out of the same tree and the same version.
 * It never bumps the version and never tags; `npm version` does that first.
 */

const REPO = resolve(fileURLToPath(new URL('..', import.meta.url)))
const RELEASE = join(REPO, 'release')
const WEB_OUT = join(RELEASE, 'web')
const UNPACKED = join(RELEASE, 'win-unpacked')

const allowDirty = process.argv.includes('--allow-dirty')

/** How long each step took, printed as a table at the end. */
const timings = []

function mb(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Spawns a child with no shell and fails the run on a non-zero exit. */
function run(file, argv, opts = {}) {
  return new Promise((ok, fail) => {
    const child = spawn(file, argv, { cwd: REPO, stdio: 'inherit', shell: false, ...opts })
    child.on('error', fail)
    child.on('exit', (code) => {
      if (code === 0) ok()
      else fail(new Error(`${basename(file)} ${argv.join(' ')} exited with ${code}`))
    })
  })
}

/** The same, but the child's stdout comes back as a string. */
function capture(file, argv, opts = {}) {
  return new Promise((ok, fail) => {
    const child = spawn(file, argv, {
      cwd: REPO,
      stdio: ['ignore', 'pipe', 'inherit'],
      shell: false,
      ...opts
    })
    let out = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => (out += chunk))
    child.on('error', fail)
    child.on('exit', (code) => ok({ code, out }))
  })
}

/**
 * npm's own JS entry point. Spawning `npm.cmd` would need a shell, which Node
 * refuses for a `.cmd` file unless `shell: true`; running the CLI under this
 * interpreter keeps every child shell-free.
 */
function npmCli() {
  const fromEnv = process.env.npm_execpath
  if (fromEnv && fromEnv.endsWith('.js') && existsSync(fromEnv)) return fromEnv
  const beside = resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
  if (existsSync(beside)) return beside
  throw new Error('Could not find npm-cli.js; run this through `npm run release`.')
}

/** A JS CLI inside `node_modules`, run under this interpreter. */
function nodeBin(rel) {
  const path = join(REPO, 'node_modules', rel)
  if (!existsSync(path)) throw new Error(`Missing build tool: node_modules/${rel}`)
  return path
}

async function step(name, fn) {
  const started = Date.now()
  console.log(`\n=== ${name}`)
  const value = await fn()
  const seconds = (Date.now() - started) / 1000
  timings.push({ name, seconds })
  console.log(`--- ${name} in ${seconds.toFixed(1)}s`)
  return value
}

/** Node version, build tools, a clean tree and a version nothing else is tagged with. */
async function preflight() {
  const major = Number(process.versions.node.split('.')[0])
  if (major < 22) throw new Error(`Node 22 or newer is required; this is ${process.versions.node}.`)

  for (const pkg of ['sharp', '7zip-bin', 'electron-builder', 'fflate']) {
    if (!existsSync(join(REPO, 'node_modules', pkg))) {
      throw new Error(`${pkg} is not installed; run npm install --legacy-peer-deps.`)
    }
  }

  if (!existsSync(join(REPO, 'build', 'icon.ico'))) {
    console.warn('  warning: build/icon.ico is missing, so the exe gets electron-builder’s stock icon.')
  }

  const status = await capture('git', ['status', '--porcelain'])
  const dirty = status.out.trim()
  if (dirty && !allowDirty) {
    console.error(dirty)
    throw new Error('The working tree is dirty. Commit first, or pass --allow-dirty for a test build.')
  }
  if (dirty) console.warn('  warning: building a dirty tree (--allow-dirty).')

  const head = (await capture('git', ['rev-parse', 'HEAD'])).out.trim()
  const sha = head.slice(0, 8)

  const { version } = JSON.parse(await readFile(join(REPO, 'package.json'), 'utf8'))
  const tag = `v${version}`
  // Stderr is dropped: an absent tag is the normal case and prints its own error.
  const tagged = await capture('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}^{commit}`], {
    stdio: ['ignore', 'pipe', 'ignore']
  })
  if (tagged.code === 0 && tagged.out.trim() && tagged.out.trim() !== head) {
    throw new Error(
      `Tag ${tag} already points at ${tagged.out.trim().slice(0, 8)}, not HEAD. Run npm version first.`
    )
  }

  console.log(`  version ${version}, HEAD ${sha}, node ${process.versions.node}`)
  return { version, sha }
}

/** Zips a folder's contents with `index.html` at the root of the archive. */
async function zipFolder(folder, target) {
  await rm(target, { force: true })
  await run(sevenBin.path7za, ['a', '-tzip', '-r', target, '.'], { cwd: folder })
  const listed = await capture(sevenBin.path7za, ['l', '-slt', target])
  const paths = [...listed.out.matchAll(/^Path = (.+)$/gm)].map((m) => m[1].replace(/\\/g, '/'))
  // The first Path line is the archive itself; the rest are its entries.
  if (!paths.slice(1).includes('index.html')) {
    throw new Error(`${basename(target)} has no index.html at its root.`)
  }
  return (await stat(target)).size
}

/** Everything the packaged folder has to contain, and the things it must not. */
async function assertDesktopPayload(version) {
  const required = [
    'Venus University.exe',
    '.itch.toml',
    'resources/app.asar',
    'resources/app.asar.unpacked/node_modules/7zip-bin/win/x64/7za.exe',
    'resources/build-manifest.json'
  ]
  for (const rel of required) {
    if (!existsSync(join(UNPACKED, rel))) throw new Error(`The build is missing ${rel}.`)
  }

  const manifest = JSON.parse(await readFile(join(UNPACKED, 'resources/build-manifest.json'), 'utf8'))
  if (manifest.version !== version) {
    throw new Error(
      `resources/build-manifest.json is version ${manifest.version}, but the release is ${version}.`
    )
  }
  for (const file of manifest.files) {
    if (!existsSync(join(UNPACKED, file.rel))) {
      throw new Error(`resources/build-manifest.json lists ${file.rel}, which the build does not have.`)
    }
  }

  const updateSource = await readFile(join(REPO, 'src/shared/updateSource.ts'), 'utf8')
  const targetMatch = updateSource.match(/ITCH_TARGET = '([^']+)'/)
  if (!targetMatch) throw new Error('Could not find ITCH_TARGET in src/shared/updateSource.ts.')
  const { itchTarget } = JSON.parse(await readFile(join(REPO, 'build/release.json'), 'utf8'))
  if (itchTarget !== targetMatch[1]) {
    throw new Error(
      `build/release.json's itchTarget (${itchTarget}) does not match ITCH_TARGET (${targetMatch[1]}).`
    )
  }

  const cast = await readdir(join(UNPACKED, 'resources/assets/characters'))
  if (cast.length !== 24) {
    throw new Error(`resources/assets/characters holds ${cast.length} characters, expected 24.`)
  }
  if (existsSync(join(UNPACKED, 'resources/assets/bg'))) {
    throw new Error('resources/assets/bg was shipped; the renderer bundles the backgrounds.')
  }

  const asar = join(UNPACKED, 'resources/app.asar')
  const asarBytes = (await stat(asar)).size
  let listed = null
  try {
    listed = (await import('@electron/asar')).listPackage(asar)
  } catch {
    // electron-builder brings @electron/asar with it; if a future version stops,
    // the size is the coarse stand-in for the listing.
  }
  if (listed) {
    const stray = listed.filter((entry) =>
      /^[/\\](data|src|test)([/\\]|$)/.test(entry)
    )
    if (stray.length > 0) throw new Error(`app.asar carries ${stray.slice(0, 5).join(', ')}.`)
    console.log(`  app.asar: ${listed.length} entries, ${mb(asarBytes)}`)
  } else {
    // The renderer's bundled backgrounds are most of the archive, so the coarse
    // cap sits well above them rather than near the code's own size.
    if (asarBytes > 200 * 1024 * 1024) {
      throw new Error(`app.asar is ${mb(asarBytes)}; something outside out/ was packaged.`)
    }
    console.log(`  app.asar: ${mb(asarBytes)} (unlisted)`)
  }
  return asarBytes
}

async function main() {
  const started = Date.now()
  const { version, sha } = await step('preflight', preflight)

  await step('clean release/', () => rm(RELEASE, { recursive: true, force: true }))
  await step('typecheck', () => run(process.execPath, [npmCli(), 'run', 'typecheck']))
  await step('test', () => run(process.execPath, [npmCli(), 'test']))

  const packed = await step('pack the shipped cast', packCharacters)
  console.log(
    `  ${packed.characters} characters, ${packed.images} images, ${mb(packed.packBytes)} of packs; ` +
      `encoded ${packed.encoded}, cached ${packed.cached}`
  )

  await step('build the browser bundle', () =>
    run(process.execPath, [nodeBin('vite/bin/vite.js'), 'build', '-c', 'vite.web.config.ts'])
  )

  await step('check the itch.io limits', async () => {
    const failures = await checkItchLimits(WEB_OUT, (line) => console.log(line))
    if (failures.length > 0) {
      for (const line of failures) console.error(`  - ${line}`)
      throw new Error(`${failures.length} itch.io limit check(s) failed.`)
    }
  })

  const webZip = join(RELEASE, `venus-university-web-${version}.zip`)
  const webZipBytes = await step('zip the browser build', () => zipFolder(WEB_OUT, webZip))

  await step('build the desktop bundles', () =>
    run(process.execPath, [nodeBin('electron-vite/bin/electron-vite.js'), 'build'])
  )

  await step('package the desktop app', () =>
    run(process.execPath, [
      nodeBin('electron-builder/cli.js'),
      '--win',
      'zip',
      '--config',
      'electron-builder.yml'
    ])
  )

  const asarBytes = await step('check the desktop payload', () => assertDesktopPayload(version))

  const winZip = join(RELEASE, `venus-university-${version}-win.zip`)
  const winZipBytes = existsSync(winZip) ? (await stat(winZip)).size : 0
  const webFiles = (await readdir(WEB_OUT, { withFileTypes: true, recursive: true })).filter((e) =>
    e.isFile()
  ).length
  const webBytes = await folderBytes(WEB_OUT)
  const unpackedBytes = await folderBytes(UNPACKED)

  const { itchTarget } = JSON.parse(await readFile(join(REPO, 'build', 'release.json'), 'utf8'))

  console.log(`\n=== Venus University ${version} (${sha})`)
  const rows = [
    ['browser folder', WEB_OUT, `${webFiles} files / 1000, ${mb(webBytes)} / 500.0 MB`],
    ['browser zip', webZip, mb(webZipBytes)],
    ['desktop folder', UNPACKED, `${mb(unpackedBytes)}, app.asar ${mb(asarBytes)}`],
    ['desktop zip', winZip, winZipBytes ? mb(winZipBytes) : 'missing'],
    [
      'transcode cache',
      `${packed.encoded} encoded / ${packed.cached} cached`,
      `sharp ${packed.sharp}, libvips ${packed.libvips}`
    ]
  ]
  for (const [label, where, measure] of rows) {
    console.log(`  ${label.padEnd(16)} ${measure.padEnd(34)} ${where}`)
  }
  for (const { name, seconds } of timings) {
    console.log(`  ${seconds.toFixed(1).padStart(7)}s  ${name}`)
  }
  console.log(`  ${((Date.now() - started) / 1000).toFixed(1)}s total`)

  console.log('\nPush to itch.io with:')
  console.log(`  butler push release/web ${itchTarget}:html5 --userversion ${version}`)
  console.log(`  butler push release/win-unpacked ${itchTarget}:windows --userversion ${version}`)
}

main().catch((err) => {
  console.error(`\nRelease failed: ${err.message}`)
  process.exitCode = 1
})
