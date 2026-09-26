import { app } from 'electron'
import { spawn } from 'child_process'
import { copyFile, mkdir, readdir, readFile, rm, stat, statfs, writeFile } from 'fs/promises'
import { basename, join } from 'path'
import { appError, messageOf, toAppError } from '@shared/errors'
import type {
  AppError,
  BuildManifest,
  FileStamp,
  Settings,
  UpdateCheck,
  UpdateProgress
} from '@shared/types'
import {
  ITCH_PAGE_URL,
  ITCH_WINDOWS_UPLOAD_ID,
  latestUrl,
  uploadFileUrl
} from '@shared/updateSource'
import { getAppLogPath, getDataPath, getInstallPath, getUpdatePath } from '../paths'
import { redactError } from '../redact'
import { discard, extractZip, stripWrapperDir } from './archiveService'
import { downloadFile } from './downloadService'
import { writeAtomicJson } from './jsonFile'
import { getSettings } from './settingsService'
import {
  compareVersions,
  isBuildManifest,
  isSwapFailure,
  parseLatest,
  planUpdate
} from './updatePlan'

/**
 * The desktop's updater: the launch check against the itch.io channel, and the run that
 * downloads the newer build, stages it under `/data/update` and hands the swap to the helper
 * the app spawns on its way out. `data/` is never part of either.
 */

/** The launch check is one small request; an offline boot must not wait on it. */
const CHECK_TIMEOUT_MS = 6000

/** Each half of the download handshake, which fetches a page rather than a file. */
const HANDSHAKE_TIMEOUT_MS = 15000

/** How long a started download may go without a byte before it counts as stalled. */
const STALL_MS = 60000

/** Where a build's file manifest sits, inside the install and inside the staged tree alike. */
const MANIFEST_REL = 'resources/build-manifest.json'

/** Where the helper leaves word of a swap that did not land, inside the update folder. */
const FAILED_REL = 'failed.json'

/** What itch.io sees this build as. */
function userAgent(): string {
  return `VenusUniversity/${app.getVersion()}`
}

/** True for an address the app will fetch from. */
function isHttps(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:'
  } catch {
    return false
  }
}

/** The hand-edited dev feed that stands in for both itch endpoints, or null when there is none. */
function feedUrlOf(settings: Settings | null): string | null {
  const feed = settings?.updateFeed
  if (feed === undefined) return null
  if (!isHttps(feed)) {
    console.warn('[update] updateFeed is not an https address; ignoring it')
    return null
  }
  return feed
}

/** What the feed answers: the version it serves and where its zip is. */
async function readFeed(feedUrl: string): Promise<{ latest: string | null; url: string | null }> {
  const response = await fetch(feedUrl, {
    signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    headers: { 'User-Agent': userAgent() }
  })
  if (!response.ok) {
    throw appError('UPDATE_FEED_FAILED', `The update feed answered HTTP ${response.status}.`)
  }
  const body = (await response.json()) as { url?: unknown }
  return { latest: parseLatest(body), url: typeof body.url === 'string' ? body.url : null }
}

/** itch.io's channel endpoint: the newest user-version pushed, or null when a push carried none. */
async function readChannelLatest(): Promise<string | null> {
  const response = await fetch(latestUrl(), {
    signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    headers: { 'User-Agent': userAgent() }
  })
  if (!response.ok) {
    throw appError('UPDATE_CHECK_FAILED', `itch.io answered HTTP ${response.status}.`)
  }
  return parseLatest(await response.json())
}

/**
 * Asks whether a newer build is out. A failure of any kind answers "no update": an offline
 * launch is ordinary, and nothing here may hold up the boot or reach the player as an error.
 */
async function runCheck(): Promise<UpdateCheck> {
  const settings = await getSettings().catch(() => null)
  const current = settings?.updateAsVersion ?? app.getVersion()
  const none: UpdateCheck = { current, latest: null, available: false }
  const feed = feedUrlOf(settings)

  // A dev run has no install to replace, so it checks only under one of the dev switches.
  if (!app.isPackaged && settings?.updateAsVersion === undefined && feed === null) return none

  try {
    const latest = feed === null ? await readChannelLatest() : (await readFeed(feed)).latest
    const available = latest !== null && compareVersions(latest, current) > 0
    console.log(`[update] running ${current}, latest ${latest ?? 'unknown'}`)
    return { current, latest, available }
  } catch (err) {
    console.warn('[update] check failed:', messageOf(err))
    return none
  }
}

