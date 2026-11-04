import { base64ToBytes, bytesToBase64 } from '@shared/base64'
import {
  baseRel,
  cgRel,
  CUSTOM_CGS_DIR,
  expressionRel,
  isCharFileRel,
  layerRel,
  outfitRel,
  OUTFITS_DIR,
  profileRel,
  REFERENCE_NAME,
  roomRel,
  spriteFileRel,
  stagedRel,
  wardrobeImageRel
} from '@shared/characterFiles'
import {
  assertSafeCharId,
  CHARACTER_SCHEMA_VERSION,
  defaultsStatusOf,
  newCharacter,
  withRemovedDefault
} from '@shared/characterRules'
import { defaultTagsOf } from '@shared/defaultTags'
import { EMOTIONS } from '@shared/emotions'
import { appError, messageOf } from '@shared/errors'
import { assertPng, imageTypeOf } from '@shared/imageBytes'
import { enqueue } from '@shared/jobQueue'
import { LINEUP_MIME_TYPE } from '@shared/lineup'
import { generateImage } from '@shared/llm/cloudImage'
import { customOutfitSlotsIn, isCustomOutfitSlot, STOCK_OUTFIT_SETS } from '@shared/outfits'
import { afterOf, customCgSlotsIn, isCustomCgSlot, STOCK_POSITIONS } from '@shared/positions'
import { dayRoomPrompt, isRoomVariant, NIGHT_ROOM_PROMPT, ROOM_VARIANTS } from '@shared/room'
import type { RoomVariant } from '@shared/room'
import { assertRoomPicture } from '@shared/roomPicture'
import type {
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
import { blobOf, imageBlob } from './blob'
import * as db from './db/chars'
import { imageBytes, imageRels } from './files'
import { forgetImages } from './images'
import { copiedIds, isPackRead, markCopied, unmarkCopied } from './copies'
import {
  isShipped,
  packImages,
  shippedCharacter,
  shippedCharacters,
  shippedCharIds,
  shippedProfileUrl
} from './packs'
import { cutProfile, profileCropOf, tryCutProfile } from './profile'
import { currentSettings, setRemovedDefaults } from './settings'
import { jpegOf } from './webp'

/**
 * Characters in the browser: the cast the game ships with, read out of its packs until the
 * player first changes one of them, and the player's own, kept in the browser's storage under the
 * same relative paths a folder uses. A shipped character who has been changed is kept there too,
 * under her own id.
 */

/** Which shipped characters are being copied into storage right now, by charId. */
const claims = new Map<string, Promise<void>>()

/**
 * Copies one shipped character into storage: her record as shipped, every image of her pack and
 * her portrait, in one transaction. From then on storage is what reads of her use.
 */
async function copyIntoStorage(charId: string): Promise<void> {
  const arriving: db.FileWrite[] = []
  for (const [rel, bytes] of await packImages(charId)) {
    arriving.push({ rel, blob: imageBlob(bytes) })
  }

  // The pack carries no portrait; hers is a file of its own beside it.
  const url = shippedProfileUrl(charId)
  if (url) {
    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const bytes = new Uint8Array(await response.arrayBuffer())
      arriving.push({ rel: profileRel(), blob: imageBlob(bytes) })
    } catch (err) {
      throw appError('PACK_UNREADABLE', 'Could not load that character.', messageOf(err))
    }
  }

  await db.adoptCharacter(shippedCharacter(charId), arriving)
  markCopied(charId)
  // The pack's minted URLs go, so the next request for a picture of hers is read from storage.
  forgetImages(charId)
}

/**
 * Makes sure a write for this character lands in storage: a shipped character still read out of
 * her pack is copied in first, once however many writes ask at the same time.
 */
async function claimCharacter(charId: string): Promise<void> {
  assertSafeCharId(charId)
  if (!isPackRead(charId)) return

  let claim = claims.get(charId)
  if (!claim) {
    claim = copyIntoStorage(charId).finally(() => claims.delete(charId))
    claims.set(charId, claim)
  }
  await claim
}

/**
 * Lists both roots, shipped cast first in the order the build wrote them, each in her edited
 * form where she has one.
 */
export async function listCharacters(): Promise<Character[]> {
  const stored = await db.listOwn()
  const copies = new Map(stored.map((character) => [character.charId, character]))
  return [
    ...shippedCharacters().map((character) =>
      isPackRead(character.charId) ? character : (copies.get(character.charId) ?? character)
    ),
    ...stored.filter((character) => !isShipped(character.charId))
  ]
}

/** One character, from her pack or from storage, whichever holds her now. */
export async function getCharacter(charId: string): Promise<Character> {
  assertSafeCharId(charId)
  return isPackRead(charId) ? shippedCharacter(charId) : db.readCharacter(charId)
}

