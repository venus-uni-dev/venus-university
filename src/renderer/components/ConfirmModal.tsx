import type { JSX, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'
import { gestures, lift, press, quietLift, quietPress } from '../views/motion'
import { DialogFrame } from './DialogFrame'
import { useModalShell } from './useModalShell'
import '../vu_styles/Dialog.css'

export interface ConfirmModalProps {
  id: string
  /** Drawn by the screen that raised this — a portal inherits neither palette nor state rules. */
  theme: 'day' | 'night'
  title: string
  message: ReactNode
  /** Drawn under the message, inside the frame and above the foot — a checkbox the answer carries. */
  aside?: ReactNode
  confirmText?: string
  /** Label for the dismiss button. */
  cancelText?: string
  /** Locks every button while the confirmed action is still running. */
  busy?: boolean
  /** Replaces `confirmText` while `busy`. */
  busyText?: string
  /** Makes an overlay click do nothing, so the only ways out are the buttons. */
  lockOut?: boolean
  /**
   * A third answer beside confirm and cancel. Both `extraText` and `onExtra`
   * are needed for the button to appear.
   */
  extraText?: string
  onExtra?: () => void
  onConfirm: () => void
  /**
   * Omitted for a modal with only one way out: the dismiss button is then
   * hidden and closing the modal runs `onConfirm`.
   */
  onCancel?: () => void
  /**
   * What Escape and a click on the dimming run. Defaults to `onCancel`, then
   * `onConfirm` — pass it only when the quiet button's own action isn't the
   * right thing for those to do.
   */
  onDismiss?: () => void
}

/**
 * Yes/no gate in front of a destructive action, e.g. deleting a character. Wears the A4
 * frame (`vu_styles/Dialog.css`), which it shares with the error modal.
 */
export function ConfirmModal({
  id,
  theme,
  title,
  message,
  aside,
  confirmText = 'Delete',
  cancelText = 'Cancel',
  busy = false,
  busyText,
  lockOut = false,
  extraText,
  onExtra,
  onConfirm,
  onCancel,
  onDismiss
}: ConfirmModalProps): JSX.Element | null {
  const dismiss = onDismiss ?? onCancel ?? onConfirm
  const { host, overlayProps } = useModalShell(busy || lockOut ? () => {} : dismiss)
  if (!host) return null

  return createPortal(
    <DialogFrame
      id={id}
      theme={theme}
      role="dialog"
      ariaLabel={title}
      overlayProps={overlayProps}
      title={title}
      foot={
        <>
          {onCancel && (
            <motion.button
              id={`${id}-cancel`}
              className="vu-btn vu-btn--quiet"
              type="button"
              disabled={busy}
              {...gestures(busy, quietLift, quietPress)}
              onClick={onCancel}
            >
              {cancelText}
            </motion.button>
          )}
          {extraText && onExtra && (
            <motion.button
              id={`${id}-extra`}
              className="vu-btn vu-btn--quiet"
              type="button"
              disabled={busy}
              {...gestures(busy, quietLift, quietPress)}
              onClick={onExtra}
            >
              {extraText}
            </motion.button>
          )}
          <motion.button
            id={`${id}-confirm`}
            className="vu-btn vu-btn--primary vu-paper vu-btn--panel"
            type="button"
            disabled={busy}
            {...gestures(busy, lift, press)}
            onClick={onConfirm}
          >
            {busy && busyText ? busyText : confirmText}
          </motion.button>
        </>
      }
    >
      <p className="vu-note-text">{message}</p>
      {aside}
    </DialogFrame>,
    host
  )
}
