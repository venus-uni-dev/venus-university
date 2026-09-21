import { spawn } from 'child_process'
import { appendFileSync, existsSync } from 'fs'
import { mkdir, readFile, rename } from 'fs/promises'
import { dirname, join } from 'path'

/**
 * The swap half of an update, run by the app's own exe in Node mode after the app has quit:
 * it parks the files the update replaces or drops, moves the staged ones in, rolls back if any
 * of that fails, and relaunches the game either way. Node builtins only — no electron, no app.
 */

// Electron's Node mode may still shim `fs` for `.asar` paths; here every one is a plain file.
;(process as { noAsar?: boolean }).noAsar = true

/** What `plan.json` carries: where everything is, and which paths move. */
interface Plan {
  schemaVersion: number
  parentPid: number
  installDir: string
  newDir: string
  oldDir: string
  logPath: string
  exe: string
  install: string[]
  remove: string[]
}

/** How long the app is given to exit before the swap is abandoned. */
const EXIT_TIMEOUT_MS = 60_000

/** How often the app's process is looked for while it shuts down. */
const POLL_MS = 200

/** How many times a rename is retried while a scanner or a straggler holds the file. */
const RENAME_TRIES = 5

/** How long between those tries. */
const RENAME_BACKOFF_MS = 300

/** Errors that mean "something holds this file right now", rather than "this cannot work". */
const HELD_CODES = new Set(['EBUSY', 'EPERM', 'EACCES'])

/** Where the lines go, and the roots that come out of them; set once the plan is read. */
let logPath: string | null = null
let roots: Array<{ pattern: RegExp; label: string }> = []

