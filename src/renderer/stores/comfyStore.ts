import { create } from 'zustand'
import type { AppError, ComfyRuntimeState } from '@shared/types'
import { isWebBuild } from '../platform'

interface ComfyStoreState {
  state: ComfyRuntimeState
  error?: AppError
  /** Asks main to start ComfyUI unless it is already up; concurrent callers share one boot. */
  ensureStarted: () => Promise<void>
  /** Kills the server; it stays down until someone starts it again or a render job needs it. */
  stop: () => Promise<void>
}

/**
 * ComfyUI's *runtime* state, kept apart from `setupStore`'s *install* state:
 * one answers "is the server up", the other "are the files on disk". Main owns the answer
 * and broadcasts it, so nothing here sets the state from what a call returned.
 */
export const useComfyStore = create<ComfyStoreState>(() => ({
  state: 'idle',

  ensureStarted: async () => {
    // There is no local server in the browser, so the state stays idle and no start is asked for.
    if (isWebBuild()) return
    await window.api.comfy.start()
  },

  stop: async () => {
    await window.api.comfy.stop()
  }
}))

/** Subscribes to `comfy:state` at module scope, so a start this window never asked for lands. */
window.api.comfy.onState((status) => {
  useComfyStore.setState({ state: status.state, error: status.error })
})
