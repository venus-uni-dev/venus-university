import { formatRecord, KEEP_BYTES, logExportName, MAX_LOG_BYTES, trimToHalf } from '@shared/logRules'
import type { LogLevel } from '@shared/types'
import { readLog, writeLog } from './db/log'
import { offerDownload } from './download'

/**
 * The app log in the browser: the text is held in memory and flushed to storage behind the
 * console, since a write per printed line would be a database round trip per printed line.
 * Past the cap the oldest half is dropped, as it is on disk.
 */

/** How long the log waits after a record before what it holds is written out. */
const FLUSH_MS = 2000

const encoder = new TextEncoder()
const decoder = new TextDecoder()

let text = ''
let bytes = 0
let flushing: ReturnType<typeof setTimeout> | null = null

/** Picks up what the last visit left behind, so the log outlives a reload. */
export async function openLog(): Promise<void> {
  text = await readLog()
  bytes = encoder.encode(text).length
}

/** Drops the oldest half of the log, keeping the newest bytes from their first line break. */
function trim(): void {
  const whole = encoder.encode(text)
  const kept = trimToHalf(whole.subarray(Math.max(0, whole.length - KEEP_BYTES)))
  text = decoder.decode(kept)
  bytes = kept.length
}

/** Writes what is in memory out, at most once every {@link FLUSH_MS}. */
function scheduleFlush(): void {
  if (flushing !== null) return
  flushing = setTimeout(() => {
    flushing = null
    void writeLog(text).catch((err: unknown) => {
      // A log that will not write costs nothing but the log.
      console.warn('[log] the app log could not be saved:', err)
    })
  }, FLUSH_MS)
}

/** Appends one record. Accounted in bytes: the app prints arrows and ticks. */
export function writeLogLine(level: LogLevel, line: string): void {
  const record = formatRecord('renderer', level, line, new Date())
  text += record
  bytes += encoder.encode(record).length
  if (bytes > MAX_LOG_BYTES) trim()
  scheduleFlush()
}

/** Offers a copy of the log for saving, and answers with the name it is offered under. */
export function exportLog(): string {
  return offerDownload(logExportName(), text, 'text/plain')
}
