import type { JSX, ReactNode } from 'react'
import { motion } from 'motion/react'
import { panelIn, veilIn } from '../views/motion'
import type { ModalShell } from './useModalShell'
import '../vu_styles/Dialog.css'

export interface DialogFrameProps {
  id: string
  /** Drawn by the screen that raised this — a portal inherits neither palette nor state rules. */
  theme: 'day' | 'night'
  /** `alertdialog` where the panel is reporting a failure, `dialog` where it is asking. */
  role: 'dialog' | 'alertdialog'
  ariaLabel: string
  /** The dimming's handlers, from the caller's own `useModalShell`. */
  overlayProps: ModalShell['overlayProps']
  title: string
  /** The code the failure happened under, where the panel has one. */
  code?: string
  /** What the panel says: the message, and any detail under it. */
  children: ReactNode
  /** The answers, in the order the foot offers them. */
  foot: ReactNode
}

/**
 * The frame both small panels wear: the dimming, the badge, the head and the foot. The
 * caller keeps its own shell and portals this into the host it was handed.
 */
export function DialogFrame({
  id,
  theme,
  role,
  ariaLabel,
  overlayProps,
  title,
  code,
  children,
  foot
}: DialogFrameProps): JSX.Element {
  return (
    <motion.div
      className="vu-veil"
      data-theme={theme}
      variants={veilIn}
      initial="hidden"
      animate="shown"
      exit="gone"
      {...overlayProps}
    >
      <motion.div
        id={id}
        className="vu-dialog vu-paper"
        role={role}
        aria-modal="true"
        aria-label={ariaLabel}
        variants={panelIn}
      >
        <span className="vu-dialog-badge vu-arch vu-paper" aria-hidden="true">
          !
        </span>

        <div className="vu-dialog-head">
          <h2 className="vu-dialog-title">{title}</h2>
          {code !== undefined && <span className="vu-dialog-code">CODE: {code}</span>}
        </div>
        {children}

        <div className="vu-foot vu-dialog-foot">{foot}</div>
      </motion.div>
    </motion.div>
  )
}
