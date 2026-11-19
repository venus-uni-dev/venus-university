/**
 * The player's own notes on one character, written from her contact page: one free-text well
 * whose saved words close her entry in every prompt that describes her in full.
 */
import { useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'

import { ConfirmModal } from '../components/ConfirmModal'
import { TextField } from '../components/TextField'
import { TitleTab } from '../components/TitleTab'
import { useModalShell } from '../components/useModalShell'
import { useGameStore } from '../stores/gameStore'
import type { ScreenTheme } from './clockTheme'
import { gestures, lift, panelUnderTab, press, quietLift, quietPress, veilIn } from './motion'
import '../vu_styles/CharacterNotes.css'

/** What the notes well says under its label, wherever the player writes her notes. */
export const NOTES_HINT =
  "The below text will be injected into the character's info in prompts. Use third person and address yourself as 'the reader'."

export interface CharacterNotesModalProps {
  /** Drawn by the screen that opened this — a portal inherits no palette. */
  theme: ScreenTheme
  /** Whose notes they are. */
  charId: string
  onClose: () => void
}

/** The Character notes panel: the well, then Cancel and Save. */
export function CharacterNotesModal({
  theme,
  charId,
  onClose
}: CharacterNotesModalProps): JSX.Element | null {
  const stored = useGameStore((s) => s.charInfo[charId]?.notes) ?? ''
  const [text, setText] = useState(stored)
  // The gate in front of leaving with the well not matching what is kept.
  const [closing, setClosing] = useState(false)

  /** The gate in front of leaving, asked on Cancel, on Escape and on an outside click alike. */
  function requestClose(): void {
    if (text.trim() !== stored) setClosing(true)
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
          id="char-notes"
          className="vu-charnotes vu-paper"
          role="dialog"
          aria-modal="true"
          aria-label="Character notes"
          variants={panelUnderTab}
          // Enter is a line break in the well, and nothing behind the panel answers it as well.
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.stopPropagation()
          }}
        >
          <TitleTab>Character notes</TitleTab>

          <TextField
            id="char-notes-text"
            label="Notes"
            hint={NOTES_HINT}
            value={text}
            onChange={setText}
            multiline
            autoFocus
          />

          <div className="vu-foot">
            <motion.button
              id="char-notes-cancel"
              className="vu-btn vu-btn--quiet"
              type="button"
              {...gestures(false, quietLift, quietPress)}
              onClick={requestClose}
            >
              Cancel
            </motion.button>
            <motion.button
              id="char-notes-save"
              className="vu-btn vu-btn--primary vu-btn--panel vu-paper"
              type="button"
              {...gestures(false, lift, press)}
              onClick={() => {
                useGameStore.getState().setCharNotes(charId, text)
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
            id="char-notes-discard"
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
