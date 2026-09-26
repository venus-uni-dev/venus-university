import type { JSX } from 'react'
import { ConfirmModal } from '../components/ConfirmModal'
import { useUpdateStore } from '../stores/updateStore'

/**
 * The one question an update asks, put over the boot cover before any screen is drawn, or over
 * the menu from its notice. "Not now" leaves the app where it was; "Update" hands it to the
 * updater.
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
      message={`Upgrade to version ${version}? Your saves, characters, and settings will be maintained.`}
      confirmText="Update"
      cancelText="Not now"
      onConfirm={() => answer('update')}
      onCancel={() => answer('later')}
    />
  )
}
