import type { JSX } from 'react'
import { ConfirmModal } from '../components/ConfirmModal'
import { useUpdateStore } from '../stores/updateStore'

/**
 * The one question an update asks, put over the boot cover before the app has drawn a screen.
 * Either answer lets boot go on; only "Update" hands the rest of the launch to the updater.
 */
export function UpdateModal({
  theme,
  version
}: {
  /** Drawn by the screen that raised this — a portal inherits neither palette nor state rules. */
  theme: 'day' | 'night'
  version: string
}): JSX.Element {
  const answer = useUpdateStore((s) => s.answer)

  return (
    <ConfirmModal
      id="update-offer"
      theme={theme}
      title="Update available"
      message={`Version ${version} is out. Your saves, characters and settings stay where they are.`}
      confirmText="Update"
      cancelText="Not now"
      onConfirm={() => answer('update')}
      onCancel={() => answer('later')}
    />
  )
}
