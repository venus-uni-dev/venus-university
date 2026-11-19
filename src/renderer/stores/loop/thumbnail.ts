import { cgRel, roomRel, spriteRel } from '@shared/characterFiles'
import type { BgVariant } from '@shared/customBackgrounds'
import { messageOf } from '@shared/errors'
import type { RoomVariant } from '@shared/room'
import {
  stageCgPlacement,
  stagePortraitPlacement,
  STAGE_THUMB_FALLBACK_QUALITY,
  STAGE_THUMB_HEIGHT,
  STAGE_THUMB_MAX_BYTES,
  STAGE_THUMB_FALLBACK_MIME_TYPE,
  STAGE_THUMB_QUALITY,
  STAGE_THUMB_WIDTH,
  type StagePlacement
} from '@shared/stageThumb'
import { allBackgrounds, roomBgIdOf, type SceneState } from '@shared/types'
import { slotHalf } from '../../prompts/gameDate'
import { isEpilogueNight } from '../../prompts/graduation'
import { bgThumbUrl, customBackgroundOf, roomOwnerOf, SLOT_BG } from '../../views/bgAssets'
import { useAssetStore } from '../assetStore'
import { stageContextOf, useGameStore } from '../gameStore'
import { matchCgBiologyOf, noNsfwImagesOf, useSettingsStore } from '../settingsStore'
import { stockCgsInPlay } from '@shared/positions'
import { displayedCgOf, displaySlotsOf, displaySpriteRef } from '../stageDisplay'
import { stageOnLoad } from '../stageStep'
import { blobToBase64, canvasToWebpOr } from './encode'
import { currentRun, runStale } from './state'

/**
 * The picture of the stage a save carries: the scene's background, then its CG or its row of
 * portraits, drawn small off the scene the save records rather than off the screen.
 */

/** How many decoded layers are kept for the next picture. */
const LAYER_CACHE_CAP = 24

/** Decoded layers by what they were read from, least recently used first. */
const layers = new Map<string, ImageBitmap>()

/** Reads a character's image version; the slot cycle registers the character store's. */
let spriteVersionOf: (charId: string) => number = () => 0

/** Registers where a character's image version is read, so a regenerated image is decoded afresh. */
export function registerSpriteVersions(read: (charId: string) => number): void {
  spriteVersionOf = read
}

/** The layer held under `key`, moved to the recent end; null when none is. */
function heldLayer(key: string): ImageBitmap | null {
  const bitmap = layers.get(key)
  if (!bitmap) return null
  layers.delete(key)
  layers.set(key, bitmap)
  return bitmap
}

/** Holds `bitmap` under `key`, releasing the least recently used past the cap. */
function holdLayer(key: string, bitmap: ImageBitmap): void {
  layers.set(key, bitmap)
  for (const [oldest, evicted] of layers) {
    if (layers.size <= LAYER_CACHE_CAP) break
    layers.delete(oldest)
    evicted.close()
  }
}

/** The layer under `key`, decoded `height` pixels tall off what `read` answers when not held. */
async function layerOf(
  key: string,
  height: number,
  read: () => Promise<Blob | null>
): Promise<ImageBitmap | null> {
  const held = heldLayer(key)
  if (held) return held
  const blob = await read()
  if (!blob) return null
  const bitmap = await createImageBitmap(blob, {
    resizeHeight: Math.max(1, Math.round(height)),
    resizeQuality: 'medium'
  })
  holdLayer(key, bitmap)
  return bitmap
}

/** One of a character's images, or null when she has none at `rel`. */
export async function characterImage(charId: string, rel: string): Promise<Blob | null> {
  const result = await window.api.chars.readImage(charId, rel)
  if (!result.ok) throw result.error
  return result.data ? new Blob([result.data]) : null
}

