import { cp, mkdir, mkdtemp, readdir, readFile, rename, rm, unlink, writeFile } from 'fs/promises'
import { basename, dirname, join } from 'path'
import {
  baseRel,
  CUSTOM_CGS_DIR,
  isCharFileRel,
  isLosslessRel,
  layerRel,
  looseNamesOf,
  OUTFITS_DIR,
  REFERENCE_NAME,
  setDirRel,
  spriteFileRel,
  STAGING_DIR,
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
  readCharacterRecord,
  SAFE_CHAR_ID,
  withRemovedDefault
} from '@shared/characterRules'
import { defaultTagsOf } from '@shared/defaultTags'
import { appError, messageOf } from '@shared/errors'
import { EMOTIONS } from '@shared/emotions'
import { assertPng, imageTypeOf } from '@shared/imageBytes'
import { customOutfitSlotsIn, isCustomOutfitSlot, STOCK_OUTFIT_SETS } from '@shared/outfits'
import { afterOf, customCgSlotsIn, isCustomCgSlot, STOCK_POSITIONS } from '@shared/positions'
import { ROOM_VARIANTS, roomStem, type RoomVariant } from '@shared/room'
import type {
  AppError,
  Character,
  CharacterBrief,
  CustomCgSlot,
  CustomOutfitSlot,
  DefaultsStatus,
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
  castInPlace,
  hasShippedCopy,
  isPregenChar,
  listPregenCharIds,
  listShippedCopies,
  markCopied,
  unmarkCopied,
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
  getStagedOutfitsPath,
  getTempPath
} from '../paths'
import {
  findImage,
  imageNamesIn,
  imagePath,
  imageStemsIn,
  removeImage,
  retireTwins,
  storedImage
} from './imageFiles'
import { readJsonFile, renameWithPatience, writeAtomicJson } from './jsonFile'
import { cutProfile, profileCropOf, tryCutProfile } from './profileService'
import { getSettings, setRemovedDefaults } from './settingsService'

/** Characters on disk; what a character record must be is a shared rule. */

export { assertSafeCharId }

/** True for a shipped character of a packaged build who has not been copied out yet. */
function isUnclaimed(charId: string): boolean {
  return isPregenChar(charId) && !castInPlace() && !hasShippedCopy(charId)
}

/** True while a shipped character is read from `/assets`: in place, or not yet copied out. */
function readsFromAssets(charId: string): boolean {
  return isPregenChar(charId) && (castInPlace() || !hasShippedCopy(charId))
}

/** The copies being made right now, so two writes to one character copy her once. */
const claims = new Map<string, Promise<void>>()

