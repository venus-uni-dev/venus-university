import { spawnSync } from 'child_process'

/**
 * Windows process-tree teardown for spawned servers; synchronous for `will-quit`
 * because Electron does not await it.
 */

/** Kills `pid` and every process descended from it. */
export function killTree(pid: number | undefined): void {
  if (!pid) return

  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore'
    })
  }
}

/**
 * Every running process whose executable path is in `exePaths`, or `null` where Windows
 * would not answer — which is not the same as an empty listing.
 */
export function listProcessIds(exePaths: readonly string[]): number[] | null {
  if (process.platform !== 'win32') return null

  // Single-quoted PowerShell strings are literal; only an embedded quote needs doubling.
  const filter = exePaths
    .map((path) => `'${path.toLowerCase().replace(/'/g, "''")}'`)
    .join(',')

  const result = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and (@(${filter}) -contains $_.ExecutablePath.ToLower()) } | ForEach-Object { $_.ProcessId }`
    ],
    { windowsHide: true, encoding: 'utf8', timeout: 15_000 }
  )

  if (result.error || result.status !== 0) return null

  const pids: number[] = []
  for (const line of (result.stdout ?? '').split('\n')) {
    const pid = Number(line.trim())
    if (Number.isInteger(pid) && pid > 0) pids.push(pid)
  }
  return pids
}

/**
 * Kills every running process whose executable path is in `exePaths`, tree and all; a
 * listing Windows would not answer leaves nothing to kill.
 */
export function killStrayProcesses(exePaths: readonly string[]): void {
  for (const pid of listProcessIds(exePaths) ?? []) {
    console.log(`[cleanup] killing stray process ${pid}`)
    killTree(pid)
  }
}
