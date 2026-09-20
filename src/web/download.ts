import { useUiStore } from '../renderer/stores/uiStore'
import { blobOf } from './blob'

/**
 * Handing a built file to the player. A browser only lets a click download while the click is
 * still live, and the zip is only ready long after that, so the file is offered through a
 * panel whose button is a click of its own.
 */

/** Offers one file for saving and answers with the name it is offered under. */
export function offerDownload(name: string, content: Uint8Array | string, type: string): string {
  const blob = typeof content === 'string' ? new Blob([content], { type }) : blobOf(content, type)
  useUiStore.getState().offerDownload(name, URL.createObjectURL(blob))
  return name
}
