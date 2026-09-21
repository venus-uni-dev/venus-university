import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Settings, SettingsPatch } from '@shared/types'

/**
 * Settings persistence: the secret round trip, not the field list — every case here is a way
 * to silently lose or leak the stored API key. `safeStorage` is stubbed reversible, and
 * refusing anything it did not write, so a decrypt failure is reachable.
 */
let root = ''
let encryptionAvailable = true

const ENC_PREFIX = 'dpapi:'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => root, getPath: () => root },
  safeStorage: {
    isEncryptionAvailable: () => encryptionAvailable,
    encryptString: (plain: string) => Buffer.from(`${ENC_PREFIX}${plain}`),
    decryptString: (blob: Buffer) => {
      const text = blob.toString()
      if (!text.startsWith(ENC_PREFIX)) throw new Error('not a blob this key can open')
      return text.slice(ENC_PREFIX.length)
    }
  }
}))

const settingsService = await import('../src/main/services/settingsService')
const { getSettingsPath } = await import('../src/main/paths')

/** The on-disk shape, as far as these tests care. */
type FileShape = Record<string, unknown>

/**
 * A complete `settings.json` body, every field the loader requires; `over` adds or replaces.
 * A field set to `undefined` is dropped by `JSON.stringify`, which is how a test seeds a
 * file that is missing one.
 */
function stored(over: FileShape = {}): FileShape {
  const base: Omit<Settings, 'apiKey'> = {
    schemaVersion: 1,
    apiProvider: 'gemini',
    apiModel: 'gemini-3.7-flash',
    thinkingLevel: 'low',
    serviceTier: 'standard',
    streamResponses: true,
    comfyDeferred: false,
    noNsfwImages: false,
    lessNsfwText: false,
    sfwAsked: true,
    removedDefaults: []
  }
  return { ...base, ...over }
}

/** Writes `settings.json` straight to disk, bypassing the service under test. */
async function seed(body: FileShape): Promise<void> {
  await mkdir(join(root, 'data'), { recursive: true })
  await writeFile(getSettingsPath(), JSON.stringify(body), 'utf-8')
}

async function fileOnDisk(): Promise<FileShape> {
  return JSON.parse(await readFile(getSettingsPath(), 'utf-8')) as FileShape
}

/**
 * A patch carrying every field a renderer always sends. `over` is deliberately
 * untyped: one test sends fields no honest renderer would, which is the point of
 * the whitelist.
 */
function patch(over: Record<string, unknown> = {}): SettingsPatch {
  const base: SettingsPatch = {
    apiProvider: 'gemini',
    apiModel: 'gemini-3.7-flash',
    thinkingLevel: 'low',
    comfyDeferred: false,
    noNsfwImages: false,
    lessNsfwText: false,
    sfwAsked: true
  }
  return { ...base, ...over } as SettingsPatch
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'venus-university-settings-'))
  encryptionAvailable = true
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('encryption at rest', () => {
  it('writes a blob, never the plaintext, and reads it back', async () => {
    await settingsService.applySettingsPatch(patch({ apiKey: 'AIza-secret' }))

    const file = await fileOnDisk()
    expect(file.apiKeyEnc).toBe(Buffer.from(`${ENC_PREFIX}AIza-secret`).toString('base64'))
    expect(file.apiKey).toBeUndefined()
    expect(JSON.stringify(file)).not.toContain('AIza-secret')

    expect((await settingsService.getSettings()).apiKey).toBe('AIza-secret')
  })

  it('writes neither form for an empty key', async () => {
    await settingsService.applySettingsPatch(patch())
    const file = await fileOnDisk()
    expect('apiKey' in file).toBe(false)
    expect('apiKeyEnc' in file).toBe(false)
  })

  it('falls back to plaintext where the OS keyring is unavailable', async () => {
    encryptionAvailable = false
    await settingsService.applySettingsPatch(patch({ apiKey: 'plain-key' }))

    const file = await fileOnDisk()
    expect(file.apiKey).toBe('plain-key')
    expect(file.apiKeyEnc).toBeUndefined()
    expect((await settingsService.getSettings()).apiKey).toBe('plain-key')
  })

  it('writes the endpoint key as its own blob, never the plaintext, and keeps it unasked', async () => {
    const endpoint = { endpointUrl: 'https://example.com/v1', apiProvider: 'openai' }
    await settingsService.applySettingsPatch(
      patch({ ...endpoint, endpointApiKey: 'endpoint-secret' })
    )

    const file = await fileOnDisk()
    expect(file.endpointApiKeyEnc).toBe(
      Buffer.from(`${ENC_PREFIX}endpoint-secret`).toString('base64')
    )
    expect(file.endpointApiKey).toBeUndefined()
    expect(JSON.stringify(file)).not.toContain('endpoint-secret')
    expect((await settingsService.getSettings()).endpointApiKey).toBe('endpoint-secret')

    await settingsService.applySettingsPatch(patch(endpoint))
    expect((await settingsService.getSettings()).endpointApiKey).toBe('endpoint-secret')
  })
})

