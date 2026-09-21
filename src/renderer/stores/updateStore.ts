import { create } from 'zustand'
import type { AppError, UpdateProgress } from '@shared/types'
import { isWebBuild } from '../platform'

/** What the offer and the failure are answered with, once each. */
let settleOffer: ((choice: 'update' | 'later') => void) | null = null
let releaseFailure: (() => void) | null = null

interface UpdateStoreState {
  /** The newer build the player is being asked about, and null whenever nothing is asked. */
  offer: { version: string } | null
  /** Why the update stopped, for as long as the modal saying so is up. */
  failure: AppError | null
  /** Where main says the update has got to; null before the first report. */
  progress: UpdateProgress | null
  /** Asks main whether itch.io has a newer build, answering its version or null. */
  check: () => Promise<string | null>
  /** Raises the offer and waits on the player's answer. */
  ask: (version: string) => Promise<'update' | 'later'>
  /** The modal's two answers, the first of which takes the offer down. */
  answer: (choice: 'update' | 'later') => void
  /** Runs the update, answering null on success or the failure once its modal is closed. */
  apply: () => Promise<AppError | null>
  /** Closes the failure modal, releasing whoever is waiting on the run. */
  dismissFailure: () => void
}

/**
 * The desktop's self-update, from the boot check to the offer, the progress and the failure.
 * Boot drives the whole of it and waits on the modals it raises, so both answers are promises
 * rather than callbacks.
 */
export const useUpdateStore = create<UpdateStoreState>((set) => ({
  offer: null,
  failure: null,
  progress: null,

  check: async () => {
    // There is nothing to replace in a browser tab, and the bridge there refuses the call.
    if (isWebBuild()) return null
    const result = await window.api.update.check()
    if (!result.ok) {
      // An offline boot is ordinary, and a check nobody asked for never stops one.
      console.warn('Update check failed:', result.error.code, result.error.message)
      return null
    }
    return result.data.available ? result.data.latest : null
  },

  ask: (version) =>
    new Promise((resolve) => {
      settleOffer = resolve
      set({ offer: { version } })
    }),

  answer: (choice) => {
    // A leaving modal still answers its own Escape, so every answer after the first is dropped.
    const settle = settleOffer
    settleOffer = null
    set({ offer: null })
    settle?.(choice)
  },

  apply: async () => {
    const result = await window.api.update.apply()
    // The app quits moments after this lands, so success returns to a boot that stops there.
    if (result.ok) return null
    return new Promise((resolve) => {
      releaseFailure = () => resolve(result.error)
      set({ failure: result.error })
    })
  },

  dismissFailure: () => {
    const release = releaseFailure
    releaseFailure = null
    set({ failure: null })
    release?.()
  }
}))

/** Subscribes to `update:progress` at module scope, main reporting on one fixed channel. */
window.api.update.onProgress((progress) => {
  useUpdateStore.setState({ progress })
})
