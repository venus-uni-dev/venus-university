import { appError } from './errors'
import { isLogLevel, type LogLevel } from './types'

/** What the app log is: how big it may get, what a record looks like, and what a trim keeps. */

/** The size the log is trimmed back from. */
export const MAX_LOG_BYTES = 10 * 1024 * 1024

/** What a trim keeps: the newest half of the log, from its first whole line. */
export const KEEP_BYTES = MAX_LOG_BYTES / 2

/** What every line of a record after its first carries, so only a record starts at column 0. */
const CONTINUATION = '  '

/** The level and text of a log record that arrived from outside the type system. */
export function logRecordOf(level: unknown, text: unknown): { level: LogLevel; text: string } {
  if (!isLogLevel(level) || typeof text !== 'string') {
    throw appError('LOG_RECORD_INVALID', 'That is not a log record.')
  }
  return { level, text }
}

/** A clock reading as `YYYY-MM-DD HH:MM:SS.mmm`, local. */
function stamp(at: Date): string {
  const pad = (value: number, width = 2): string => String(value).padStart(width, '0')
  const date = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`
  return `${date} ${time}.${pad(at.getMilliseconds(), 3)}`
}

/** One record as the log holds it, its every line after the first indented. */
export function formatRecord(
  source: 'main' | 'renderer',
  level: LogLevel,
  text: string,
  at: Date
): string {
  const body = text.replaceAll('\n', `\n${CONTINUATION}`)
  return `${stamp(at)} ${source.padEnd(8)} ${level.padEnd(5)} ${body}\n`
}

/** What a trim keeps out of the newest {@link KEEP_BYTES}: everything past the first line break. */
export function trimToHalf(tail: Uint8Array): Uint8Array {
  const start = tail.indexOf(10)
  return start === -1 ? tail.subarray(0, 0) : tail.subarray(start + 1)
}

/** What a saved copy of the log is called: `vu_log_<local date and time>.log`, safe as a filename. */
export function logExportName(at = new Date()): string {
  return `vu_log_${stamp(at).slice(0, 19).replace(' ', '_').replaceAll(':', '-')}.log`
}
