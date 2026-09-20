import type { AppError } from '@shared/types'

/**
 * The backoff a failed LLM call re-sends itself under before anything is said to the player.
 */
const SILENT_RETRIES = 5
const SILENT_BACKOFF_MS = [1000, 2000, 4000, 8000, 16000]

/**
 * The error taxonomy's retryable tier — what a silent resend can plausibly fix.
 * `LLM_CREDITS_DEPLETED` is left out on purpose: a resend cannot refill an empty
 * balance, so it goes straight to the modal.
 */
function silentlyRetryable(code: string): boolean {
  return (
    code === 'LLM_NETWORK' ||
    code === 'LLM_HTTP' ||
    code === 'LLM_TRUNCATED' ||
    code === 'LLM_EMPTY' ||
    code === 'LLM_MALFORMED' ||
    code === 'LLM_RATE_LIMITED' ||
    code === 'LLM_OVERLOADED'
  )
}

export interface SilentRetryOptions {
  /** Asked before each resend: true abandons the retry and falls through to the modal. */
  skip?: () => boolean
  /** Handed a canceller for the sleep in progress. */
  onSleep?: (cancel: () => void) => void
}

/**
 * One silent-retry decision: true means back off and re-send, false means fall through to the
 * player.
 */
export async function retrySilently(
  call: string,
  error: AppError,
  spent: number,
  options: SilentRetryOptions = {}
): Promise<boolean> {
  if (spent >= SILENT_RETRIES || !silentlyRetryable(error.code)) return false
  if (options.skip?.()) return false
  const delay = SILENT_BACKOFF_MS[spent] ?? SILENT_BACKOFF_MS[SILENT_BACKOFF_MS.length - 1]
  console.warn(`[${call}] retrying silently in ${delay}ms (${spent + 1}/${SILENT_RETRIES})`)
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, delay)
    options.onSleep?.(() => {
      clearTimeout(timer)
      resolve()
    })
  })
  return true
}