/** Every shipped charId, which of them the player has removed and which have been edited. */
export async function getDefaultsStatus(): Promise<DefaultsStatus> {
  const { removedDefaults } = await currentSettings()
  return defaultsStatusOf(shippedCharIds(), removedDefaults, copiedIds(), false)
}

/** Throws away a shipped character's edited copy and answers with her as the build ships her. */
export async function resetDefault(charId: string): Promise<Character> {
  assertSafeCharId(charId)
  if (!isShipped(charId)) {
    throw appError('CHARACTER_NOT_SHIPPED', 'Only a default character can be reset.', charId)
  }
  // A copy still on its way in is finished first, so none is left behind.
  await claims.get(charId)?.catch(() => undefined)
  if (!isPackRead(charId)) {
    await db.deleteCharacter(charId)
    unmarkCopied(charId)
    forgetImages(charId)
  }
  return shippedCharacter(charId)
}

/** Puts every removed shipped character back on the roster. */
export async function restoreDefaults(): Promise<void> {
  const { removedDefaults } = await currentSettings()
  if (removedDefaults.length === 0) return
  await setRemovedDefaults([])
}

/**
 * Creates the pre-LLM record a new character starts as, with the reference picture stored
 * before it, so `brief.reference` is only ever true with the picture already there.
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
    defaultTagsOf(await currentSettings()).subject,
    brief
  )
  if (reference) {
    const bytes = base64ToBytes(reference.data)
    await db.writeFiles(character.charId, [
      { rel: REFERENCE_NAME, blob: blobOf(bytes, reference.mimeType) }
    ])
  }
  return writeCharacter(character)
}

/** The reference picture stored beside her record, or `null` where there is none. */
export async function readReference(charId: string): Promise<ReferenceImage | null> {
  assertSafeCharId(charId)
  const blob = await db.readFile(charId, REFERENCE_NAME)
  if (!blob) return null
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const mimeType = imageTypeOf(bytes)
  return mimeType ? { mimeType, data: bytesToBase64(bytes) } : null
}

/** Writes one character's record, stamping the two fields this module owns. */
export async function writeCharacter(character: Character): Promise<Character> {
  await claimCharacter(character.charId)

  // Stamped here rather than by any caller: every write of a record goes through this
  // function or the adoption in `transfer.ts`, and the grid's order is read off it.
  const next: Character = {
    ...character,
    schemaVersion: CHARACTER_SCHEMA_VERSION,
    updatedAt: Date.now()
  }
  await db.writeCharacter(next)
  // A record with no brief is nothing's to resume, so the picture it was written from goes:
  // the write that lands her sheet retires it, and any later save heals an orphan.
  if (!next.brief) await db.writeFiles(next.charId, [], [REFERENCE_NAME])

  return next
}

/** Deletes one of the player's own; a shipped one only comes off the roster, her copy kept. */
export async function deleteCharacter(charId: string): Promise<void> {
  assertSafeCharId(charId)
  if (isShipped(charId)) {
    const { removedDefaults } = await currentSettings()
    const next = withRemovedDefault(removedDefaults, charId)
    if (next.length !== removedDefaults.length) await setRemovedDefaults(next)
    return
  }
  await db.deleteCharacter(charId)
  forgetImages(charId)
}

/** Which of `keys` have an image, by the path each one is kept under. */
function scanPresent<K extends string>(
  rels: ReadonlySet<string>,
  keys: readonly K[],
  relOf: (key: K) => string
): Record<K, boolean> {
  const status = {} as Record<K, boolean>
  for (const key of keys) status[key] = rels.has(relOf(key))
  return status
}

/** Reports which of the seven sprite files exist. */
export async function getExpressionStatus(charId: string): Promise<Record<Emotion, boolean>> {
  assertSafeCharId(charId)
  return scanPresent(await imageRels(charId), EMOTIONS, expressionRel)
}

/** The names of the folders a character's live files stand in directly under `dir`. */
function foldersIn(rels: ReadonlySet<string>, dir: string): string[] {
  const names: string[] = []
  for (const rel of rels) {
    const segments = rel.split('/')
    if (segments.length === 3 && segments[0] === dir) names.push(segments[1])
  }
  return names
}

/**
 * Reports which CG files exist: every stock one, and both images of each custom slot that has
 * a file.
 */
export async function getCgStatus(charId: string): Promise<Record<Position, boolean>> {
  assertSafeCharId(charId)
  const rels = await imageRels(charId)
  const slots = customCgSlotsIn(foldersIn(rels, CUSTOM_CGS_DIR))
  const positions = [...STOCK_POSITIONS, ...slots.flatMap((slot) => [slot, afterOf(slot)])]
  return scanPresent(rels, positions, cgRel)
}

