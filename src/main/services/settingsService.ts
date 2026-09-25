import { mkdir } from 'fs/promises'
import { safeStorage } from 'electron'
import { appError, messageOf } from '@shared/errors'
import {
  defaultSettings,
  mergePatch,
  redactSettings,
  SETTINGS_READ,
  SETTINGS_SCHEMA_VERSION,
  SETTINGS_UNREADABLE,
  upgradeSettings
} from '@shared/settingsRules'
import type { RendererSettings, Settings, SettingsPatch } from '@shared/types'
import { getDataPath, getSettingsPath } from '../paths'
import { readValidatedJson, writeAtomicJson } from './jsonFile'

/**
 * The on-disk shape: {@link Settings} with each secret as a DPAPI blob (`apiKeyEnc`,
 * `endpointApiKeyEnc`), or as the bare string only where encryption is unavailable.
 */
type SettingsFile = Omit<Settings, 'apiKey' | 'endpointApiKey'> & {
  apiKey?: string
  apiKeyEnc?: string
  endpointApiKey?: string
  endpointApiKeyEnc?: string
}

/** The codes the OS refuses a write with when the folder is not the player's to write in. */
const UNWRITABLE_CODES = new Set(['EPERM', 'EACCES', 'EROFS'])

/** Creates the runtime data root if absent. Throws a tier-3 fatal error if it cannot be created. */
export async function ensureDataDir(): Promise<void> {
  const dataPath = getDataPath()
  try {
    await mkdir(dataPath, { recursive: true })
  } catch (err) {
    const detail = `${dataPath}: ${messageOf(err)}`
    if (UNWRITABLE_CODES.has((err as NodeJS.ErrnoException).code ?? '')) {
      throw appError(
        'DATA_DIR_UNWRITABLE',
        'Venus University keeps its saves in a folder beside its own program file, and Windows will ' +
          'not let it write there — move the whole game folder somewhere you can write to, ' +
          'such as Documents, and start it again.',
        detail
      )
    }
    throw appError('DATA_DIR_UNWRITABLE', 'Could not create the data directory.', detail)
  }
}

/** Encrypts one secret for disk: empty writes neither field, no keyring writes plaintext. */
function encryptSecret(plain: string): { enc?: string; plain?: string } {
  if (!plain) return {}
  if (!safeStorage.isEncryptionAvailable()) return { plain }
  return { enc: safeStorage.encryptString(plain).toString('base64') }
}

/** Decrypts one secret off disk, preferring the blob; one DPAPI refuses reads as unset. */
function decryptSecret(enc: string | undefined, plain: string | undefined, field: string): string {
  if (enc) {
    try {
      return safeStorage.decryptString(Buffer.from(enc, 'base64'))
    } catch (err) {
      console.warn(
        `settings.json: stored ${field} could not be decrypted; treating it as unset.`,
        err
      )
      return ''
    }
  }
  return plain ?? ''
}

/** Runtime settings in the on-disk shape, each secret encrypted where the keyring allows. */
function fileShapeOf(settings: Settings): SettingsFile {
  const { apiKey, endpointApiKey, ...rest } = settings
  const file: SettingsFile = { ...rest, schemaVersion: SETTINGS_SCHEMA_VERSION }

  // Exactly one of the two forms, never both.
  const api = encryptSecret(apiKey)
  if (api.enc) file.apiKeyEnc = api.enc
  if (api.plain) file.apiKey = api.plain

  const endpoint = encryptSecret(endpointApiKey ?? '')
  if (endpoint.enc) file.endpointApiKeyEnc = endpoint.enc
  if (endpoint.plain) file.endpointApiKey = endpoint.plain

  return file
}

/** Writes the on-disk shape atomically, as it stands. */
async function writeFileShape(file: SettingsFile): Promise<void> {
  await ensureDataDir()
  await writeAtomicJson(getSettingsPath(), file, {
    code: 'SETTINGS_UNWRITABLE',
    message: 'Could not save settings.json.'
  })
}

/** Serializes runtime settings to the on-disk shape and writes them atomically. */
async function writeSettingsFile(settings: Settings): Promise<void> {
  await writeFileShape(fileShapeOf(settings))
}

/**
 * Reads `/data/settings.json` or defaults, decrypting both secrets; a malformed, wrong-version
 * or incomplete file is a hard error. A custom endpoint's file with its model ids in Gemini's
 * fields is upgraded and written straight back, its key blobs as they were read.
 */
export async function getSettings(): Promise<Settings> {
  const read = await readValidatedJson<SettingsFile>(getSettingsPath(), {
    ...SETTINGS_READ,
    unreadable: SETTINGS_UNREADABLE,
    // No settings file is the first-run state, not a failure.
    onMissing: defaultSettings
  })
  const { settings: candidate, upgraded } = upgradeSettings(read)
  if (upgraded) await writeFileShape(candidate)

  const {
    apiKeyEnc,
    apiKey: plain,
    endpointApiKeyEnc,
    endpointApiKey: endpointPlain,
    ...stored
  } = candidate
  return {
    ...stored,
    apiKey: decryptSecret(apiKeyEnc, plain, 'apiKey'),
    endpointApiKey:
      decryptSecret(endpointApiKeyEnc, endpointPlain, 'endpointApiKey') || undefined
  }
}

/** Records which shipped characters the player has taken off the roster. */
export async function setRemovedDefaults(charIds: readonly string[]): Promise<void> {
  const current = await getSettings()
  await writeSettingsFile({ ...current, removedDefaults: [...charIds] })
}

/** `settings:get` — settings as the renderer sees them, with no key in them. */
export async function getRendererSettings(): Promise<RendererSettings> {
  return redactSettings(await getSettings())
}

/** `settings:set` — merges a renderer patch over the stored settings and writes. */
export async function applySettingsPatch(patch: SettingsPatch): Promise<RendererSettings> {
  const current = await getSettings()

  const next = mergePatch(current, patch)

  await writeSettingsFile(next)
  return redactSettings(next)
}
