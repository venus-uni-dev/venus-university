import { create } from 'zustand'
import type { AppError } from '@shared/types'
import { isWebBuild } from '../platform'

/** Where the local ComfyUI process is, as far as this window knows. */
type ComfyState = 'idle' | 'starting' | 'ready' | 'error'

interface ComfyStoreState {
  state: ComfyState
  error?: AppError
  /** Starts ComfyUI if it is not already up; concurrent callers share one attempt. */
  ensureStarted: () => Promise<void>
}

/** The in-flight start, shared by every concurrent caller. */
let starting: Promise<void> | null = null

/**
 * ComfyUI's *runtime* state, kept apart from `setupStore`'s *install* state:
 * one answers "is the server up", the other "are the files on disk".
 */
export const useComfyStore = create<ComfyStoreState>((set, get) => ({
  state: 'idle',

  ensureStarted: () => {
    // There is no local server in the browser, so the state stays idle and no start is asked for.
    if (isWebBuild()) return Promise.resolve()
    if (get().state === 'ready') return Promise.resolve()
    if (starting) return starting

    set({ state: 'starting', error: undefined })
    starting = window.api.comfy
      .start()
      .then((result) => {
        // Reported in place, never as a modal.
        if (result.ok) set({ state: 'ready', error: undefined })
        else set({ state: 'error', error: result.error })
      })
      .finally(() => {
        starting = null
      })
    return starting
  }
}))