/**
 * Reports which alternate-outfit sprites exist, per set and emotion: every stock set, and each
 * custom slot that has a file.
 */
export async function getOutfitStatus(
  charId: string
): Promise<Record<OutfitSet, Record<Emotion, boolean>>> {
  assertSafeCharId(charId)
  const rels = await imageRels(charId)
  const customs = customOutfitSlotsIn(foldersIn(rels, OUTFITS_DIR))

  const status = {} as Record<OutfitSet, Record<Emotion, boolean>>
  for (const set of [...STOCK_OUTFIT_SETS, ...customs]) {
    status[set] = scanPresent(rels, EMOTIONS, (emotion) => outfitRel(set, emotion))
  }
  return status
}

/** Reports which of the two room backgrounds exist. */
export async function getRoomStatus(charId: string): Promise<Record<RoomVariant, boolean>> {
  assertSafeCharId(charId)
  return scanPresent(await imageRels(charId), ROOM_VARIANTS, roomRel)
}

/** Whether one set's base frame — what its other six expressions are face-passed from — exists. */
export async function hasBaseImage(charId: string, target: SetTarget): Promise<boolean> {
  assertSafeCharId(charId)
  if (target === 'cgs' || target === 'room' || isCustomCgSlot(target)) return true
  return (await imageRels(charId)).has(baseRel(target === 'default' ? null : target))
}

/** Makes a staged regenerate the live set. */
export async function commitStagedSet(
  charId: string,
  target: SetTarget
): Promise<'committed' | 'empty'> {
  await claimCharacter(charId)
  const committed = await db.commitStaged(charId, target)
  forgetImages(charId)
  return committed
}

/** Throws away one staged set, or every staged set when `target` is omitted. */
export async function discardStaged(charId: string, target?: SetTarget): Promise<void> {
  // A character still read out of her pack has nothing staged.
  if (isPackRead(charId)) return
  await db.discardStaged(charId, target)
  forgetImages(charId)
}

/**
 * Deletes one custom set's images, a wardrobe's or a CG pair's, live and staged; the record is
 * the renderer's to rewrite.
 */
export async function deleteCustomSet(
  charId: string,
  slot: CustomOutfitSlot | CustomCgSlot
): Promise<void> {
  if (!isCustomCgSlot(slot) && !isCustomOutfitSlot(slot)) {
    throw appError('OUTFIT_SET_UNKNOWN', `"${String(slot)}" is not a custom set.`)
  }
  await claimCharacter(charId)
  await db.deleteSet(charId, slot)
  forgetImages(charId)
}

/** The bytes of one wardrobe image, or `null` if there is none. */
export async function readWardrobeImage(
  charId: string,
  target: WardrobeTarget,
  image: string
): Promise<Uint8Array | null> {
  assertSafeCharId(charId)
  return imageBytes(charId, wardrobeImageRel(target, image))
}

/**
 * The bytes of one of her images by the path her image URL names, or `null` where there is none
 * or the path names none of her images.
 */
export async function readImage(charId: string, rel: string): Promise<Uint8Array | null> {
  assertSafeCharId(charId)
  if (!isCharFileRel(rel)) return null
  return imageBytes(charId, rel)
}

/** Base64 to a blob, refusing anything that is not a PNG before it can land on a sprite. */
function decodePng(data: string, what: string): Blob {
  const bytes = base64ToBytes(data)
  assertPng(bytes, what)
  return blobOf(bytes, 'image/png')
}

/**
 * Writes one wardrobe's repaired sprites over the set, plus its paint layer where the repair
 * keeps one. The hand repair passes `null` instead, removing any stale layer. The erase also
 * hands over the set's base frame, written in the same transaction.
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

  const writes = images.map(({ emotion, data }) => ({
    rel: spriteFileRel(target, emotion),
    blob: decodePng(data, emotion)
  }))
  if (paintLayer !== null) {
    writes.push({
      rel: layerRel(target, kind),
      blob: decodePng(paintLayer, 'the paint layer')
    })
  }
  if (base !== undefined) {
    writes.push({
      rel: baseRel(target === 'default' ? null : target),
      blob: decodePng(base, 'the base frame')
    })
  }

  // A repair that keeps no layer takes the one it was made over with it, stale or its own.
  const gone = paintLayer === null ? [layerRel(target, kind)] : []
  await db.writeFiles(charId, writes, gone)
  for (const write of writes) forgetImages(charId, write.rel)
  for (const rel of gone) forgetImages(charId, rel)

  // The portrait is a slice of the neutral sprite, and the repair just rewrote it.
  if (target === 'default') await tryCutProfile(charId, await getCharacter(charId))
}

/** Removes one repair's kept paint layer, if it is there. */
export async function discardWardrobeLayer(
  charId: string,
  target: WardrobeTarget,
  kind: WardrobeLayer
): Promise<void> {
  assertSafeCharId(charId)
  // A character still read out of her pack has no paint layer to clear.
  if (isPackRead(charId)) return
  const rel = layerRel(target, kind)
  await db.writeFiles(charId, [], [rel])
  forgetImages(charId, rel)
}

