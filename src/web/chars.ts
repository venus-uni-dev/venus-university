import { base64ToBytes, bytesToBase64 } from '@shared/base64'
import {
  baseRel,
  cgRel,
  expressionRel,
  layerRel,
  outfitRel,
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
import { EMOTIONS } from '@shared/emotions'
import { appError, messageOf } from '@shared/errors'
import { assertPng, imageTypeOf } from '@shared/imageBytes'
import { enqueue } from '@shared/jobQueue'
import { generateImage } from '@shared/llm/cloudImage'
import { OUTFIT_SETS } from '@shared/outfits'
import { POSITIONS } from '@shared/positions'
import { dayRoomPrompt, isRoomVariant, NIGHT_ROOM_PROMPT, ROOM_VARIANTS } from '@shared/room'
import type { RoomVariant } from '@shared/room'
import type {
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
import { blobOf, imageBlob } from './blob'
import * as db from './db/chars'
import { imageBytes, imageRels } from './files'
import { forgetImages } from './images'
import { isShipped, shippedCharacter, shippedCharacters, shippedCharIds } from './packs'
import { cutProfile, profileCropOf, tryCutProfile } from './profile'
import { currentSettings, setRemovedDefaults } from './settings'

/**
 * Characters in the browser: the cast the game ships with, read out of its packs, and the
 * player's own, kept in the browser's storage under the same relative paths a folder uses.
 */

/** Rejects a write aimed at one of the shipped cast; nothing makes them editable here. */
function assertEditableChar(charId: string): void {
  assertSafeCharId(charId)
  if (!isShipped(charId)) return
  throw appError(
    'CHARACTER_READ_ONLY',
    'Default characters cannot be edited.',
    `Duplicate her first; the copy is editable. (${charId})`
  )
}

/** Lists both roots, shipped cast first, as the desktop lists its two folders. */
export async function listCharacters(): Promise<Character[]> {
  return [...shippedCharacters(), ...(await db.listOwn())]
}

/** One character, whichever of the two holds her. */
export async function getCharacter(charId: string): Promise<Character> {
  assertSafeCharId(charId)
  return isShipped(charId) ? shippedCharacter(charId) : db.readCharacter(charId)
}

/** Every shipped charId, and which of them the player has removed. */
export async function getDefaultsStatus(): Promise<{ ids: string[]; removed: string[] }> {
  const { removedDefaults } = await currentSettings()
  return defaultsStatusOf(shippedCharIds(), removedDefaults)
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
  const character = newCharacter(firstName, lastName, brief)
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
  assertEditableChar(character.charId)

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

/** Deletes one of the player's own; a shipped one only comes off the roster. */
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

/** Reports which of the eight CG files exist. */
export async function getCgStatus(charId: string): Promise<Record<Position, boolean>> {
  assertSafeCharId(charId)
  return scanPresent(await imageRels(charId), POSITIONS, cgRel)
}

/** Reports which alternate-outfit sprites exist, per set and emotion. */
export async function getOutfitStatus(
  charId: string
): Promise<Record<OutfitSet, Record<Emotion, boolean>>> {
  assertSafeCharId(charId)
  const rels = await imageRels(charId)

  const status = {} as Record<OutfitSet, Record<Emotion, boolean>>
  for (const set of OUTFIT_SETS) {
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
  if (target === 'cgs' || target === 'room') return true
  return (await imageRels(charId)).has(baseRel(target === 'default' ? null : target))
}

/** Makes a staged regenerate the live set. */
export async function commitStagedSet(
  charId: string,
  target: SetTarget
): Promise<'committed' | 'empty'> {
  const committed = await db.commitStaged(charId, target)
  forgetImages(charId)
  return committed
}

/** Throws away one staged set, or every staged set when `target` is omitted. */
export async function discardStaged(charId: string, target?: SetTarget): Promise<void> {
  await db.discardStaged(charId, target)
  forgetImages(charId)
}

/**
 * Deletes one custom set's images, live and staged; the record is the renderer's to rewrite.
 */
export async function deleteCustomSet(charId: string, slot: CustomOutfitSlot): Promise<void> {
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

/** Base64 to a blob, refusing anything that is not a PNG before it can land on a sprite. */
function decodePng(data: string, what: string): Blob {
  const bytes = base64ToBytes(data)
  assertPng(bytes, what)
  return blobOf(bytes, 'image/png')
}

/**
 * Writes one wardrobe's repaired sprites over the set, plus its paint layer where the repair
 * keeps one. The hand repair passes `null` instead, removing any stale layer.
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
  assertEditableChar(charId)

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
    const day = await readDayImage(character.charId, staged)
    const mimeType = imageTypeOf(day)
    if (!mimeType) {
      throw appError(
        'ROOM_DAY_INVALID',
        'The daytime room background could not be read as an image. Render it again.'
      )
    }
    bytes = await generateImage(NIGHT_ROOM_PROMPT, { signal, source: { bytes: day, mimeType } })
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
  // The cloud bucket's own copy of the gate in front of every write.
  assertEditableChar(character.charId)
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
