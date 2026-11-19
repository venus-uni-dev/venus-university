/**
 * One paragraph written for a Scene Creator scene: a girl's notes, closing her entry in the
 * scene's prompts as a contact page's notes do. The Character notes panel's frame.
 */
import { useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'

import { ConfirmModal } from '../components/ConfirmModal'
import { TextField } from '../components/TextField'
import { TitleTab } from '../components/TitleTab'
import { useModalShell } from '../components/useModalShell'
import type { ScreenTheme } from './clockTheme'
import { gestures, lift, panelUnderTab, press, quietLift, quietPress, veilIn } from './motion'
import '../vu_styles/CharacterNotes.css'

export interface SceneNotesModalProps {
  /** Drawn by the screen that opened this — a portal inherits no palette. */
  theme: ScreenTheme
  /** Whose notes they are, by first name. */
  name: string
  value: string
  onSave: (value: string) => void
  onClose: () => void
}

/** The notes panel: the well, then Cancel and Save. */
export function SceneNotesModal({
  theme,
  name,
  value,
  onSave,
  onClose
}: SceneNotesModalProps): JSX.Element | null {
  const [text, setText] = useState(value)
  // The gate in front of leaving with the well not matching what is kept.
  const [closing, setClosing] = useState(false)

  /** The gate in front of leaving, asked on Cancel, on Escape and on an outside click alike. */
  function requestClose(): void {
    if (text.trim() !== value.trim()) setClosing(true)
    else onClose()
  }

  const { host, overlayProps } = useModalShell(requestClose)
  if (!host) return null

  return createPortal(
    <>
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
          id="scene-notes"
          className="vu-charnotes vu-paper"
          role="dialog"
          aria-modal="true"
          aria-label={`Notes on ${name}`}
          variants={panelUnderTab}
          // Enter is a line break in the well, and nothing behind the panel answers it as well.
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.stopPropagation()
          }}
        >
          <TitleTab>{`Notes on ${name}`}</TitleTab>

          <TextField
            id="scene-notes-text"
            label="Notes"
            hint="Add any other relevant information to the scene: school year, memories, mood, etc."
            value={text}
            onChange={setText}
            multiline
            autoFocus
          />

          <div className="vu-foot">
            <motion.button
              id="scene-notes-cancel"
              className="vu-btn vu-btn--quiet"
              type="button"
              {...gestures(false, quietLift, quietPress)}
              onClick={requestClose}
            >
              Cancel
            </motion.button>
            <motion.button
              id="scene-notes-save"
              className="vu-btn vu-btn--primary vu-btn--panel vu-paper"
              type="button"
              {...gestures(false, lift, press)}
              onClick={() => {
                onSave(text.trim())
                onClose()
              }}
            >
              Save
            </motion.button>
          </div>
        </motion.div>
      </motion.div>

      {/* Sibling of the veil, not a child: the confirm leaves when this panel does. */}
      <AnimatePresence propagate>
        {closing && (
          <ConfirmModal
            key="discard"
            id="scene-notes-discard"
            theme={theme}
            title="Discard changes?"
            message="Your notes have not been saved."
            confirmText="Discard changes"
            cancelText="Keep editing"
            // Taken down before the panel goes, so the two do not leave as one exiting child
            // rendered twice under the same key.
            onConfirm={() => {
              setClosing(false)
              onClose()
            }}
            onCancel={() => setClosing(false)}
          />
        )}
      </AnimatePresence>
    </>,
    host
  )
}
