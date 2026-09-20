import { useEffect, useState, type JSX, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { noteIn } from '../views/motion'
import '../vu_styles/DeadNote.css'

export interface DeadNoteProps {
  /** What a hover raises over the control, or `null` where there is nothing to say. */
  note: string | null
  /** Where the pill hangs: off the wrapper's left edge, or centred over it. */
  align?: 'left' | 'center'
  /** Hangs the pill under the control instead of over it, for one sitting under a panel's tab. */
  below?: boolean
  children: ReactNode
}

/**
 * The label a hover raises over a control, and the wrapper that hears the pointer for it. Chrome
 * delivers `pointerenter`/`pointerleave` for a disabled button to its *parent*, so the wrapper
 * hears the hand instead; the hover drops the moment the note does.
 */
export function DeadNote({
  note,
  align = 'left',
  below = false,
  children
}: DeadNoteProps): JSX.Element {
  const [hover, setHover] = useState(false)
  useEffect(() => {
    if (note === null) setHover(false)
  }, [note])

  const centred = align === 'center' ? ' vu-deadnote-pill--center' : ''
  const under = below ? ' vu-deadnote-pill--below' : ''

  // The wrapper is rendered whether or not there is a note, so layout never moves with the gate.
  return (
    <div
      className="vu-deadnote"
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
    >
      {children}
      <AnimatePresence>
        {note !== null && hover && (
          <motion.span
            key="note"
            className={`vu-deadnote-pill${centred}${under}`}
            variants={noteIn}
            initial="hidden"
            animate="shown"
            exit="gone"
          >
            {note}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  )
}
