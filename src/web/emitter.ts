/**
 * The browser build's stand-in for one of main's fixed push channels: a set of listeners the
 * bridge hands an unsubscribe for, since a job can outlive the call that started it.
 */

/** One channel: what is sent on it, and who is listening. */
export interface Emitter<Args extends unknown[]> {
  emit: (...args: Args) => void
  /** Subscribes, and answers with the unsubscribe. */
  on: (listener: (...args: Args) => void) => () => void
}

/** Opens one channel. */
export function emitter<Args extends unknown[]>(): Emitter<Args> {
  const listeners = new Set<(...args: Args) => void>()

  return {
    emit: (...args) => {
      // Copied first: a listener that unsubscribes itself must not skip the next one.
      for (const listener of [...listeners]) {
        try {
          listener(...args)
        } catch (err) {
          console.error('[web] a listener threw:', err)
        }
      }
    },
    on: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  }
}
