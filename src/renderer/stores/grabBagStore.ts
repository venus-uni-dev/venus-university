import { create } from 'zustand'
import { drawFromBag, drawManyFromBag } from '@shared/grabBag'
import type { GrabBags } from '@shared/types'
import { useUiStore } from './uiStore'

/**
 * The grab bags every authored pool is dealt from, and the one owner of `grabBags:*` IPC. A
 * draw is synchronous; the file is written behind it, one coalesced write at a time, and only
 * once the file has been read, so nothing on disk is ever replaced by a bag that never saw it.
 */

interface GrabBagStoreState {
  /** The set-aside keys, one list per bag id. */
  bags: GrabBags
  /** Whether `bags` came off the disk; nothing is written before it has. */
  hydrated: boolean

  /** Reads the file. A failure is a tier 2 error and the bags run in memory for the session. */
  load: () => Promise<void>
  /** Draws one item from `items` under `bagId`, narrowed to what `accept` passes, setting it aside. */
  draw: <T>(
    bagId: string,
    items: readonly T[],
    keyOf?: (item: T) => string,
    accept?: (item: T) => boolean
  ) => T
  /** Draws `count` distinct items from `items` under `bagId`. */
  drawMany: <T>(bagId: string, items: readonly T[], count: number, keyOf?: (item: T) => string) => T[]
  /** Resolves once every draw so far is on disk (or has failed to get there). */
  flush: () => Promise<void>
  /** Empties every bag and forgets the disk; for tests. */
  reset: () => void
}

/** The default key: the item itself, for a pool of strings. */
function itemKey<T>(item: T): string {
  return String(item)
}

/** Whether a write is owed for draws made since the last one started. */
let dirty = false

/** The write in flight, or null. */
let writing: Promise<void> | null = null

/** Whether a failed write has already been reported this session. */
let writeFailed = false

/** Writes the bags once the current write, if any, has settled; a draw mid-write queues one more. */
function scheduleWrite(): void {
  dirty = true
  if (writing) return
  writing = (async () => {
    while (dirty) {
      dirty = false
      const result = await window.api.grabBags.set(useGrabBagStore.getState().bags)
      if (!result.ok && !writeFailed) {
        writeFailed = true
        useUiStore.getState().showError(result.error)
      }
    }
  })().finally(() => {
    writing = null
  })
}

export const useGrabBagStore = create<GrabBagStoreState>((set, get) => ({
  bags: {},
  hydrated: false,

  load: async () => {
    const result = await window.api.grabBags.get()
    if (!result.ok) {
      useUiStore.getState().showError(result.error)
      return
    }
    // A second read never replaces bags that have been drawn from since the first.
    if (get().hydrated) return
    set({ bags: result.data, hydrated: true })
  },

  draw: (bagId, items, keyOf = itemKey, accept) => {
    const { item, drawn } = drawFromBag(items, get().bags[bagId] ?? [], keyOf, Math.random, accept)
    set({ bags: { ...get().bags, [bagId]: drawn } })
    if (get().hydrated) scheduleWrite()
    return item
  },

  drawMany: (bagId, items, count, keyOf = itemKey) => {
    const result = drawManyFromBag(items, get().bags[bagId] ?? [], keyOf, count)
    set({ bags: { ...get().bags, [bagId]: result.drawn } })
    if (get().hydrated) scheduleWrite()
    return result.items
  },

  flush: async () => {
    while (writing) await writing
  },

  reset: () => {
    dirty = false
    set({ bags: {}, hydrated: false })
  }
}))