/** One of a character's images as a layer, keyed on her image version. */
function characterLayer(charId: string, rel: string, height: number): Promise<ImageBitmap | null> {
  return layerOf(`${charId}/${rel}@${spriteVersionOf(charId)}`, height, () =>
    characterImage(charId, rel)
  )
}

/** A bundled picture's bytes. */
export async function bundledImage(url: string): Promise<Blob> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  return response.blob()
}

/** One of the player's own backgrounds' pictures, or null when it has none at `variant`. */
export async function customImage(name: string, variant: BgVariant): Promise<Blob | null> {
  const result = await window.api.backgrounds.readImage(name, variant)
  if (!result.ok) throw result.error
  return result.data ? new Blob([result.data]) : null
}

/** Whose room `base` is under the roster and the listed backgrounds as they stand right now. */
export function roomOwnerNow(base: string): string | undefined {
  const owners = new Map(
    Object.values(useGameStore.getState().characters).map((character) => [
      roomBgIdOf(character),
      character.charId
    ])
  )
  const listed = new Set(allBackgrounds(useAssetStore.getState().backgrounds))
  return roomOwnerOf(base, owners, listed)
}

/**
 * The background `base` names at `half`: one of the player's own, a character's room, or a
 * bundled thumbnail. The first two are read as bytes over the bridge, as the canvas needs them.
 */
function backgroundLayer(base: string, half: RoomVariant): Promise<ImageBitmap | null> {
  const custom = customBackgroundOf(base)
  if (custom) {
    // Keyed on when it was brought, so one re-added under the name is decoded afresh.
    const key = `bg:${base}@${String(custom.record.createdAt)}/${half}`
    return layerOf(key, STAGE_THUMB_HEIGHT, () => customImage(base, half))
  }
  const owner = roomOwnerNow(base)
  if (owner) return characterLayer(owner, roomRel(half), STAGE_THUMB_HEIGHT)
  const url = bgThumbUrl(base, half, false) ?? bgThumbUrl(SLOT_BG, half, false)
  if (!url) return Promise.resolve(null)
  return layerOf(url, STAGE_THUMB_HEIGHT, () => bundledImage(url))
}

/** Draws `bitmap` over the whole canvas, centred, cropping whatever overhangs. */
function drawCovering(ctx: CanvasRenderingContext2D, bitmap: ImageBitmap): void {
  const scale = Math.max(STAGE_THUMB_WIDTH / bitmap.width, STAGE_THUMB_HEIGHT / bitmap.height)
  const width = bitmap.width * scale
  const height = bitmap.height * scale
  ctx.drawImage(
    bitmap,
    (STAGE_THUMB_WIDTH - width) / 2,
    (STAGE_THUMB_HEIGHT - height) / 2,
    width,
    height
  )
}

/** Draws `bitmap` into `at`, mirrored across its own width when `mirrored`. */
function drawPlaced(
  ctx: CanvasRenderingContext2D,
  bitmap: ImageBitmap,
  at: StagePlacement,
  mirrored: boolean
): void {
  if (!mirrored) {
    ctx.drawImage(bitmap, at.x, at.y, at.width, at.height)
    return
  }
  ctx.save()
  ctx.translate(at.x + at.width, 0)
  ctx.scale(-1, 1)
  ctx.drawImage(bitmap, 0, at.y, at.width, at.height)
  ctx.restore()
}

/** Says which layer the picture went without, and why. */
function leftOut(layer: string, err: unknown): void {
  console.warn(`[thumbnail] drawn without ${layer}:`, messageOf(err))
}

/**
 * The stage a load of `scene` opens on, as a small JPEG in base64 with no `data:` prefix. A
 * layer that cannot be read is left out; null when the picture cannot be made small enough,
 * when the stay it was started in is left, or outside a browser — the node test suite has no
 * canvas.
 */
