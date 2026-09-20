import type { JSX } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'
import type { AppError } from '@shared/types'
import { gestures, lift, press, quietLift, quietPress } from '../views/motion'
import { DialogFrame } from './DialogFrame'
import { useModalShell } from './useModalShell'
import '../vu_styles/Dialog.css'

export interface ErrorModalProps {
  id: string
  /** Drawn by the screen that raised this — a portal inherits neither palette nor state rules. */
  theme: 'day' | 'night'
  error: AppError
  onClose: () => void
  /**
   * A third answer beside the dismissal. Both `extraText` and `onExtra` are needed for
   * the button to appear.
   */
  extraText?: string
  onExtra?: () => void
  /** The dismiss button's label. */
  closeText?: string
}

/**
 * A recoverable tier-2 error. The A4 frame: what happened, the code it happened under,
 * and the detail a bug report needs — all of it at rest, since a line behind a disclosure is
 * a line nobody pastes.
 */
export function ErrorModal({
  id,
  theme,
  error,
  onClose,
  extraText,
  onExtra,
  closeText = 'Got it'
}: ErrorModalProps): JSX.Element | null {
  const { host, overlayProps } = useModalShell(onClose)
  if (!host) return null

  return createPortal(
    <DialogFrame
      id={id}
      theme={theme}
      role="alertdialog"
      ariaLabel={error.message}
      overlayProps={overlayProps}
      title="Something went wrong"
      code={error.code}
      foot={
        <>
          {extraText && onExtra && (
            <motion.button
              id={`${id}-extra`}
              className="vu-btn vu-btn--quiet"
              type="button"
              {...gestures(false, quietLift, quietPress)}
              onClick={onExtra}
            >
              {extraText}
            </motion.button>
          )}
          <motion.button
            id={`${id}-dismiss`}
            className="vu-btn vu-btn--primary vu-paper vu-btn--panel"
            type="button"
            {...gestures(false, lift, press)}
            onClick={onClose}
          >
            {closeText}
          </motion.button>
        </>
      }
    >
      <p className="vu-note-text">{error.message}</p>
      {error.detail && <pre className="vu-dialog-detail" data-cursor="text">
          {error.detail}
        </pre>}
    </DialogFrame>,
    host
  )
}
