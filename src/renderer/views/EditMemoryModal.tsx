/**
 * One memory a character holds, rewritten from her contact page: the sentence it is read as,
 * with a picker for how she remembers it and a field for what. Saving files the new verb and
 * words over every copy she holds, on the same date.
 */
import { useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'

import { storedMemoryDesc } from '@shared/readerVoice'
import type { CharMemory } from '@shared/types'
import { MemoryRow } from '../components/MemoryRow'
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
  const [type, setType] = useState(memory.type)
  // Opens in the reader's voice, the one it is filed in, whichever voice it was written in.
  const [desc, setDesc] = useState(() => storedMemoryDesc(memory.desc))
  const blank = desc.trim() === ''
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
        id="edit-memory"
        className="vu-memedit vu-memedit--one vu-paper"
        role="dialog"
        aria-modal="true"
        aria-label="Edit memory"
        variants={panelUnderTab}
        // A form, so Enter in the field is Save; a blank line saves nothing.
        onSubmit={(event) => {
          event.preventDefault()
          if (blank) return
          useGameStore
            .getState()
            .replaceMemory(charId, memory, { date: memory.date, type, desc: storedMemoryDesc(desc) })
          onClose()
        }}
        // The key stops here, so no listener behind the panel answers it as well.
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.stopPropagation()
        }}
      >
        <TitleTab>Edit memory</TitleTab>

        <MemoryRow
          id="edit-memory-row"
          name={name}
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
            onClick={onClose}
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
    </motion.div>,
    host
  )
}
