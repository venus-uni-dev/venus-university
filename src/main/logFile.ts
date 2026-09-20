/**
 * The app log: every console line of both processes, appended to one capped file. Main's
 * lands here as it prints and the renderer's arrives over IPC; past the cap the oldest half
 * of the file is dropped.
 */

import { app } from 'electron'
import { existsSync, fstatSync, mkdirSync, openSync, readSync, writeFileSync, writeSync } from 'fs'
import { copyFile } from 'fs/promises'
import { format } from 'util'
import { appError } from '@shared/errors'
import { formatRecord, KEEP_BYTES, MAX_LOG_BYTES, trimToHalf } from '@shared/logRules'
import type { LogLevel } from '@shared/types'
import { getAppLogPath, getDataPath } from './paths'
import { redact } from './redact'

/** The console as it was before {@link installConsoleLog} wrapped it; the log reports through it. */
const original = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  debug: console.debug.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console)
}

// The descriptor, the byte count it is capped against, and the states a failure leaves behind.
// The file is never closed: `writeSync` hands each record to the OS as it runs, so the log is
// whole at whatever point the process ends, shutdown included.
let fd: number | null = null
let size = 0
let disabled = false
let trimFailed = false
let installed = false

/** Opens the file on the first write, onto the end of what the last run left. */
function open(): boolean {
  if (fd !== null) return true
  try {
    mkdirSync(getDataPath(), { recursive: true })
    // Read-write (`a+`): a trim reads the tail back through this same descriptor.
    fd = openSync(getAppLogPath(), 'a+')
    size = fstatSync(fd).size
    return true
  } catch (err) {
    disabled = true
    original.warn('[log] app log unavailable:', err)
    return false
  }
}

/** Writes every byte of one buffer, however many calls the OS takes them in. */
function writeAll(buffer: Buffer): void {
  const handle = fd
  if (handle === null) return
  let offset = 0
  while (offset < buffer.length) {
    offset += writeSync(handle, buffer, offset)
  }
}

/** Drops the oldest half of the file, keeping the newest bytes from their first line break. */
function trim(): void {
  const handle = fd
  if (handle === null) return
  const length = Math.min(KEEP_BYTES, size)
  const buffer = Buffer.alloc(length)
  const read = buffer.subarray(0, readSync(handle, buffer, 0, length, size - length))
  const tail = trimToHalf(read)
  // Rewritten by path: Windows refuses to shorten a handle that was opened for appending, and
  // the open descriptor goes on appending at whatever end of file this leaves.
  writeFileSync(getAppLogPath(), tail)
  size = tail.length
}

/** Appends one record; a failed log costs nothing but the log, so this never throws. */
export function writeLogLine(source: 'main' | 'renderer', level: LogLevel, text: string): void {
  if (disabled || !open()) return

  // Built once and accounted in bytes: the app prints arrows, ticks and dashes, so the
  // character count would drift from what the file actually holds. This machine's paths go
  // out of the text on the way in.
  const record = Buffer.from(formatRecord(source, level, redact(text), new Date()), 'utf8')

  if (!trimFailed && size + record.length > MAX_LOG_BYTES) {
    try {
      trim()
    } catch (err) {
      trimFailed = true
      original.warn('[log] app log could not be trimmed; it will grow past its cap:', err)
    }
  }

  try {
    writeAll(record)
    size += record.length
  } catch (err) {
    disabled = true
    original.warn('[log] app log write failed; nothing more is logged:', err)
  }
}

/**
 * Copies the log to a path the player picked. A copy by path holds everything written so far,
 * since every record goes through the held descriptor synchronously as it prints.
 */
export async function copyLogTo(target: string): Promise<void> {
  const source = getAppLogPath()
  if (!existsSync(source)) throw appError('LOG_MISSING', 'There is no app log to save yet.')
  await copyFile(source, target)
}

/** Wraps main's console: every call prints as it always did, and is written to the log as well. */
export function installConsoleLog(): void {
  if (installed) return
  installed = true

  /** One console method: the original first, then the same call as a record. */
  const wrap =
    (level: LogLevel, method: (...args: unknown[]) => void) =>
    (...args: unknown[]): void => {
      method(...args)
      try {
        writeLogLine('main', level, format(...args))
      } catch {
        // A console call never throws.
      }
    }

  console.log = wrap('LOG', original.log)
  console.info = wrap('LOG', original.info)
  console.debug = wrap('LOG', original.debug)
  console.warn = wrap('WARN', original.warn)
  console.error = wrap('ERROR', original.error)

  writeLogLine('main', 'LOG', `==== Venus University ${app.getVersion()} started ====`)
}
