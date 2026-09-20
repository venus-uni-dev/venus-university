/**
 * The reference sheet's geometry: how a row of transparent sprites becomes one landscape
 * image an image model can be handed as a cast list. Pure arithmetic; the canvas that executes
 * the layout lives in `stores/loop/endingArt.ts`.
 */

/**
 * How tall each sprite's *trimmed* art stands on the sheet, in pixels: just under the ~1620px a
 * 1160x1696 sprite carries, so the pass is always a downscale.
 */
const LINEUP_ART_HEIGHT = 1600

/** The widest sheet that may be built, in pixels. */
const LINEUP_MAX_WIDTH = 8192

/** How far each sprite is pulled over the one before it, in pixels. */
const LINEUP_OVERLAP = 0

/** The alpha a pixel needs to count as art. */
const LINEUP_ALPHA_FLOOR = 8

/**
 * The trim scan reads one pixel in this many on each axis; whatever it finds is padded outward
 * by one cell.
 */
export const LINEUP_SCAN_STEP = 8

/** The sheet's encoding and quality — the one place those are decided. */
export const LINEUP_MIME_TYPE = 'image/jpeg'
export const LINEUP_QUALITY = 0.92

/** A rectangle in some image's own pixels. */
export interface LineupBox {
  x: number
  y: number
  width: number
  height: number
}

/** One sprite as the layout needs it: its canvas, and where the art sits in it. */
export interface LineupSprite {
  width: number
  height: number
  /** The opaque bounding box — {@link alphaBounds}' answer. */
  art: LineupBox
}

/** One `drawImage` call: source rect out of the sprite, destination rect on the sheet. */
interface LineupPlacement {
  sx: number
  sy: number
  sw: number
  sh: number
  dx: number
  dy: number
  dw: number
  dh: number
}

export interface LineupLayout {
  width: number
  height: number
  placements: LineupPlacement[]
}

/** The smallest box containing every pixel at or above `floor`, or `null` when there is none. */
export function alphaBounds(
  alpha: ArrayLike<number>,
  width: number,
  height: number,
  floor: number = LINEUP_ALPHA_FLOOR
): LineupBox | null {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      if (alpha[row + x] < floor) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }

  if (maxX < 0) return null
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

/** Grows a box by `pad` on every side without leaving the image. */
export function padBox(box: LineupBox, pad: number, width: number, height: number): LineupBox {
  const x = Math.max(0, box.x - pad)
  const y = Math.max(0, box.y - pad)
  return {
    x,
    y,
    width: Math.min(width, box.x + box.width + pad) - x,
    height: Math.min(height, box.y + box.height + pad) - y
  }
}

/**
 * Where every sprite goes on the sheet. Each is scaled so its *trimmed* art is exactly
 * {@link LINEUP_ART_HEIGHT} tall, then laid left to right.
 */
export function layoutLineup(sprites: readonly LineupSprite[]): LineupLayout {
  if (sprites.length === 0) return { width: 0, height: 0, placements: [] }

  // Unrounded, so the fit below is computed against the true width.
  const scales = sprites.map((sprite) => LINEUP_ART_HEIGHT / sprite.art.height)
  const widths = sprites.map((sprite, i) => sprite.art.width * scales[i])
  const raw =
    widths.reduce((total, width) => total + width, 0) - LINEUP_OVERLAP * (sprites.length - 1)
  const fit = raw > LINEUP_MAX_WIDTH ? LINEUP_MAX_WIDTH / raw : 1

  const placements: LineupPlacement[] = []
  let x = 0
  for (let i = 0; i < sprites.length; i++) {
    const art = sprites[i].art
    const dw = widths[i] * fit
    const dx = Math.round(x)
    placements.push({
      sx: art.x,
      sy: art.y,
      sw: art.width,
      sh: art.height,
      dx,
      dy: 0,
      dw: Math.round(x + dw) - dx,
      dh: Math.round(LINEUP_ART_HEIGHT * fit)
    })
    x += dw - LINEUP_OVERLAP * fit
  }

  const last = placements[placements.length - 1]
  return { width: last.dx + last.dw, height: placements[0].dh, placements }
}
