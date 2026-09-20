/**
 * The line the reader says as he hands a present over. **Wearing the final design**:
 * no mock, so it is the form modals' own frame with one field in it — and, like every one of
 * them, a placeholder here is a real value, so a blank field sends the words shown.
 */
import { useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'

import { useModalShell } from '../components/useModalShell'
import { TextField } from '../components/TextField'
import { TitleTab } from '../components/TitleTab'
import type { ScreenTheme } from './clockTheme'
import { gestures, lift, panelUnderTab, press, quietLift, quietPress, veilIn } from './motion'
import '../vu_styles/Gift.css'

/** What the reader says when he says nothing — sent verbatim, not as a blank. */
const DEFAULT_GIFT_MESSAGE = 'I got you this.'

export interface GiftMessageModalProps {
  /** Drawn by the screen that opened this — a portal inherits no palette. */
  theme: ScreenTheme
  /** Who is being given to, for the answer's own words — already nameable to the reader. */
  firstName: string
  onSend: (message: string) => void
  onClose: () => void
}

export function GiftMessageModal({
  theme,
  firstName,
  onSend,
  onClose
}: GiftMessageModalProps): JSX.Element | null {
  const [message, setMessage] = useState('')
  const { host, overlayProps } = useModalShell(onClose)

  if (!host) return null

  return createPortal(
    <motion.div
      className="vu-veil"
      data-theme={theme}
      variants={veilIn}
      initial="hidden"
      animate="shown"
      exit="gone"
      {...overlayProps}
    >
      <motion.form
        id="gift-message"
        className="vu-giftsay vu-paper"
        role="dialog"
        aria-modal="true"
        aria-label="Send a message with your gift?"
        variants={panelUnderTab}
        // A form, so Enter in the field is the answer the foot gives.
        onSubmit={(event) => {
          event.preventDefault()
          onSend(message.trim() || DEFAULT_GIFT_MESSAGE)
        }}
        // And the scene behind this never sees that key: the window-level Enter advances a
        // line, and one answered here is not also answered there.
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.stopPropagation()
        }}
      >
        <TitleTab>Send a message with your gift?</TitleTab>
        
        {/* Focus lands on the field, which is what a form dialog opens on. */}
        <TextField
          id="gift-message-text"
          label="Your message"
          value={message}
          onChange={setMessage}
          placeholder={DEFAULT_GIFT_MESSAGE}
          maxLength={200}
          autoFocus
        />

        {/* **Dismiss is a cancel here**, unlike the reader's own name: nothing has been spent
            yet, and backing out of a handover costs him the item he was about to give. */}
        <div className="vu-foot">
          <motion.button
            id="gift-message-cancel"
            className="vu-btn vu-btn--quiet"
            type="button"
            {...gestures(false, quietLift, quietPress)}
            onClick={onClose}
          >
            Cancel
          </motion.button>
          <motion.button
            id="gift-message-send"
            className="vu-btn vu-btn--primary vu-btn--panel vu-paper"
            type="submit"
            {...gestures(false, lift, press)}
          >
            Give it to {firstName}
          </motion.button>
        </div>
      </motion.form>
    </motion.div>,
    host
  )
}
