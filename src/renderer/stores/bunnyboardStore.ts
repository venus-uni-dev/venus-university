import { create } from 'zustand'

/**
 * Which Bunnyboard tab is showing. **There is no tab for the reader himself**: the decision
 * landing already draws his money and his three stats, and a phone that reported them a second
 * time would be the screen saying one thing twice.
 */
export type BunnyboardTab = 'chats' | 'friends' | 'updates'

/** An agreed hangout waiting on the player's "Begin hangout". */
interface ArmedHangout {
  charId: string
  /** The plan, as the reply described it — the scene's opening action. */
  description: string
}

/** Transient UI state for the Bunnyboard modal. */
interface BunnyboardUiState {
  /** The modal is open. */
  open: boolean
  tab: BunnyboardTab
  /** The charId whose conversation is open on the Chats tab; null on that tab's list. */
  viewingCharId: string | null
  /**
   * The charId whose page is open over the whole stage — reached from any tab, and from
   * a face in a list, so it is a field of its own rather than the tab's detail view.
   */
  pageCharId: string | null
  /**
   * A hangout is being turned into a scene: a transparent layer swallows all
   * input until the scene takes over.
   */
  locked: boolean
  /**
   * An agreed hangout the player has not started yet: the thread shows "Begin hangout" instead
   * of the composer, and nothing else on the Bunnyboard responds until they press it.
   */
  armedHangout: ArmedHangout | null
  /**
   * charIds whose turn is still running — her reply, and then the hangout classifier that
   * reads it.
   */
  busyCharIds: string[]
  /**
   * charIds with texts still waiting out their typing delay — the thread's
   * `...` bubble, and nothing else. Owned by the pacer in `textingPace.ts`.
   */
  typingCharIds: string[]
  /** charIds whose last turn failed and is parked on the thread's Retry. */
  failedCharIds: string[]

  openApp: () => void
  closeApp: () => void
  setTab: (tab: BunnyboardTab) => void
  /** Opens a conversation on the Chats tab. */
  viewChar: (charId: string) => void
  /** Back to the Chats list. */
  backToList: () => void
  /** Opens her page over whichever tab is behind it. */
  openPage: (charId: string) => void
  /** Closes the page, leaving the tab under it exactly as it was. */
  closePage: () => void
  setLocked: (locked: boolean) => void
  setArmedHangout: (armed: ArmedHangout | null) => void
  setTextBusy: (charId: string, busy: boolean) => void
  setTyping: (charId: string, typing: boolean) => void
  setTextFailed: (charId: string, failed: boolean) => void
  /** Back to the blank closed app — the leave-game teardown. */
  reset: () => void
}

export const useBunnyboardStore = create<BunnyboardUiState>((set) => ({
  open: false,
  tab: 'chats',
  viewingCharId: null,
  pageCharId: null,
  locked: false,
  armedHangout: null,
  busyCharIds: [],
  typingCharIds: [],
  failedCharIds: [],

  openApp: () => set({ open: true, tab: 'chats', viewingCharId: null, pageCharId: null }),
  // `locked` is left alone: a hangout launch closes the app while still holding the lock.
  closeApp: () => set({ open: false, viewingCharId: null, pageCharId: null }),
  // A tab is a destination, so it closes the page over it as well as the thread.
  setTab: (tab) => set({ tab, viewingCharId: null, pageCharId: null }),
  viewChar: (charId) => set({ viewingCharId: charId }),
  backToList: () => set({ viewingCharId: null }),
  openPage: (charId) => set({ pageCharId: charId }),
  closePage: () => set({ pageCharId: null }),
  setLocked: (locked) => set({ locked }),
  setArmedHangout: (armedHangout) => set({ armedHangout }),
  // Same-array return when nothing changes, so a selector on it cannot churn.
  setTextBusy: (charId, busy) =>
    set((state) => {
      const held = state.busyCharIds.includes(charId)
      if (held === busy) return state
      return {
        busyCharIds: busy
          ? [...state.busyCharIds, charId]
          : state.busyCharIds.filter((id) => id !== charId)
      }
    }),
  // Same shape, same same-array rule, for the same selector reason.
  setTextFailed: (charId, failed) =>
    set((state) => {
      const held = state.failedCharIds.includes(charId)
      if (held === failed) return state
      return {
        failedCharIds: failed
          ? [...state.failedCharIds, charId]
          : state.failedCharIds.filter((id) => id !== charId)
      }
    }),
  // Same shape, same same-array rule, for the same selector reason.
  setTyping: (charId, typing) =>
    set((state) => {
      const held = state.typingCharIds.includes(charId)
      if (held === typing) return state
      return {
        typingCharIds: typing
          ? [...state.typingCharIds, charId]
          : state.typingCharIds.filter((id) => id !== charId)
      }
    }),
  reset: () =>
    set({
      open: false,
      tab: 'chats',
      viewingCharId: null,
      pageCharId: null,
      locked: false,
      armedHangout: null,
      busyCharIds: [],
      typingCharIds: [],
      failedCharIds: []
    })
}))
