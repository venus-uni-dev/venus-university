import { describe, expect, it } from 'vitest'
import {
  anchorOf,
  overlappingPairs,
  placeBubbles,
  type Bounds,
  type PinBox
} from '../src/renderer/views/mapLayout'

/**
 * Where the map's bubbles land: anchors are approximate, so what must hold is not that a bubble
 * sits on its landmark but that it is always readable — inside the frame, never under another.
 */

/** The frame, in the picture's own pixels. */
const BOUNDS: Bounds = { left: 0, top: 0, right: 1000, bottom: 600 }

/** The sheet sizes and frames a 4:3 window and a 16:9 one draw the map at. */
const FRAMES: ReadonlyArray<{ sheetW: number; sheetH: number; bounds: Bounds }> = [
  { sheetW: 1254, sheetH: 700, bounds: { left: 18, top: 18, right: 1236, bottom: 682 } },
  { sheetW: 1640, sheetH: 915, bounds: { left: 18, top: 143, right: 1622, bottom: 771 } }
]

/** One bubble the size a two-face pin measures. */
function pin(key: string, ax: number, ay: number): PinBox {
  return { key, ax, ay, w: 200, h: 100 }
}

/** A one-face bubble on each of `keys`, on its own anchor of a `sheetW` by `sheetH` sheet. */
function cluster(keys: readonly string[], sheetW: number, sheetH: number): PinBox[] {
  return keys.map((key) => {
    const anchor = anchorOf(key)
    return { key, ax: anchor.x * sheetW, ay: anchor.y * sheetH, w: 230, h: 150 }
  })
}

/** The rectangle a placement of a `w` by `h` bubble covers. */
function boxOf(
  at: { x: number; y: number },
  w: number,
  h: number
): { l: number; r: number; t: number; b: number } {
  return { l: at.x, r: at.x + w, t: at.y, b: at.y + h }
}

/** Asserts a bubble on each of `keys` is clear of the others and on the map, in both frames. */
function expectApart(keys: readonly string[]): void {
  for (const frame of FRAMES) {
    const pins = cluster(keys, frame.sheetW, frame.sheetH)
    const placed = placeBubbles(pins, frame.bounds)

    expect(overlappingPairs(pins, placed)).toEqual([])
    for (const one of pins) {
      const box = boxOf(at(placed, one.key), one.w, one.h)
      expect(box.l).toBeGreaterThanOrEqual(frame.bounds.left)
      expect(box.t).toBeGreaterThanOrEqual(frame.bounds.top)
      expect(box.r).toBeLessThanOrEqual(frame.bounds.right)
      expect(box.b).toBeLessThanOrEqual(frame.bounds.bottom)
    }
  }
}

describe('placeBubbles', () => {
  it('stands a bubble over its anchor', () => {
    const placed = placeBubbles([pin('agora', 500, 300)], BOUNDS)
    const at = placed.get('agora')

    // Centred across the anchor, its foot a stand-off above it.
    expect(at?.x).toBe(400)
    expect(at?.y).toBe(185)
  })

  it('pulls a bubble anchored against a corner back inside the frame', () => {
    // A place drawn near the edge of the picture would otherwise hang half of its bubble
    // outside the frame, which clips it — the map's own `overflow: hidden`.
    const placed = placeBubbles([pin('elysium', 990, 590)], BOUNDS)
    const box = boxOf(placed.get('elysium') ?? { x: 0, y: 0 }, 200, 100)

    expect(box.l).toBeGreaterThanOrEqual(BOUNDS.left)
    expect(box.t).toBeGreaterThanOrEqual(BOUNDS.top)
    expect(box.r).toBeLessThanOrEqual(BOUNDS.right)
    expect(box.b).toBeLessThanOrEqual(BOUNDS.bottom)
  })

  it('keeps the riverside crowd apart and inside the frame', () => {
    // Six landmarks within a few dozen pixels of each other: the whole roster on the Promenade
    // is the case this exists for, and one bubble drifts off its landmark rather than be covered.
    expectApart([
      'apogee_club',
      'lumiere_fusion',
      'riverside_mall',
      'future_cinema',
      'riverside_aquarium',
      'selkie_beach'
    ])
  })

  it('keeps the downtown crowd apart and inside the frame', () => {
    expectApart([
      'reserve_bank_cafe',
      'spring_mart',
      'fast_eats',
      'bobbys_diner',
      'green_hill_park',
      'cutetea',
      'btb_arcade'
    ])
  })

  it('keeps the Stanchion crowd apart and inside the frame', () => {
    expectApart([
      'cutetea',
      'btb_arcade',
      'stalestein_bar',
      'pastel_palace',
      'eastern_buffet',
      'freights_books',
      'hotel_dreams'
    ])
  })
})

/** The placement for `key`, which every case above expects to exist. */
function at(
  placed: Map<string, { x: number; y: number }>,
  key: string
): { x: number; y: number } {
  const answer = placed.get(key)
  if (!answer) throw new Error(`nothing placed for ${key}`)
  return answer
}
