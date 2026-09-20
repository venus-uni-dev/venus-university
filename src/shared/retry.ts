import { isPermanent } from './errors'

/**
 * Shared retry policy: three retries at 2s / 8s / 30s; permanence lives in
 * `shared/errors.ts`.
 */

const DELAYS_MS = [2000, 8000, 30000] as const

export interface RetryOptions {
  /** Called before each backoff wait, for progress messaging. */
  onRetry?: (attempt: number, waitMs: number, error: unknown) => void
  /** Aborts the backoff wait so a cancelled job doesn't sit out 30 seconds. */
  signal?: AbortSignal
}

/** Runs `fn`, retrying transient failures with the backoff. */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { onRetry, signal } = options

  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (isPermanent(err) || attempt >= DELAYS_MS.length || signal?.aborted) throw err

      const waitMs = DELAYS_MS[attempt]
      onRetry?.(attempt + 1, waitMs, err)
      await sleep(waitMs, signal)
    }
  }
}

/** Waits `ms`, resolving early if `signal` aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(finish, ms)
    signal?.addEventListener('abort', finish, { once: true })

    function finish(): void {
      clearTimeout(timer)
      signal?.removeEventListener('abort', finish)
      resolve()
    }
  })
}
