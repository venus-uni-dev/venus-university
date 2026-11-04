import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { basename, dirname, join } from 'path'
import { unzipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyCatalog } from '@shared/application'
import { EMOTIONS } from '@shared/emotions'
import type { BackupFile } from '@shared/backup'
import type { SlotReplay } from '@shared/replays'
import type { SavedScene } from '@shared/sceneCreator'
import type { AppError, Character, SaveDraft } from '@shared/types'
import { useGameStore } from '../src/renderer/stores/gameStore'
import { character as characterFixture, record } from './fixtures'

/**
 * Backing the data folder up and putting it back: a restore writes over every save, setting
 * and character at once, so a backup missing a file, or one that drops the stored API key, is
 * only found when there is nothing left to find it with. The 7-Zip pass here is real.
 */
let root = ''
// A packaged build and an unpackaged run resolve to the same folders under the temp root.
let packaged = false
vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return packaged
    },
    getAppPath: () => root,
    getPath: (name: string) => (name === 'exe' ? join(root, 'game.exe') : root)
  },
  // No keyring: the service then writes and reads the key as plain text.
  safeStorage: { isEncryptionAvailable: () => false }
}))

// Which renames Windows refuses in this test, as it refuses a folder another program holds.
const held = vi.hoisted(() => ({
  refuses: null as ((from: string, to: string) => boolean) | null
}))
vi.mock('fs/promises', async (actual) => {
  const real = await actual<typeof import('fs/promises')>()
  return {
    ...real,
    rename: async (from: string, to: string): Promise<void> => {
      if (held.refuses?.(from, to)) {
        throw Object.assign(new Error(`EPERM: operation not permitted, rename '${from}'`), {
          code: 'EPERM'
        })
      }
      await real.rename(from, to)
    }
  }
})

