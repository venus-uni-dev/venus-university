import { validateRecord } from '@shared/jsonValidate'
import { defaultSettings, SETTINGS_READ, upgradeSettings } from '@shared/settingsRules'
import type { Settings } from '@shared/types'
import { database, storage, type StoredSettings } from './open'

/**
 * The settings row: one record, checked on the way out exactly as the desktop file is, and a
 * custom endpoint's row with its model ids in Gemini's fields upgraded and written straight back.
 */

/** What has been saved, upgraded where it must be, or the first-run defaults where nothing has. */
export async function readSettings(): Promise<StoredSettings> {
  const stored = await storage('read the settings', async () =>
    (await database()).get('settings', 'settings')
  )
  if (stored === undefined) {
    // The key is never part of the row's defaults: it is written only once it is remembered.
    const { apiKey: _absent, ...fresh } = defaultSettings()
    return fresh
  }
  const { settings, upgraded } = upgradeSettings(
    validateRecord<Settings>(stored, 'settings', SETTINGS_READ)
  )
  if (upgraded) await writeSettings(settings)
  return settings
}

/** Replaces the row wholesale, so a field left out of `row` is gone from storage. */
export async function writeSettings(row: StoredSettings): Promise<void> {
  await storage('save the settings', async () => (await database()).put('settings', row, 'settings'))
}
