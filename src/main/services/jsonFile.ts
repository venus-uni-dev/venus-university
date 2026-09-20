import { randomUUID } from 'crypto'
import { readFile, rename, rm, writeFile } from 'fs/promises'
import { appError, messageOf } from '@shared/errors'
import { validateRecord, type ValidateRecordOptions } from '@shared/jsonValidate'

/**
 * The JSON-on-disk mechanics every persisted-state service shares: read and parse, then the
 * shared record check, and the atomic write.
 */

/** The `detail` shape every file error carries: which path, and what the OS said. */
function detailOf(path: string, err: unknown): string {
  return `${path}: ${messageOf(err)}`
}

/** What a read adds to the record check: the two ways the file itself can be unavailable. */
export interface ReadValidatedOptions<T extends object> extends ValidateRecordOptions<T> {
  /** Raised when the file exists but cannot be read. */
  unreadable: { code: string; message: string }
  /** ENOENT recovery: return a value (nothing was read, nothing is validated) or throw. */
  onMissing: () => T
}

/**
 * Reads one JSON file, having checked that it parses and passes the record check.
 */
export async function readValidatedJson<T extends object>(
  path: string,
  opts: ReadValidatedOptions<T>
): Promise<T> {
  let raw: string
  try {
    raw = await readFile(path, 'utf-8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return opts.onMissing()
    throw appError(opts.unreadable.code, opts.unreadable.message, detailOf(path, err))
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw appError(opts.malformed.code, opts.malformed.message, detailOf(path, err))
  }

  return validateRecord<T>(parsed, path, opts)
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
    await rename(tempPath, path)
  } catch (err) {
    // A unique temp name is never reused, so a failed write cleans up its own scratch.
    await rm(tempPath, { force: true }).catch(() => {})
    throw appError(opts.code, opts.message, detailOf(path, err))
  }
}