/** The check's answer, asked for once per run. */
let checking: Promise<UpdateCheck> | null = null

/** What the last launch's swap left behind, read before the folder is swept. */
let rolledBack: Promise<AppError | null> = Promise.resolve(null)

/** The sweep of the update folder, which a new update waits out before staging into it. */
let sweeping: Promise<void> = Promise.resolve()

/** Starts the launch check, so the renderer's ask a moment later costs nothing. */
export function startUpdateCheck(): void {
  checking ??= runCheck()
}

/**
 * What the launch check found, starting it if the boot has not, and word of the last update's
 * swap when it did not land.
 */
export async function getUpdateCheck(): Promise<UpdateCheck> {
  checking ??= runCheck()
  const [check, failure] = await Promise.all([checking, rolledBack])
  return failure === null ? check : { ...check, lastFailure: failure }
}

/**
 * The note a failed swap left, as the error the player is told, or null when there is none this
 * build reads. Redacted here, since a successful answer is not redacted on its way out.
 */
async function readRolledBack(dir: string): Promise<AppError | null> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(join(dir, FAILED_REL), 'utf-8'))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    console.warn('[update] the failure note could not be read:', messageOf(err))
    return null
  }
  if (!isSwapFailure(parsed)) {
    console.warn('[update] the failure note is not one this build reads')
    return null
  }
  console.warn('[update] the last update did not land:', parsed.message)
  return redactError(
    appError(
      'UPDATE_SWAP_FAILED',
      'The last update could not be applied, so the previous version was restored.',
      parsed.message
    )
  )
}

/** Every handshake miss reads the same: which step, and what the server said. Never the token. */
function sourceChanged(step: string, detail: string): AppError {
  return appError(
    'UPDATE_SOURCE_CHANGED',
    'itch.io did not answer the download the way this build expects.',
    `${step}: ${detail}`
  )
}

/**
 * What the page's own Download button does: read the page for its csrf token and cookie, then
 * ask it for this upload and get back a signed address, good for about a minute.
 */
async function signedDownloadUrl(): Promise<string> {
  const page = await fetch(ITCH_PAGE_URL, {
    signal: AbortSignal.timeout(HANDSHAKE_TIMEOUT_MS),
    headers: { 'User-Agent': userAgent() }
  })
  if (!page.ok) throw sourceChanged('page', `HTTP ${page.status}`)

  const cookie = page.headers
    .getSetCookie()
    .map((line) => line.split(';')[0])
    .join('; ')
  const html = await page.text()

  const csrf = /csrf_token" value="([^"]+)"/.exec(html)?.[1]
  if (csrf === undefined) throw sourceChanged('page', 'it carries no csrf token')
  if (!html.includes(`data-upload_id="${ITCH_WINDOWS_UPLOAD_ID}"`)) {
    throw sourceChanged('page', 'it does not offer this build')
  }

  const response = await fetch(uploadFileUrl(ITCH_WINDOWS_UPLOAD_ID), {
    method: 'POST',
    signal: AbortSignal.timeout(HANDSHAKE_TIMEOUT_MS),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: ITCH_PAGE_URL,
      Cookie: cookie,
      'User-Agent': userAgent()
    },
    body: `csrf_token=${encodeURIComponent(csrf)}`
  })
  if (!response.ok) throw sourceChanged('file', `HTTP ${response.status}`)

  const body = (await response.json().catch(() => {
    throw sourceChanged('file', 'the reply is not JSON')
  })) as { url?: unknown; external?: unknown }

  if (body.external === true) throw sourceChanged('file', 'the build is hosted off itch.io')
  if (typeof body.url !== 'string' || !isHttps(body.url)) {
    throw sourceChanged('file', 'the address it answered is not an https one')
  }
  return body.url
}

/**
 * Runs `work` with Electron's asar-aware `fs` switched off, so a staged or parked `app.asar` is
 * a file to stat, move and remove rather than an archive to look inside. The app's own bundle
 * is read outside these windows.
 */
async function withoutAsar<T>(work: () => Promise<T>): Promise<T> {
  const before = process.noAsar
  process.noAsar = true
  try {
    return await work()
  } finally {
    process.noAsar = before
  }
}

/** Proves the install folder can be written before anything is downloaded into it. */
async function probeInstallWritable(installDir: string): Promise<void> {
  const probePath = join(installDir, `.vu-update-${process.pid}.tmp`)
  try {
    await writeFile(probePath, '')
  } catch (err) {
    throw appError(
      'UPDATE_INSTALL_READONLY',
      'Venus University cannot write to the folder it runs from, so it cannot update itself.',
      `${installDir}: ${messageOf(err)}`
    )
  } finally {
    await rm(probePath, { force: true }).catch(() => {})
  }
}

/** True when something is at that path. */
async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/** The one folder a zip wrapped the build in, or null when the tree is not shaped that way. */
async function wrapperDirOf(dir: string, exeName: string): Promise<string | null> {
  const dirs = (await readdir(dir, { withFileTypes: true })).filter((entry) => entry.isDirectory())
  if (dirs.length !== 1) return null
  return (await exists(join(dir, dirs[0].name, exeName))) ? dirs[0].name : null
}

/** A build's file manifest, or null when there is none there that this build can read. */
async function readManifest(path: string): Promise<BuildManifest | null> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(path, 'utf-8'))
  } catch {
    return null
  }
  return isBuildManifest(parsed) ? parsed : null
}

