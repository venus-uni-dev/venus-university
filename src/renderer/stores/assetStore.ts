import { create } from 'zustand'
import type { BackgroundSets, PoseManifest, QuickstartBundle } from '@shared/types'
import { shippedBackgrounds } from '../views/bgAssets'
import { useUiStore } from './uiStore'

interface AssetStoreState {
  /** Poses with both a manifest entry and a skeleton PNG, keyed by pose key. */
  poses: PoseManifest
  /** Background base names present in both `_day` and `_night`, sorted, by category. */
  backgrounds: BackgroundSets
  loaded: boolean
  /** The canned semester behind Quickstart, or null until it is asked for. */
  quickstart: QuickstartBundle | null

  /** Loads the pose manifest once at boot, and pairs the bundled backgrounds beside it. */
  load: () => Promise<void>
  /** Fetches the quickstart bundle on demand, null on a failure it has already reported. */
  loadQuickstart: () => Promise<QuickstartBundle | null>
}

/** Loads shipped renderer assets via IPC; failures are non-fatal outside creation. */
export const useAssetStore = create<AssetStoreState>((set, get) => ({
  poses: {},
  backgrounds: { interior: [], exterior: [] },
  loaded: false,
  quickstart: null,

  load: async () => {
    const poses = await window.api.assets.getPoseManifest()
    if (!poses.ok) useUiStore.getState().showError(poses.error)

    set({
      poses: poses.ok ? poses.data : {},
      // The renders are bundled, so which of them pair is read off the bundle itself.
      backgrounds: shippedBackgrounds(),
      loaded: poses.ok
    })
  },

  loadQuickstart: async () => {
    const held = get().quickstart
    if (held) return held

    const result = await window.api.assets.getQuickstart()
    if (!result.ok) {
      useUiStore.getState().showError(result.error)
      return null
    }
    set({ quickstart: result.data })
    return result.data
  }
}))

/** Pose keys in a stable order, for prompt enums and UI lists. */
export function poseKeysOf(poses: PoseManifest): string[] {
  return Object.keys(poses).sort()
}