export async function composeStageThumbnail(scene: SceneState): Promise<string | null> {
  if (typeof document === 'undefined') return null
  const run = currentRun()
  const game = useGameStore.getState()
  const { stage, bgOverride } = stageOnLoad(scene, stageContextOf(game))

  const canvas = document.createElement('canvas')
  canvas.width = STAGE_THUMB_WIDTH
  canvas.height = STAGE_THUMB_HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  // The epilogue's evening is night whatever the clock says, as on the stage itself.
  const half = isEpilogueNight(game.date, game.time, game.graduationSeen)
    ? 'night'
    : slotHalf(game.time)

  // A CG stands in for the whole row, as it does on the stage, and a locked one is drawn over an
  // empty row as well.
  const shown = displaySlotsOf(stage.slots, stage.stageOverride)
  const stockCgs = stockCgsInPlay(
    game.playerPronouns,
    matchCgBiologyOf(useSettingsStore.getState())
  )
  const row = shown.filter(
    (charId): charId is string => charId !== null && Boolean(game.characters[charId])
  )
  const cg = displayedCgOf({
    shown,
    emotions: stage.emotions,
    lock: scene.cgLock,
    hasCharacter: (charId) => Boolean(game.characters[charId]),
    ready: { cgReady: game.cgReady, customCgReady: game.customCgReady, stockCgs },
    noNsfwImages: noNsfwImagesOf(useSettingsStore.getState())
  })
  // Nobody on the stage and no CG — the landing, an exam, a scene everyone has left — is drawn
  // by no picture: the card shows the background's own thumbnail instead, which is the same one.
  if (row.length === 0 && !cg) return null

  try {
    const bitmap = await backgroundLayer(bgOverride ?? stage.bg ?? SLOT_BG, half)
    if (runStale(run)) return null
    if (bitmap) drawCovering(ctx, bitmap)
  } catch (err) {
    if (runStale(run)) return null
    leftOut('its background', err)
  }

  if (cg) {
    try {
      const height = stageCgPlacement(1).height
      const bitmap = await characterLayer(cg.charId, cgRel(cg.position), height)
      if (runStale(run)) return null
      if (bitmap) {
        drawPlaced(ctx, bitmap, stageCgPlacement(bitmap.width / bitmap.height), false)
      }
    } catch (err) {
      if (runStale(run)) return null
      leftOut('its CG', err)
    }
  } else {
    for (const [index, charId] of row.entries()) {
      const scale = game.characters[charId].height
      try {
        const ref = displaySpriteRef(
          stage.emotions[charId] ?? 'neutral',
          scene.outfitLock?.[charId],
          game.outfitReady[charId],
          game.customCgReady[charId],
          stockCgs
        )
        // A portrait's height is her scale's alone; only its width waits on the decoded image.
        const height = stagePortraitPlacement(index, row.length, scale, 1).height
        const bitmap = await characterLayer(charId, spriteRel(ref), height)
        if (runStale(run)) return null
        if (!bitmap) continue
        const at = stagePortraitPlacement(index, row.length, scale, bitmap.width / bitmap.height)
        drawPlaced(ctx, bitmap, at, stage.flipped[charId] === true)
      } catch (err) {
        if (runStale(run)) return null
        leftOut('a portrait', err)
      }
    }
  }

  try {
    let blob = await canvasToWebpOr(canvas, STAGE_THUMB_QUALITY, STAGE_THUMB_FALLBACK_MIME_TYPE)
    if (runStale(run)) return null
    if (blob.size > STAGE_THUMB_MAX_BYTES) {
      blob = await canvasToWebpOr(
        canvas,
        STAGE_THUMB_FALLBACK_QUALITY,
        STAGE_THUMB_FALLBACK_MIME_TYPE
      )
      if (runStale(run)) return null
    }
    if (blob.size > STAGE_THUMB_MAX_BYTES) return null
    const data = await blobToBase64(blob)
    return runStale(run) ? null : data
  } catch (err) {
    console.warn('[thumbnail] the stage picture could not be encoded:', messageOf(err))
    return null
  }
}
