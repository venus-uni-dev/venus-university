import { create } from 'zustand'
import type { AppError } from '@shared/types'
import type { ScreenTheme } from '../views/clockTheme'

/** Top-level screens the app can be showing. */
export type ViewName =
  | 'boot'
  | 'setup'
  /** The key stage alone, from the menu's top slot when no key is set. */
  | 'apiKey'
  /** The first run: every stage not already settled, then the content question. */
  | 'firstRun'
  | 'mainMenu'
  | 'manageCharacters'
  | 'newGame'
  /** The canned start, rendered by `NewGameView` for `classSelect`'s reason. */
  | 'quickstart'
  /** The class selector, rendered by `NewGameView` so the roster survives it. */
  | 'classSelect'
  | 'game'

/** Modals that can be stacked over the current view. */
type ModalName = 'settings' | 'credits' | 'loadGame' | 'feedback' | 'support'

interface UiStoreState {
  view: ViewName
  /** The open modals, bottom to top, through `ModalHost`'s single portal. */
  modals: ModalName[]
  /** Tier 2 error currently shown in `ErrorModal`; null when none. */
  error: AppError | null
  /** Tier 3 error — replaces the whole UI with `FatalErrorScreen`. */
  fatalError: AppError | null
  /**
   * The half of the day the Main Menu **and everything reachable from it** open in: the hour a
   * game was left in, so a curtain that came down on a night menu does not open onto a daylight
   * roster one click later. Null is the ordinary case, and means the clock decides.
   */
  menuTheme: ScreenTheme | null
  /**
   * A file the app has built and is waiting to hand over, as its name and the object URL
   * holding it. Null the rest of the time, which is always on the desktop, where a native
   * save dialog takes the file instead.
   */
  download: { name: string; url: string } | null

  setView: (view: ViewName) => void
  setMenuTheme: (theme: ScreenTheme) => void
  openModal: (modal: ModalName) => void
  closeModal: (modal: ModalName) => void
  showError: (error: AppError) => void
  dismissError: () => void
  showFatalError: (error: AppError) => void
  /** Offers a built file for saving; the panel it raises is the only thing that hands it over. */
  offerDownload: (name: string, url: string) => void
  /** Closes that panel and lets go of the file behind it. */
  clearDownload: () => void
  /** The copy of the app log the Feedback modal offers, saved through the native dialog. */
  exportLog: () => Promise<'saved' | 'cancelled' | 'failed'>
}

export const useUiStore = create<UiStoreState>((set, get) => ({
  view: 'boot',
  modals: [],
  error: null,
  fatalError: null,
  menuTheme: null,
  download: null,

  // **A handed hour is dropped by entering a game and by nothing else**: every other screen the
  // menu reaches is a satellite of that visit and wears the same hour, where a game carries its
  // own (the save's, through its crossing). One line here, and no call site has to remember.
  setView: (view) => set(view === 'game' ? { view, menuTheme: null } : { view }),

  setMenuTheme: (menuTheme) => set({ menuTheme }),

  openModal: (modal) =>
    set((state) =>
      state.modals.includes(modal) ? state : { modals: [...state.modals, modal] }
    ),

  closeModal: (modal) => set((state) => ({ modals: state.modals.filter((m) => m !== modal) })),

  showError: (error) => set({ error }),

  dismissError: () => set({ error: null }),

  showFatalError: (fatalError) => set({ fatalError }),

  offerDownload: (name, url) => {
    // One offer at a time: whatever was waiting is let go of before the new one takes its place.
    get().clearDownload()
    set({ download: { name, url } })
  },

  clearDownload: () => {
    const held = get().download
    if (!held) return
    URL.revokeObjectURL(held.url)
    set({ download: null })
  },

  exportLog: async () => {
    const result = await window.api.log.export()
    if (!result.ok) {
      get().showError(result.error)
      return 'failed'
    }
    return result.data === null ? 'cancelled' : 'saved'
  }
}))
