import { describe, expect, it } from 'vitest'
import { isRgbaPng } from '@shared/imageBytes'

/**
 * Whether a PNG carries an alpha channel: the answer decides whether a base frame is cut
 * again before its sprites are, and whether the hand fix's paint layer is read as a mask.
 */

/** A PNG's IHDR header, through the colour-type byte the answer is read off. */
function pngHeader(colourType: number): Uint8Array {
  const bytes = new Uint8Array(26)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  bytes.set([0, 0, 0, 13], 8)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  bytes[24] = 8
  bytes[25] = colourType
  return bytes
}

describe('isRgbaPng', () => {
  it('reads the colour type: truecolour with alpha, truecolour without', () => {
    expect(isRgbaPng(pngHeader(6))).toBe(true)
    expect(isRgbaPng(pngHeader(2))).toBe(false)
  })

  it('refuses anything that is not a PNG, whatever its 26th byte holds', () => {
    const ascii = (text: string): number[] => Array.from(text, (c) => c.charCodeAt(0))
    const webp = new Uint8Array(26)
    webp.set(ascii('RIFF'))
    webp.set(ascii('WEBP'), 8)
    webp[25] = 6
    expect(isRgbaPng(webp)).toBe(false)
    expect(isRgbaPng(new Uint8Array(0))).toBe(false)
  })
})
