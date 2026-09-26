import type { JSX } from 'react'
import type { AppError } from '@shared/types'
import { ITCH_PAGE_URL } from '@shared/updateSource'
import { ErrorModal } from '../components/ErrorModal'
import { useUpdateStore } from '../stores/updateStore'

/**
 * An update that did not land — stopped before the swap, or rolled back by it on the last launch —
 * with the store page as the way to do it by hand. Closing it releases whoever is waiting behind
 * it, which carries on as usual.
 */
export function UpdateFailedModal({
  theme,
  error
}: {
  /** Drawn by the screen that raised this — a portal inherits neither palette nor state rules. */
  theme: 'day' | 'night'
  error: AppError
}): JSX.Element {
  const dismissFailure = useUpdateStore((s) => s.dismissFailure)

  return (
    <ErrorModal
      id="update-failed"
      theme={theme}
      error={error}
      closeText="Continue"
      extraText="Open itch.io"
      // The same door as every other outside link: `window.open` reaches main's handler.
      onExtra={() => window.open(ITCH_PAGE_URL)}
      onClose={dismissFailure}
    />
  )
}
