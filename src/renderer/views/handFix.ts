import { alphaBounds, padBox, type LineupBox } from '@shared/lineup'

/**
 * How much of the frame around the changed region the close-up shows, as a share of the
 * region's longer side: enough that the hand is read against the arm it belongs to.
 */
const PREVIEW_PAD = 0.35

/** The alpha a region pixel needs to count as changed — the mask is hard-edged but feathered. */
const REGION_FLOOR = 8

/**
 * Lays one hand fix over one sprite: the region is cleared, then the cutout drawn into the hole,
 * so a blob finger the redrawn hand lacks is removed rather than covered. All three bitmaps are
 * the same size by construction.
 */
export function compositeHands(
  target: HTMLCanvasElement,
  sprite: ImageBitmap,
  region: ImageBitmap,
  cutout: ImageBitmap
): void {
  target.width = sprite.width
  target.height = sprite.height
  const ctx = target.getContext('2d')
  if (!ctx) throw new Error('The compositing canvas could not be opened.')

  ctx.clearRect(0, 0, target.width, target.height)
  ctx.globalCompositeOperation = 'source-over'
  ctx.drawImage(sprite, 0, 0)

  ctx.globalCompositeOperation = 'destination-out'
  ctx.drawImage(region, 0, 0, target.width, target.height)

  ctx.globalCompositeOperation = 'source-over'
  ctx.drawImage(cutout, 0, 0, target.width, target.height)
}

/**
 * Where the close-up looks: the box the region covers, padded so the hand is shown in its
 * own arm. `null` is the answer that matters — the graph changed nothing, so there is no hand
 * near the strokes and there is nothing to apply.
 */
export function previewBox(region: ImageBitmap): LineupBox | null {
  const scratch = document.createElement('canvas')
  scratch.width = region.width
  scratch.height = region.height
  const ctx = scratch.getContext('2d')
  if (!ctx) return null

  ctx.drawImage(region, 0, 0)
  const { data } = ctx.getImageData(0, 0, region.width, region.height)
  const alpha = new Uint8ClampedArray(region.width * region.height)
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3]

  const box = alphaBounds(alpha, region.width, region.height, REGION_FLOOR)
  if (!box) return null
  return padBox(box, Math.round(Math.max(box.width, box.height) * PREVIEW_PAD), region.width, region.height)
}
