import { appError } from './errors'

/**
 * The record check every persisted-state file passes once it has been parsed: this build's
 * `schemaVersion`, and every required field present. Nothing is defaulted.
 */

/** Per-caller naming for the ways a record can be refused. */
export interface ValidateRecordOptions<T extends object> {
  /** How the record is named in the messages — `'character.json'`, `'That save'`. */
  label: string
  /** Raised when it is not an object, or is missing a required field. */
  malformed: { code: string; message: string }
  /** Raised when `schemaVersion` is not {@link expects}. */
  schemaVersion: { code: string }
  /** The one version this build reads and writes. */
  expects: number
  /** Every field the record must carry; the first one absent is refused by name. */
  required: Partial<Record<keyof T, true>>
}

/**
 * Checks one parsed record and hands it back typed; `where` is the path or key it came from,
 * which every refusal carries as its detail.
 */
export function validateRecord<T extends object>(
  parsed: unknown,
  where: string,
  opts: ValidateRecordOptions<T>
): T {
  if (typeof parsed !== 'object' || parsed === null) {
    throw appError(opts.malformed.code, `${opts.label} does not contain an object.`, where)
  }

  const candidate = parsed as Partial<T> & { schemaVersion?: number }
  if (candidate.schemaVersion !== opts.expects) {
    throw appError(
      opts.schemaVersion.code,
      `${opts.label} has unsupported schemaVersion ${String(candidate.schemaVersion)}; this build expects ${opts.expects}.`,
      where
    )
  }

  for (const key of Object.keys(opts.required)) {
    if (!(key in candidate)) {
      throw appError(opts.malformed.code, `${opts.label} is missing "${key}".`, where)
    }
  }

  return candidate as T
}

/** Rejects an id that could escape the folder or key it names; every path-bound id passes one. */
export function assertSafeId(id: string, pattern: RegExp, code: string, message: string): void {
  if (!pattern.test(id)) {
    throw appError(code, message, id)
  }
}
