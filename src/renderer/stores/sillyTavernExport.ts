import { zipSync } from 'fflate'
import { expressionRel } from '@shared/characterFiles'
import { defaultTagsOf } from '@shared/defaultTags'
import { EMOTIONS } from '@shared/emotions'
import { appError } from '@shared/errors'
import { imageTypeOf } from '@shared/imageBytes'
import { utf8ToBase64, withTextChunks } from '@shared/pngText'
import { CARD_BG, CARD_SIZE, cardFrame, SILLYTAVERN_EMOTIONS } from '@shared/sillyTavern'
import type { Character } from '@shared/types'
import { buildCharacterCard } from '../prompts/characterCard'
import { bgUrl } from '../views/bgAssets'
import { blobToBase64, canvasToBlob } from './loop/encode'
import { bundledImage } from './loop/thumbnail'
import { useSettingsStore } from './settingsStore'

/**
 * Composing the two files a character leaves the app as for SillyTavern: the card picture,
 * her sheet hidden in its text chunks, and a flat zip of her sprites.
 */

/** Draws `bitmap` covering the whole canvas, centred, cropping whatever overhangs. */
function drawCovering(ctx: CanvasRenderingContext2D, bitmap: ImageBitmap): void {
  const scale = Math.max(CARD_SIZE.width / bitmap.width, CARD_SIZE.height / bitmap.height)
  const width = bitmap.width * scale
  const height = bitmap.height * scale
  const x = (CARD_SIZE.width - width) / 2
  ctx.drawImage(bitmap, x, (CARD_SIZE.height - height) / 2, width, height)
}

/** Composes a character's SillyTavern card as a base64 PNG, sheet included in its text chunks. */
export async function composeCard(charId: string, character: Character): Promise<string> {
  const spriteResult = await window.api.chars.readImage(charId, expressionRel('neutral'))
  if (!spriteResult.ok) throw spriteResult.error
  if (!spriteResult.data) {
    throw appError('CARD_NO_SPRITE', 'She has no neutral sprite yet. Render her sprites first.')
  }

  const cropResult = await window.api.chars.profileCrop(charId)
  if (!cropResult.ok) throw cropResult.error
  const frame = cardFrame(cropResult.data.suggested)

  const sprite = await createImageBitmap(new Blob([spriteResult.data]))
  let background: ImageBitmap | null = null
  try {
    const url = bgUrl(CARD_BG, 'day', false)
    if (url) background = await createImageBitmap(await bundledImage(url))
  } catch (err) {
    // A missing background is not fatal: the card is drawn on a blank canvas instead.
    console.warn('[sillyTavernExport] drawn without a background:', err)
  }

  const canvas = document.createElement('canvas')
  canvas.width = CARD_SIZE.width
  canvas.height = CARD_SIZE.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('The card picture could not be drawn.')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  try {
    if (background) drawCovering(ctx, background)
    const k = CARD_SIZE.height / frame.height
    ctx.drawImage(sprite, -frame.x * k, -frame.y * k, sprite.width * k, sprite.height * k)
  } finally {
    background?.close()
    sprite.close()
  }

  const blob = await canvasToBlob(canvas, 'image/png', 1)
  const bytes = new Uint8Array(await blob.arrayBuffer())

  const card = buildCharacterCard(
    character,
    new Date(),
    defaultTagsOf(useSettingsStore.getState().settings).subject
  )
  const cardBytes = withTextChunks(bytes, {
    chara: utf8ToBase64(JSON.stringify(card.v2)),
    ccv3: utf8ToBase64(JSON.stringify(card.v3))
  })
  return blobToBase64(new Blob([new Uint8Array(cardBytes)], { type: 'image/png' }))
}

/**
 * Composes a character's rendered expressions as a base64 zip under SillyTavern's names, each
 * sprite copied under every label it stands in for.
 */
export async function composeSpritePack(charId: string): Promise<string> {
  const files: Record<string, Uint8Array> = {}
  for (const emotion of EMOTIONS) {
    const result = await window.api.chars.readImage(charId, expressionRel(emotion))
    if (!result.ok) throw result.error
    if (!result.data) continue
    const type = imageTypeOf(result.data)
    if (!type) continue
    const ext = type === 'image/webp' ? 'webp' : 'png'
    for (const label of SILLYTAVERN_EMOTIONS[emotion]) files[`${label}.${ext}`] = result.data
  }
  if (Object.keys(files).length === 0) {
    throw appError('SPRITES_NONE', 'She has no sprites yet. Render her sprites first.')
  }
  // Level 0: the art is already compressed, and a stored zip is what the desktop importer
  // and the shipped packs both are.
  const zipped = zipSync(files, { level: 0 })
  return blobToBase64(new Blob([zipped], { type: 'application/zip' }))
}
