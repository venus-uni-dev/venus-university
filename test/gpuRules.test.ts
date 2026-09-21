import { describe, expect, it } from 'vitest'
import { comfyGpuFor } from '@shared/gpuRules'

/**
 * Which ComfyUI portable build a machine gets: the vendor ids Electron reports decide it, and
 * a discrete card beside an integrated one is what has to win.
 */

/** PCI vendor ids as a machine reports them, the two makers and an integrated one. */
const NVIDIA = 0x10de
const AMD = 0x1002
const INTEL = 0x8086

describe('comfyGpuFor', () => {
  it('names the vendor a single card is from', () => {
    expect(comfyGpuFor([NVIDIA])).toBe('nvidia')
    expect(comfyGpuFor([AMD])).toBe('amd')
  })

  it('takes the discrete card beside an integrated one, whichever is listed first', () => {
    expect(comfyGpuFor([INTEL, NVIDIA])).toBe('nvidia')
    expect(comfyGpuFor([INTEL, AMD])).toBe('amd')
  })

  it('prefers NVIDIA where both makers are present', () => {
    expect(comfyGpuFor([AMD, NVIDIA])).toBe('nvidia')
  })

  it('falls back to NVIDIA where nothing is reported', () => {
    expect(comfyGpuFor([])).toBe('nvidia')
    expect(comfyGpuFor([INTEL])).toBe('nvidia')
  })
})
