import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { unzipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EMOTIONS } from '@shared/emotions'
import type { AppError, Character } from '@shared/types'
import { character } from './fixtures'

/**
 * Exporting and importing one character: an import writes a character folder from a file
 * nobody in this build wrote, and one that lands wrong is a roster entry that looks fine and
 * cannot be played. The 7-Zip and unzip passes here are real.
 */
let root = ''
vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => root, getPath: () => root }
}))

const { createCharacter, getCharacter, writeCharacter } = await import(
  '../src/main/services/characterService'
)
const { duplicateCharacter, exportCharacter, importCharacter } = await import(
  '../src/main/services/characterTransferService'
)
const {
  MANIFEST_NAME,
  buildManifest,
  checkManifest,
  classifyImportEntry,
  portableOf,
  stripWrapper
} = await import('../src/shared/characterTransfer')
const { createZip, extractZip } = await import('../src/main/services/archiveService')
const {
  getCharacterCgsPath,
  getCharacterExpressionsPath,
  getCharacterFilePath,
  getCharacterPath,
  getCharactersPath,
  getCharacterStagingPath,
  getStagedExpressionsPath,
  getTempPath
} = await import('../src/main/paths')

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'venus-university-transfer-'))
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  vi.restoreAllMocks()
})

/** The eight bytes every PNG opens with — all `imageTypeOf` reads to sniff one. */
const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** The twelve bytes a WebP opens with: a RIFF container whose form tag is `WEBP`. */
const WEBP_BYTES = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0x10, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50
])

/** A character on disk with sprites, a CG and a staging tree to leave behind, under `extension`. */
async function seedCharacter(extension = '.png'): Promise<Character> {
  const bytes = extension === '.png' ? PNG_BYTES : WEBP_BYTES
  const character = await createCharacter('Mina', 'Aoki')
  const charId = character.charId

  await mkdir(getCharacterExpressionsPath(charId), { recursive: true })
  for (const emotion of EMOTIONS) {
    const sprite = join(getCharacterExpressionsPath(charId), `${emotion}${extension}`)
    await writeFile(sprite, bytes)
  }
  await mkdir(getCharacterCgsPath(charId), { recursive: true })
  await writeFile(join(getCharacterCgsPath(charId), `sex${extension}`), bytes)
  await mkdir(getStagedExpressionsPath(charId), { recursive: true })
  await writeFile(join(getStagedExpressionsPath(charId), 'neutral.png'), PNG_BYTES)

  return writeCharacter({ ...character, personality: 'Quietly stubborn.', pose: 'standing' })
}

/** Where an export is written — outside `/data`, as a player's chosen path is. */
function archivePath(name = 'export.zip'): string {
  return join(root, name)
}

/** Unpacks an archive to a scratch folder and lists what is at its root. */
async function unpack(archive: string, name: string): Promise<string> {
  const dir = join(root, `unpacked-${name}`)
  await extractZip(archive, dir)
  return dir
}

/** Builds a zip out of a hand-made folder — an import's input, however odd. */
async function zipOf(name: string, build: (dir: string) => Promise<void>): Promise<string> {
  const dir = join(root, `handmade-${name}`)
  await mkdir(dir, { recursive: true })
  await build(dir)
  const archive = archivePath(`${name}.zip`)
  await createZip(dir, archive)
  return archive
}

/** The `character.json` body every hand-made zip starts from — complete, as an export writes it. */
function portableCharacter(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const { charId: _identity, ...portable } = character({
    firstName: 'Mina',
    lastName: 'Aoki',
    personality: 'Quietly stubborn.'
  })
  return { ...portable, ...overrides }
}

/** A manifest, valid unless the test says otherwise. */
function manifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format: 'venus-university-character',
    schemaVersion: 2,
    exportedAt: '2015-01-19T00:00:00.000Z',
    firstName: 'Mina',
    lastName: 'Aoki',
    ...overrides
  }
}

