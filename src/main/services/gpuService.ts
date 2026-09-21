import { app } from 'electron'
import { messageOf } from '@shared/errors'
import { comfyGpuFor } from '@shared/gpuRules'
import type { ComfyGpu } from '@shared/setupManifest'
import type { Settings } from '@shared/types'

/** The disk edge of the GPU rule: what Electron says this machine has, and the override over it. */

/** One GPU as `app.getGPUInfo('basic')` reports it. */
interface GpuDevice {
  vendorId?: number
}

/**
 * Which ComfyUI build this machine is for: the hand-edited `comfyGpu` where it is set,
 * otherwise the vendors Electron reports. A failed probe falls back to NVIDIA.
 */
export async function resolveComfyGpu(settings: Settings): Promise<ComfyGpu> {
  if (settings.comfyGpu !== undefined) {
    console.log(`[verify] GPU vendor: ${settings.comfyGpu} (comfyGpu in settings.json)`)
    return settings.comfyGpu
  }
  try {
    const info = (await app.getGPUInfo('basic')) as { gpuDevice?: GpuDevice[] }
    const vendorIds = (info.gpuDevice ?? [])
      .map((device) => device.vendorId)
      .filter((id): id is number => typeof id === 'number')
    const gpu = comfyGpuFor(vendorIds)
    const listed = vendorIds.map((id) => `0x${id.toString(16)}`).join(', ') || 'none'
    console.log(`[verify] GPU vendor: ${gpu} (detected, devices ${listed})`)
    return gpu
  } catch (err) {
    console.log(`[verify] GPU vendor: nvidia (detection failed — ${messageOf(err)})`)
    return 'nvidia'
  }
}
