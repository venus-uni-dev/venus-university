import { mkdir, readdir, readFile, rename, rm, unlink, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import {
  baseRel,
  layerRel,
  looseNamesOf,
  REFERENCE_NAME,
  setDirRel,
  spriteFileRel,
  wardrobeImageRel
} from '@shared/characterFiles'
import {
  assertSafeCharId,
  CHARACTER_NOT_FOUND,
  CHARACTER_READ,
  CHARACTER_SCHEMA_VERSION,
  CHARACTER_UNREADABLE,
  defaultsStatusOf,
  newCharacter,
  SAFE_CHAR_ID,
  withRemovedDefault
} from '@shared/characterRules'
import { appError, messageOf } from '@shared/errors'
import { EMOTIONS } from '@shared/emotions'
import { assertPng, imageTypeOf } from '@shared/imageBytes'
import { isCustomOutfitSlot, OUTFIT_SETS } from '@shared/outfits'
import { POSITIONS } from '@shared/positions'
import { ROOM_VARIANTS, roomStem, type RoomVariant } from '@shared/room'
import type {
  AppError,
  Character,
  CharacterBrief,
  CustomOutfitSlot,
  Emotion,
  OutfitSet,
  Position,
  ProfileCrop,
  ProfileCropInfo,
  ReferenceImage,
  SetTarget,
  WardrobeFixImage,
  WardrobeLayer,
  WardrobeTarget
} from '@shared/types'
import {
  isPregenChar,
  listPregenCharIds,
  getPregenCharactersPath,
  getCharacterCgsPath,
  getCharacterExpressionsPath,
  getCharacterFilePath,
  getCharacterImagePath,
  getCharacterOutfitSetPath,
  getCharacterPath,
  getCharactersPath,
  getCharacterStagingPath,
  getStagedPath,
  getStagedOutfitsPath
} from '../paths'
import {
  dropImageTwins,
  findImage,
  imageNamesIn,
  imagePath,
  imageStemsIn
} from './imageFiles'
import { readValidatedJson, writeAtomicJson } from './jsonFile'
import { cutProfile, profileCropOf, tryCutProfile } from './profileService'
import { getSettings, setRemovedDefaults } from './settingsService'

/** Characters on disk; what a character record must be is a shared rule. */

export { assertSafeCharId }

/** Rejects a write aimed at one of the shipped cast, unless the dev switch is on. */
export async function assertEditableChar(charId: string): Promise<void> {
  assertSafeCharId(charId)
  if (!isPregenChar(charId)) return
  if ((await getSettings()).editPregens === true) return
  throw appError(
    'CHARACTER_READ_ONLY',
    'Default characters cannot be edited.',
    `Duplicate her first; the copy is editable. (${charId})`
  )
}

/** Reads and validates one `character.json` at `path`; a missing field is refused by name. */
export async function readCharacterFile(
  path: string,
  charId: string,
  onMissing: () => never
): Promise<Character> {
  const candidate = await readValidatedJson<Character>(path, {
    ...CHARACTER_READ,
    unreadable: CHARACTER_UNREADABLE,
    onMissing
  })

  // The folder's name is her id, whatever the file says.
  return { ...candidate, charId }
}

/** Reads and validates one character's `character.json` by id. */
export async function getCharacter(charId: string): Promise<Character> {
  assertSafeCharId(charId)
  return readCharacterFile(getCharacterFilePath(charId), charId, () => {
    throw appError(CHARACTER_NOT_FOUND.code, CHARACTER_NOT_FOUND.message, charId)
  })
}

/** One root's folder names; a root that is not there holds no characters. */
async function charIdsIn(dir: string): Promise<string[]> {
  try {
    return await readdir(dir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw appError('CHARACTERS_UNREADABLE', 'Could not read the characters folder.', messageOf(err))
  }
}

/** The player's own charIds; the shipped cast is the build's, wherever it is read from. */
export async function ownCharIds(): Promise<string[]> {
  return charIdsIn(getCharactersPath())
}

/** Lists both roots, shipped cast first, skipping a corrupt folder with a warning. */
export async function listCharacters(): Promise<Character[]> {
  const entries = [
    ...(await charIdsIn(getPregenCharactersPath())),
    ...(await charIdsIn(getCharactersPath()))
  ]

  const characters: Character[] = []
  for (const charId of entries) {
    try {
      characters.push(await getCharacter(charId))
    } catch (err) {
      console.warn(`[characters] skipping "${charId}":`, (err as AppError).message ?? err)
    }
  }
  return characters
}

/** Every shipped charId, and which of them the player has removed. */
export async function getDefaultsStatus(): Promise<{ ids: string[]; removed: string[] }> {
  const { removedDefaults } = await getSettings()
  return defaultsStatusOf(listPregenCharIds(), removedDefaults)
}

/** Puts every removed shipped character back on the roster. */
export async function restoreDefaults(): Promise<void> {
  const { removedDefaults } = await getSettings()
  if (removedDefaults.length === 0) return
  await setRemovedDefaults([])
}

/**
 * Creates the character folder and pre-LLM `character.json`; empty `pose` marks
 * appearance as not generated yet. The reference picture lands before the record, so
 * `brief.reference` is only ever true with the file already beside it.
 */
export async function createCharacter(
  firstName: string,
  lastName: string,
  brief?: CharacterBrief,
  reference?: ReferenceImage
): Promise<Character> {
  const character = newCharacter(firstName, lastName, brief)

  await mkdir(getCharacterExpressionsPath(character.charId), { recursive: true })
  await mkdir(getCharacterCgsPath(character.charId), { recursive: true })
  if (reference) {
    await writeFile(
      getCharacterImagePath(character.charId, REFERENCE_NAME),
      Buffer.from(reference.data, 'base64')
    )
  }
  return writeCharacter(character)
}

/** The reference picture beside her record, or `null` where there is none to read. */
export async function readReference(charId: string): Promise<ReferenceImage | null> {
  assertSafeCharId(charId)
  let bytes: Buffer
  try {
    bytes = await readFile(getCharacterImagePath(charId, REFERENCE_NAME))
  } catch {
    return null
  }
  const mimeType = imageTypeOf(bytes)
  return mimeType ? { mimeType, data: bytes.toString('base64') } : null
}

/** Writes `character.json` atomically (temp file in the same folder, then rename). */
export async function writeCharacter(character: Character): Promise<Character> {
  await assertEditableChar(character.charId)

  // Stamped here rather than by any caller: every write of the file goes through this
  // function or `adoptFolder`, and the grid's order is read off it.
  const next: Character = {
    ...character,
    schemaVersion: CHARACTER_SCHEMA_VERSION,
    updatedAt: Date.now()
  }
  await writeAtomicJson(getCharacterFilePath(next.charId), next, {
    code: 'CHARACTER_UNWRITABLE',
    message: 'Could not save the character.'
  })
  // A record with no brief is nothing's to resume, so the picture it was written from goes:
  // the write that lands her sheet retires it, and any later save heals an orphan.
  if (!next.brief) {
    await rm(getCharacterImagePath(next.charId, REFERENCE_NAME), { force: true })
  }

  return next
}

/**
 * Deletes a character's entire folder. Callers cancel the character's job group first so
 * nothing is still writing sprites into it.
 */
export async function deleteCharacter(charId: string): Promise<void> {
  assertSafeCharId(charId)
  if (isPregenChar(charId)) {
    const { removedDefaults } = await getSettings()
    const next = withRemovedDefault(removedDefaults, charId)
    if (next.length !== removedDefaults.length) await setRemovedDefaults(next)
    return
  }
  try {
    await rm(getCharacterPath(charId), { recursive: true, force: true })
  } catch (err) {
    throw appError(
      'CHARACTER_UNDELETABLE',
      'Could not delete the character folder.',
      messageOf(err)
    )
  }
}

/** Which of `keys` have an image in `dir`; a missing folder reads as none yet. */
async function scanPresent<K extends string>(
  dir: string,
  keys: readonly K[]
): Promise<Record<K, boolean>> {
  const present = await imageStemsIn(dir)
  const status = {} as Record<K, boolean>
  for (const key of keys) status[key] = present.has(key)
  return status
}

/** Reports which of the seven sprite files exist on disk. */
export async function getExpressionStatus(charId: string): Promise<Record<Emotion, boolean>> {
  assertSafeCharId(charId)
  return scanPresent(getCharacterExpressionsPath(charId), EMOTIONS)
}

/**
 * Whether one set's base frame — the neutral its other six expressions are face-passed
 * from — is on disk.
 */
export async function hasBaseImage(charId: string, target: SetTarget): Promise<boolean> {
  assertSafeCharId(charId)
  if (target === 'cgs' || target === 'room') return true

  const base = getCharacterImagePath(charId, baseRel(target === 'default' ? null : target))
  return (await findImage(base)) !== null
}

/** Reports which of the two room backgrounds exist on disk — the files are the record. */
export async function getRoomStatus(charId: string): Promise<Record<RoomVariant, boolean>> {
  assertSafeCharId(charId)
  const present = await scanPresent(getCharacterPath(charId), ROOM_VARIANTS.map(roomStem))
  return { day: present[roomStem('day')], night: present[roomStem('night')] }
}

/** Reports which of the eight CG files exist on disk — the files are the record. */
export async function getCgStatus(charId: string): Promise<Record<Position, boolean>> {
  assertSafeCharId(charId)
  return scanPresent(getCharacterCgsPath(charId), POSITIONS)
}

/** Reports which alternate-outfit sprites exist on disk, per set and emotion. */
export async function getOutfitStatus(
  charId: string
): Promise<Record<OutfitSet, Record<Emotion, boolean>>> {
  assertSafeCharId(charId)

  const status = {} as Record<OutfitSet, Record<Emotion, boolean>>
  for (const set of OUTFIT_SETS) {
    status[set] = await scanPresent(getCharacterOutfitSetPath(charId, set), EMOTIONS)
  }
  return status
}

/**
 * Where one set's images live and where its regenerate stages them; only the room's two
 * files sit loose in the character folder.
 */
function setLocation(
  charId: string,
  target: SetTarget
): { live: string; staged: string; loose: string[] | null } {
  const dir = setDirRel(target)
  return {
    live: getCharacterImagePath(charId, dir),
    staged: getStagedPath(charId, dir),
    loose: looseNamesOf(target)
  }
}

/** Removes the staging tree once nothing is left in it — it is scratch, not state. */
async function pruneStaging(charId: string): Promise<void> {
  const root = getCharacterStagingPath(charId)
  try {
    const outfits = getStagedOutfitsPath(charId)
    if ((await readdir(outfits)).length === 0) await rm(outfits, { recursive: true, force: true })
  } catch {
    // No outfits subtree to prune; the root check below is the one that matters.
  }
  try {
    if ((await readdir(root)).length === 0) await rm(root, { recursive: true, force: true })
  } catch {
    // Already gone, or still holding another set's staged images.
  }
}

/** Swallows the error a `mkdir` of a folder that is already there throws, and nothing else. */
function ignoreExisting(err: unknown): void {
  if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
}

/**
 * Makes a staged regenerate the live set: the staged images replace the old ones wholesale,
 * and the old ones are gone only once there is something to put in their place.
 */
export async function commitStagedSet(
  charId: string,
  target: SetTarget
): Promise<'committed' | 'empty'> {
  assertSafeCharId(charId)
  const { live, staged, loose } = setLocation(charId, target)

  const stagedImages = await imageNamesIn(staged)
  if (stagedImages.length === 0) {
    await pruneStaging(charId)
    return 'empty'
  }

  // The directory branch below deletes `live` outright; a `live` that is the character
  // root would delete her rather than one set.
  if (!loose && live === getCharacterPath(charId)) {
    throw appError(
      'STAGED_UNCOMMITTABLE',
      'Could not save the regenerated images.',
      `"${String(target)}" resolves to the character folder itself; refusing to replace it.`
    )
  }

  try {
    if (loose) {
      // Loose files move one at a time; only a variant that was staged moves.
      for (const name of loose) {
        if (!stagedImages.includes(name)) continue
        await rm(join(live, name), { force: true })
        await rename(join(staged, name), join(live, name))
        await dropImageTwins(join(live, name))
      }
    } else {
      await rm(live, { recursive: true, force: true })
      // `outfits/{set}` sits one folder below her root, and nothing makes that folder before the
      // first set lands in it. Not recursive, and never her own folder: a commit racing her
      // deletion must not put the folder back.
      const parent = dirname(live)
      if (parent !== getCharacterPath(charId)) await mkdir(parent).catch(ignoreExisting)
      await rename(staged, live)
    }
  } catch (err) {
    throw appError('STAGED_UNCOMMITTABLE', 'Could not save the regenerated images.', messageOf(err))
  }

  await pruneStaging(charId)
  return 'committed'
}

/**
 * Throws away one staged set, or every staged set when `target` is omitted; the live
 * images are untouched.
 */
export async function discardStaged(charId: string, target?: SetTarget): Promise<void> {
  assertSafeCharId(charId)
  if (!target) {
    await rm(getCharacterStagingPath(charId), { recursive: true, force: true })
    return
  }

  const { staged, loose } = setLocation(charId, target)
  if (loose) {
    for (const name of loose) await rm(join(staged, name), { force: true })
  } else {
    await rm(staged, { recursive: true, force: true })
  }
  await pruneStaging(charId)
}

/**
 * Deletes one player-authored wardrobe's images, live and staged. The record is the
 * renderer's to rewrite.
 */
export async function deleteCustomSet(charId: string, slot: CustomOutfitSlot): Promise<void> {
  await assertEditableChar(charId)
  if (!isCustomOutfitSlot(slot)) {
    throw appError('OUTFIT_SET_UNKNOWN', `"${String(slot)}" is not a custom outfit.`)
  }

  const { live, staged } = setLocation(charId, slot)
  try {
    await rm(live, { recursive: true, force: true })
    await rm(staged, { recursive: true, force: true })
  } catch (err) {
    throw appError('OUTFIT_UNDELETABLE', 'Could not delete the outfit.', messageOf(err))
  }
  await pruneStaging(charId)
}

/** The bytes of one wardrobe image, or `null` if it is not on disk. */
export async function readWardrobeImage(
  charId: string,
  target: WardrobeTarget,
  image: string
): Promise<Uint8Array | null> {
  assertSafeCharId(charId)
  const path = await imagePath(getCharacterImagePath(charId, wardrobeImageRel(target, image)))

  try {
    return await readFile(path)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw appError('CHARACTER_UNREADABLE', 'Could not read that image.', messageOf(err))
  }
}

/**
 * Base64 to bytes, refusing anything that is not a PNG before it can land on a sprite — or, for
 * the hand fix, be staged as a graph's input.
 */
export function decodePng(data: string, what: string): Buffer {
  const bytes = Buffer.from(data, 'base64')
  assertPng(bytes, what)
  return bytes
}

/**
 * Writes one wardrobe's repaired sprites over the set on disk, plus its paint layer where the
 * repair keeps one. The hand repair passes `null` instead, removing any stale layer on disk.
 */
export async function applyWardrobeFix(
  charId: string,
  target: WardrobeTarget,
  images: readonly WardrobeFixImage[],
  paintLayer: string | null,
  kind: WardrobeLayer
): Promise<void> {
  assertSafeCharId(charId)
  if (images.length === 0) {
    throw appError('FIX_EMPTY', 'There were no sprites to repair.')
  }

  const dir = getCharacterImagePath(charId, setDirRel(target))
  const writes = images.map(({ emotion, data }) => ({
    path: getCharacterImagePath(charId, spriteFileRel(target, emotion)),
    bytes: decodePng(data, emotion)
  }))
  if (paintLayer !== null) {
    writes.push({
      path: getCharacterImagePath(charId, layerRel(target, kind)),
      bytes: decodePng(paintLayer, 'the paint layer')
    })
  }

  const temps = writes.map((write) => `${write.path}.tmp`)
  try {
    await mkdir(dir, { recursive: true })
    for (const [index, write] of writes.entries()) await writeFile(temps[index], write.bytes)
    for (const [index, write] of writes.entries()) await rename(temps[index], write.path)
    // A duplicate of a shipped character carries WebP into her folder; one stem is one image.
    for (const write of writes) await dropImageTwins(write.path)
  } catch (err) {
    await Promise.all(temps.map((temp) => unlink(temp).catch(() => {})))
    throw appError('SPRITE_UNWRITABLE', 'Could not save the repaired sprites.', messageOf(err))
  }

  // After the renames, so a failed write leaves the set *and* its layer as they were: a repair
  // that keeps no layer takes the one it was made over with it, stale or its own.
  if (paintLayer === null) await discardWardrobeLayer(charId, target, kind)

  // The portrait is a slice of the neutral sprite, and the repair just rewrote it.
  if (target === 'default') await tryCutProfile(charId, await getCharacter(charId))
}

/**
 * Removes one repair's kept paint layer, if it is there — what the hand repair runs both
 * when it opens and when it applies, since strokes outlive the hand they were painted on.
 */
export async function discardWardrobeLayer(
  charId: string,
  target: WardrobeTarget,
  kind: WardrobeLayer
): Promise<void> {
  assertSafeCharId(charId)
  try {
    await rm(getCharacterImagePath(charId, layerRel(target, kind)), { force: true })
  } catch (err) {
    throw appError('SPRITE_UNWRITABLE', 'Could not clear the saved paint layer.', messageOf(err))
  }
}

/**
 * Frames her portrait where the player put it: the picture is cut first, so a frame that
 * could not be cut is not one `character.json` claims she is wearing.
 */
export async function setProfileCrop(charId: string, crop: ProfileCrop): Promise<Character> {
  assertSafeCharId(charId)
  await assertEditableChar(charId)

  const character = await getCharacter(charId)
  // Stamped with the seed she renders under now, which is what a regenerate retires.
  const framed: Character = {
    ...character,
    profileCrop: { ...crop, seed: character.generationSeed }
  }
  const used = await cutProfile(charId, framed)

  return writeCharacter({ ...framed, profileCrop: used })
}

/** What the crop modal opens on. */
export async function getProfileCrop(charId: string): Promise<ProfileCropInfo> {
  assertSafeCharId(charId)
  return profileCropOf(charId, await getCharacter(charId))
}

/** Deletes every character's staging tree at startup, under either root. */
export async function sweepStaging(): Promise<void> {
  let own: string[]
  try {
    own = await readdir(getCharactersPath())
  } catch {
    own = []
  }

  // The shipped root can hold a staging tree too, while `editPregens` is on.
  for (const charId of [...listPregenCharIds(), ...own]) {
    if (!SAFE_CHAR_ID.test(charId)) continue
    try {
      await rm(getCharacterStagingPath(charId), { recursive: true, force: true })
    } catch (err) {
      console.warn(`[characters] could not sweep staging for "${charId}":`, err)
    }
  }
}
