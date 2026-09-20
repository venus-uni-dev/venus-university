import { mkdir, rename, rm } from 'fs/promises'
import { join } from 'path'
import { CHARACTER_FILE_NAME, STAGING_DIR } from '@shared/characterFiles'
import { assertSafeCharId } from '@shared/characterRules'
import {
  adoptStamp,
  buildManifest,
  checkManifest,
  classifyImportEntry,
  MANIFEST_MISSING,
  MANIFEST_NAME,
  MANIFEST_READ,
  MANIFEST_UNREADABLE,
  portableOf,
  stripWrapper,
  type CharacterManifest
} from '@shared/characterTransfer'
import { appError, messageOf } from '@shared/errors'
import type { Character } from '@shared/types'
import { randomId } from '@shared/uuid'
import { getCharacterPath, getCharactersPath } from '../paths'
import {
  checkExtractedContent,
  copyInto,
  createZip,
  discard,
  extractZip,
  relPathsUnder,
  scratchDir,
  stripWrapperDir
} from './archiveService'
import { getCharacter, readCharacterFile } from './characterService'
import { sniffImageFile } from './imageFiles'
import { readValidatedJson, writeAtomicJson } from './jsonFile'

/** Moving one character between installs, as a zip in the shared package format. */

/** Zips one character's folder to `targetPath`, minus staging and with a manifest. */
export async function exportCharacter(charId: string, targetPath: string): Promise<void> {
  assertSafeCharId(charId)
  // Validated before anything is copied: an unreadable character must not become a zip.
  const character = await getCharacter(charId)
  const stagingDir = scratchDir('export')

  try {
    await copyImages(getCharacterPath(charId), stagingDir)

    await writeAtomicJson(join(stagingDir, CHARACTER_FILE_NAME), portableOf(character), {
      code: 'EXPORT_FAILED',
      message: 'Could not write the character into the export.'
    })

    const manifest = buildManifest(character, new Date().toISOString())
    await writeAtomicJson(join(stagingDir, MANIFEST_NAME), manifest, {
      code: 'EXPORT_FAILED',
      message: 'Could not write the export manifest.'
    })

    // 7-Zip's `a` updates an existing archive, so an old zip must go first.
    await rm(targetPath, { force: true })
    await createZip(stagingDir, targetPath)
  } catch (err) {
    // A half-written zip is worse than none: it opens, and it is not her.
    await rm(targetPath, { force: true }).catch(() => {})
    throw err
  } finally {
    await discard(stagingDir)
  }
}

/**
 * Stamps the folder's `character.json` with its new id, then moves it into `/data/characters`
 * with one same-volume rename.
 */
async function adoptFolder(
  tempDir: string,
  character: Character,
  code: string,
  verb: string
): Promise<Character> {
  // The other write path stamps in `writeCharacter`.
  const adopted = adoptStamp(character, Date.now())
  await writeAtomicJson(join(tempDir, CHARACTER_FILE_NAME), adopted, {
    code,
    message: `Could not write the ${verb} character.`
  })

  try {
    await mkdir(getCharactersPath(), { recursive: true })
    await rename(tempDir, getCharacterPath(adopted.charId))
  } catch (err) {
    throw appError(code, `Could not add the ${verb} character.`, messageOf(err))
  }

  return adopted
}

/**
 * Copies one character's folder under a fresh identity — the import path with the zip taken
 * out.
 */
export async function duplicateCharacter(charId: string): Promise<Character> {
  assertSafeCharId(charId)
  // Validated before anything is copied, as an export is.
  const character = await getCharacter(charId)
  const tempDir = scratchDir('duplicate')

  try {
    await copyImages(getCharacterPath(charId), tempDir)

    // The id is minted here, never read off the copied file.
    const copy: Character = { ...character, charId: randomId() }
    return await adoptFolder(tempDir, copy, 'DUPLICATE_FAILED', 'duplicated')
  } catch (err) {
    await discard(tempDir)
    throw err
  }
}

/**
 * Copies her record and every one of her pictures out of `from`, leaving behind a staged run,
 * the loose reference, a half-written file and anything else the folder has collected.
 */
async function copyImages(from: string, to: string): Promise<void> {
  await mkdir(to, { recursive: true })
  for (const rel of await relPathsUnder(from)) {
    const role = classifyImportEntry(rel)
    if (role !== 'record' && role !== 'image') continue
    if (role === 'image' && !(await sniffImageFile(join(from, rel)))) {
      console.warn(`[transfer] left out ${rel}: not an image`)
      continue
    }

    await copyInto(join(from, rel), join(to, rel))
  }
}

/** Reads and checks the archive's manifest, or says why it is not one of ours. */
async function readManifest(dir: string): Promise<CharacterManifest> {
  const manifest = await readValidatedJson<CharacterManifest>(join(dir, MANIFEST_NAME), {
    ...MANIFEST_READ,
    unreadable: MANIFEST_UNREADABLE,
    onMissing: () => {
      throw appError(MANIFEST_MISSING.code, MANIFEST_MISSING.message, MANIFEST_NAME)
    }
  })

  return checkManifest(manifest)
}

/**
 * Adopts a character zip: validates it, gives her a fresh identity and moves the folder into
 * `/data/characters`.
 */
export async function importCharacter(archivePath: string): Promise<Character> {
  const tempDir = scratchDir('import')

  try {
    const entries = await extractZip(archivePath, tempDir)

    // One wrapper level from a hand-rezipped folder is unwrapped rather than refused.
    const wrapper = stripWrapper(entries.map((entry) => entry.path))
    if (wrapper !== null) await stripWrapperDir(tempDir, wrapper)

    await checkExtractedContent(tempDir, classifyImportEntry, 'export')

    await readManifest(tempDir)

    const charId = randomId()
    const character = await readCharacterFile(join(tempDir, CHARACTER_FILE_NAME), charId, () => {
      throw appError(
        'IMPORT_CHARACTER_MISSING',
        'That export holds no character.',
        CHARACTER_FILE_NAME
      )
    })

    // Neither is hers: staging is a dead run's images, the manifest describes the archive.
    await discard(join(tempDir, STAGING_DIR))
    await rm(join(tempDir, MANIFEST_NAME), { force: true })

    return await adoptFolder(tempDir, character, 'IMPORT_FAILED', 'imported')
  } catch (err) {
    await discard(tempDir)
    throw err
  }
}
