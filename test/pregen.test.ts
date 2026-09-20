import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultModelFor } from '@shared/providers'
import type { Character, Settings } from '@shared/types'
import { character } from './fixtures'

/**
 * The shipped cast: which root a charId resolves to, what may be written to one, and what
 * "delete" means when her folder is content the build came with. `safeStorage` rides along
 * because a removal is recorded in `settings.json`, where the secrets live.
 */
let root = ''

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => root, getPath: () => root },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (plain: string) => Buffer.from(plain),
    decryptString: (blob: Buffer) => blob.toString()
  }
}))

const characterService = await import('../src/main/services/characterService')
const settingsService = await import('../src/main/services/settingsService')
const paths = await import('../src/main/paths')

const SHIPPED = 'shipped-1'
const OWN = 'own-1'

/** Writes one `character.json` under whichever root the caller names. */
async function seed(dir: string, charId: string, over: Partial<Character> = {}): Promise<void> {
  const folder = join(dir, charId)
  await mkdir(folder, { recursive: true })
  await writeFile(
    join(folder, 'character.json'),
    JSON.stringify(character({ charId, ...over })),
    'utf-8'
  )
}

/** The dev switch, hand-edited into a complete `settings.json` exactly as a dev puts it there. */
async function enableEditPregens(): Promise<void> {
  await settingsService.ensureDataDir()
  const settings: Omit<Settings, 'apiKey'> = {
    schemaVersion: 1,
    apiProvider: 'gemini',
    apiModel: defaultModelFor('gemini').id,
    thinkingLevel: defaultModelFor('gemini').defaultThinkingLevel,
    serviceTier: 'standard',
    streamResponses: true,
    comfyDeferred: false,
    noNsfwImages: false,
    lessNsfwText: false,
    sfwAsked: false,
    removedDefaults: [],
    editPregens: true
  }
  await writeFile(paths.getSettingsPath(), JSON.stringify(settings), 'utf-8')
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dd-pregen-'))
  // The listing is memoized for the run, so a fresh root needs a fresh read.
  paths.clearPregenCache()
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('which root a character lives under', () => {
  it('sends a shipped charId to /assets and everything else to /data', async () => {
    await seed(paths.getPregenCharactersPath(), SHIPPED)
    paths.clearPregenCache()

    expect(paths.isPregenChar(SHIPPED)).toBe(true)
    expect(paths.isPregenChar(OWN)).toBe(false)
    expect(paths.getCharacterPath(SHIPPED)).toBe(join(paths.getPregenCharactersPath(), SHIPPED))
    expect(paths.getCharacterPath(OWN)).toBe(join(paths.getCharactersPath(), OWN))
    // Every other helper composes from that one, so the whole folder — and the
    // `charimg://` handler, which resolves through these — follows it.
    expect(paths.getCharacterFilePath(SHIPPED).startsWith(paths.getPregenCharactersPath())).toBe(
      true
    )
    expect(paths.getCharacterExpressionPath(SHIPPED, 'happy')).toBe(
      join(paths.getPregenCharactersPath(), SHIPPED, 'expressions', 'happy.png')
    )
  })
})

describe('listing', () => {
  it('answers with both roots, and hides nobody', async () => {
    await seed(paths.getPregenCharactersPath(), SHIPPED, { firstName: 'Winter' })
    await seed(paths.getCharactersPath(), OWN, { firstName: 'Ayla' })
    paths.clearPregenCache()
    await settingsService.setRemovedDefaults([SHIPPED])

    const listed = await characterService.listCharacters()
    // The removed one is still here on purpose: a save that holds her has to
    // resolve its roster, so hiding her is the renderer's job.
    expect(listed.map((c) => c.charId).sort()).toEqual([OWN, SHIPPED].sort())
  })
})

describe('what may be done to a shipped character', () => {
  beforeEach(async () => {
    await seed(paths.getPregenCharactersPath(), SHIPPED)
    await seed(paths.getCharactersPath(), OWN)
    paths.clearPregenCache()
  })

  it('refuses a write to one and allows a write to the player’s own', async () => {
    await expect(characterService.writeCharacter(character({ charId: SHIPPED }))).rejects.toMatchObject(
      { code: 'CHARACTER_READ_ONLY' }
    )
    await expect(characterService.writeCharacter(character({ charId: OWN }))).resolves.toMatchObject(
      { charId: OWN }
    )
  })

  it('still records a removal rather than deleting while the dev switch is on', async () => {
    // The one thing the switch does not unlock: `/assets` has no undo, and what
    // deleting her means is a fact about her folder rather than a permission.
    await enableEditPregens()
    await characterService.deleteCharacter(SHIPPED)

    await expect(characterService.getCharacter(SHIPPED)).resolves.toMatchObject({ charId: SHIPPED })
    expect((await settingsService.getSettings()).removedDefaults).toEqual([SHIPPED])
  })

  it('records a removal instead of deleting the folder', async () => {
    await characterService.deleteCharacter(SHIPPED)

    // Nothing left disk: the folder is content the build came with, and no
    // reinstall is on offer to put it back.
    await expect(characterService.getCharacter(SHIPPED)).resolves.toMatchObject({ charId: SHIPPED })
    expect((await settingsService.getSettings()).removedDefaults).toEqual([SHIPPED])

    // Twice is once: the list says who is off the roster, not how often.
    await characterService.deleteCharacter(SHIPPED)
    expect((await settingsService.getSettings()).removedDefaults).toEqual([SHIPPED])
  })
})
