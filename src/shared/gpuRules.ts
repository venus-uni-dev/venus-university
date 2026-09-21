import type { ComfyGpu } from './setupManifest'

/** Which of the two ComfyUI portable builds a machine's graphics hardware calls for. */

/** PCI vendor ids of the two makers a portable build exists for. */
const NVIDIA = 0x10de
const AMD = 0x1002

/**
 * The build to install, read off every GPU the machine reports rather than the one it calls
 * active: a discrete NVIDIA card beside an integrated one is still what the renders run on.
 * An AMD card answers only where there is no NVIDIA one, and hardware from neither maker
 * takes the NVIDIA build, which is the one the app was written against.
 */
export function comfyGpuFor(vendorIds: readonly number[]): ComfyGpu {
  if (vendorIds.includes(NVIDIA)) return 'nvidia'
  if (vendorIds.includes(AMD)) return 'amd'
  return 'nvidia'
}