/** The `AppError` a rejected import threw. */
async function importError(archive: string): Promise<AppError> {
  try {
    await importCharacter(archive)
  } catch (err) {
    return err as AppError
  }
  throw new Error('the import was expected to fail')
}

/** Character folders on disk, so a refused import can be shown to have added none. */
async function charFolders(): Promise<string[]> {
  return (await readdir(getCharactersPath()).catch(() => [])).sort()
}

/** What a transfer left under `/data/tmp`. */
async function transferScratch(): Promise<string[]> {
  return (await readdir(getTempPath()).catch(() => [])).filter(
    (name) => name.startsWith('import-') || name.startsWith('export-')
  )
}

describe('exportCharacter', () => {
  it('writes the folder at the archive root, with a manifest and no identity', async () => {
    const character = await seedCharacter()
    const archive = archivePath()

    await exportCharacter(character.charId, archive)
    const dir = await unpack(archive, 'shape')

    // At the root, not under a wrapper: an import reads `character.json` there.
    expect((await readdir(dir)).sort()).toEqual([
      'cg',
      'character.json',
      'expressions',
      MANIFEST_NAME
    ])

    const written = JSON.parse(await readFile(join(dir, 'character.json'), 'utf8'))
    // The whole point of stripping it: an id is what one install calls her.
    expect(written).not.toHaveProperty('charId')
    expect(written.firstName).toBe('Mina')
    expect(written.schemaVersion).toBe(2)

    expect(JSON.parse(await readFile(join(dir, MANIFEST_NAME), 'utf8'))).toMatchObject({
      format: 'venus-university-character',
      schemaVersion: 2,
      firstName: 'Mina',
      lastName: 'Aoki'
    })
  })

  it('replaces an export written over, rather than merging into it', async () => {
    const first = await seedCharacter()
    const second = await createCharacter('Rei', 'Sato')
    await writeCharacter({ ...second, pose: 'standing' })
    const archive = archivePath()

    await exportCharacter(first.charId, archive)
    await exportCharacter(second.charId, archive)
    const dir = await unpack(archive, 'overwrite')

    // 7-Zip's `a` updates an archive; without the pre-delete the first
    // character's sprites would still be in here beside the second's. Rei has no
    // pictures at all, so anything but the two files below is the first export's.
    expect((await readdir(dir)).sort()).toEqual(['character.json', MANIFEST_NAME].sort())
    expect(JSON.parse(await readFile(join(dir, 'character.json'), 'utf8')).firstName).toBe('Rei')
  })

  it('writes nothing a browser’s unzip would refuse on the way back in', async () => {
    const character = await seedCharacter()
    const archive = archivePath('listing.zip')
    await exportCharacter(character.charId, archive)

    // fflate lists the folder rows 7-Zip writes, which the desktop's unpacker never shows;
    // this is the listing the web importer walks.
    const names = Object.keys(unzipSync(new Uint8Array(await readFile(archive))))

    expect(names.some((name) => name.endsWith('/'))).toBe(true)
    expect(names.filter((name) => classifyImportEntry(name) === 'reject')).toEqual([])
  })

  it('leaves a half-written file and the loose reference picture behind', async () => {
    const character = await seedCharacter()
    const folder = getCharacterPath(character.charId)
    await writeFile(join(folder, 'expressions', 'happy.png.partial'), PNG_BYTES)
    await writeFile(join(folder, 'reference'), PNG_BYTES)
    const archive = archivePath('leftovers.zip')

    await exportCharacter(character.charId, archive)
    const imported = await importCharacter(archive)

    // Both are refused by the gate the import runs, so packing either is packing an
    // archive this build would not take back.
    const adopted = getCharacterPath(imported.charId)
    expect(await readdir(adopted)).not.toContain('reference')
    expect(await readdir(join(adopted, 'expressions'))).not.toContain('happy.png.partial')
  })
})

