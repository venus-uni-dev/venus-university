import { mkdir, rename, rm, unlink, writeFile } from 'fs/promises'
import { join } from 'path'
import { CHARACTER_FILE_NAME, isStaleTwinRel, STAGING_DIR } from '@shared/characterFiles'
import { assertSafeCharId } from '@shared/characterRules'
import {
  adoptStamp,
  buildManifest,
  classifyImportEntry,
  MANIFEST_MISSING,
  MANIFEST_NAME,
  MANIFEST_READ,
  MANIFEST_UNREADABLE,
  memberName,
  packMembers,
  packRefusal,
  portableOf,
  readManifestRecord,
  stripWrapper,
  type CharacterManifest,
  type RefusedMember
} from '@shared/characterTransfer'
import { appError, messageOf, toAppError } from '@shared/errors'
import { imageTypeOf } from '@shared/imageBytes'
import type { ExportKind } from '@shared/sillyTavern'
import type { Character, CharacterImport } from '@shared/types'
import { randomId } from '@shared/uuid'
import { PACK_ZIP_LIMITS } from '@shared/zipRules'
import { getCharacterPath, getCharactersPath } from '../paths'
import {
  checkExtractedContent,
  copyInto,
  createZip,
  discard,
  extractZip,
  listZip,
  relPathsUnder,
  scratchDir,
  stripWrapperDir
} from './archiveService'
import { getCharacter, readCharacterFile } from './characterService'
import { sniffImageFile } from './imageFiles'
import { readJsonFile, writeAtomicJson } from './jsonFile'
import { convertFolderImages } from './legacyImageService'

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

/** The four bytes every zip local file header opens with. */
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04]

/** True where `bytes` opens with a zip local file header. */
function looksLikeZip(bytes: Buffer): boolean {
  return ZIP_SIGNATURE.every((byte, i) => bytes[i] === byte)
}

/**
 * Writes a SillyTavern export the renderer composed: `base64` decoded, sniffed for the shape
 * `kind` claims, then written atomically like every other picture this build saves.
 */
export async function saveExportFile(
  kind: ExportKind,
  targetPath: string,
  base64: string
): Promise<void> {
  const bytes = Buffer.from(base64, 'base64')
  if (kind === 'card' && imageTypeOf(bytes) !== 'image/png') {
    throw appError('EXPORT_FAILED', 'Could not write the export.', 'the card is not a PNG')
  }
  if (kind === 'sprites' && !looksLikeZip(bytes)) {
    throw appError('EXPORT_FAILED', 'Could not write the export.', 'the sprite pack is not a zip')
  }

  const temp = `${targetPath}.tmp`
  try {
    await writeFile(temp, bytes)
    await rename(temp, targetPath)
  } catch (err) {
    await unlink(temp).catch(() => {})
    throw appError('EXPORT_FAILED', 'Could not write the export.', messageOf(err))
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
  verb: string,
  adoptedAt = Date.now()
): Promise<Character> {
  // The other write path stamps in `writeCharacter`.
  const adopted = adoptStamp(character, adoptedAt)
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
    // A folder still holding older pictures becomes a copy that holds none.
    await convertFolderImages(tempDir)

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
 * the loose reference, a half-written file, a PNG its WebP twin replaced and anything else the
 * folder has collected.
 */
async function copyImages(from: string, to: string): Promise<void> {
  await mkdir(to, { recursive: true })
  const rels = await relPathsUnder(from)
  const present = new Set(rels.map((rel) => rel.toLowerCase()))
  for (const rel of rels) {
    const role = classifyImportEntry(rel)
    if (role !== 'record' && role !== 'image') continue
    if (role === 'image' && isStaleTwinRel(rel, present)) continue
    if (role === 'image' && !(await sniffImageFile(join(from, rel)))) {
      console.warn(`[transfer] left out ${rel}: not an image`)
      continue
    }

    await copyInto(join(from, rel), join(to, rel))
  }
}

/** Reads and checks the archive's manifest, or says why it is not one of ours. */
async function readManifest(dir: string): Promise<CharacterManifest> {
  const path = join(dir, MANIFEST_NAME)
  const read = await readJsonFile(path, {
    malformed: MANIFEST_READ.malformed,
    unreadable: MANIFEST_UNREADABLE,
    onMissing: (): never => {
      throw appError(MANIFEST_MISSING.code, MANIFEST_MISSING.message, MANIFEST_NAME)
    }
  })
  if (read.kind === 'missing') return read.value

  return readManifestRecord(read.parsed, path)
}

/**
 * Adopts a character zip: validates it, gives her a fresh identity and moves the folder into
 * `/data/characters`, stamped `adoptedAt`.
 */
export async function importCharacter(
  archivePath: string,
  adoptedAt = Date.now()
): Promise<Character> {
  const tempDir = scratchDir('import')

  try {
    const entries = await extractZip(archivePath, tempDir)

    // One wrapper level from a hand-rezipped folder is unwrapped rather than refused.
    const wrapper = stripWrapper(entries.map((entry) => entry.path))
    if (wrapper !== null) await stripWrapperDir(tempDir, wrapper)

    await checkExtractedContent(tempDir, classifyImportEntry, 'export')

    await readManifest(tempDir)

    const charId = randomId()
    const { character } = await readCharacterFile(
      join(tempDir, CHARACTER_FILE_NAME),
      charId,
      () => {
        throw appError(
          'IMPORT_CHARACTER_MISSING',
          'That export holds no character.',
          CHARACTER_FILE_NAME
        )
      }
    )

    // Neither is hers: staging is a dead run's images, the manifest describes the archive.
    await discard(join(tempDir, STAGING_DIR))
    await rm(join(tempDir, MANIFEST_NAME), { force: true })
    // An older package's pictures arrive as PNG and are kept as WebP, before she is the player's.
    await convertFolderImages(tempDir)

    return await adoptFolder(tempDir, character, 'IMPORT_FAILED', 'imported', adoptedAt)
  } catch (err) {
    await discard(tempDir)
    throw err
  }
}

/**
 * Adopts whatever Import character ZIP was handed: one character zip, or a pack of them, every
 * member that passes adopted in name order and the rest named in one error.
 */
export async function importArchive(archivePath: string): Promise<CharacterImport> {
  const members = packMembers((await listZip(archivePath)).map((entry) => entry.path))
  if (members === null) return { characters: [await importCharacter(archivePath)], refused: null }

  const packDir = scratchDir('import-pack')
  try {
    await extractZip(archivePath, packDir, PACK_ZIP_LIMITS)

    const characters: Character[] = []
    const refused: RefusedMember[] = []
    const start = Date.now()
    for (const [i, member] of members.entries()) {
      const memberPath = join(packDir, member)
      try {
        characters.push(await importCharacter(memberPath, start + i))
      } catch (err) {
        const error = toAppError(err, 'IMPORT_FAILED')
        console.warn(`[transfer] refused ${memberName(member)}: ${error.code} ${error.message}`)
        refused.push({ name: memberName(member), error })
      }
      // Done with either way, so the pack's scratch shrinks as it goes.
      await rm(memberPath, { force: true }).catch(() => {})
    }

    return { characters, refused: packRefusal(members.length, refused) }
  } finally {
    await discard(packDir)
  }
}
