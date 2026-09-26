import { create } from 'zustand'
import type { AppError, UpdateProgress } from '@shared/types'
import { isWebBuild } from '../platform'
import { updateCaption } from '../views/updateCaption'
import { nameCrossingWait } from './crossingStore'

/** What the offer and the failure are answered with, once each. */
let settleOffer: ((choice: 'update' | 'later') => void) | null = null
let releaseFailure: (() => void) | null = null

interface UpdateStoreState {
  /** The newer build the player is being asked about, and null whenever nothing is asked. */
  offer: { version: string } | null
  /** Why the update stopped, for as long as the modal saying so is up. */
  failure: AppError | null
  /** Where main says the update has got to; null before the first report of a run. */
  progress: UpdateProgress | null
  /**
   * The newer build the launch check found, or null; kept so the menu can offer it after the
   * launch offer is declined or turned off.
   */
  available: string | null
  /**
   * Asks main whether itch.io has a newer build, keeps its version on `available`, and answers
   * word of a swap that did not land on the last launch (null when there is none).
   */
  check: () => Promise<AppError | null>
  /** Raises the offer and waits on the player's answer. */
  ask: (version: string) => Promise<'update' | 'later'>
  /** The modal's two answers, the first of which takes the offer down. */
  answer: (choice: 'update' | 'later') => void
  /**
   * Runs the update under whatever cover the caller has raised, captioning its mark through each
   * phase; answers null on success (the app quits moments later) or the failure once its modal
   * is closed.
   */
  apply: () => Promise<AppError | null>
  /** Raises the failure modal and waits on its Continue. */
  showFailure: (error: AppError) => Promise<void>
  /** Closes the failure modal, releasing whoever is waiting on it. */
  dismissFailure: () => void
}

/**
 * The desktop's self-update, from the launch check to the offer, the progress and the failure.
 * Boot and the menu's notice both drive it and wait on the modals it raises, so both answers are
 * promises rather than callbacks.
 */
export const useUpdateStore = create<UpdateStoreState>((set, get) => ({
  offer: null,
  failure: null,
  progress: null,
  available: null,

  check: async () => {
    // There is nothing to replace in a browser tab, and the bridge there refuses the call.
    if (isWebBuild()) return null
    const result = await window.api.update.check()
    if (!result.ok) {
      // An offline boot is ordinary, and a check nobody asked for never stops one.
      console.warn('Update check failed:', result.error.code, result.error.message)
      return null
    }
    set({ available: result.data.available ? result.data.latest : null })
    return result.data.lastFailure ?? null
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
    // A report the last attempt left would caption this one until its own first arrives.
    set({ progress: null })
    let shown = updateCaption(null)
    nameCrossingWait(shown)
    const stop = useUpdateStore.subscribe((state) => {
      const caption = updateCaption(state.progress)
      if (caption !== shown) {
        shown = caption
        nameCrossingWait(caption)
      }
    })
    const result = await window.api.update.apply()
    stop()
    // The app quits moments after this lands, so success returns to a caller that stops there.
    if (result.ok) return null
    await get().showFailure(result.error)
    return result.error
  },

  showFailure: (error) =>
    new Promise((resolve) => {
      releaseFailure = resolve
      set({ failure: error })
    }),

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
