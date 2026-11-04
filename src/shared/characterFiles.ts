import { isEmotion } from './emotions'
import { appError } from './errors'
import { BASE_IMAGE, FIX_IMAGE, isOutfitSet, parseSpriteRef } from './outfits'
import { customCgSlotOf, isCustomCgSlot, isPosition, isStockPosition } from './positions'
import { roomStem, roomVariantOfStem, ROOM_VARIANTS, type RoomVariant } from './room'
import type { OutfitSet, SetTarget, SpriteRef, WardrobeLayer, WardrobeTarget } from './types'

/**
 * The one vocabulary of a character's image paths, each one relative to wherever her files
 * are kept: a folder on disk, a key space in a browser database, the entries of her export
 * zip. Every reader and every writer names a file through this file and nowhere else.
 */

/**
 * The neutral frame one set's sprites are face-passed from, saved with its background
 * already cut so every sprite takes its alpha from it. Named outside the `{emotion}.png`
 * vocabulary so a presence scan never reads it as a sprite.
 */
const BASE_IMAGE_NAME = 'neutral.base.png'

/**
 * Her portrait, cut from the default set's `neutral` at the archway's ratio.
 * Named outside the emotion vocabulary for {@link BASE_IMAGE_NAME}'s reason.
 */
const PROFILE_IMAGE_NAME = 'profile.png'

/**
 * The face the detector found on that same sprite, as a full-frame mask — what the
 * portrait above is framed off, kept so it can be reframed without re-rendering her.
 * Named outside the emotion vocabulary for {@link BASE_IMAGE_NAME}'s reason.
 */
const FACE_MASK_NAME = 'face.png'

/**
 * One set's saved transparency-repair layer — the strokes the player painted under its
 * sprites, kept so the editor can reopen on them.
 */
const FIX_LAYER_NAME = 'fix.png'

/**
 * The hand repair's layer, which is **not** kept: the strokes place a finger on a hand the fix
 * then replaces, so they are wrong for the next repair. Named only so a leftover from before
 * this rule — or from the repair that just ran — can be removed.
 */
const HANDS_LAYER_NAME = 'hands.png'

/** The name a character's record is written under, at the root of her folder or her package. */
export const CHARACTER_FILE_NAME = 'character.json'

/**
 * The picture the New Character modal was given, kept loose beside the record until her sheet
 * lands. Extensionless and outside {@link isCharFileRel}, so nothing scans it as an image and
 * no export, backup or `charimg://` request can reach it.
 */
export const REFERENCE_NAME = 'reference'

/** The default wardrobe's folder, which also holds the portrait and the face mask. */
const EXPRESSIONS_DIR = 'expressions'

/** The alternate wardrobes' folder, one subfolder per set. */
export const OUTFITS_DIR = 'outfits'

/** The stock CGs' folder. */
const CGS_DIR = 'cg'

/**
 * The custom CG pairs' folder, one subfolder per slot — never inside the stock CGs' folder,
 * which a stock regenerate replaces whole.
 */
export const CUSTOM_CGS_DIR = 'customcg'

/** Where a regenerate's images land until they are committed over the live set. */
export const STAGING_DIR = 'staging'

/** The extension every image this vocabulary names is called by, whatever it is stored as. */
export const IMAGE_EXTENSION = '.png'

/**
 * The extension every image is kept under — the shipped cast as the release transcodes it,
 * everything the app writes as it writes it — which every reader takes for the `.png` it names.
 */
export const STORED_EXTENSION = '.webp'

/** The name this vocabulary calls a stored file by. */
export function namedRel(entry: string): string {
  return entry.toLowerCase().endsWith(STORED_EXTENSION)
    ? `${entry.slice(0, -STORED_EXTENSION.length)}${IMAGE_EXTENSION}`
    : entry
}

/** The stored name of an image this vocabulary calls `<stem>.png`. */
export function storedRel(rel: string): string {
  return rel.toLowerCase().endsWith(IMAGE_EXTENSION)
    ? `${rel.slice(0, -IMAGE_EXTENSION.length)}${STORED_EXTENSION}`
    : rel
}

/**
 * Whether `rel` is a picture's PNG name whose stored twin stands among `present` (paths
 * lowercased): the stored one is the picture read, and the PNG beside it is stale.
 */
export function isStaleTwinRel(rel: string, present: ReadonlySet<string>): boolean {
  const stored = storedRel(rel)
  return stored !== rel && present.has(stored.toLowerCase())
}

/**
 * Whether an image is one of the editor's working files — a base frame, the face mask, a paint
 * layer — which later renders and repairs read back as pixels, and so is kept losslessly.
 */
export function isLosslessRel(rel: string): boolean {
  const name = namedRel(rel.slice(rel.lastIndexOf('/') + 1))
  return name === FACE_MASK_NAME || isEditorFile(name)
}

/** `expressions/{emotion}.png` — one default-wardrobe sprite. */
export function expressionRel(emotion: string): string {
  return `${EXPRESSIONS_DIR}/${emotion}${IMAGE_EXTENSION}`
}

/** `outfits/{set}/{emotion}.png` — one alternate-wardrobe sprite. */
export function outfitRel(set: string, emotion: string): string {
  return `${OUTFITS_DIR}/${set}/${emotion}${IMAGE_EXTENSION}`
}

