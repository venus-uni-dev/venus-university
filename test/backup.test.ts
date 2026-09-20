import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { unzipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EMOTIONS } from '@shared/emotions'
import type { BackupFile } from '@shared/backup'
import type { Character, SaveDraft } from '@shared/types'
import { useGameStore } from '../src/renderer/stores/gameStore'
import { record } from './fixtures'

/**
 * Backing the data folder up and putting it back: a restore writes over every save, setting
 * and character at once, so a backup missing a file, or one that drops the stored API key, is
 * only found when there is nothing left to find it with. The 7-Zip pass here is real.
 */
let root = ''
vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => root, getPath: () => root },
  // No keyring: the service then writes and reads the key as plain text.
  safeStorage: { isEncryptionAvailable: () => false }
}))

const { exportBackup, importBackup } = await import('../src/main/services/backupService')
const { createCharacter, getCharacter, writeCharacter } = await import(
  '../src/main/services/characterService'
)
const { createPlaythrough, listPlaythroughs, loadSave, writeAutosave, writeSlotSave } = await import(
  '../src/main/services/saveService'
)
const { getGrabBags, setGrabBags } = await import('../src/main/services/grabBagService')
const { getSettings } = await import('../src/main/services/settingsService')
const { createZip, extractZip, listZip } = await import('../src/main/services/archiveService')
const {
  BACKUP_NAME,
  BACKUP_READ,
  BACKUP_ZIP_LIMITS,
  CHARACTERS_DIR,
  charFileEntry,
  classifyBackupEntry,
  endingArtEntry
} = await import('../src/shared/backup')
const { cgRel, expressionRel, STAGING_DIR } = await import('../src/shared/characterFiles')
const { validateRecord } = await import('../src/shared/jsonValidate')
const { checkZipListing } = await import('../src/shared/zipRules')
const { defaultSettings } = await import('../src/shared/settingsRules')
const {
  getCharacterCgsPath,
  getCharacterExpressionsPath,
  getCharacterPath,
  getCharactersPath,
  getDataPath,
  getEndingArtPath,
  getGrabBagsPath,
  getSavesPath,
  getSettingsPath,
  getStagedExpressionsPath
} = await import('../src/main/paths')

/** The eight bytes every PNG opens with — all `imageTypeOf` reads to sniff one. */
const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
/** The twelve bytes a WebP opens with: a RIFF container whose form tag is `WEBP`. */
const WEBP_BYTES = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0x10, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50
])
/** The three bytes every JPEG opens with, as the graduation picture is stored. */
const ENDING_ART = Uint8Array.from([0xff, 0xd8, 0xff])
const BAGS = { inspiration: ['kettle', 'harbour'] }

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'venus-university-backup-'))
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  vi.restoreAllMocks()
})

/** A complete draft — every field the loader requires — as a fresh store writes one. */
function draft(): SaveDraft {
  return useGameStore.getState().toGameSave()
}

/** Writes `settings.json` straight to disk, bypassing the service under test. */
async function seedSettings(over: Record<string, unknown> = {}): Promise<void> {
  await mkdir(getDataPath(), { recursive: true })
  const body = { ...defaultSettings(), apiKey: '', lessNsfwText: true, ...over }
  await writeFile(getSettingsPath(), JSON.stringify(body), 'utf-8')
}

/** One playthrough with two slot saves, an autosave and a graduation picture. */
async function seedPlaythrough(): Promise<{ playthroughId: string; saveIds: string[] }> {
  const opening = await createPlaythrough(record(), draft())
  const playthroughId = opening.save.playthroughId
  const second = await writeSlotSave(playthroughId, draft())
  const autosave = await writeAutosave(playthroughId, draft())

  await writeFile(getEndingArtPath(playthroughId), ENDING_ART)
  return { playthroughId, saveIds: [opening.save.saveId, second.saveId, autosave.saveId] }
}