describe('importCharacter', () => {
  it('round-trips a character under a new identity, with her images', async () => {
    const original = await seedCharacter()
    const archive = archivePath()
    await exportCharacter(original.charId, archive)

    const imported = await importCharacter(archive)

    expect(imported.charId).not.toBe(original.charId)
    expect(imported.firstName).toBe('Mina')
    expect(imported.personality).toBe('Quietly stubborn.')
    // Stamped on arrival, not carried from whoever exported her: the grid orders on it.
    expect(imported.updatedAt).toBeTypeOf('number')

    // The folder is named for the new id, and the file agrees with the folder.
    const onDisk = await getCharacter(imported.charId)
    expect(onDisk.charId).toBe(imported.charId)
    expect(onDisk.schemaVersion).toBe(2)

    const sprites = getCharacterExpressionsPath(imported.charId)
    expect(await readFile(join(sprites, 'neutral.png'))).toEqual(Buffer.from(PNG_BYTES))
    expect(await readFile(join(getCharacterCgsPath(imported.charId), 'sex.png'))).toEqual(
      Buffer.from(PNG_BYTES)
    )

    // Both installs hold her at once: an import copies, it does not move.
    expect(await charFolders()).toEqual([original.charId, imported.charId].sort())
  })

  it('round-trips a character whose pictures are WebP, under their own names', async () => {
    const original = await seedCharacter('.webp')
    const archive = archivePath('webp.zip')
    await exportCharacter(original.charId, archive)

    const imported = await importCharacter(archive)

    // The extension the shipped cast is transcoded to: every reader takes it for the PNG it names.
    expect(
      await readFile(join(getCharacterExpressionsPath(imported.charId), 'neutral.webp'))
    ).toEqual(Buffer.from(WEBP_BYTES))
    expect(await readFile(join(getCharacterCgsPath(imported.charId), 'sex.webp'))).toEqual(
      Buffer.from(WEBP_BYTES)
    )
  })

  it('keeps neither the manifest nor a staged set the archive carried', async () => {
    const archive = await zipOf('extras', async (dir) => {
      await writeFile(join(dir, 'character.json'), JSON.stringify(portableCharacter()))
      await writeFile(join(dir, MANIFEST_NAME), JSON.stringify(manifest()))
      await mkdir(join(dir, 'staging', 'expressions'), { recursive: true })
      await writeFile(join(dir, 'staging', 'expressions', 'neutral.png'), 'staged')
    })

    const imported = await importCharacter(archive)

    const entries = await readdir(getCharacterPath(imported.charId))
    expect(entries).toEqual(['character.json'])
  })

  it('ignores a charId the archive carries, however it is spelled', async () => {
    const archive = await zipOf('hostile', async (dir) => {
      await writeFile(
        join(dir, 'character.json'),
        JSON.stringify(portableCharacter({ charId: '../escaped' }))
      )
      await writeFile(join(dir, MANIFEST_NAME), JSON.stringify(manifest()))
    })

    const imported = await importCharacter(archive)

    expect(imported.charId).not.toBe('../escaped')
    // Nothing landed beside `/data/characters`, which is what the id could
    // otherwise have reached.
    expect(await charFolders()).toEqual([imported.charId])
    expect(JSON.parse(await readFile(getCharacterFilePath(imported.charId), 'utf8')).charId).toBe(
      imported.charId
    )
  })

  it('refuses an export missing a field, names it, and adopts nothing', async () => {
    // Nothing is defaulted on the way in: a field the export never carried
    // is refused by name, before a folder is minted for her.
    const { height: _absent, ...sparse } = portableCharacter()
    const archive = await zipOf('sparse', async (dir) => {
      await writeFile(join(dir, 'character.json'), JSON.stringify(sparse))
      await writeFile(join(dir, MANIFEST_NAME), JSON.stringify(manifest()))
    })

    const error = await importError(archive)

    expect(error.code).toBe('CHARACTER_MALFORMED')
    expect(error.message).toContain('"height"')
    expect(await charFolders()).toEqual([])
    expect(await transferScratch()).toEqual([])
  })

  it('refuses a schema this build does not read', async () => {
    const archive = await zipOf('future', async (dir) => {
      await writeFile(join(dir, 'character.json'), JSON.stringify(portableCharacter()))
      await writeFile(join(dir, MANIFEST_NAME), JSON.stringify(manifest({ schemaVersion: 99 })))
    })

    expect((await importError(archive)).code).toBe('IMPORT_SCHEMA_VERSION')
    expect(await charFolders()).toEqual([])
  })

  it('refuses an export with no character in it', async () => {
    const archive = await zipOf('empty', async (dir) => {
      await writeFile(join(dir, MANIFEST_NAME), JSON.stringify(manifest()))
      await mkdir(join(dir, 'expressions'), { recursive: true })
      await writeFile(join(dir, 'expressions', 'neutral.png'), PNG_BYTES)
    })

    expect((await importError(archive)).code).toBe('IMPORT_CHARACTER_MISSING')
    expect(await charFolders()).toEqual([])
  })

  it('refuses the whole archive over one stray file, and adopts nothing', async () => {
    const archive = await zipOf('stray', async (dir) => {
      await writeFile(join(dir, 'character.json'), JSON.stringify(portableCharacter()))
      await writeFile(join(dir, MANIFEST_NAME), JSON.stringify(manifest()))
      await writeFile(join(dir, 'evil.txt'), 'nothing of ours')
    })

    expect((await importError(archive)).code).toBe('IMPORT_BAD_CONTENT')
    expect(await charFolders()).toEqual([])
  })

  it('refuses the whole archive over a named image that is not one, and adopts nothing', async () => {
    const archive = await zipOf('fakeimage', async (dir) => {
      await writeFile(join(dir, 'character.json'), JSON.stringify(portableCharacter()))
      await writeFile(join(dir, MANIFEST_NAME), JSON.stringify(manifest()))
      await mkdir(join(dir, 'expressions'), { recursive: true })
      await writeFile(join(dir, 'expressions', 'neutral.png'), Buffer.from('not an image'))
    })

    expect((await importError(archive)).code).toBe('IMPORT_BAD_CONTENT')
    expect(await charFolders()).toEqual([])
  })

  it('leaves no scratch behind, whether it lands or is refused', async () => {
    const character = await seedCharacter()
    const good = archivePath('good.zip')
    await exportCharacter(character.charId, good)
    const bad = await zipOf('junk', async (dir) => {
      await writeFile(join(dir, 'notes.txt'), 'nothing of ours')
    })

    await importCharacter(good)
    await importError(bad)

    // `/data/tmp` is scratch, and a transfer that leaves its extraction there
    // fills the disk one abandoned character at a time.
    expect(await transferScratch()).toEqual([])
  })
})

