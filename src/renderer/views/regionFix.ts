import { alphaBounds, padBox, type LineupBox } from '@shared/lineup'

/**
 * How much of the frame around the changed region the close-up shows, as a share of the
 * region's longer side: enough that what was redrawn is read against what it belongs to.
 */
const PREVIEW_PAD = 0.35

/** The alpha a region pixel needs to count as changed — the mask is hard-edged but feathered. */
const REGION_FLOOR = 8

/**
 * Lays one rendered fix over one picture: the region is cleared, then the cutout drawn into the
 * hole, so a blob finger the redrawn hand lacks is removed rather than covered. `opaque` keeps a
 * picture with no transparency that way, white showing where the cutout has none — a base frame
 * never cut is read as uncut only while it stays opaque. All three bitmaps are the same size by
 * construction.
 */
export function compositeRegion(
  target: HTMLCanvasElement,
  picture: ImageBitmap,
  region: ImageBitmap,
  cutout: ImageBitmap,
  opaque = false
): void {
  clearRegion(target, picture, region)
  const ctx = target.getContext('2d')
  if (!ctx) throw new Error('The compositing canvas could not be opened.')

  ctx.globalCompositeOperation = 'source-over'
  ctx.drawImage(cutout, 0, 0, target.width, target.height)

  if (opaque) {
    ctx.globalCompositeOperation = 'destination-over'
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, target.width, target.height)
    ctx.globalCompositeOperation = 'source-over'
  }
}

/** Draws one picture into `target` with the region cleared out of it, and nothing laid in. */
export function clearRegion(
  target: HTMLCanvasElement,
  picture: ImageBitmap,
  region: ImageBitmap
): void {
  target.width = picture.width
  target.height = picture.height
  const ctx = target.getContext('2d')
  if (!ctx) throw new Error('The compositing canvas could not be opened.')

  ctx.clearRect(0, 0, target.width, target.height)
  ctx.globalCompositeOperation = 'source-over'
  ctx.drawImage(picture, 0, 0)

  ctx.globalCompositeOperation = 'destination-out'
  ctx.drawImage(region, 0, 0, target.width, target.height)
  ctx.globalCompositeOperation = 'source-over'
}

/**
 * Where the close-up looks: the box the region covers, padded so what was redrawn is shown in
 * place. `null` is the answer that matters — the graph changed nothing, so there is nothing to
 * apply.
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