/** A character on disk with sprites, a CG and a staging tree to leave behind. */
async function seedCharacter(): Promise<Character> {
  const created = await createCharacter('Mina', 'Aoki')
  const charId = created.charId

  for (const emotion of EMOTIONS) {
    await writeFile(join(getCharacterExpressionsPath(charId), `${emotion}.png`), PNG_BYTES)
  }
  await writeFile(join(getCharacterCgsPath(charId), 'sex.png'), PNG_BYTES)
  // The extension the shipped cast is transcoded to, which a duplicate of one is under.
  await writeFile(join(getCharacterPath(charId), 'room_day.webp'), WEBP_BYTES)
  await mkdir(getStagedExpressionsPath(charId), { recursive: true })
  await writeFile(join(getStagedExpressionsPath(charId), 'neutral.png'), 'staged:neutral')

  return writeCharacter({ ...created, personality: 'Quietly stubborn.', pose: 'standing' })
}

/** Everything a seeded install holds, backed up to one zip. */
async function seedAndExport(): Promise<{
  archive: string
  playthroughId: string
  saveIds: string[]
  character: Character
}> {
  await seedSettings()
  await setGrabBags(BAGS)
  const { playthroughId, saveIds } = await seedPlaythrough()
  const character = await seedCharacter()

  const archive = join(root, 'out.zip')
  await exportBackup(archive)
  return { archive, playthroughId, saveIds, character }
}

/** The archive's entries, by the name each one is stored under. */
async function entriesOf(archive: string): Promise<Record<string, Uint8Array>> {
  return unzipSync(new Uint8Array(await readFile(archive)))
}

describe('exportBackup', () => {
  it('carries every save, character image and setting the data folder holds', async () => {
    const { archive, playthroughId, saveIds, character } = await seedAndExport()
    const entries = await entriesOf(archive)

    const parsed = JSON.parse(new TextDecoder().decode(entries[BACKUP_NAME])) as unknown
    const backup = validateRecord<BackupFile>(parsed, BACKUP_NAME, BACKUP_READ)

    expect(backup.saves.map((entry) => entry.saveId).sort()).toEqual([...saveIds].sort())
    expect(backup.saves.every((entry) => entry.playthroughId === playthroughId)).toBe(true)
    // The folder name is a mint timestamp, which is when the playthrough began.
    expect(backup.playthroughs[playthroughId].createdAt).toBe(Number(playthroughId))
    expect(backup.endingArt).toEqual([playthroughId])
    expect(entries[endingArtEntry(playthroughId)]).toEqual(ENDING_ART)

    for (const emotion of EMOTIONS) {
      expect(entries).toHaveProperty([charFileEntry(character.charId, expressionRel(emotion))])
    }
    expect(entries).toHaveProperty([charFileEntry(character.charId, cgRel('sex'))])
    expect(backup.characters.map((entry) => entry.charId)).toEqual([character.charId])

    // Settings as the renderer sees them: the flag rather than the key itself.
    expect(backup.settings.lessNsfwText).toBe(true)
    expect(backup.settings).not.toHaveProperty('apiKey')
    expect(backup.grabbags).toEqual(BAGS)

    expect(checkZipListing(await listZip(archive), BACKUP_ZIP_LIMITS)).toBeNull()
  })

  it('leaves out the staging tree and the character record', async () => {
    const { archive, character } = await seedAndExport()
    const names = Object.keys(await entriesOf(archive))

    // A staging tree is a dead run's images, and her record travels in `backup.json`.
    const staged = `${charFileEntry(character.charId, STAGING_DIR)}/`
    expect(names.filter((name) => name.startsWith(staged))).toEqual([])
    expect(names.filter((name) => name.endsWith('character.json'))).toEqual([])
  })

  it('leaves a character file that is not a picture out, and restores the rest', async () => {
    await seedSettings()
    const character = await seedCharacter()
    // What a killed write leaves behind: her name, and bytes that are nobody's picture.
    await writeFile(join(getCharacterExpressionsPath(character.charId), 'happy.png'), 'truncated')

    const archive = join(root, 'tainted.zip')
    await exportBackup(archive)

    // Packed, it would be the one entry the restore's gate refuses — a backup that opens and
    // can never be put back.
    expect(await entriesOf(archive)).not.toHaveProperty([
      charFileEntry(character.charId, expressionRel('happy'))
    ])

    await rm(getCharacterPath(character.charId), { recursive: true, force: true })
    await importBackup(archive)

    const sprites = getCharacterExpressionsPath(character.charId)
    expect(await readFile(join(sprites, 'neutral.png'))).toEqual(Buffer.from(PNG_BYTES))
    await expect(readFile(join(sprites, 'happy.png'))).rejects.toThrow()
  })
})

