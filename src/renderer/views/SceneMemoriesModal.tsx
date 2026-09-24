/**
 * The boundary's memory question, asked over the curtain once it is down: a row for each memory
 * the ledger filed for somebody in the scene and a blank one for each girl it gave nothing, every
 * row an editable sentence. Every value is already an answer, so a dismissal commits as Save does.
 */
import { useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'

import { MemoryRow } from '../components/MemoryRow'
import { useModalShell } from '../components/useModalShell'
import { TitleTab } from '../components/TitleTab'
import { UNKNOWN_NAME, useGameStore } from '../stores/gameStore'
import type { MemoryAnswer, MemoryEditRow } from '../stores/loop/memoryEdit'
import type { ScreenTheme } from './clockTheme'
import { gestures, lift, panelUnderTab, press, veilIn } from './motion'
import '../vu_styles/MemoryEdit.css'

export interface SceneMemoriesModalProps {
  /** The finished slot's half, the curtain's own colour — a portal inherits no palette. */
  theme: ScreenTheme
  /** The question's rows, in the order the answers are handed back. */
  rows: readonly MemoryEditRow[]
  /** The one answer: Save, Escape and a click on the dimming alike. */
  onSave: (answers: readonly MemoryAnswer[]) => void
}

export function SceneMemoriesModal({
  theme,
  rows,
  onSave
}: SceneMemoriesModalProps): JSX.Element | null {
  const characters = useGameStore((s) => s.characters)
  const charInfo = useGameStore((s) => s.charInfo)
  // Each row opens on the memory the ledger filed, or on a blank sentence where it filed none.
  const [drafts, setDrafts] = useState<MemoryAnswer[]>(() =>
    rows.map((row) => ({ type: row.applied?.type ?? 'liked', desc: row.applied?.desc ?? '' }))
  )
  // The shell reads its close at the moment it fires, so a dismissal commits the latest drafts.
  const { host, overlayProps } = useModalShell(() => onSave(drafts))

  /** Writes one row's verb or words, leaving the others as they stand. */
  function edit(index: number, change: Partial<MemoryAnswer>): void {
    setDrafts((was) => was.map((draft, at) => (at === index ? { ...draft, ...change } : draft)))
  }

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
        id="scene-memories"
        className="vu-memedit vu-paper"
        role="dialog"
        aria-modal="true"
        aria-label="Edit memories?"
        variants={panelUnderTab}
        // A form, so Enter in any field is the answer the foot gives.
        onSubmit={(event) => {
          event.preventDefault()
          onSave(drafts)
        }}
        // And the screen behind this never sees that key.
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.stopPropagation()
        }}
      >
        <TitleTab>Edit memories?</TitleTab>

        <p className="vu-note-text">
          Add anything else the characters should remember after this scene. Keep it short and
          include only important things to avoid context bloat, since this is injected in every
          scene the character is in. Use past-tense and refer to yourself as “the reader”.
        </p>

        <div className="vu-scroll-box">
          <div className="vu-memedit-rows">
            {rows.map((row, index) => {
              const draft = drafts[index]
              // Masked as the name box masks a speaker.
              const name = charInfo[row.charId]?.nameKnown
                ? (characters[row.charId]?.firstName ?? UNKNOWN_NAME)
                : UNKNOWN_NAME
              return (
                <MemoryRow
                  key={`${row.charId}-${index}`}
                  id={`memedit-${row.charId}-${index}`}
                  name={name}
                  faceOf={row.charId}
                  type={draft.type}
                  desc={draft.desc}
                  onType={(type) => edit(index, { type })}
                  onDesc={(desc) => edit(index, { desc })}
                  autoFocus={index === 0}
                />
              )
            })}
          </div>
          <div className="vu-scroll-fade" />
        </div>

        {/* Every row is already an answer, so the foot carries one and no cancel. */}
        <div className="vu-foot">
          <motion.button
            id="scene-memories-save"
            className="vu-btn vu-btn--primary vu-btn--panel vu-paper"
            type="submit"
            {...gestures(false, lift, press)}
          >
            Save
          </motion.button>
        </div>
      </motion.form>
    </motion.div>,
    host
  )
}
