import type { JSX } from 'react'
import { ConfirmModal } from '../components/ConfirmModal'
import { useUiStore } from '../stores/uiStore'

/**
 * Hands over a file the app has just built. The button clicks a link made for it and thrown
 * away again, and the link in the panel is that same file for a right-click, which is the
 * only way out of a frame that has not been allowed to download.
 */
export function DownloadModal({
  theme,
  name,
  url
}: {
  /** Drawn by the screen that raised this — a portal inherits neither palette nor state rules. */
  theme: 'day' | 'night'
  name: string
  url: string
}): JSX.Element {
  const clearDownload = useUiStore((s) => s.clearDownload)

  /** Saves the file through a link built for the click and removed again after it. */
  function save(): void {
    const link = document.createElement('a')
    link.href = url
    link.download = name
    document.body.appendChild(link)
    link.click()
    link.remove()
  }

  return (
    <ConfirmModal
      id="download"
      theme={theme}
      title="Your file is ready"
      message={
        <>
          If nothing downloads,{' '}
          <a className="vu-link" href={url} download={name} target="_blank" rel="noopener">
            right-click this link
          </a>{' '}
          and save it.
        </>
      }
      confirmText={`Download ${name}`}
      cancelText="Close"
      // The panel stays up on the answer: the link under it is what a swallowed click leaves.
      onConfirm={save}
      onCancel={clearDownload}
    />
  )
}