/** A clock reading as `YYYY-MM-DD HH:MM:SS.mmm`, local. */
function stamp(at: Date): string {
  const pad = (value: number, width = 2): string => String(value).padStart(width, '0')
  const date = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`
  return `${date} ${time}.${pad(at.getMilliseconds(), 3)}`
}

/** This machine's paths out of one line, the same placeholders the app's own log uses. */
function redact(text: string): string {
  let out = text
  for (const root of roots) out = out.replace(root.pattern, root.label)
  return out
}

/** Appends one record to the app log; a failed log costs nothing but the log. */
function log(level: 'LOG' | 'WARN' | 'ERROR', text: string): void {
  const body = redact(text).replaceAll('\n', '\n  ')
  const record = `${stamp(new Date())} ${'helper'.padEnd(8)} ${level.padEnd(5)} ${body}\n`
  try {
    if (logPath !== null) appendFileSync(logPath, record, 'utf8')
  } catch {
    // Nothing to report it to.
  }
}

/** The message off any thrown value. */
function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** A path as a case-insensitive pattern, so a line naming it in any spelling is replaced. */
function rootPattern(path: string): RegExp {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\\|\//g, '[\\\\/]')
  return new RegExp(escaped, 'gi')
}

/** Refuses a plan that is not this build's, or that names anything but plain relative paths. */
function checkPlan(parsed: unknown): Plan {
  if (typeof parsed !== 'object' || parsed === null) throw new Error('the plan is not an object')
  const plan = parsed as Partial<Plan>
  if (plan.schemaVersion !== 1) {
    throw new Error(`unsupported plan schemaVersion ${String(plan.schemaVersion)}`)
  }
  for (const field of ['installDir', 'newDir', 'oldDir', 'logPath', 'exe'] as const) {
    if (typeof plan[field] !== 'string' || plan[field] === '') {
      throw new Error(`the plan has no ${field}`)
    }
  }
  if (typeof plan.parentPid !== 'number') throw new Error('the plan has no parentPid')
  for (const list of ['install', 'remove'] as const) {
    if (!Array.isArray(plan[list])) throw new Error(`the plan has no ${list} list`)
    for (const rel of plan[list] as unknown[]) {
      if (typeof rel !== 'string') throw new Error(`${list} holds something that is not a path`)
      checkRel(rel)
    }
  }
  return plan as Plan
}

/** Refuses one path that could land outside the install folder, or inside the player's data. */
function checkRel(rel: string): void {
  const path = rel.replace(/\\/g, '/')
  if (path === '') throw new Error('the plan names a file with no name')
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) throw new Error(`${rel} is an absolute path`)
  if (path.split('/').includes('..')) throw new Error(`${rel} climbs out of the app folder`)
  if (path.toLowerCase() === 'data' || path.toLowerCase().startsWith('data/')) {
    throw new Error(`${rel} is under the data folder`)
  }
}

/** Waits until the app's process is gone; false when it is still there after the cap. */
async function waitForExit(pid: number): Promise<boolean> {
  const deadline = Date.now() + EXIT_TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0)
    } catch (err) {
      // ESRCH is the answer this waits for: no such process.
      if ((err as NodeJS.ErrnoException).code === 'ESRCH') return true
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
  return false
}

/** One rename, retried while the file is merely held rather than unmovable. */
async function moveFile(from: string, to: string): Promise<void> {
  await mkdir(dirname(to), { recursive: true })
  for (let attempt = 1; ; attempt++) {
    try {
      await rename(from, to)
      return
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? ''
      if (attempt >= RENAME_TRIES || !HELD_CODES.has(code)) throw err
      await new Promise((resolve) => setTimeout(resolve, RENAME_BACKOFF_MS))
    }
  }
}

/** Puts every move back where it came from, newest first; a miss is logged and passed over. */
async function rollback(journal: Array<[string, string]>): Promise<void> {
  log('WARN', 'rolling the swap back')
  for (const [from, to] of [...journal].reverse()) {
    try {
      await moveFile(to, from)
    } catch (err) {
      log('ERROR', `could not put ${from} back: ${messageOf(err)}`)
    }
  }
}

/** Parks what the update replaces or drops, then moves the staged files into their places. */
async function swap(plan: Plan, journal: Array<[string, string]>): Promise<void> {
  for (const rel of [...plan.install, ...plan.remove]) {
    const live = join(plan.installDir, rel)
    if (!existsSync(live)) continue
    const parked = join(plan.oldDir, rel)
    await moveFile(live, parked)
    journal.push([live, parked])
  }

  for (const rel of plan.install) {
    const staged = join(plan.newDir, rel)
    const live = join(plan.installDir, rel)
    await moveFile(staged, live)
    journal.push([staged, live])
  }
}

/** Starts the game again, detached, as a window rather than as this process's Node mode. */
function relaunch(plan: Plan): void {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  try {
    const child = spawn(plan.exe, [], {
      env,
      detached: true,
      stdio: 'ignore',
      cwd: plan.installDir
    })
    child.unref()
  } catch (err) {
    log('ERROR', `could not restart the game: ${messageOf(err)}`)
  }
}

/** Reads the plan, waits the app out, swaps, and relaunches whatever the swap did. */
async function main(): Promise<number> {
  const planPath = process.argv[2]
  if (planPath === undefined) return 1

  let plan: Plan
  try {
    plan = checkPlan(JSON.parse(await readFile(planPath, 'utf-8')))
  } catch (err) {
    // Nothing has moved and the log path is not known; the app's next launch sweeps the folder.
    console.error(`[helper] ${messageOf(err)}`)
    return 1
  }

  logPath = plan.logPath
  roots = [
    { pattern: rootPattern(join(plan.installDir, 'data')), label: '<data>' },
    { pattern: rootPattern(plan.installDir), label: '<app>' }
  ]

  log('LOG', `waiting for the app (pid ${plan.parentPid}) to exit`)
  if (!(await waitForExit(plan.parentPid))) {
    log('ERROR', 'the app is still running; nothing was changed')
    return 1
  }

  const journal: Array<[string, string]> = []
  let failure: string | null = null
  try {
    log('LOG', `swapping: ${plan.install.length} files in, ${plan.remove.length} out`)
    await swap(plan, journal)
    log('LOG', 'the swap is done')
  } catch (err) {
    failure = messageOf(err)
    log('ERROR', `the swap failed: ${failure}`)
    await rollback(journal)
  }

  relaunch(plan)
  return failure === null ? 0 : 1
}

void main()
  .catch((err: unknown) => {
    console.error(`[helper] ${messageOf(err)}`)
    return 1
  })
  .then((code) => {
    process.exit(code)
  })