describe('importBackup', () => {
  it('puts a backup back and keeps the stored key', async () => {
    const { archive, playthroughId, saveIds, character } = await seedAndExport()

    // Everything the backup carries, gone; the key and the settings around it, not.
    await rm(getSavesPath(), { recursive: true, force: true })
    await rm(getCharacterPath(character.charId), { recursive: true, force: true })
    await rm(getGrabBagsPath(), { force: true })
    await seedSettings({ apiKey: 'kept', lessNsfwText: false })

    await importBackup(archive)

    expect((await listPlaythroughs()).map((entry) => entry.playthroughId)).toEqual([playthroughId])
    for (const saveId of saveIds) {
      expect((await loadSave(playthroughId, saveId)).saveId).toBe(saveId)
    }
    expect(await readFile(getEndingArtPath(playthroughId))).toEqual(Buffer.from(ENDING_ART))

    const restored = await getCharacter(character.charId)
    expect(restored.personality).toBe('Quietly stubborn.')
    expect(
      await readFile(join(getCharacterExpressionsPath(character.charId), 'neutral.png'))
    ).toEqual(Buffer.from(PNG_BYTES))
    expect(await readFile(join(getCharacterCgsPath(character.charId), 'sex.png'))).toEqual(
      Buffer.from(PNG_BYTES)
    )
    expect(await readFile(join(getCharacterPath(character.charId), 'room_day.webp'))).toEqual(
      Buffer.from(WEBP_BYTES)
    )
    expect(getCharacterPath(character.charId)).toBe(join(getCharactersPath(), character.charId))

    expect(await getGrabBags()).toEqual(BAGS)

    const settings = await getSettings()
    // The backup never carried a key, so the one already here is the one still here.
    expect(settings.apiKey).toBe('kept')
    expect(settings.lessNsfwText).toBe(true)
  })

  it('refuses the whole backup when a character image is not one, and touches nothing', async () => {
    const { archive, character } = await seedAndExport()
    await seedSettings({ lessNsfwText: false })

    // A real export, unpacked, with one of her sprites swapped for bytes that are not a picture.
    const tamperedDir = join(root, 'tampered')
    await extractZip(archive, tamperedDir)
    await writeFile(
      join(tamperedDir, charFileEntry(character.charId, expressionRel('neutral'))),
      'not an image'
    )
    const tampered = join(root, 'tampered.zip')
    await createZip(tamperedDir, tampered)

    await expect(importBackup(tampered)).rejects.toMatchObject({ code: 'IMPORT_BAD_CONTENT' })

    // The whole archive was refused before a byte of it was put back.
    expect((await getSettings()).lessNsfwText).toBe(false)
  })
})

describe('classifyBackupEntry', () => {
  it('sorts an entry into what it is allowed to be', () => {
    expect(classifyBackupEntry(BACKUP_NAME)).toBe('record')
    expect(classifyBackupEntry(charFileEntry('char-1', expressionRel('neutral')))).toBe('image')
    expect(classifyBackupEntry(charFileEntry('char-1', 'cg/sex.webp'))).toBe('image')
    // A folder row: carried by a browser's listing of the archive, written by nobody.
    expect(classifyBackupEntry(`${CHARACTERS_DIR}/`)).toBe('skip')
    expect(classifyBackupEntry(endingArtEntry('1700000000000'))).toBe('image')
    expect(classifyBackupEntry(`${endingArtEntry('1700000000000')}/extra`)).toBe('reject')
    expect(classifyBackupEntry('evil.txt')).toBe('reject')
  })
})
