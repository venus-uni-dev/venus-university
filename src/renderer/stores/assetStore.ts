import { create } from 'zustand'
import { bytesToBase64 } from '@shared/base64'
import { withCustomBackgrounds } from '@shared/backgroundSets'
import type {
  BgVariant,
  CustomBackgroundDraft,
  CustomBackgroundListing
} from '@shared/customBackgrounds'
import type { BackgroundSets, PoseManifest, QuickstartBundle } from '@shared/types'
import { setCustomBackgrounds, shippedBackgrounds } from '../views/bgAssets'
import { useUiStore } from './uiStore'

interface AssetStoreState {
  /** Poses with both a manifest entry and a skeleton PNG, keyed by pose key. */
  poses: PoseManifest
  /** The bundled background base names present in both `_day` and `_night`, sorted, by category. */
  shipped: BackgroundSets
  /**
   * Every background the scene may name — the shipped ones and the player's own beside them —
   * sorted, by category.
   */
  backgrounds: BackgroundSets
  /** Every background the player brought, by name, those a shipped name shadows included. */
  customBackgrounds: CustomBackgroundListing[]
  loaded: boolean
  /** The canned semester behind Quickstart, or null until it is asked for. */
  quickstart: QuickstartBundle | null

  /**
   * Loads the pose manifest once at boot, and pairs the bundled backgrounds beside it with the
   * player's own added.
   */
  load: () => Promise<void>
  /** Fetches the quickstart bundle on demand, null on a failure it has already reported. */
  loadQuickstart: () => Promise<QuickstartBundle | null>
  /** Reads the player's own backgrounds again, keeping what is held on a failure it reports. */
  loadCustomBackgrounds: () => Promise<void>
  /**
   * Keeps a new background of the player's, `images` holding each picture's PNG bytes by
   * variant; answers whether it was kept, having reported why where it was not.
   */
  addCustomBackground: (
    draft: CustomBackgroundDraft,
    images: Partial<Record<BgVariant, Uint8Array>>
  ) => Promise<boolean>
  /** Removes one of the player's backgrounds; answers whether it went, as `add` does. */
  removeCustomBackground: (name: string) => Promise<boolean>
}

/**
 * The background lists once the player's own are `listings`: a shipped name keeps the place,
 * and the URL helpers are handed the ones the stage may show.
 */
function withListings(
  shipped: BackgroundSets,
  listings: CustomBackgroundListing[]
): Pick<AssetStoreState, 'backgrounds' | 'customBackgrounds'> {
  const { sets, kept } = withCustomBackgrounds(
    shipped,
    listings.map((listing) => ({ name: listing.record.name, kind: listing.record.kind, listing }))
  )
  setCustomBackgrounds(kept.map((entry) => entry.listing))
  return { backgrounds: sets, customBackgrounds: listings }
}

/** Loads shipped renderer assets via IPC; failures are non-fatal outside creation. */
export const useAssetStore = create<AssetStoreState>((set, get) => ({
  poses: {},
  shipped: { interior: [], exterior: [] },
  backgrounds: { interior: [], exterior: [] },
  customBackgrounds: [],
  loaded: false,
  quickstart: null,

  load: async () => {
    const poses = await window.api.assets.getPoseManifest()
    if (!poses.ok) useUiStore.getState().showError(poses.error)

    // The renders are bundled, so which of them pair is read off the bundle itself.
    const shipped = shippedBackgrounds()
    set({
      poses: poses.ok ? poses.data : {},
      shipped,
      ...withListings(shipped, get().customBackgrounds),
      loaded: poses.ok
    })
    await get().loadCustomBackgrounds()
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
  },

  loadCustomBackgrounds: async () => {
    const result = await window.api.backgrounds.list()
    if (!result.ok) {
      useUiStore.getState().showError(result.error)
      return
    }
    set(withListings(get().shipped, result.data))
  },

  addCustomBackground: async (draft, images) => {
    const encoded: Partial<Record<BgVariant, string>> = {}
    for (const [variant, bytes] of Object.entries(images) as [BgVariant, Uint8Array][]) {
      encoded[variant] = bytesToBase64(bytes)
    }
    const result = await window.api.backgrounds.add(draft, encoded)
    if (!result.ok) {
      useUiStore.getState().showError(result.error)
      return false
    }
    const listings = [
      ...get().customBackgrounds.filter((held) => held.record.name !== draft.name),
      result.data
    ].sort((a, b) => (a.record.name < b.record.name ? -1 : 1))
    set(withListings(get().shipped, listings))
    return true
  },

  removeCustomBackground: async (name) => {
    const result = await window.api.backgrounds.remove(name)
    if (!result.ok) {
      useUiStore.getState().showError(result.error)
      return false
    }
    const listings = get().customBackgrounds.filter((held) => held.record.name !== name)
    set(withListings(get().shipped, listings))
    return true
  }
}))