describe('an incomplete file', () => {
  it('refuses a settings.json missing a field, and names it', async () => {
    // Nothing is defaulted: the key is inside the file, so a quiet reset would
    // lose it, and the field's name is what makes the file repairable by hand.
    await seed(stored({ apiModel: undefined }))
    await expect(settingsService.getSettings()).rejects.toMatchObject({
      code: 'SETTINGS_MALFORMED',
      message: expect.stringContaining('"apiModel"')
    })
  })
})

describe('the two call switches', () => {
  // Neither is a player setting any more: both are hand-edited, absent meaning the
  // priority queue and streaming on. Failing to read a file without them would be tier-3
  // fatal on first boot, which is every install made from here on.
  it('reads a file that carries neither', async () => {
    await seed(stored({ serviceTier: undefined, streamResponses: undefined }))
    await expect(settingsService.getSettings()).resolves.toMatchObject({
      apiModel: 'gemini-3.7-flash'
    })
  })

  // The renderer cannot send either, so `applySettingsPatch`'s `...current` is the whole of
  // what preserves them: a hand-edited switch has to survive a save made from the panel.
  it('keeps what the file says through a save that says nothing about them', async () => {
    await seed(stored({ serviceTier: 'standard', streamResponses: false }))
    await settingsService.applySettingsPatch(patch({ apiModel: 'gemini-3.6-flash' }))
    const file = await fileOnDisk()
    expect(file.serviceTier).toBe('standard')
    expect(file.streamResponses).toBe(false)
  })
})

describe('a blob that will not decrypt', () => {
  it('reads as unset instead of throwing, and is dropped by the next write', async () => {
    await seed(
      stored({ apiKeyEnc: Buffer.from('written by another windows account').toString('base64') })
    )

    const settings = await settingsService.getSettings()
    expect(settings.apiKey).toBe('')

    await settingsService.applySettingsPatch(patch({ apiKey: 'replacement' }))
    expect((await settingsService.getSettings()).apiKey).toBe('replacement')
  })
})

describe('patching', () => {
  it('keeps a stored key when the patch omits it', async () => {
    await settingsService.applySettingsPatch(patch({ apiKey: 'keep-me' }))
    const before = await fileOnDisk()

    const renderer = await settingsService.applySettingsPatch(
      patch({ apiModel: 'gemini-3.7-pro', comfyDeferred: true })
    )

    expect(renderer.apiKeySet).toBe(true)
    expect(renderer.apiModel).toBe('gemini-3.7-pro')
    expect(renderer.comfyDeferred).toBe(true)

    const after = await fileOnDisk()
    expect(after.apiKeyEnc).toBe(before.apiKeyEnc)

    expect((await settingsService.getSettings()).apiKey).toBe('keep-me')
  })

  it('writes no field the patch is not entitled to', async () => {
    // Hand-edited, dev-only: a renderer round trip must not clear any of them.
    await seed(stored({ freezeSeeds: true, editPregens: true, forceTime: 'night' }))

    await settingsService.applySettingsPatch(
      patch({
        apiKeySet: true,
        freezeSeeds: false,
        editPregens: false,
        forceTime: 'day',
        schemaVersion: 99
      })
    )

    const file = await fileOnDisk()
    expect(file.freezeSeeds).toBe(true)
    expect(file.editPregens).toBe(true)
    expect(file.forceTime).toBe('night')
    expect(file.schemaVersion).toBe(1)
    expect('apiKeySet' in file).toBe(false)
  })

  it('round-trips the group volumes and leaves the key out where there are none', async () => {
    // Absent is full volume, so a file that never held the key must not gain one saying so.
    await seed(stored())

    await settingsService.applySettingsPatch(
      patch({ volumes: { music: 40, sfx: 100, ambience: 0, nsfw: 75 } })
    )
    expect((await fileOnDisk()).volumes).toEqual({ music: 40, sfx: 100, ambience: 0, nsfw: 75 })

    await settingsService.applySettingsPatch(patch())
    expect('volumes' in (await fileOnDisk())).toBe(false)
  })
})

describe('redaction', () => {
  it('leaves no key property on what the renderer receives', async () => {
    await settingsService.applySettingsPatch(patch({ apiKey: 'secret' }))

    const renderer = await settingsService.getRendererSettings()
    expect('apiKey' in renderer).toBe(false)
    expect(JSON.stringify(renderer)).not.toContain('secret')
    expect(renderer.apiKeySet).toBe(true)
  })
})

describe('the removed shipped cast', () => {
  it('back-fills to nobody, and stays out of a renderer patch', async () => {
    // The patch is a field-by-field whitelist, and this field is not on it:
    // `chars:delete` and `chars:restoreDefaults` are the only writers, so a
    // renderer saving Settings can never take a character off the roster.
    await settingsService.setRemovedDefaults(['shipped-1'])
    await settingsService.applySettingsPatch(patch())
    expect((await settingsService.getSettings()).removedDefaults).toEqual(['shipped-1'])
  })
})
