import { useState, type JSX } from 'react'
import { motion } from 'motion/react'
import type { AppError } from '@shared/types'
import { heldScreenTheme } from '../views/clockTheme'
import { gestures, lift, press } from '../views/motion'
import '../vu_styles/Dialog.css'
import '../vu_styles/Fatal.css'

export interface FatalErrorScreenProps {
  error: AppError
}

/**
 * An unrecoverable tier-3 error: the whole stage rather than a modal over one, since
 * there is no screen left underneath to dim. Wears `Dialog.css`'s A4 frame with no veil, and
 * holds the theme it opened with — a screen that fell over does not go on reading the clock.
 */
export function FatalErrorScreen({ error }: FatalErrorScreenProps): JSX.Element {
  const [theme] = useState(heldScreenTheme)
  const [copied, setCopied] = useState(false)

  const diagnostics = [`code: ${error.code}`, `message: ${error.message}`, error.detail ?? '']
    .filter(Boolean)
    .join('\n')

  function handleCopy(): void {
    void navigator.clipboard.writeText(diagnostics).then(
      () => setCopied(true),
      // Clipboard permission can be refused.
      () => setCopied(false)
    )
  }

  return (
    <div className="vu-fatal" data-theme={theme}>
      <div className="vu-dialog vu-paper">
        <span className="vu-dialog-badge vu-arch vu-paper" aria-hidden="true">
          !
        </span>

        <div className="vu-dialog-head">
          <h1 className="vu-dialog-title">Venus University can&apos;t continue</h1>
          <span className="vu-dialog-code">CODE: {error.code}</span>
        </div>
        <p className="vu-note-text">{error.message}</p>
        <pre className="vu-dialog-detail" data-cursor="text">
          {diagnostics}
        </pre>

        <div className="vu-foot vu-dialog-foot">
          <motion.button
            id="fatal-copy"
            className="vu-btn vu-btn--primary vu-paper vu-btn--panel"
            type="button"
            {...gestures(false, lift, press)}
            onClick={handleCopy}
          >
            {copied ? 'Copied' : 'Copy diagnostics'}
          </motion.button>
        </div>
      </div>
    </div>
  )
}
