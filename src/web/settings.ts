import { mergePatch, redactSettings } from '@shared/settingsRules'
import type { RendererSettings, Settings, SettingsPatch } from '@shared/types'
import type { StoredSettings } from './db/open'
import { readSettings, writeSettings } from './db/settings'

/**
 * The browser build's settings. The API key is held in memory for the visit and written
 * beside the rest only while the player has asked for it to be remembered, since a browser's
 * storage is shared with every other game on the same host.
 */

/** The stored row, read once and kept as written. */
let row: StoredSettings | null = null

/** The key this visit is running on, remembered or typed in. */
let key = ''

/** What is stored, read on the first ask. */
async function settingsRow(): Promise<StoredSettings> {
  if (!row) {
    row = await readSettings()
    // A remembered key is this visit's key from the first read on.
    if (row.apiKey) key = row.apiKey
  }
  return row
}

/** The settings the app runs on: what is stored, with this visit's key. */
export async function currentSettings(): Promise<Settings> {
  return { ...(await settingsRow()), apiKey: key }
}

/** What the renderer is shown: the same settings with the key down to a presence flag. */
export async function rendererSettings(): Promise<RendererSettings> {
  return redactSettings(await currentSettings())
}

/** The row `next` is stored as: the key rides along only where it is wanted. */
function rowFor(next: Settings): StoredSettings {
  const { apiKey, ...rest } = next
  return next.rememberKey && apiKey ? { ...rest, apiKey } : rest
}

/**
 * Merges a renderer patch over the settings and writes them. One put, so turning remembering
 * off is what takes the stored key away with it.
 */
export async function patchSettings(patch: SettingsPatch): Promise<RendererSettings> {
  const next = mergePatch(await currentSettings(), patch)
  key = next.apiKey

  const written = rowFor(next)
  await writeSettings(written)
  row = written
  return redactSettings(next)
}

/** Drops what is held in memory, so the next read comes off storage. */
export function forgetSettings(): void {
  row = null
}

/** Records which shipped characters the player has taken off the roster. */
export async function setRemovedDefaults(charIds: readonly string[]): Promise<void> {
  const written: StoredSettings = { ...(await settingsRow()), removedDefaults: [...charIds] }
  await writeSettings(written)
  row = written
}
