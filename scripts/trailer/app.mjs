// Starting and stopping the dev app the trailer is staged in, and connecting to its two
// debugger ports: 9222 for the renderer, 9229 for the main process.

import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connect, sleep, targets } from './cdp.mjs'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const RENDERER_PORT = 9222
export const MAIN_PORT = 9229

/** Where the launch records its pid and start time, so teardown kills only what it started. */
const STATE = join(ROOT, 'data', 'tmp', 'trailer-launch.json')
const LOG = join(ROOT, 'data', 'tmp', 'trailer-dev.log')

/** How long after the launch an Electron process can still be one of this launch's own. */
const LAUNCH_WINDOW_MS = 120000

/** The flags that keep an unfocused Electron window painting and animating. */
const WINDOW_FLAGS = [
  '--disable-features=CalculateNativeWinOcclusion',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding'
]

/**
 * Starts `electron-vite dev` with both debugger ports open, detached, and waits for the
 * renderer to answer. Refuses when either port is already bound — which is almost always the
 * user's own dev instance, and talking to it would stage the trailer over their work.
 */
export async function launch({ quiet = false } = {}) {
  for (const port of [RENDERER_PORT, MAIN_PORT]) {
    const list = await targets(port, port === MAIN_PORT ? '/json' : '/json/version')
    if (list) {
      throw new Error(
        `port ${port} is already bound — close your own electron-vite dev instance first`
      )
    }
  }

  mkdirSync(dirname(LOG), { recursive: true })
  const out = openSync(LOG, 'a')
  // A couple of seconds of slack: the Electron processes start after the spawn, never before.
  const startedMs = Date.now() - 2000

  // ELECTRON_RUN_AS_NODE is set by some parent shells and makes main crash on `isPackaged`.
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE

  const child = spawn(
    'npx',
    [
      'electron-vite',
      'dev',
      '--remoteDebuggingPort',
      String(RENDERER_PORT),
      '--inspect',
      String(MAIN_PORT),
      '--',
      ...WINDOW_FLAGS
    ],
    { cwd: ROOT, env, shell: true, detached: true, stdio: ['ignore', out, out] }
  )
  child.unref()
  writeFileSync(STATE, JSON.stringify({ pid: child.pid, startedMs }, null, 2))

  if (!quiet) console.log(`[trailer] launching (pid ${child.pid}); logging to ${LOG}`)
  const page = await waitForRenderer()
  if (!quiet) console.log(`[trailer] renderer is up at ${page.url}`)
  const inspector = await targets(MAIN_PORT, '/json')
  if (!quiet) {
    console.log(
      inspector
        ? `[trailer] the main-process inspector answered on ${MAIN_PORT}`
        : `[trailer] the main-process inspector did not answer on ${MAIN_PORT}; the LLM stub is off`
    )
  }
  return { pid: child.pid, inspector: Boolean(inspector) }
}

/** The window's own page. Vite steps to the next port when one is taken, so the port is not named. */
const isRendererPage = (t) => t.type === 'page' && /^https?:\/\/localhost:\d+\//u.test(t.url)

/** Polls 9222 until the renderer's own page target is there. */
async function waitForRenderer(timeoutMs = 90000) {
  const started = Date.now()
  for (;;) {
    const page = (await targets(RENDERER_PORT))?.find(isRendererPage)
    if (page) return page
    if (Date.now() - started > timeoutMs) throw new Error('the renderer never came up on 9222')
    await sleep(1000)
  }
}

/** A session on the renderer. */
export async function renderer() {
  return connect(RENDERER_PORT, isRendererPage)
}

/** A session on the main process, or null when the inspector is not listening. */
export async function main() {
  const list = await targets(MAIN_PORT, '/json')
  if (!list || list.length === 0) return null
  return connect(MAIN_PORT, () => true, '/json')
}

/**
 * Kills the Electron processes this repo's launch started — matched on both the executable's
 * path and a start time after the launch, so nothing else on the machine is touched.
 */
export function teardown({ quiet = false } = {}) {
  const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : null
  if (!state) {
    if (!quiet) console.log('[trailer] no launch on record; nothing to stop')
    return 0
  }
  // All three tests matter: the path says the binary is this checkout's, and the window either
  // side of the launch says the process is one this launch made — not an older instance the user
  // is still using, and not a newer one they started while the trailer was being recorded.
  const script = [
    `$since = ${state.startedMs}`,
    `$until = ${state.startedMs + LAUNCH_WINDOW_MS}`,
    `$root = '${join(ROOT, 'node_modules')}'`,
    '$found = @(Get-Process electron -ErrorAction SilentlyContinue | Where-Object {',
    '  $started = ([DateTimeOffset]$_.StartTime).ToUnixTimeMilliseconds()',
    '  $_.Path -and $_.Path.StartsWith($root) -and $started -gt $since -and $started -lt $until })',
    '$found | ForEach-Object { Stop-Process -Id $_.Id -Force }',
    '$found.Count'
  ].join('\n')
  const printed = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { encoding: 'utf8' }
  )
  rmSync(STATE, { force: true })
  const killed = Number(printed.trim().split(/\s+/u).pop()) || 0
  if (!quiet) console.log(`[trailer] stopped ${killed} Electron process(es)`)
  return killed
}
