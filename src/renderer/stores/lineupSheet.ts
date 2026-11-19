import {
  alphaBounds,
  layoutLineup,
  padBox,
  LINEUP_MIME_TYPE,
  LINEUP_QUALITY,
  LINEUP_SCAN_STEP,
  type LineupSprite
} from '@shared/lineup'
import { canvasToBase64 } from './loop/encode'

/**
 * The reference sheet's canvas half: sprites trimmed, evened out and laid side by side on black,
 * the geometry being `@shared/lineup.ts`'s. The graduation picture and the phone's photos both
 * hand the image model one of these as their cast list.
 */

/** One girl on the sheet: a loader called once to measure and once to draw. */
export type LineupFrame = () => Promise<ImageBitmap | null>

/** A finished sheet: the JPEG as base64, and which of the frames it was handed stand on it. */
export interface LineupSheet {
  data: string
  /** Indexes into the frames, left to right; a frame that loaded nothing is missing from it. */
  drawn: number[]
}

/** Her opaque bounding box, scanned coarsely and padded back out. */
function trimOf(bitmap: ImageBitmap): LineupSprite | null {
  const width = Math.max(1, Math.round(bitmap.width / LINEUP_SCAN_STEP))
  const height = Math.max(1, Math.round(bitmap.height / LINEUP_SCAN_STEP))
  const scratch = document.createElement('canvas')
  scratch.width = width
  scratch.height = height
  const ctx = scratch.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(bitmap, 0, 0, width, height)

  const { data } = ctx.getImageData(0, 0, width, height)
  const alpha = new Uint8ClampedArray(width * height)
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3]

  const scanned = alphaBounds(alpha, width, height)
  if (!scanned) return null
  const full = {
    x: scanned.x * LINEUP_SCAN_STEP,
    y: scanned.y * LINEUP_SCAN_STEP,
    width: scanned.width * LINEUP_SCAN_STEP,
    height: scanned.height * LINEUP_SCAN_STEP
  }
  return {
    width: bitmap.width,
    height: bitmap.height,
    // One scan cell of slack on every side: a downscale averages a hair strand toward nothing.
    art: padBox(full, LINEUP_SCAN_STEP, bitmap.width, bitmap.height)
  }
}

/**
 * Every frame trimmed and laid left to right on black, or null when none of them loaded. Two
 * passes with one bitmap alive at a time — the first measures, the second draws — since every
 * full frame decoded at once costs ~8MB.
 */
export async function stitchLineup(frames: readonly LineupFrame[]): Promise<LineupSheet | null> {
  const measured: number[] = []
  const sprites: LineupSprite[] = []
  for (const [i, load] of frames.entries()) {
    const bitmap = await load()
    if (!bitmap) continue
    const sprite = trimOf(bitmap)
    bitmap.close()
    if (!sprite) continue
    measured.push(i)
    sprites.push(sprite)
  }

  const layout = layoutLineup(sprites)
  if (layout.placements.length === 0) return null

  const sheet = document.createElement('canvas')
  sheet.width = layout.width
  sheet.height = layout.height
  const ctx = sheet.getContext('2d')
  if (!ctx) return null
  // Opaque black: the sheet is a JPEG, and a lineup on black reads as "no background".
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, sheet.width, sheet.height)

  const drawn: number[] = []
  for (const [k, placement] of layout.placements.entries()) {
    const bitmap = await frames[measured[k]]()
    if (!bitmap) continue
    ctx.drawImage(
      bitmap,
      placement.sx,
      placement.sy,
      placement.sw,
      placement.sh,
      placement.dx,
      placement.dy,
      placement.dw,
      placement.dh
    )
    bitmap.close()
    drawn.push(measured[k])
  }

  return { data: await canvasToBase64(sheet, LINEUP_MIME_TYPE, LINEUP_QUALITY), drawn }
}