/** Refuses a staged tree that is missing a file its own manifest lists, or holds it at another size. */
async function assertStaged(newDir: string, files: readonly FileStamp[]): Promise<void> {
  for (const file of files) {
    let size: number
    try {
      size = (await stat(join(newDir, file.rel))).size
    } catch {
      throw appError(
        'UPDATE_BUILD_INVALID',
        'The downloaded build is missing a file it says it ships.',
        file.rel
      )
    }
    if (size !== file.size) {
      throw appError(
        'UPDATE_BUILD_INVALID',
        'A file of the downloaded build is not the size it says it is.',
        `${file.rel}: ${size} bytes, expected ${file.size}`
      )
    }
  }
}

/** The archive's size from a HEAD, or 0 when the server will not say. */
async function sizeOfDownload(url: string): Promise<number> {
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(HANDSHAKE_TIMEOUT_MS),
      headers: { 'User-Agent': userAgent() }
    })
    const length = Number(response.headers.get('content-length'))
    return Number.isFinite(length) && length > 0 ? length : 0
  } catch {
    return 0
  }
}

/** Refuses the download when the data volume has less than three times its size free. */
async function assertDiskSpace(bytes: number): Promise<void> {
  if (bytes === 0) return
  let free: number
  try {
    const volume = await statfs(getDataPath())
    free = volume.bsize * volume.bavail
  } catch {
    // Without a reading there is nothing to refuse on; the download reports its own failure.
    return
  }
  if (free < bytes * 3) {
    throw appError(
      'UPDATE_DISK_FULL',
      'There is not enough free space to download and unpack the new build.',
      `${Math.round(free / 1024 ** 2)} MB free, ${Math.round((bytes * 3) / 1024 ** 2)} MB needed`
    )
  }
}

