import type { AppError } from './types'

/** The one way an {@link AppError} is constructed; every service throws through this. */
export function appError(code: string, message: string, detail?: string): AppError {
  return { code, message, detail }
}

/** Clips modal detail text and marks the cut so it is not mistaken for API truncation. */
export function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}… (${text.length} chars total)`
}

/** `truncate`'s mirror: the *last* `limit` chars, marked the same way. */
export function tailOf(text: string, limit: number): string {
  return text.length <= limit ? text : `(${text.length} chars total) …${text.slice(-limit)}`
}

/** The wait a quota error names, rounded up to whole seconds. */
export function retryAfterSeconds(detail: string | undefined): number | null {
  const match = detail ? /retry in ([\d.]+)\s*s/i.exec(detail) : null
  if (!match) return null
  const seconds = Number(match[1])
  return Number.isFinite(seconds) ? Math.ceil(seconds) : null
}

/** The message off any thrown value — an `Error`'s own, else its string form. */
export function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Normalizes any thrown value into an {@link AppError}, passing shaped ones through;
 * `fallbackCode` labels values that carry no code of their own.
 */
export function toAppError(err: unknown, fallbackCode = 'UNKNOWN'): AppError {
  if (err && typeof err === 'object' && 'code' in err && 'message' in err) {
    return err as AppError
  }
  return {
    code: fallbackCode,
    message: err instanceof Error ? err.message : String(err),
    detail: err instanceof Error ? err.stack : undefined
  }
}

/** True for anything already shaped like an `AppError`, so it can pass through unchanged. */
export function isAppError(err: unknown): err is AppError {
  return Boolean(err) && typeof err === 'object' && 'code' in (err as object)
}

/** Permanent error codes: wrong requests, not flaky failures. */
const PERMANENT_CODES = new Set([
  // Setup / download
  'DOWNLOAD_HTTP_PERMANENT',
  'DOWNLOAD_UNAUTHORIZED',
  // An address that is not https; resending it reaches the same address.
  'DOWNLOAD_SCHEME',
  // The player cancelled the download — a decision, not a flaky failure.
  'DOWNLOAD_ABORTED',
  // An archive holding an entry no unpack may write, or one past a cap.
  'ZIP_REFUSED',
  // An archive whose listing was fine but whose bytes are not what an entry claims to be.
  'IMPORT_BAD_CONTENT',
  // An archive whose listing 7-Zip would not read at all.
  'ZIP_LIST_FAILED',
  // An archive 7-Zip would not unpack; the same bytes downloaded again unpack the same way.
  'EXTRACT_7Z_FAILED',
  'EXTRACT_ZIP_FAILED',
  // A manifest pin that is not a plain name and version; only an edited manifest fixes it.
  'PIP_CONSTRAINTS_INVALID',
  // The two refusals a hand-placed model file earns.
  'MODEL_HASH_MISMATCH',
  'MODEL_FILE_MISSING',
  // A node whose pip run left one of its imports missing; downloading it again fixes nothing.
  'NODE_DEPS_MISSING',
  // The embedded interpreter would not answer what it has installed.
  'PYTHON_PROBE_FAILED',
  // Generation
  'CANCELLED',
  'COMFY_PROMPT_REJECTED',
  'COMFY_NO_OUTPUT',
  // ComfyUI is not there; `start()` already waits out a cold boot.
  'COMFY_START_TIMEOUT',
  'COMFY_START_FAILED',
  'COMFY_UNREACHABLE',
  // ComfyUI booted without a class the workflows name; only a repaired install changes that.
  'COMFY_NODES_MISSING',
  // A server that names a file outside its output folder, or answers `/view` with something
  // that is not an image, is not one a retry fixes.
  'COMFY_OUTPUT_PATH_INVALID',
  'COMFY_VIEW_NOT_IMAGE',
  // The port is held by a program we did not start; only closing it changes that.
  'COMFY_PORT_TAKEN',
  // A prompt that outlived the wall-clock wait.
  'COMFY_WAIT_TIMEOUT',
  'POSE_UNAVAILABLE',
  // An identifier the renderer sent that is not in its vocabulary.
  'CHARACTER_ID_INVALID',
  'EMOTION_UNKNOWN',
  'POSITION_UNKNOWN',
  'OUTFIT_SET_UNKNOWN',
  'ROOM_VARIANT_UNKNOWN',
  'AUDIO_FILE_INVALID',
  // A wardrobe fix that carries nothing, or bytes that are not the PNG it needs.
  'FIX_EMPTY',
  'FIX_NOT_PNG',
  // A graduation picture request with a bad reference sheet or character count.
  'ENDING_REQUEST_INVALID',
  // A face-pass job whose set has no base frame yet.
  'EXPRESSION_SOURCE_MISSING',
  // A room job on a character with no room description.
  'ROOM_PROMPT_MISSING',
  // Import
  // The zip is not one of ours, or is one this build cannot read.
  'IMPORT_MANIFEST_MISSING',
  'IMPORT_MANIFEST_INVALID',
  'IMPORT_SCHEMA_VERSION',
  'IMPORT_CHARACTER_MISSING',
  // A night room job whose day image is not on disk yet, or is not an image.
  'ROOM_DAY_MISSING',
  'ROOM_DAY_INVALID',
  // Cloud LLM
  // LLM_CREDITS_DEPLETED is deliberately absent: the request itself was fine and the
  // account is simply out of funds, so Retry after topping up is the right answer.
  'API_KEY_MISSING',
  'LLM_REQUEST_REJECTED',
  // A custom endpoint URL that cannot be sent to; only Settings changes that.
  'LLM_ENDPOINT_INVALID',
  // An unadjustable content filter fired; the player has to reword.
  'LLM_BLOCKED',
  // The generated class catalog broke a rule the scheduler depends on; retried from New Game.
  'CLASS_GEN_INVALID',
  // The generated student profiles left somebody without a year; retried from New Game.
  'PROFILE_GEN_INVALID',
  // The generated calendar came back with nothing on it; retried from New Game.
  'OCCASION_GEN_INVALID',
  // The classifier refused the action itself; the player has to reword.
  'CLASSIFIER_REJECTED',
  // Browser storage
  // The browser has no room left; a resend puts the same bytes back into the same full box.
  'STORAGE_FULL',
  // Something only the desktop build has, asked for from the browser one.
  'DESKTOP_ONLY'
])

/** True when an error should fail immediately rather than be retried. */
export function isPermanent(err: unknown): boolean {
  return PERMANENT_CODES.has((err as AppError)?.code)
}
