import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultSettings, redactSettings } from '@shared/settingsRules'
import type { AppError, Result, RendererSettings, Settings, SettingsPatch } from '@shared/types'
import { stubApi } from './fixtures'
import { useSettingsStore } from '../src/renderer/stores/settingsStore'
import { useUiStore } from '../src/renderer/stores/uiStore'

/**
 * `update` serializes writes behind a single lane so two overlapping calls settle in order,
 * each reading the store fresh rather than carrying stale fields from before the first landed.
 */

/** The settings a patch would leave behind, applied over the factory defaults. */
function mergedSettings(patch: SettingsPatch): RendererSettings {
  return redactSettings({ ...defaultSettings(), ...patch } as Settings)
}

/** The reply `settings.set` would send back for a patch applied over the factory defaults. */
function settingsReply(patch: SettingsPatch): Result<RendererSettings> {
  return { ok: true, data: mergedSettings(patch) }
}

/** A promise plus the functions that settle it, for a `set` call the test wants to hold open. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

afterEach(() => {
  useSettingsStore.setState({ settings: null, saving: false })
  vi.restoreAllMocks()
})

describe('serialized settings updates', () => {
  it('lands two overlapping updates in order, the second reading what the first wrote', async () => {
    useSettingsStore.setState({ settings: redactSettings(defaultSettings()) })
    const first = deferred<Result<RendererSettings>>()
    const calls: SettingsPatch[] = []
    const set = vi.fn((patch: SettingsPatch) => {
      calls.push(patch)
      return calls.length === 1 ? first.promise : Promise.resolve(settingsReply(patch))
    })
    stubApi({ settings: { set } })

    const firstUpdate = useSettingsStore.getState().update({ noNsfwImages: true })
    const secondUpdate = useSettingsStore.getState().update({ lessNsfwText: true })

    // Let the first link's turn come up; the second is chained behind it and cannot
    // have reached `set` yet.
    await Promise.resolve()
    expect(calls).toHaveLength(1)
    first.resolve(settingsReply(calls[0]))
    expect(await firstUpdate).toBe(true)
    expect(await secondUpdate).toBe(true)

    expect(calls).toHaveLength(2)
    // The second write's patch carries `noNsfwImages: true` because it read the store
    // only after the first write had landed, not the state from before either began.
    expect(calls[1].noNsfwImages).toBe(true)
    expect(calls[1].lessNsfwText).toBe(true)
    expect(useSettingsStore.getState().settings).toEqual(mergedSettings(calls[1]))
  })

  it('leaves settings untouched on a rejected write, and still runs the next update', async () => {
    const initial = redactSettings(defaultSettings())
    useSettingsStore.setState({ settings: initial })
    const error: AppError = { code: 'SETTINGS_UNREADABLE', message: 'nope' }
    const set = vi
      .fn<(patch: SettingsPatch) => Promise<Result<RendererSettings>>>()
      .mockResolvedValueOnce({ ok: false, error })
      .mockImplementationOnce((patch) => Promise.resolve(settingsReply(patch)))
    stubApi({ settings: { set } })
    const showError = vi.spyOn(useUiStore.getState(), 'showError')

    const failed = await useSettingsStore.getState().update({ noNsfwImages: true })

    expect(failed).toBe(false)
    expect(useSettingsStore.getState().settings).toEqual(initial)
    expect(showError).toHaveBeenCalledWith(error)

    const succeeded = await useSettingsStore.getState().update({ lessNsfwText: true })

    expect(succeeded).toBe(true)
    expect(useSettingsStore.getState().settings?.lessNsfwText).toBe(true)
  })
})