/** Downloads the archive, treating a minute without a byte as a stall rather than a cancel. */
async function downloadBuild(
  url: string,
  destPath: string,
  emit: (progress: UpdateProgress) => void
): Promise<void> {
  const controller = new AbortController()
  let stalled = false
  let timer: NodeJS.Timeout | undefined

  const beat = (): void => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      stalled = true
      controller.abort()
    }, STALL_MS)
  }

  beat()
  try {
    await downloadFile({
      url,
      destPath,
      signal: controller.signal,
      headers: { 'User-Agent': userAgent() },
      onProgress: ({ percent, bytesDone, bytesTotal }) => {
        beat()
        emit({ phase: 'download', percent, bytesDone, bytesTotal })
      }
    })
  } catch (err) {
    if (stalled) {
      throw appError(
        'UPDATE_STALLED',
        'The download stopped partway through.',
        `No data arrived for ${STALL_MS / 1000} seconds.`
      )
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Downloads the newer build, stages it whole, works out what the install gains and loses, and
 * spawns the helper that does the swap once this process is gone. The caller quits right after.
 */
export async function applyUpdate(emit: (progress: UpdateProgress) => void): Promise<void> {
  if (!app.isPackaged) {
    throw appError(
      'UPDATE_DEV_BUILD',
      'A development build does not update itself.',
      'Run a packaged build to test the updater.'
    )
  }

  // A sweep still clearing the last update's leftovers would take this download with it.
  await sweeping

  const installDir = getInstallPath()
  const updateDir = getUpdatePath()
  await probeInstallWritable(installDir)

  await withoutAsar(() => discard(updateDir))
  await mkdir(updateDir, { recursive: true })

  try {
    const settings = await getSettings().catch(() => null)
    const current = settings?.updateAsVersion ?? app.getVersion()
    const feed = feedUrlOf(settings)

    console.log('[update] asking for the download address')
    const url = feed === null ? await signedDownloadUrl() : ((await readFeed(feed)).url ?? '')
    if (!isHttps(url)) throw sourceChanged('feed', 'it named no https address')

    await assertDiskSpace(await sizeOfDownload(url))

    const zipPath = join(updateDir, 'build.zip')
    console.log('[update] downloading the new build')
    emit({ phase: 'download', percent: 0 })
    await downloadBuild(url, zipPath, emit)

    const newDir = join(updateDir, 'new')
    console.log('[update] unpacking')
    emit({ phase: 'unpack' })
    await extractZip(zipPath, newDir, { maxEntries: 8192, maxTotalBytes: 2 * 1024 ** 3 })
    await rm(zipPath, { force: true })

    // Everything that looks at the staged tree runs without the asar shim, or the new
    // `app.asar` would stat as an empty folder.
    const { version, plan } = await withoutAsar(async () => {
      // A zip made from the folder rather than its contents arrives one level down.
      const exeName = basename(app.getPath('exe'))
      if (!(await exists(join(newDir, exeName)))) {
        const wrapper = await wrapperDirOf(newDir, exeName)
        if (wrapper !== null) await stripWrapperDir(newDir, wrapper)
      }

      const manifest = await readManifest(join(newDir, MANIFEST_REL))
      if (manifest === null) {
        throw appError(
          'UPDATE_BUILD_INVALID',
          'The downloaded build did not carry a file manifest.',
          MANIFEST_REL
        )
      }
      if (compareVersions(manifest.version, current) <= 0) {
        throw appError(
          'UPDATE_NOT_READY',
          'The new build is still being processed on itch.io. Try again later.',
          `The download is version ${manifest.version} and this is ${current}.`
        )
      }
      await assertStaged(newDir, manifest.files)

      const installed = await readManifest(join(installDir, MANIFEST_REL))
      const planned = planUpdate(manifest.files, installed === null ? null : installed.files)
      // The manifest does not list itself, and the next update is planned off the new one.
      return {
        version: manifest.version,
        plan: { ...planned, install: [...planned.install, MANIFEST_REL] }
      }
    })
    console.log(
      `[update] staged ${version}: ${plan.install.length} files in, ${plan.remove.length} out`
    )

    const planPath = join(updateDir, 'plan.json')
    await writeAtomicJson(
      planPath,
      {
        schemaVersion: 1,
        parentPid: process.pid,
        installDir,
        newDir,
        oldDir: join(updateDir, 'old'),
        logPath: getAppLogPath(),
        exe: app.getPath('exe'),
        install: plan.install,
        remove: plan.remove
      },
      { code: 'UPDATE_PLAN_UNWRITABLE', message: 'The update plan could not be written.' }
    )

    // The helper is main's second bundle; it runs from a copy outside the tree it is replacing.
    const applyPath = join(updateDir, 'apply.js')
    await copyFile(join(__dirname, 'updateHelper.js'), applyPath)

    const child = spawn(process.execPath, [applyPath, planPath], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      cwd: getDataPath()
    })
    child.unref()

    console.log('[update] handed the swap to the helper; quitting')
    emit({ phase: 'restart' })
  } catch (err) {
    await withoutAsar(() => discard(updateDir))
    throw toAppError(err, 'UPDATE_FAILED')
  }
}

/** One best-effort removal; false when something in there is still held. */
async function swept(dir: string): Promise<boolean> {
  try {
    await withoutAsar(() => rm(dir, { recursive: true, force: true }))
    return true
  } catch {
    return false
  }
}

/**
 * Drops what a finished update left behind. The helper relaunched the app from the old exe it
 * had parked, so it may still be exiting: one retry, and never a rejection.
 */
async function sweepFolder(dir: string): Promise<void> {
  if (await swept(dir)) return
  await new Promise((resolve) => setTimeout(resolve, 5000))
  if (!(await swept(dir))) {
    console.warn('[update] the update folder is still held; the next launch clears it')
  }
}

/**
 * Reads the note a failed swap left, then drops what the last update left behind; the next
 * update waits on the sweep.
 */
export function startUpdateSweep(): void {
  const dir = getUpdatePath()
  rolledBack = readRolledBack(dir)
  sweeping = rolledBack.then(() => sweepFolder(dir))
}