/** What the crop modal opens on. */
export async function getProfileCrop(charId: string): Promise<ProfileCropInfo> {
  assertSafeCharId(charId)
  return profileCropOf(charId, await getCharacter(charId))
}

/**
 * Frames her portrait where the player put it: the picture is cut first, so a frame that
 * could not be cut is not one her record claims she is wearing.
 */
export async function setProfileCrop(charId: string, crop: ProfileCrop): Promise<Character> {
  await claimCharacter(charId)

  const character = await getCharacter(charId)
  // Stamped with the seed she renders under now, which is what a regenerate retires.
  const framed: Character = { ...character, profileCrop: { ...crop, seed: character.generationSeed } }
  const used = await cutProfile(charId, framed)

  return writeCharacter({ ...framed, profileCrop: used })
}

/** The day image the night render re-lights: this run's staged one if any, else the live one. */
async function readDayImage(charId: string, staged: boolean): Promise<Uint8Array> {
  for (const fromStaging of staged ? [true, false] : [false]) {
    const bytes = await imageBytes(charId, roomRel('day'), fromStaging)
    if (bytes) return bytes
  }
  throw appError(
    'ROOM_DAY_MISSING',
    'The daytime room background has to be rendered before the night one.'
  )
}

/** Renders one of a character's two room backgrounds and keeps the image beside her. */
async function generateRoomImage(
  character: Character,
  variant: RoomVariant,
  staged: boolean,
  signal?: AbortSignal
): Promise<void> {
  assertSafeCharId(character.charId)
  if (!isRoomVariant(variant)) {
    throw appError('ROOM_VARIANT_UNKNOWN', `"${String(variant)}" is not a room variant.`)
  }

  let bytes: Uint8Array
  if (variant === 'night') {
    // The day picture goes over as a JPEG, which every Images endpoint takes as a reference.
    const day = await jpegOf(await readDayImage(character.charId, staged))
    if (!day) {
      throw appError(
        'ROOM_DAY_INVALID',
        'The daytime room background could not be read as an image. Render it again.'
      )
    }
    bytes = await generateImage(NIGHT_ROOM_PROMPT, {
      signal,
      sources: [{ bytes: day, mimeType: LINEUP_MIME_TYPE }]
    })
  } else {
    if (!character.roomPrompt.trim()) {
      throw appError(
        'ROOM_PROMPT_MISSING',
        'This character has no room description. Regenerate the character to get one.'
      )
    }
    bytes = await generateImage(dayRoomPrompt(character.roomPrompt), { signal })
  }

  const rel = roomRel(variant)
  try {
    await claimCharacter(character.charId)
    const blob = imageBlob(bytes)
    await db.writeFiles(character.charId, [{ rel: staged ? stagedRel(rel) : rel, blob }])
  } catch (err) {
    throw appError('ROOM_UNWRITABLE', 'Could not save the room background.', messageOf(err))
  }
  forgetImages(character.charId, rel, staged)
}

/** Queues one cloud room render, grouped by charId so deleting a character cancels it. */
export async function generateRoom(
  character: Character,
  variant: RoomVariant,
  staged = false
): Promise<string> {
  // Copied in before the job is queued, so a character that cannot be is refused up front.
  await claimCharacter(character.charId)
  return enqueue({
    group: character.charId,
    key: `room:${variant}`,
    run: async ({ signal, report }) => {
      report('Rendering room')
      await generateRoomImage(character, variant, staged, signal)
      return `room:${variant}`
    }
  })
}

/**
 * Keeps a room background the player picked, `png` being its base64 bytes, once they have
 * passed the shared check. Refused for a character deleted while the picture was on its way.
 */
export async function uploadRoom(charId: string, variant: RoomVariant, png: string): Promise<void> {
  await claimCharacter(charId)
  if (!isRoomVariant(variant)) {
    throw appError('ROOM_VARIANT_UNKNOWN', `"${String(variant)}" is not a room variant.`)
  }
  const bytes = base64ToBytes(png)
  assertRoomPicture(bytes)
  await db.readCharacter(charId)

  const rel = roomRel(variant)
  try {
    await db.writeFiles(charId, [{ rel, blob: imageBlob(bytes) }])
  } catch (err) {
    throw appError('ROOM_UNWRITABLE', 'Could not save the room background.', messageOf(err))
  }
  forgetImages(charId, rel, false)
}
