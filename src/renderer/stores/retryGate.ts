import type { AppError } from '@shared/types'

/** The retry-or-leave gate both classifiers park on. */
export interface RetryGate {
  /**
   * Publishes `error` once it reaches the head of the queue, parks until the
   * player answers it, and returns whether they asked for a retry.
   */
  ask: (error: AppError) => Promise<boolean>
  /** The modal's buttons; answers the head asker, a no-op when none is parked. */
  answer: (retry: boolean) => void
  /** Drops every parked asker without answering — for teardown. */
  reset: () => void
}

/** Creates a {@link RetryGate} that publishes through `setError`. */
export function createRetryGate(setError: (error: AppError | null) => void): RetryGate {
  const parked: { error: AppError; resolve: (retry: boolean) => void }[] = []

  return {
    async ask(error) {
      const retry = await new Promise<boolean>((resolve) => {
        parked.push({ error, resolve })
        // Only the head is on screen; the rest surface as it is answered.
        if (parked.length === 1) setError(error)
      })
      return retry
    },
    answer(retry) {
      const head = parked.shift()
      if (!head) return
      setError(parked[0]?.error ?? null)
      head.resolve(retry)
    },
    reset() {
      parked.length = 0
    }
  }
}