/** `cg/{position}.png` — one stock CG; `customcg/{slot}/{position}.png` — a custom pair's image. */
export function cgRel(position: string): string {
  const slot = customCgSlotOf(position)
  return slot
    ? `${CUSTOM_CGS_DIR}/${slot}/${position}${IMAGE_EXTENSION}`
    : `${CGS_DIR}/${position}${IMAGE_EXTENSION}`
}

/** `room_{day|night}.png` — one room background, which sits loose in her folder. */
export function roomRel(variant: RoomVariant): string {
  return `${roomStem(variant)}${IMAGE_EXTENSION}`
}

/** `expressions/profile.png` — her portrait. */
export function profileRel(): string {
  return `${EXPRESSIONS_DIR}/${PROFILE_IMAGE_NAME}`
}

/** `expressions/face.png` — the full-frame face mask the portrait is framed off. */
export function faceRel(): string {
  return `${EXPRESSIONS_DIR}/${FACE_MASK_NAME}`
}

/** One set's base frame; a null set is the default wardrobe. */
export function baseRel(set: OutfitSet | null): string {
  return `${setDirRel(set ?? 'default')}/${BASE_IMAGE_NAME}`
}

/** One wardrobe's kept or removed paint layer, by which repair painted it. */
export function layerRel(target: WardrobeTarget, kind: WardrobeLayer): string {
  return `${setDirRel(target)}/${kind === 'hands' ? HANDS_LAYER_NAME : FIX_LAYER_NAME}`
}

/** The image one sprite reference names: a CG for a position, a wardrobe sprite otherwise. */
export function spriteRel(value: SpriteRef): string {
  if (isPosition(value)) return cgRel(value)
  const parsed = parseSpriteRef(value)
  if (!parsed) return expressionRel(value)
  return parsed.set ? outfitRel(parsed.set, parsed.emotion) : expressionRel(parsed.emotion)
}

/** The folder one set's images sit in; the room's two files sit loose, so its folder is hers. */
export function setDirRel(target: SetTarget): string {
  if (target === 'room') return ''
  if (target === 'default') return EXPRESSIONS_DIR
  if (target === 'cgs') return CGS_DIR
  if (isCustomCgSlot(target)) return `${CUSTOM_CGS_DIR}/${target}`
  // Vocabulary check before `target` lands in a path.
  if (!isOutfitSet(target)) {
    throw appError('OUTFIT_SET_UNKNOWN', `"${String(target)}" is not an outfit set.`)
  }
  return `${OUTFITS_DIR}/${target}`
}

/** The names a set keeps loose in the character's own folder, or null where it has a folder. */
export function looseNamesOf(target: SetTarget): string[] | null {
  return target === 'room' ? ROOM_VARIANTS.map(roomRel) : null
}

/** The staged twin of a live relative path; the staging root itself for the character's own. */
export function stagedRel(rel: string): string {
  return rel === '' ? STAGING_DIR : `${STAGING_DIR}/${rel}`
}

/** One sprite's relative path, refusing anything that is not an emotion. */
export function spriteFileRel(target: WardrobeTarget, emotion: string): string {
  if (!isEmotion(emotion)) {
    throw appError('EMOTION_UNKNOWN', `"${String(emotion)}" is not an expression.`)
  }
  return target === 'default' ? expressionRel(emotion) : outfitRel(target, emotion)
}

/** One wardrobe image's relative path: the kept paint layer, the base frame, or a sprite. */
export function wardrobeImageRel(target: WardrobeTarget, image: string): string {
  if (image === FIX_IMAGE) return layerRel(target, 'fix')
  if (image === BASE_IMAGE) return baseRel(target === 'default' ? null : target)
  return spriteFileRel(target, image)
}

/** Whether `name` is one of the two names the editor keeps beside a set's sprites. */
function isEditorFile(name: string): boolean {
  return name === BASE_IMAGE_NAME || name === FIX_LAYER_NAME || name === HANDS_LAYER_NAME
}

/** Whether `name` names a default-wardrobe file: a sprite, the portrait or the face mask. */
function isExpressionFile(name: string): boolean {
  if (name === PROFILE_IMAGE_NAME || name === FACE_MASK_NAME) return true
  if (isEditorFile(name)) return true
  return isEmotion(stemOf(name))
}

/** A file name without the extension this vocabulary writes. */
function stemOf(name: string): string {
  return name.toLowerCase().endsWith(IMAGE_EXTENSION) ? name.slice(0, -IMAGE_EXTENSION.length) : name
}

/**
 * Whether `rel` is a relative path this vocabulary can name — the gate anything built from a
 * URL, an archive or a database key passes before it is joined onto a character's folder. A
 * name under either extension passes.
 */
export function isCharFileRel(rel: string): boolean {
  const segments = rel.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return false
  }
  if (segments[0] === STAGING_DIR) return isCharFileRel(segments.slice(1).join('/'))

  const name = namedRel(segments[segments.length - 1])
  if (segments.length === 1) return roomVariantOfStem(stemOf(name)) !== null
  if (segments.length === 2 && segments[0] === EXPRESSIONS_DIR) return isExpressionFile(name)
  if (segments.length === 2 && segments[0] === CGS_DIR) return isStockPosition(stemOf(name))
  if (segments.length === 3 && segments[0] === CUSTOM_CGS_DIR) {
    return isCustomCgSlot(segments[1]) && customCgSlotOf(stemOf(name)) === segments[1]
  }
  if (segments.length === 3 && segments[0] === OUTFITS_DIR) {
    return isOutfitSet(segments[1]) && (isEditorFile(name) || isEmotion(stemOf(name)))
  }
  return false
}
