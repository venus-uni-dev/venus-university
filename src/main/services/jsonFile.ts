import { randomUUID } from 'crypto'
import { readFile, rename, rm, writeFile } from 'fs/promises'
import { appError, messageOf } from '@shared/errors'
import { validateRecord, type ValidateRecordOptions } from '@shared/jsonValidate'
import { sleep } from '@shared/retry'

/** Error codes that mean the file is briefly held open by another process, not truly failed. */
const HELD_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])

/** How long to wait between rename attempts: Windows refuses a rename while a scanner or the
 * indexer holds the file it just saw change, and that hold lasts milliseconds. */
const RENAME_RETRY_WAITS_MS = [10, 20, 40, 80, 160, 320, 640]

/**
 * The JSON-on-disk mechanics every persisted-state service shares: read and parse, then the
 * shared record check, and the atomic write.
 */

/** The `detail` shape every file error carries: which path, and what the OS said. */
function detailOf(path: string, err: unknown): string {
  return `${path}: ${messageOf(err)}`
}

/** The ways reading and parsing one file can go other than to plan. */
export interface ReadJsonOptions<T> {
  /** Raised when the file is not valid JSON. */
  malformed: { code: string; message: string }
  /** Raised when the file exists but cannot be read. */
  unreadable: { code: string; message: string }
  /** ENOENT recovery: return a value (nothing was read, nothing is validated) or throw. */
  onMissing: () => T
}

/** What a read adds to the record check: the two ways the file itself can be unavailable. */
export interface ReadValidatedOptions<T extends object>
  extends ValidateRecordOptions<T>,
    ReadJsonOptions<T> {}

/** One file's parsed contents, or what `onMissing` answered where there was no file. */
export type ReadJsonResult<T> = { kind: 'read'; parsed: unknown } | { kind: 'missing'; value: T }

/** Reads and parses one JSON file, unchecked. */
export async function readJsonFile<T>(
  path: string,
  opts: ReadJsonOptions<T>
): Promise<ReadJsonResult<T>> {
  let raw: string
  try {
    raw = await readFile(path, 'utf-8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { kind: 'missing', value: opts.onMissing() }
    }
    throw appError(opts.unreadable.code, opts.unreadable.message, detailOf(path, err))
  }

  try {
    return { kind: 'read', parsed: JSON.parse(raw) }
  } catch (err) {
    throw appError(opts.malformed.code, opts.malformed.message, detailOf(path, err))
  }
}

/**
 * Reads one JSON file, having checked that it parses and passes the record check.
 */
export async function readValidatedJson<T extends object>(
  path: string,
  opts: ReadValidatedOptions<T>
): Promise<T> {
  const read = await readJsonFile(path, opts)
  if (read.kind === 'missing') return read.value
  return validateRecord<T>(read.parsed, path, opts)
}

/** Renames, waiting out the ladder while the target is held by another process. */
async function renameWithPatience(from: string, to: string): Promise<void> {
  for (const wait of RENAME_RETRY_WAITS_MS) {
    try {
      await rename(from, to)
      return
    } catch (err) {
      if (!HELD_CODES.has((err as NodeJS.ErrnoException).code ?? '')) throw err
      await sleep(wait)
    }
  }
  await rename(from, to)
}

/** Writes JSON through a temp file in the same folder, then renames over the target. */
export async function writeAtomicJson(
  path: string,
  data: unknown,
  opts: { code: string; message: string }
): Promise<void> {
  const tempPath = `${path}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`
  try {
    await writeFile(tempPath, JSON.stringify(data, null, 2), 'utf-8')
    await renameWithPatience(tempPath, path)
  } catch (err) {
    // A unique temp name is never reused, so a failed write cleans up its own scratch.
    await rm(tempPath, { force: true }).catch(() => {})
    throw appError(opts.code, opts.message, detailOf(path, err))
  }
}