const { exportBackup, importBackup } = await import('../src/main/services/backupService')
const { createCharacter, getCharacter, readCharacterImage, writeCharacter } = await import(
  '../src/main/services/characterService'
)
const { readEndingArt } = await import('../src/main/services/endingArtService')
const { readProfilePicture, readProfileSource } = await import(
  '../src/main/services/profilePictureService'
)
const {
  createPlaythrough,
  listPlaythroughs,
  loadSave,
  readApplication,
  writeApplication,
  writeAutosave,
  writeManualSave,
  writeSlotSave
} = await import('../src/main/services/saveService')
const { getGrabBags, setGrabBags } = await import('../src/main/services/grabBagService')
const { getSettings } = await import('../src/main/services/settingsService')
const {
  addCustomBackground,
  listCustomBackgrounds,
  readCustomBackgroundImage,
  removeCustomBackground
} = await import('../src/main/services/backgroundService')
const { listScenes, readScene, writeScene } = await import('../src/main/services/sceneService')
const { listPhotos, readPhoto, writePhoto } = await import('../src/main/services/photoService')
const { readLorebook, writeLorebook } = await import('../src/main/services/lorebookService')
const { createZip, extractZip, listZip } = await import('../src/main/services/archiveService')
const {
  BACKUP_NAME,
  BACKUP_READ,
  BACKUP_ZIP_LIMITS,
  backgroundEntry,
  CHARACTERS_DIR,
  charFileEntry,
  classifyBackupEntry,
  endingArtEntry,
  photoEntry,
  profilePictureEntry,
  profileSourceEntry,
  replaysFromBackup,
  semesterEndingArtEntry
} = await import('../src/shared/backup')
const { cgRel, expressionRel, STAGING_DIR } = await import('../src/shared/characterFiles')
const { validateRecord } = await import('../src/shared/jsonValidate')
const { replayIdOf } = await import('../src/shared/replays')
const { defaultMilestones } = await import('../src/shared/sceneCreator')
const { checkZipListing } = await import('../src/shared/zipRules')
const { defaultSettings } = await import('../src/shared/settingsRules')
const {
  clearPregenCache,
  getCharacterCgsPath,
  getCharacterExpressionsPath,
  getCharacterPath,
  getCharactersPath,
  getDataPath,
  getEndingArtPath,
  getCustomBackgroundPath,
  getGrabBagsPath,
  getPhotosPath,
  getPregenCharactersPath,
  getProfilePicturePath,
  getProfileSourcePath,
  getProfileSourceRecordPath,
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
/** One photo's sidecar, as the game writes it. */
const PHOTO_META = {
  schemaVersion: 1,
  date: 3,
  time: 1 as const,
  rows: [{ charId: 'char-1', set: 'default' as const, emotion: 'happy' as const }],
  prompt: 'On the quad.',
  options: { aspectRatio: '16:9' }
}
/** The id one of the shipped cast is seeded under, beside the player's own. */
const SHIPPED = 'shipped-1'

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'venus-university-backup-'))
  packaged = false
  Object.assign(process, { resourcesPath: root })
  // The shipped listing is memoized for the run, so a fresh root needs a fresh read.
  clearPregenCache()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(async () => {
  held.refuses = null
  await rm(root, { recursive: true, force: true })
  clearPregenCache()
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

/**
 * One playthrough with two slot saves, an autosave, a manual save, a graduation picture and a
 * photo.
 */
async function seedPlaythrough(): Promise<{ playthroughId: string; saveIds: string[] }> {
  const opening = await createPlaythrough(record(), draft())
  const playthroughId = opening.save.playthroughId
  const second = await writeSlotSave(playthroughId, draft())
  const autosave = await writeAutosave(playthroughId, draft())
  const manual = await writeManualSave(playthroughId, 3, draft())

  await writeFile(getEndingArtPath(playthroughId), ENDING_ART)
  await writePhoto(
    playthroughId,
    '42',
    Buffer.from(PNG_BYTES).toString('base64'),
    Buffer.from(ENDING_ART).toString('base64'),
    PHOTO_META
  )
  return {
    playthroughId,
    saveIds: [opening.save.saveId, second.saveId, autosave.saveId, manual.saveId]
  }
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
    // A photo travels with its record, and without the thumbnail a restore cuts again.
    expect(backup.photos).toEqual([{ playthroughId, photoId: '42', meta: PHOTO_META }])
    expect(entries[photoEntry(playthroughId, '42')]).toEqual(PNG_BYTES)

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
  // The boot's conversion leaves every picture under its WebP name alone, and a backup that read
  // the PNG names would carry none of them.
  it('carries a graduation picture, a reader picture and a photo kept as WebP out and back', async () => {
    await seedSettings()
    const { playthroughId } = await seedPlaythrough()
    const asWebp = (path: string): string => path.replace(/.png$/, '.webp')
    await rm(getEndingArtPath(playthroughId))
    await writeFile(asWebp(getEndingArtPath(playthroughId)), WEBP_BYTES)
    await writeFile(asWebp(getProfilePicturePath(playthroughId)), WEBP_BYTES)
    await writeFile(asWebp(getProfileSourcePath(playthroughId)), WEBP_BYTES)
    const frame = { x: 10, y: 20, width: 100, height: 120 }
    await writeFile(
      getProfileSourceRecordPath(playthroughId),
      JSON.stringify({ schemaVersion: 1, frame })
    )
    const photos = getPhotosPath(playthroughId)
    for (const name of await readdir(photos)) {
      if (name.startsWith('42.') && !name.endsWith('.json')) await rm(join(photos, name))
    }
    await writeFile(join(photos, '42.webp'), WEBP_BYTES)
    const archive = join(root, 'webp.zip')
    await exportBackup(archive)

    const entries = await entriesOf(archive)
    expect(entries[endingArtEntry(playthroughId)]).toEqual(WEBP_BYTES)
    expect(entries[profilePictureEntry(playthroughId)]).toEqual(WEBP_BYTES)
    expect(entries[profileSourceEntry(playthroughId)]).toEqual(WEBP_BYTES)
    expect(entries[photoEntry(playthroughId, '42')]).toEqual(WEBP_BYTES)

    await rm(getSavesPath(), { recursive: true, force: true })
    await importBackup(archive)
    expect(await readEndingArt(playthroughId)).toEqual(Buffer.from(WEBP_BYTES))
    expect(await readProfilePicture(playthroughId)).toEqual(Buffer.from(WEBP_BYTES))
    expect(await readProfileSource(playthroughId)).toEqual({
      image: new Uint8Array(WEBP_BYTES),
      frame
    })
    expect(await readPhoto(playthroughId, '42')).toEqual(Buffer.from(WEBP_BYTES))
  })

  // A restore merges into her folder, where the boot's conversion may since have left the same
  // picture as WebP: the WebP is read first, so a restored PNG beside it would never be seen.
  it("puts an older backup's PNG back over the WebP her folder holds since", async () => {
    await seedSettings()
    const character = await seedCharacter()
    const archive = join(root, 'older.zip')
    await exportBackup(archive)
    const sprites = getCharacterExpressionsPath(character.charId)
    await rm(join(sprites, 'neutral.png'))
    await writeFile(join(sprites, 'neutral.webp'), WEBP_BYTES)

    await importBackup(archive)

    expect((await readdir(sprites)).filter((name) => name.startsWith('neutral.'))).toEqual([
      'neutral.png'
    ])
    expect(await readCharacterImage(character.charId, expressionRel('neutral'))).toEqual(
      Buffer.from(PNG_BYTES)
    )
  })

  // A later semester's picture sits beside the first one's under its own name, and a restore that
  // dropped it would lose the one picture its ending ever drew.
  it("carries a later semester's graduation picture out and back", async () => {
    await seedSettings()
    const { playthroughId } = await seedPlaythrough()
    const later = PNG_BYTES
    await writeFile(getEndingArtPath(playthroughId, '1700000000999'), later)
    const archive = join(root, 'semesters.zip')
    await exportBackup(archive)

    const entries = await entriesOf(archive)
    const backup = JSON.parse(new TextDecoder().decode(entries[BACKUP_NAME])) as BackupFile
    expect(backup.semesterEndingArt).toEqual([{ playthroughId, semesterId: '1700000000999' }])
    expect(entries[semesterEndingArtEntry(playthroughId, '1700000000999')]).toEqual(later)

    await rm(getSavesPath(), { recursive: true, force: true })
    await importBackup(archive)
    expect(await readFile(getEndingArtPath(playthroughId, '1700000000999'))).toEqual(
      Buffer.from(later)
    )
    expect(await readFile(getEndingArtPath(playthroughId))).toEqual(Buffer.from(ENDING_ART))
  })

  it("carries a playthrough's lorebook out and back", async () => {
    await seedSettings()
    const { playthroughId } = await seedPlaythrough()
    const lorebook = {
      schemaVersion: 1,
      edits: { front_gate: { text: 'Locked after dark.' } },
      custom: [{ id: 'custom1', keys: ['kettle'], text: 'It never boils.' }]
    }
    await writeLorebook(playthroughId, lorebook)
    const archive = join(root, 'lorebook.zip')
    await exportBackup(archive)

    const backup = JSON.parse(
      new TextDecoder().decode((await entriesOf(archive))[BACKUP_NAME])
    ) as BackupFile
    expect(backup.lorebooks).toEqual({ [playthroughId]: lorebook })

    await rm(getSavesPath(), { recursive: true, force: true })
    await importBackup(archive)
    expect(await readLorebook(playthroughId)).toEqual(lorebook)
  })

  it('carries a new game in progress out and back', async () => {
    await seedSettings()
    const { playthroughId, application } = await writeApplication({
      screen: 'loading',
      season: 'spring',
      chars: ['a', 'b'],
      plan: [],
      occasions: {},
      catalog: emptyCatalog(),
      girls: {},
      pairs: {},
      replies: {}
    })
    const archive = join(root, 'applying.zip')
    await exportBackup(archive)

    const backup = JSON.parse(
      new TextDecoder().decode((await entriesOf(archive))[BACKUP_NAME])
    ) as BackupFile
    expect(backup.applications).toEqual({ [playthroughId]: application })

    await rm(getSavesPath(), { recursive: true, force: true })
    await importBackup(archive)
    expect(await readApplication(playthroughId)).toEqual(application)
  })

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
    expect(await readPhoto(playthroughId, '42')).toEqual(Buffer.from(PNG_BYTES))
    expect(await listPhotos(playthroughId)).toEqual([{ photoId: '42', meta: PHOTO_META }])

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

  it('leaves the shipped cast out of a backup and never writes one back', async () => {
    await seedSettings()
    const shipped = characterFixture({ charId: SHIPPED, personality: 'As shipped.' })
    const shippedFolder = join(getPregenCharactersPath(), SHIPPED)
    await mkdir(join(shippedFolder, 'expressions'), { recursive: true })
    await writeFile(join(shippedFolder, 'character.json'), JSON.stringify(shipped), 'utf-8')
    await writeFile(join(shippedFolder, expressionRel('neutral')), PNG_BYTES)
    clearPregenCache()
    const own = await seedCharacter()

    const archive = join(root, 'out.zip')
    await exportBackup(archive)
    const entries = await entriesOf(archive)
    const backup = JSON.parse(new TextDecoder().decode(entries[BACKUP_NAME])) as BackupFile
    expect(backup.characters.map((entry) => entry.charId)).toEqual([own.charId])
    const shippedPrefix = charFileEntry(SHIPPED, '')
    expect(Object.keys(entries).filter((name) => name.startsWith(shippedPrefix))).toEqual([])

    // The same backup with her record and a sprite of hers written in by hand.
    const dir = join(root, 'with-shipped')
    await extractZip(archive, dir)
    const tampered: BackupFile = {
      ...backup,
      characters: [
        ...backup.characters,
        { ...shipped, charId: SHIPPED, personality: 'from the backup' }
      ]
    }
    await writeFile(join(dir, BACKUP_NAME), JSON.stringify(tampered), 'utf-8')
    const sprite = join(dir, charFileEntry(SHIPPED, expressionRel('neutral')))
    await mkdir(dirname(sprite), { recursive: true })
    await writeFile(sprite, PNG_BYTES)
    const second = join(root, 'with-shipped.zip')
    await createZip(dir, second)

    await rm(getCharacterPath(own.charId), { recursive: true, force: true })
    await importBackup(second)

    expect((await getCharacter(own.charId)).personality).toBe('Quietly stubborn.')
    expect((await getCharacter(SHIPPED)).personality).toBe('As shipped.')
    await expect(stat(join(getCharactersPath(), SHIPPED))).rejects.toThrow()
  })
})

describe('an edited copy of a shipped character in a backup', () => {
  it('travels with the backup and comes back as her copy, not the shipped folder', async () => {
    packaged = true
    await seedSettings()
    const shipped = characterFixture({ charId: SHIPPED, personality: 'As shipped.' })
    const shippedFolder = join(getPregenCharactersPath(), SHIPPED)
    await mkdir(join(shippedFolder, 'expressions'), { recursive: true })
    await writeFile(join(shippedFolder, 'character.json'), JSON.stringify(shipped), 'utf-8')
    await writeFile(join(shippedFolder, expressionRel('neutral')), PNG_BYTES)
    clearPregenCache()
    await writeCharacter({ ...shipped, personality: 'Edited by the player.' })

    const archive = join(root, 'out.zip')
    await exportBackup(archive)
    const entries = await entriesOf(archive)
    const backup = JSON.parse(new TextDecoder().decode(entries[BACKUP_NAME])) as BackupFile
    expect(backup.characters.map((entry) => entry.charId)).toEqual([SHIPPED])
    expect(entries[charFileEntry(SHIPPED, expressionRel('neutral'))]).toBeDefined()

    // A fresh install: the shipped folder as built, no copy yet.
    await rm(getCharactersPath(), { recursive: true, force: true })
    clearPregenCache()
    expect((await getCharacter(SHIPPED)).personality).toBe('As shipped.')

    await importBackup(archive)

    expect((await getCharacter(SHIPPED)).personality).toBe('Edited by the player.')
    expect(getCharacterPath(SHIPPED)).toBe(join(getCharactersPath(), SHIPPED))
    expect(await readCharacterImage(SHIPPED, expressionRel('neutral'))).toBeTruthy()
    expect(JSON.parse(await readFile(join(shippedFolder, 'character.json'), 'utf-8'))).toMatchObject(
      { personality: 'As shipped.' }
    )
  })
})

describe('custom backgrounds in a backup', () => {
  /** A picture's base64 bytes, as the renderer hands one over. */
  const PNG = Buffer.from(PNG_BYTES).toString('base64')

  it('travels whole, and comes back in place of whatever is kept under its name', async () => {
    await seedSettings()
    await addCustomBackground(
      { name: 'rooftop', kind: 'exterior', music: 'venue_edm' },
      { day: PNG, night: PNG, day_rain: PNG }
    )
    const archive = join(root, 'out.zip')
    await exportBackup(archive)

    const entries = await entriesOf(archive)
    const backup = JSON.parse(new TextDecoder().decode(entries[BACKUP_NAME])) as BackupFile
    expect(backup.backgrounds?.map((background) => background.name)).toEqual(['rooftop'])
    expect(entries[backgroundEntry('rooftop', 'day_rain')]).toEqual(PNG_BYTES)
    expect(entries).not.toHaveProperty([backgroundEntry('rooftop', 'night_rain')])

    // Kept again since under the same name, as something else: indoors, songless, and with
    // the other rain render, which the backup's copy does not have.
    await removeCustomBackground('rooftop')
    await addCustomBackground(
      { name: 'rooftop', kind: 'interior' },
      { day: PNG, night: PNG, night_rain: PNG }
    )

    await importBackup(archive)

    const [restored] = await listCustomBackgrounds()
    expect(restored.record).toMatchObject({ name: 'rooftop', kind: 'exterior', music: 'venue_edm' })
    expect(Object.keys(restored.urls).sort()).toEqual(['day', 'day_rain', 'night'])
    expect(await readCustomBackgroundImage('rooftop', 'night_rain')).toBeNull()
    expect(await readCustomBackgroundImage('rooftop', 'day_rain')).toEqual(Buffer.from(PNG_BYTES))
  })

  it('is merged in by name, leaving one kept since the backup alone', async () => {
    await seedSettings()
    const archive = join(root, 'out.zip')
    await exportBackup(archive)
    await addCustomBackground({ name: 'arcade_hall', kind: 'interior' }, { day: PNG, night: PNG })

    await importBackup(archive)

    expect((await listCustomBackgrounds()).map((listing) => listing.record.name)).toEqual([
      'arcade_hall'
    ])
  })

  it('reads a folder left without its record as absent, and a later add clears it', async () => {
    await seedSettings()
    await addCustomBackground(
      { name: 'rooftop', kind: 'exterior' },
      { day: PNG, night: PNG, day_rain: PNG }
    )
    // What a write cut short between the pictures and the record leaves behind.
    await rm(join(getCustomBackgroundPath('rooftop'), 'background.json'))
    expect(await listCustomBackgrounds()).toEqual([])

    await addCustomBackground({ name: 'rooftop', kind: 'exterior' }, { day: PNG, night: PNG })
    const [kept] = await listCustomBackgrounds()
    expect(Object.keys(kept.urls).sort()).toEqual(['day', 'night'])
  })

  it('refuses a second background under a name already kept', async () => {
    await addCustomBackground({ name: 'rooftop', kind: 'exterior' }, { day: PNG, night: PNG })
    await expect(
      addCustomBackground({ name: 'rooftop', kind: 'interior' }, { day: PNG, night: PNG })
    ).rejects.toMatchObject({ code: 'BACKGROUND_TAKEN' })
  })
})

describe('saved scenes in a backup', () => {
  /** A minimal saved scene under `id`. */
  function scene(id: string, name: string): SavedScene {
    return {
      schemaVersion: 1,
      id,
      name,
      savedAt: 1000,
      setup: {
        reader: { firstName: 'Sam', lastName: 'Lee', tiers: { brain: 1, body: 1, heart: 1 }, bio: '' },
        cast: [
          {
            charId: 'char-1',
            outfit: 'default',
            disposition: 'friendly',
            milestones: defaultMilestones(),
            notes: ''
          }
        ],
        pairs: {},
        date: 60,
        time: 1,
        weather: 'clear',
        prompt: 'Hello.'
      },
      castNames: ['Ami Ito'],
      transcript: [],
      ended: true
    }
  }
  const FIRST = '11111111-1111-4111-8111-111111111111'
  const SECOND = '22222222-2222-4222-8222-222222222222'
  const THIRD = '33333333-3333-4333-8333-333333333333'

  it('is merged in by id: the backup wins a shared id, a scene kept since stays', async () => {
    await seedSettings()
    await writeScene(scene(FIRST, 'Original'))
    await writeScene(scene(SECOND, 'Second'))
    const archive = join(root, 'out.zip')
    await exportBackup(archive)

    await writeScene(scene(FIRST, 'Edited since'))
    await writeScene(scene(THIRD, 'Third'))
    await importBackup(archive)

    expect((await readScene(FIRST)).name).toBe('Original')
    expect((await listScenes()).map((summary) => summary.id).sort()).toEqual([FIRST, SECOND, THIRD])
  })

})

describe('importBackup — the settings it carries', () => {
  it('refuses settings missing a field before anything is written', async () => {
    await seedSettings()
    const png = Buffer.from(PNG_BYTES).toString('base64')
    await addCustomBackground({ name: 'rooftop', kind: 'exterior' }, { day: png, night: png })
    const archive = join(root, 'out.zip')
    await exportBackup(archive)
    const dir = join(root, 'incomplete')
    await extractZip(archive, dir)
    const backup = JSON.parse(await readFile(join(dir, BACKUP_NAME), 'utf-8')) as BackupFile
    const { apiModel: _missing, ...settings } = backup.settings
    await writeFile(join(dir, BACKUP_NAME), JSON.stringify({ ...backup, settings }), 'utf-8')
    const incomplete = join(root, 'incomplete.zip')
    await createZip(dir, incomplete)

    await removeCustomBackground('rooftop')
    await seedSettings({ lessNsfwText: false })

    await expect(importBackup(incomplete)).rejects.toMatchObject({ code: 'BACKUP_MALFORMED' })
    // Neither the settings nor anything after them was put back.
    expect((await getSettings()).lessNsfwText).toBe(false)
    expect(await listCustomBackgrounds()).toEqual([])
  })
})

describe('importBackup — a saves folder that will not move', () => {
  /** A backup, and an install that has since moved on from it, as bytes to compare against. */
  async function seedAndMoveOn(): Promise<{
    archive: string
    playthroughId: string
    saveIds: string[]
    settings: Buffer
    bags: Buffer
  }> {
    const { archive, playthroughId, saveIds } = await seedAndExport()
    await seedSettings({ lessNsfwText: false })
    await setGrabBags({ inspiration: ['lantern'] })
    return {
      archive,
      playthroughId,
      saveIds,
      settings: await readFile(getSettingsPath()),
      bags: await readFile(getGrabBagsPath())
    }
  }

  it.each([
    ['the live folder is held', 'BACKUP_SAVES_HELD', (from: string) => from === getSavesPath()],
    [
      'the staged folder will not land',
      'BACKUP_RESTORE_FAILED',
      (from: string, to: string) => to === getSavesPath() && !basename(from).startsWith('saves-old-')
    ]
  ])('changes nothing when %s', async (_case, code, refuses) => {
    const { archive, playthroughId, saveIds, settings, bags } = await seedAndMoveOn()

    held.refuses = refuses
    await expect(importBackup(archive)).rejects.toMatchObject({ code })

    expect(await readFile(getSettingsPath())).toEqual(settings)
    expect(await readFile(getGrabBagsPath())).toEqual(bags)
    for (const saveId of saveIds) {
      expect((await loadSave(playthroughId, saveId)).saveId).toBe(saveId)
    }
  })

  it('names the folder the saves are left in when they cannot be moved back', async () => {
    const { archive, playthroughId, settings } = await seedAndMoveOn()

    held.refuses = (_from, to) => to === getSavesPath()
    const error = (await importBackup(archive).catch((err: unknown) => err)) as AppError

    expect(error.code).toBe('BACKUP_SAVES_STRANDED')
    const parked = /data\\tmp\\(saves-old-[^,\s]+)/.exec(error.message)?.[1] ?? ''
    expect(parked).not.toBe('')
    const left = await readdir(join(getDataPath(), 'tmp', parked, playthroughId))
    expect(left.length).toBeGreaterThan(0)
    expect(await readFile(getSettingsPath())).toEqual(settings)
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
    expect(classifyBackupEntry(profilePictureEntry('1700000000000'))).toBe('image')
    expect(classifyBackupEntry(`${profilePictureEntry('1700000000000')}/extra`)).toBe('reject')
    expect(classifyBackupEntry(photoEntry('1700000000000', '1700000000001'))).toBe('image')
    expect(classifyBackupEntry('photos/1700000000000')).toBe('reject')
    expect(classifyBackupEntry(`${photoEntry('1700000000000', '1700000000001')}/extra`)).toBe(
      'reject'
    )
    expect(classifyBackupEntry('photos/1700000000000/not-a-number')).toBe('reject')
    expect(classifyBackupEntry('photos/../x')).toBe('reject')
    expect(classifyBackupEntry(backgroundEntry('rooftop', 'night_rain'))).toBe('image')
    expect(classifyBackupEntry('backgrounds/rooftop/dusk')).toBe('reject')
    expect(classifyBackupEntry('backgrounds/Roof Top/day')).toBe('reject')
    expect(classifyBackupEntry('backgrounds/__proto__/day')).toBe('reject')
    expect(classifyBackupEntry(`${backgroundEntry('rooftop', 'day')}/extra`)).toBe('reject')
    expect(classifyBackupEntry('evil.txt')).toBe('reject')
  })
})

describe('replaysFromBackup', () => {
  const replay: SlotReplay = {
    schemaVersion: 1,
    date: 8,
    time: 0,
    cast: ['ava'],
    keys: { ava: 'ava' },
    transcript: [{ speaker: 'ava', text: 'Hi.' }]
  }
  const entry = { playthroughId: '1700000000000', replayId: replayIdOf(replay), replay }
  /** A record carrying `replays` and nothing else this rule reads. */
  const carrying = (replays: unknown[]): BackupFile => ({ replays }) as unknown as BackupFile

  it('reads back every entry that could have been written', () => {
    expect(replaysFromBackup(carrying([entry]))).toEqual([entry])
  })

  it('refuses the backup over an entry it could not write back, or one carried twice', () => {
    for (const bad of [
      { ...entry, playthroughId: '../1' },
      { ...entry, replayId: 'nope' },
      { ...entry, replay: { ...replay, transcript: undefined } },
      { ...entry, replay: { ...replay, schemaVersion: 2 } }
    ]) {
      expect(() => replaysFromBackup(carrying([bad]))).toThrow()
    }
    expect(() => replaysFromBackup(carrying([entry, entry]))).toThrow(
      expect.objectContaining({ code: 'BACKUP_MALFORMED' })
    )
  })
})
