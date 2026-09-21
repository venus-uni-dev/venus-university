import { create } from 'zustand'
import type { RendererSettings, Result, SettingsPatch, WriterCandidate } from '@shared/types'
import { useUiStore } from './uiStore'

interface SettingsStoreState {
  settings: RendererSettings | null
  saving: boolean

  /** Loads settings from main. Failure here is fatal — nothing can run without it. */
  load: () => Promise<void>
  /** Persists a patch; surfaces a tier 2 error and leaves state untouched on failure. */
  save: (patch: SettingsPatch) => Promise<boolean>
  /**
   * Writes only the fields given, serialized behind every write already in flight. A caller
   * passes only the fields it changed; everything else is read from the store when the write's
   * turn comes, so two writes in flight never clobber each other and a stale render cannot
   * re-write an old record.
   */
  update: (fields: Partial<SettingsPatch>) => Promise<boolean>
  /** Records whether the player skipped the optional ComfyUI install. */
  setComfyDeferred: (deferred: boolean) => Promise<void>
  /**
   * The model ids a custom endpoint lists, for the Settings form's suggestions. The failure is
   * the form's to read rather than the app's to raise: a list is a convenience, not a setting.
   */
  listModels: (endpointUrl: string, apiKey?: string) => Promise<Result<string[]>>
  /** Sends one tiny request on the writer fields as typed; the error is the form's answer. */
  testWriter: (candidate: WriterCandidate) => Promise<Result<void>>
  /**
   * Hands the player everything this build has stored as one file. Answers false where the
   * player picked nowhere to put it.
   */
  exportBackup: () => Promise<boolean>
  /**
   * Puts a backup file back in place of everything stored. Answers false where the player
   * picked no file; a restore that lands reloads the window onto the data it wrote.
   */
  importBackup: () => Promise<boolean>
}

/** The tail of the settings-write lane; every `update` call links onto it. */
let tail: Promise<unknown> = Promise.resolve()

/**
 * Owns `settings:*` IPC. Neither key is ever here: main sends presence flags and
 * takes patches, so a key exists in exactly one process.
 */
export const useSettingsStore = create<SettingsStoreState>((set, get) => ({
  settings: null,
  saving: false,

  load: async () => {
    const result = await window.api.settings.get()
    if (!result.ok) {
      useUiStore.getState().showFatalError(result.error)
      return
    }
    set({ settings: result.data })
  },

  save: async (settings) => {
    set({ saving: true })
    const result = await window.api.settings.set(settings)
    set({ saving: false })
    if (!result.ok) {
      useUiStore.getState().showError(result.error)
      return false
    }
    set({ settings: result.data })
    return true
  },

  update: (fields) => {
    // Runs once every write enqueued before it has settled; `catch` before chaining, so
    // one rejected write does not poison the lane.
    const job = async () => {
      const s = get().settings
      if (!s) return false
      return get().save({ ...patchOf(s), ...fields })
    }
    const result = tail.then(job, job)
    tail = result.catch(() => undefined)
    return result
  },

  setComfyDeferred: async (deferred) => {
    const settings = get().settings
    // Nothing to merge into before boot has loaded.
    if (!settings || settings.comfyDeferred === deferred) return
    await get().update({ comfyDeferred: deferred })
  },

  listModels: async (endpointUrl, apiKey) => window.api.llm.listModels(endpointUrl, apiKey),

  testWriter: async (candidate) => window.api.llm.testWriter(candidate),

  exportBackup: async () => {
    const result = await window.api.backup.export()
    if (!result.ok) {
      useUiStore.getState().showError(result.error)
      return false
    }
    return result.data !== null
  },

  importBackup: async () => {
    const result = await window.api.backup.import()
    if (!result.ok) {
      useUiStore.getState().showError(result.error)
      return false
    }
    // A restore replaces the settings, the playthroughs, the saves and the characters at once,
    // under stores holding hydrated copies of all four and blob URLs minted from the images.
    // Coming up again on the restored data is the one way to be sure nothing stale survives it.
    if (result.data) window.location.reload()
    return result.data
  }
}))

/** Whether the player has asked for no nude wardrobe and no CGs. */
export function noNsfwImagesOf(state: SettingsStoreState): boolean {
  return state.settings?.noNsfwImages === true
}

/**
 * The current non-secret settings as a patch, for a caller changing one field. Named rather
 * than spread so the presence flags cannot ride along into a write.
 */
export function patchOf(settings: RendererSettings): SettingsPatch {
  return {
    apiProvider: settings.apiProvider,
    apiModel: settings.apiModel,
    thinkingLevel: settings.thinkingLevel,
    // Carried, or a save made from anywhere else would drop the custom endpoint the writer
    // runs on, the effort it runs at and the reply cap it is sent.
    endpointUrl: settings.endpointUrl,
    reasoningEffort: settings.reasoningEffort,
    maxOutputTokens: settings.maxOutputTokens,
    // Carried, or a save made from anywhere else would drop the secondary model.
    secondaryModel: settings.secondaryModel,
    secondaryModelFor: settings.secondaryModelFor,
    comfyDeferred: settings.comfyDeferred,
    noNsfwImages: settings.noNsfwImages,
    lessNsfwText: settings.lessNsfwText,
    noNsfwSound: settings.noNsfwSound,
    sfwAsked: settings.sfwAsked,
    // Carried, or a save made from anywhere else would drop a browser's key on the next visit.
    rememberKey: settings.rememberKey,
    // Carried, or a save made from anywhere else would put every group back to full.
    volumes: settings.volumes
  }
}
