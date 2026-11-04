import type { LineupBox } from '@shared/lineup'

/** The tolerance the sensitivity slider reaches at its top: half a channel's range. */
const TOLERANCE_MAX = 128

/** The pixels one magic-erase click takes, as a map the size of the box around them. */
export interface Selection {
  /** One byte a pixel of `box`, row by row: 1 where the pixel is taken. */
  selected: Uint8Array
  box: LineupBox
}

/** The per-channel tolerance a 0–100 sensitivity stands for. */
export function toleranceOf(sensitivity: number): number {
  return Math.round((sensitivity * TOLERANCE_MAX) / 100)
}

/**
 * Every visible pixel joined to (x, y) through pixels within `tolerance` of it, four-connected,
 * and the patch's soft edge with it. Colours are compared premultiplied and alpha beside them,
 * so every transparent pixel reads as one colour: a click on a patch stops at the transparency
 * around it, and a click on the empty ground reaches the faint halo touching it. The edge is
 * what the fill leaves around a patch — its own colour fading out — taken while each step only
 * fades, so it never climbs into anything opaque. `null` where nothing visible is taken.
 */
export function floodSelect(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  tolerance: number
): Selection | null {
  if (x < 0 || y < 0 || x >= width || y >= height) return null

  const channels = (i: number): [number, number, number, number] => {
    const a = data[i * 4 + 3]
    return [(data[i * 4] * a) / 255, (data[i * 4 + 1] * a) / 255, (data[i * 4 + 2] * a) / 255, a]
  }
  const [sr, sg, sb, sa] = channels(y * width + x)
  const matches = (i: number): boolean => {
    const [r, g, b, a] = channels(i)
    return (
      Math.abs(a - sa) <= tolerance &&
      Math.abs(r - sr) <= tolerance &&
      Math.abs(g - sg) <= tolerance &&
      Math.abs(b - sb) <= tolerance
    )
  }

  const visited = new Uint8Array(width * height)
  const taken = new Uint8Array(width * height)
  let left = width
  let top = height
  let right = -1
  let bottom = -1
  // What the edge pass starts from: every pixel the fill takes.
  const edge: number[] = []
  const take = (i: number): void => {
    taken[i] = 1
    edge.push(i)
    const px = i % width
    const py = (i - px) / width
    if (px < left) left = px
    if (px > right) right = px
    if (py < top) top = py
    if (py > bottom) bottom = py
  }

  /* A pixel of the seed's own colour at its own, lower opacity: premultiplied, that is the
     seed's channels scaled by the opacity. */
  const fades = (i: number): boolean => {
    const [r, g, b, a] = channels(i)
    const k = a / sa
    return (
      Math.abs(r - sr * k) <= tolerance &&
      Math.abs(g - sg * k) <= tolerance &&
      Math.abs(b - sb * k) <= tolerance
    )
  }

  // A scanline fill: each seed is widened to its whole run, and the rows either side seeded
  // once per run of matching pixels under it.
  const seeds: number[] = [x, y]
  while (seeds.length > 0) {
    const sy = seeds.pop() as number
    const sx = seeds.pop() as number
    const row = sy * width
    if (visited[row + sx] || !matches(row + sx)) continue

    let start = sx
    while (start > 0 && !visited[row + start - 1] && matches(row + start - 1)) start--
    let end = sx
    while (end < width - 1 && !visited[row + end + 1] && matches(row + end + 1)) end++

    for (let px = start; px <= end; px++) {
      visited[row + px] = 1
      if (data[(row + px) * 4 + 3] === 0) continue
      take(row + px)
    }

    for (const ny of [sy - 1, sy + 1]) {
      if (ny < 0 || ny >= height) continue
      const next = ny * width
      let inRun = false
      for (let px = start; px <= end; px++) {
        const open = !visited[next + px] && matches(next + px)
        if (open && !inRun) seeds.push(px, ny)
        inRun = open
      }
    }
  }

  // The edge: outward from what was taken, onto visible pixels no more opaque than the one
  // stepped from and fainter than the seed, while they are its colour fading.
  while (edge.length > 0) {
    const i = edge.pop() as number
    const alpha = data[i * 4 + 3]
    const px = i % width
    for (const j of [
      px > 0 ? i - 1 : -1,
      px < width - 1 ? i + 1 : -1,
      i >= width ? i - width : -1,
      i + width < width * height ? i + width : -1
    ]) {
      if (j < 0 || taken[j]) continue
      const a = data[j * 4 + 3]
      if (a === 0 || a > alpha || a >= sa || !fades(j)) continue
      take(j)
    }
  }

  if (right < 0) return null
  const box = { x: left, y: top, width: right - left + 1, height: bottom - top + 1 }
  const selected = new Uint8Array(box.width * box.height)
  for (let py = 0; py < box.height; py++) {
    const from = (box.y + py) * width + box.x
    selected.set(taken.subarray(from, from + box.width), py * box.width)
  }
  return { selected, box }
}

/** A selection as a canvas the size of its box, opaque where taken: what a click stamps. */
export function selectionCanvas({ selected, box }: Selection): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = box.width
  canvas.height = box.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('The selection canvas could not be opened.')

  const stamp = ctx.createImageData(box.width, box.height)
  for (let i = 0; i < selected.length; i++) {
    if (selected[i]) stamp.data[i * 4 + 3] = 255
  }
  ctx.putImageData(stamp, 0, 0)
  return canvas
}

/**
 * Draws one image into `target` with the erase mask cut out of it. The mask is drawn at the
 * image's size unsmoothed, so a pixel erased on the stage is the same pixel in every file.
 */
export function cutMask(
  target: HTMLCanvasElement,
  image: ImageBitmap,
  mask: HTMLCanvasElement
): void {
  target.width = image.width
  target.height = image.height
  const ctx = target.getContext('2d')
  if (!ctx) throw new Error('The compositing canvas could not be opened.')

  ctx.clearRect(0, 0, target.width, target.height)
  ctx.globalCompositeOperation = 'source-over'
  ctx.drawImage(image, 0, 0)
  ctx.globalCompositeOperation = 'destination-out'
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(mask, 0, 0, target.width, target.height)
  ctx.globalCompositeOperation = 'source-over'
}

/**
 * Whether any pixel of an image is less than opaque. A base frame rendered before the base
 * graph cut its own background has none, and takes no alpha from the erase.
 */
export function hasTransparency(image: ImageBitmap): boolean {
  const scratch = document.createElement('canvas')
  scratch.width = image.width
  scratch.height = image.height
  const ctx = scratch.getContext('2d')
  if (!ctx) return false

  ctx.drawImage(image, 0, 0)
  const { data } = ctx.getImageData(0, 0, image.width, image.height)
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 255) return true
  }
  return false
}