describe('duplicateCharacter', () => {
  it('copies her under a new identity, images and all', async () => {
    const original = await seedCharacter()

    const copy = await duplicateCharacter(original.charId)

    expect(copy.charId).not.toBe(original.charId)
    // Same character, same name: renaming the copy is an edit made on the copy,
    // not something decided for the player here.
    expect(copy.firstName).toBe('Mina')
    expect(copy.lastName).toBe('Aoki')
    expect(copy.personality).toBe('Quietly stubborn.')
    expect(copy.updatedAt).toBeTypeOf('number')

    // The folder is named for the new id and the file inside agrees with it —
    // the folder-name-is-authoritative rule an import follows.
    const onDisk = await getCharacter(copy.charId)
    expect(onDisk.charId).toBe(copy.charId)
    expect(JSON.parse(await readFile(getCharacterFilePath(copy.charId), 'utf8')).charId).toBe(
      copy.charId
    )

    expect(
      await readFile(join(getCharacterExpressionsPath(copy.charId), 'neutral.png'))
    ).toEqual(Buffer.from(PNG_BYTES))
    expect(await readFile(join(getCharacterCgsPath(copy.charId), 'sex.png'))).toEqual(
      Buffer.from(PNG_BYTES)
    )

    expect(await charFolders()).toEqual([original.charId, copy.charId].sort())
  })

  it('leaves the staging tree out and the original alone', async () => {
    const original = await seedCharacter()

    const copy = await duplicateCharacter(original.charId)

    // A staging tree is a run's uncommitted images, and the copy has no run to
    // commit them.
    expect(await readdir(getCharacterPath(copy.charId))).not.toContain('staging')
    // The character copied *from* is not touched by having been copied.
    expect(await readdir(getCharacterStagingPath(original.charId))).toContain('expressions')
    expect((await getCharacter(original.charId)).charId).toBe(original.charId)
  })

  it('refuses an id that could name a path, and adds nothing', async () => {
    await seedCharacter()

    await expect(duplicateCharacter('../escaped')).rejects.toMatchObject({
      code: 'CHARACTER_ID_INVALID'
    })

    expect(await charFolders()).toHaveLength(1)
  })
})