/** Copies a shipped character's folder into `/data/characters` through a scratch folder. */
async function copyOut(charId: string): Promise<void> {
  const tempRoot = getTempPath()
  let temp: string | null = null
  try {
    await mkdir(tempRoot, { recursive: true })
    await mkdir(getCharactersPath(), { recursive: true })
    temp = await mkdtemp(join(tempRoot, 'claim-'))
    // The staging tree and half-written files are scratch, not part of her.
    await cp(join(getPregenCharactersPath(), charId), join(temp, charId), {
      recursive: true,
      filter: (path) => basename(path) !== STAGING_DIR && !path.endsWith('.tmp')
    })
    await renameWithPatience(join(temp, charId), join(getCharactersPath(), charId))
    markCopied(charId)
  } catch (err) {
    throw appError(
      'CHARACTER_UNWRITABLE',
      'Could not copy the character to edit her.',
      messageOf(err)
    )
  } finally {
    if (temp !== null) await rm(temp, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Readies a character for a write that would change her. A shipped character in a packaged
 * build is first copied whole into `/data/characters`, and from then on the copy is the one
 * every reader and writer uses; anyone else, and the cast in an unpackaged run, is ready as is.
 */
export async function claimCharacter(charId: string): Promise<void> {
  assertSafeCharId(charId)
  const pending = claims.get(charId)
  if (pending) return pending
  if (!isUnclaimed(charId)) return

  const claim = copyOut(charId).finally(() => claims.delete(charId))
  claims.set(charId, claim)
  return claim
}

/**
 * Reads, upgrades and validates one `character.json` at `path`; a missing field is refused by
 * name, and `upgraded` says the file holds an older version than the one returned.
 */
export async function readCharacterFile(
  path: string,
  charId: string,
  onMissing: () => never
): Promise<{ character: Character; upgraded: boolean }> {
  const read = await readJsonFile(path, {
    malformed: CHARACTER_READ.malformed,
    unreadable: CHARACTER_UNREADABLE,
    onMissing
  })
  if (read.kind === 'missing') return read.value
  const { character, upgraded } = readCharacterRecord(read.parsed, path)

  // The folder's name is her id, whatever the file says.
  return { character: { ...character, charId }, upgraded }
}

/** Reads and validates one character's `character.json` by id. */
export async function getCharacter(charId: string): Promise<Character> {
  assertSafeCharId(charId)
  const { character, upgraded } = await readCharacterFile(
    getCharacterFilePath(charId),
    charId,
    () => {
      throw appError(CHARACTER_NOT_FOUND.code, CHARACTER_NOT_FOUND.message, charId)
    }
  )

  // An older record is written back at once, so the file on disk is current after the first
  // listing and its updatedAt keeps the grid's order.
  if (upgraded && !readsFromAssets(charId)) {
    await writeAtomicJson(getCharacterFilePath(charId), character, {
      code: 'CHARACTER_UNWRITABLE',
      message: 'Could not save the character.'
    })
  }
  return character
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

/** Every folder under `/data/characters`: the player's own charIds and the shipped cast's copies. */
export async function ownCharIds(): Promise<string[]> {
  return charIdsIn(getCharactersPath())
}

/**
 * Lists both roots, shipped cast first, skipping a corrupt folder with a warning. A shipped
 * character's copy is listed once, in her shipped place.
 */
export async function listCharacters(): Promise<Character[]> {
  const shipped = await charIdsIn(getPregenCharactersPath())
  const own = (await charIdsIn(getCharactersPath())).filter((charId) => !shipped.includes(charId))
  const entries = [...shipped, ...own]

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

/** Every shipped charId, which of them the player has removed and which have an edited copy. */
export async function getDefaultsStatus(): Promise<DefaultsStatus> {
  const { removedDefaults } = await getSettings()
  return defaultsStatusOf(listPregenCharIds(), removedDefaults, listShippedCopies(), castInPlace())
}

/**
 * Puts a shipped character back as she was built: her edited copy is deleted, and she is read
 * from the shipped folder again. An unpackaged run edits the shipped folder itself, so there
 * is nothing to go back to.
 */
export async function resetDefault(charId: string): Promise<Character> {
  assertSafeCharId(charId)
  if (!isPregenChar(charId) || castInPlace()) {
    throw appError(
      'CHARACTER_NOT_SHIPPED',
      'Only a default character can be reset.',
      `${charId} has no shipped version to go back to.`
    )
  }
  await claims.get(charId)?.catch(() => {})
  if (hasShippedCopy(charId)) {
    // Moved aside in one rename before it is deleted, so a file held open mid-delete cannot
    // leave half a copy standing in for her.
    let aside: string
    try {
      await mkdir(getTempPath(), { recursive: true })
      aside = await mkdtemp(join(getTempPath(), 'reset-'))
      await renameWithPatience(join(getCharactersPath(), charId), join(aside, charId))
    } catch (err) {
      throw appError(
        'CHARACTER_UNDELETABLE',
        'Could not reset the character folder.',
        messageOf(err)
      )
    }
    unmarkCopied(charId)
    await rm(aside, { recursive: true, force: true }).catch((err: unknown) => {
      console.warn(`[characters] could not clear the reset copy of "${charId}":`, err)
    })
  }
  return getCharacter(charId)
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
  const character = newCharacter(
    firstName,
    lastName,
    defaultTagsOf(await getSettings()).subject,
    brief
  )

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
  await claimCharacter(character.charId)

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
  if (target === 'cgs' || target === 'room' || isCustomCgSlot(target)) return true

  const base = getCharacterImagePath(charId, baseRel(target === 'default' ? null : target))
  return (await findImage(base)) !== null
}

/** Reports which of the two room backgrounds exist on disk — the files are the record. */
export async function getRoomStatus(charId: string): Promise<Record<RoomVariant, boolean>> {
  assertSafeCharId(charId)
  const present = await scanPresent(getCharacterPath(charId), ROOM_VARIANTS.map(roomStem))
  return { day: present[roomStem('day')], night: present[roomStem('night')] }
}

/** The names of the folders directly inside `dir`, or none where it does not exist. */
async function foldersIn(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
}

/**
 * Reports which CG files exist on disk — the files are the record: every stock one, and both
 * images of each custom slot that has a folder.
 */
export async function getCgStatus(charId: string): Promise<Record<Position, boolean>> {
  assertSafeCharId(charId)
  const status = {} as Record<Position, boolean>
  Object.assign(status, await scanPresent(getCharacterCgsPath(charId), STOCK_POSITIONS))
  const slots = customCgSlotsIn(
    await foldersIn(getCharacterImagePath(charId, CUSTOM_CGS_DIR))
  )
  for (const slot of slots) {
    const dir = getCharacterImagePath(charId, setDirRel(slot))
    Object.assign(status, await scanPresent(dir, [slot, afterOf(slot)]))
  }
  return status
}

/**
 * Reports which alternate-outfit sprites exist on disk, per set and emotion: every stock set, and
 * each custom slot that has a folder.
 */
export async function getOutfitStatus(
  charId: string
): Promise<Record<OutfitSet, Record<Emotion, boolean>>> {
  assertSafeCharId(charId)

  const status = {} as Record<OutfitSet, Record<Emotion, boolean>>
  const customs = customOutfitSlotsIn(
    await foldersIn(getCharacterImagePath(charId, OUTFITS_DIR))
  )
  for (const set of [...STOCK_OUTFIT_SETS, ...customs]) {
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
  for (const subtree of [getStagedOutfitsPath(charId), getStagedPath(charId, CUSTOM_CGS_DIR)]) {
    try {
      if ((await readdir(subtree)).length === 0) await rm(subtree, { recursive: true, force: true })
    } catch {
      // No such subtree to prune; the root check below is the one that matters.
    }
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
  await claimCharacter(charId)
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
      // Loose files move one at a time, each under the name it was staged as; only a variant
      // that was staged moves, and it replaces the live picture whichever extension that is under.
      for (const name of loose) {
        const stagedFile = await findImage(join(staged, name))
        if (stagedFile === null) continue
        await removeImage(join(live, name))
        await rename(stagedFile, join(live, basename(stagedFile)))
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
  // A packaged build never stages beside the shipped folder, and nothing it removes may land there.
  if (isUnclaimed(charId)) return
  if (!target) {
    await rm(getCharacterStagingPath(charId), { recursive: true, force: true })
    return
  }

  const { staged, loose } = setLocation(charId, target)
  if (loose) {
    for (const name of loose) await removeImage(join(staged, name))
  } else {
    await rm(staged, { recursive: true, force: true })
  }
  await pruneStaging(charId)
}

/**
 * Deletes one player-authored set's images — a wardrobe's or a CG pair's — live and staged.
 * The record is the renderer's to rewrite.
 */
export async function deleteCustomSet(
  charId: string,
  slot: CustomOutfitSlot | CustomCgSlot
): Promise<void> {
  await claimCharacter(charId)
  const isCg = isCustomCgSlot(slot)
  if (!isCg && !isCustomOutfitSlot(slot)) {
    throw appError('OUTFIT_SET_UNKNOWN', `"${String(slot)}" is not a custom set.`)
  }

  const { live, staged } = setLocation(charId, slot)
  try {
    await rm(live, { recursive: true, force: true })
    await rm(staged, { recursive: true, force: true })
  } catch (err) {
    throw isCg
      ? appError('CG_UNDELETABLE', 'Could not delete the CG.', messageOf(err))
      : appError('OUTFIT_UNDELETABLE', 'Could not delete the outfit.', messageOf(err))
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
 * The bytes of one of her images by the path her image URL names, or `null` where it is not on
 * disk or the path names none of her images.
 */
export async function readCharacterImage(charId: string, rel: string): Promise<Uint8Array | null> {
  assertSafeCharId(charId)
  if (!isCharFileRel(rel)) return null
  // The path names the PNG; the picture is its `.webp` twin, or the PNG not yet converted.
  const path = await imagePath(getCharacterImagePath(charId, rel))

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
 * The erase also hands over the set's base frame, written in the same batch.
 */
export async function applyWardrobeFix(
  charId: string,
  target: WardrobeTarget,
  images: readonly WardrobeFixImage[],
  paintLayer: string | null,
  kind: WardrobeLayer,
  base?: string
): Promise<void> {
  await claimCharacter(charId)
  if (images.length === 0) {
    throw appError('FIX_EMPTY', 'There were no sprites to repair.')
  }

  const dir = getCharacterImagePath(charId, setDirRel(target))
  const writes = images.map(({ emotion, data }) => ({
    rel: spriteFileRel(target, emotion),
    bytes: decodePng(data, emotion)
  }))
  if (paintLayer !== null) {
    writes.push({ rel: layerRel(target, kind), bytes: decodePng(paintLayer, 'the paint layer') })
  }
  if (base !== undefined) {
    writes.push({
      rel: baseRel(target === 'default' ? null : target),
      bytes: decodePng(base, 'the base frame')
    })
  }

  // Every picture is encoded before any is written: the sprites at the shared profile, the
  // paint layer and the base frame losslessly.
  const stored = await Promise.all(
    writes.map(({ rel, bytes }) =>
      storedImage(getCharacterImagePath(charId, rel), bytes, isLosslessRel(rel))
    )
  )
  const temps = stored.map((image) => `${image.path}.tmp`)
  try {
    await mkdir(dir, { recursive: true })
    for (const [index, image] of stored.entries()) await writeFile(temps[index], image.bytes)
    // A scanner can still hold a picture the boot just converted, so each rename waits it out.
    for (const [index, image] of stored.entries()) {
      await renameWithPatience(temps[index], image.path)
    }
    // The twin each picture replaced goes too, so one stem is one image.
    for (const image of stored) await retireTwins(image)
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
  if (isUnclaimed(charId)) return
  try {
    await removeImage(getCharacterImagePath(charId, layerRel(target, kind)))
  } catch (err) {
    throw appError('SPRITE_UNWRITABLE', 'Could not clear the saved paint layer.', messageOf(err))
  }
}

/**
 * Frames her portrait where the player put it: the picture is cut first, so a frame that
 * could not be cut is not one `character.json` claims she is wearing.
 */
export async function setProfileCrop(charId: string, crop: ProfileCrop): Promise<Character> {
  await claimCharacter(charId)

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

/**
 * Deletes every character's staging tree at startup: the folders under `/data/characters`,
 * a shipped character's copy among them, and the shipped root's own only where the cast is
 * edited in place.
 */
export async function sweepStaging(): Promise<void> {
  let own: string[]
  try {
    own = await readdir(getCharactersPath())
  } catch {
    own = []
  }

  const shipped = castInPlace() ? listPregenCharIds() : []
  for (const charId of new Set([...shipped, ...own])) {
    if (!SAFE_CHAR_ID.test(charId)) continue
    try {
      await rm(getCharacterStagingPath(charId), { recursive: true, force: true })
    } catch (err) {
      console.warn(`[characters] could not sweep staging for "${charId}":`, err)
    }
  }
}
