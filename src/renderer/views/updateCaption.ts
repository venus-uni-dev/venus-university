import type { UpdateProgress } from '@shared/types'

/**
 * What the curtain's mark says an update is doing. One short line, since the caption is drawn
 * as a single uppercase mono row, and a whole percent, so it is rewritten a hundred times at most.
 */
export function updateCaption(progress: UpdateProgress | null): string {
  if (progress === null) return 'Downloading'
  switch (progress.phase) {
    case 'download':
      return progress.percent === undefined
        ? 'Downloading'
        : `Downloading ${Math.round(progress.percent)}%`
    case 'unpack':
      return 'Unpacking'
    case 'restart':
      return 'Restarting'
  }
}
