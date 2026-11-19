/**
 * One memory a character holds, rewritten from her contact page: the sentence it is read as,
 * with a picker for how she remembers it and a field for what. Saving files the new verb and
 * words over every copy she holds, on the same date.
 */
import { useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'

import { genderOf } from '@shared/gender'
import { shownMemoryDesc, typedMemoryDesc } from '@shared/readerVoice'
import { rewordedMemory } from '@shared/relationship'
import type { CharMemory } from '@shared/types'
import { ConfirmModal } from '../components/ConfirmModal'
import { MemoryRow, memoryNameHint } from '../components/MemoryRow'
import { TitleTab } from '../components/TitleTab'
import { useModalShell } from '../components/useModalShell'
import { useGameStore } from '../stores/gameStore'
import type { ScreenTheme } from './clockTheme'
import { gestures, lift, panelUnderTab, press, quietLift, quietPress, veilIn } from './motion'
import '../vu_styles/MemoryEdit.css'

export interface EditMemoryModalProps {
  /** Drawn by the screen that opened this — a portal inherits no palette. */
  theme: ScreenTheme
  /** Whose memory it is. */
  charId: string
  /** Her first name, which opens the sentence. */
  name: string
  /** The memory as the contact page lists it — the date, verb and words a save matches on. */
  memory: CharMemory
  onClose: () => void
}

/** The Edit memory panel: her name, the verb, "that", the words, then Cancel and Save. */
export function EditMemoryModal({
  theme,
  charId,
  name,
  memory,
  onClose
}: EditMemoryModalProps): JSX.Element | null {
  const holder = genderOf(useGameStore((s) => s.characters[charId]))
  const pronouns = useGameStore((s) => s.playerPronouns)
  const readerName = useGameStore((s) => s.playerFirstName)
  const [type, setType] = useState(memory.type)
  // Opens as the contact page reads it, the reader by his name; kept to compare against.
  const [opened] = useState(() => shownMemoryDesc(memory.desc, readerName, holder, pronouns))
  const [desc, setDesc] = useState(opened)
  const blank = desc.trim() === ''
  // The gate in front of leaving with the verb or the words changed.
  const [closing, setClosing] = useState(false)

  /** The gate in front of leaving, asked on Cancel, on Escape and on an outside click alike. */
  function requestClose(): void {
    if (type !== memory.type || desc !== opened) setClosing(true)
    else onClose()
  }

  /**
   * Save: a blank line saves nothing; words left as they opened keep the filed desc exactly, and
   * new ones are filed with the reader's name back to "the reader".
   */
  function save(): void {
    if (blank) return
    const words =
      desc === opened ? memory.desc : typedMemoryDesc(desc, readerName, holder, pronouns)
    useGameStore.getState().replaceMemory(charId, memory, rewordedMemory(memory, type, words))
    onClose()
  }

  const { host, overlayProps, primaryProps } = useModalShell(requestClose, 'panel', save)

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
        <motion.form
          id="edit-memory"
          className="vu-memedit vu-memedit--one vu-paper"
          role="dialog"
          aria-modal="true"
          aria-label="Edit memory"
          variants={panelUnderTab}
          // A form, so Enter in the field is Save; the shell gives it to Enter and Space outside
          // the fields.
          onSubmit={(event) => {
            event.preventDefault()
            save()
          }}
          // The key stops here, so no listener behind the panel answers it as well.
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.stopPropagation()
          }}
          {...primaryProps}
        >
          <TitleTab>Edit memory</TitleTab>

          <p className="vu-note-text">{memoryNameHint(readerName)}</p>

          <MemoryRow
            id="edit-memory-row"
            name={name}
            gender={holder}
            type={type}
            desc={desc}
            onType={setType}
            onDesc={setDesc}
            autoFocus
          />

          {/* Dismissing is Cancel: nothing is filed until Save. */}
          <div className="vu-foot">
            <motion.button
              id="edit-memory-cancel"
              className="vu-btn vu-btn--quiet"
              type="button"
              {...gestures(false, quietLift, quietPress)}
              onClick={requestClose}
            >
              Cancel
            </motion.button>
            <motion.button
              id="edit-memory-save"
              className="vu-btn vu-btn--primary vu-btn--panel vu-paper"
              type="submit"
              disabled={blank}
              {...gestures(blank, lift, press)}
            >
              Save
            </motion.button>
          </div>
        </motion.form>
      </motion.div>

      {/* Sibling of the veil, not a child: the confirm leaves when this panel does. */}
      <AnimatePresence propagate>
        {closing && (
          <ConfirmModal
            key="discard"
            id="edit-memory-discard"
            theme={theme}
            title="Discard changes?"
            message="This memory has not been saved."
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