describe('the package rules', () => {
  it('marks an export as ours, at the schema the character was written against', () => {
    const her = character({ firstName: 'Mina', lastName: 'Aoki' })

    const built = buildManifest(her, '2015-01-19T00:00:00.000Z')

    expect(built).toEqual({
      format: 'venus-university-character',
      schemaVersion: 2,
      exportedAt: '2015-01-19T00:00:00.000Z',
      firstName: 'Mina',
      lastName: 'Aoki'
    })
    expect(checkManifest(built)).toBe(built)
  })

  it('refuses a marker that says the zip is something else’s', () => {
    const foreign = { ...buildManifest(character({}), ''), format: 'someone-elses-game' }

    expect(() => checkManifest(foreign as never)).toThrow()
  })

  it('leaves the source install’s identity out of what travels', () => {
    const her = character({ charId: 'lives-here', firstName: 'Mina' })

    const portable = portableOf(her)

    expect('charId' in portable).toBe(false)
    expect(portable.firstName).toBe('Mina')
  })

  it('names the one folder a hand-rezipped export sits under', () => {
    expect(stripWrapper(['Mina_Aoki', 'Mina_Aoki/character.json', 'Mina_Aoki/cg/sex.png'])).toBe(
      'Mina_Aoki'
    )
    // A zip made from inside the folder has no wrapper to take off.
    expect(stripWrapper(['character.json', 'manifest.json', 'cg/sex.png'])).toBeNull()
    // Two roots are not one folder, and a lone file is not a folder at all.
    expect(stripWrapper(['Mina_Aoki/character.json', 'notes.txt'])).toBeNull()
    expect(stripWrapper(['character.json'])).toBeNull()
    expect(stripWrapper([])).toBeNull()
  })

  it('reads past what a Mac’s zipper adds, which no unpack of ours keeps', () => {
    const entries = [
      '__MACOSX',
      '__MACOSX/._Mina_Aoki',
      'Mina_Aoki',
      'Mina_Aoki/character.json'
    ]

    expect(stripWrapper(entries)).toBe('Mina_Aoki')
  })

  it('sorts an entry into what it is allowed to be', () => {
    expect(classifyImportEntry('character.json')).toBe('record')
    expect(classifyImportEntry(MANIFEST_NAME)).toBe('manifest')
    expect(classifyImportEntry('staging')).toBe('staging')
    expect(classifyImportEntry('staging/expressions/neutral.png')).toBe('staging')
    expect(classifyImportEntry('expressions/neutral.png')).toBe('image')
    expect(classifyImportEntry('cg/sex.png')).toBe('image')
    expect(classifyImportEntry('cg/fellatio.webp')).toBe('image')
    // A folder row, a Mac's cruft: carried by an archive, written by nobody.
    expect(classifyImportEntry('cg/')).toBe('skip')
    expect(classifyImportEntry('__MACOSX/._character.json')).toBe('skip')
    expect(classifyImportEntry('.DS_Store')).toBe('skip')
    expect(classifyImportEntry('evil.txt')).toBe('reject')
  })
})
