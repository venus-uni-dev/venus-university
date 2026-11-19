/**
 * What one girl remembers of the reader from before the semester, edited on New Game's Profiles
 * screen: a sentence per memory with its day, a row to add another, and the disposition they set
 * her at as the semester opens, worked out as they change. Every row is already an answer.
 */
import { useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'

import {
  emptyGirl,
  START_DATE_DEFAULT,
  START_DATE_FIRST,
  START_DATE_LAST,
  startDispositionOf,
  withGirlChanged,
  type ApplicationGirl
} from '@shared/application'
import { genderOf } from '@shared/gender'
import { DISPOSITION_LABELS } from '@shared/relationship'
import type { Character, CharMemory, Gender, Season } from '@shared/types'
import { DeleteX } from '../components/DeleteX'
import { MemoryRow } from '../components/MemoryRow'
import { TitleTab } from '../components/TitleTab'
import { useModalShell } from '../components/useModalShell'
import { formatShortGameDate } from '../prompts/gameDate'
import {
  updateApplication,
  useApplicationStore,
  useMasked
} from '../stores/applicationStore'
import { UNKNOWN_NAME } from '../stores/gameStore'
import type { ScreenTheme } from './clockTheme'
import { DatePickerModal } from './DatePickerModal'
import { gestures, lift, panelUnderTab, press, quietLift, quietPress, veilIn } from './motion'
import '../vu_styles/MemoryEdit.css'
import '../vu_styles/NewGameProfiles.css'

/** Her disposition as the semester opens it, as a reading, or null for one he has not met. */
export function startReadingOf(girl: ApplicationGirl, character: Character): string | null {
  const disposition = startDispositionOf(girl, character)
  return disposition ? DISPOSITION_LABELS[disposition] : null
}

/** Writes her memories into the application through `change`. */
function changeMemories(charId: string, change: (memories: CharMemory[]) => CharMemory[]): void {
  updateApplication((draft) => {
    const girls = withGirlChanged(draft.girls, charId, (girl) => {
      const memories = change(girl.memories)
      return memories === girl.memories ? girl : { ...girl, memories }
    })
    return girls === draft.girls ? draft : { ...draft, girls }
  })
}

/** One memory's row, its ✕ revealed by the row's own hover. */
function MemoryLine({
  charId,
  name,
  gender,
  masked,
  index,
  memory,
  season,
  onDate
}: {
  charId: string
  name: string
  /** The gender of the one who remembers it. */
  gender: Gender
  masked: boolean
  index: number
  memory: CharMemory
  /** The application's season, which her days are read in. */
  season: Season
  onDate: () => void
}): JSX.Element {
  const [hover, setHover] = useState(false)
  const edit = (patch: Partial<CharMemory>): void =>
    changeMemories(charId, (memories) =>
      memories.map((entry, at) => (at === index ? { ...entry, ...patch } : entry))
    )
  return (
    <div
      className="vu-startmem-line"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <MemoryRow
        id={`start-memory-${index}`}
        name={name}
        gender={gender}
        faceOf={charId}
        masked={masked}
        type={memory.type}
        desc={memory.desc}
        onType={(type) => edit({ type })}
        onDesc={(desc) => edit({ desc })}
        trailing={
          <motion.button
            id={`start-memory-${index}-date`}
            className="vu-pill vu-startmem-date"
            type="button"
            aria-label="When it happened"
            {...gestures(false, quietLift, quietPress)}
            onClick={onDate}
          >
            {formatShortGameDate(memory.date, season)}
          </motion.button>
        }
      />
      <DeleteX
        className="vu-x vu-startmem-x"
        hovered={hover}
        label="Delete memory"
        onDelete={() => changeMemories(charId, (memories) => memories.filter((_, at) => at !== index))}
      />
    </div>
  )
}

export interface StartMemoriesModalProps {
  /** Drawn by the screen that opened this — a portal inherits no palette. */
  theme: ScreenTheme
  character: Character
  onClose: () => void
}

/** The memories panel: her rows, Add memory, the disposition they set, and Done. */
export function StartMemoriesModal({
  theme,
  character,
  onClose
}: StartMemoriesModalProps): JSX.Element | null {
  const charId = character.charId
  const stored = useApplicationStore((s) => s.application?.girls[charId])
  const season = useApplicationStore((s) => s.application?.season ?? 'spring')
  const girl: ApplicationGirl = stored ?? emptyGirl()
  const hidden = useMasked().has(charId)
  const name = hidden ? UNKNOWN_NAME : character.firstName
  // The row whose day is being picked.
  const [dating, setDating] = useState<number | null>(null)

  /** Done, Escape and a click on the dimming alike: a row left without words is dropped. */
  const close = (): void => {
    changeMemories(charId, (memories) =>
      memories.every((entry) => entry.desc.trim() !== '')
        ? memories
        : memories.filter((entry) => entry.desc.trim() !== '')
    )
    onClose()
  }
  const { host, overlayProps, primaryProps } = useModalShell(close, 'panel', close)

  if (!host) return null

  const disposition = startReadingOf(girl, character)
  const pickedDate = dating !== null ? girl.memories[dating]?.date : undefined

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
          id="start-memories"
          className="vu-memedit vu-paper"
          role="dialog"
          aria-modal="true"
          aria-label={`${name}'s memories`}
          variants={panelUnderTab}
          onSubmit={(event) => {
            event.preventDefault()
            close()
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.stopPropagation()
          }}
          {...primaryProps}
        >
          <TitleTab>Memories</TitleTab>

          <p className="vu-note-text">
            Use past tense and refer to yourself as “the reader”.
          </p>
          <p className="vu-field-hint">
            A memory from the last week contributes to disposition twice as much as one from the last month, and four
            times as much as anything older.
          </p>

          <div className="vu-scroll-box">
            <div className="vu-memedit-rows">
              {girl.memories.length === 0 ? (
                <p className="vu-empty vu-empty--flush">No memories yet.</p>
              ) : (
                girl.memories.map((memory, index) => (
                  <MemoryLine
                    key={index}
                    charId={charId}
                    name={name}
                    gender={genderOf(character)}
                    masked={hidden}
                    index={index}
                    memory={memory}
                    season={season}
                    onDate={() => setDating(index)}
                  />
                ))
              )}
            </div>
            <div className="vu-scroll-fade" />
          </div>

          <div className="vu-startmem-tools">
            <motion.button
              id="start-memories-add"
              className="vu-pill"
              type="button"
              {...gestures(false, quietLift, quietPress)}
              onClick={() =>
                changeMemories(charId, (memories) => [
                  ...memories,
                  { date: START_DATE_DEFAULT, type: 'liked', desc: '' }
                ])
              }
            >
              Add memory
            </motion.button>
            <span className="vu-field-label">Disposition</span>
            <span id="start-memories-disposition" className="vu-profile-reading vu-profile-reading--on">
              {disposition ?? 'Not met'}
            </span>
          </div>

          {/* Every row is already an answer, so the foot carries one and no cancel. */}
          <div className="vu-foot">
            <motion.button
              id="start-memories-done"
              className="vu-btn vu-btn--primary vu-btn--panel vu-paper"
              type="submit"
              {...gestures(false, lift, press)}
            >
              Done
            </motion.button>
          </div>
        </motion.form>
      </motion.div>

      {/* Sibling of the veil, not a child: the picker leaves when this panel does. */}
      <AnimatePresence propagate>
        {dating !== null && pickedDate !== undefined && (
          <DatePickerModal
            key="date"
            theme={theme}
            id="start-memory-date-picker"
            date={pickedDate}
            first={START_DATE_FIRST}
            last={START_DATE_LAST}
            season={season}
            onPick={(date) =>
              changeMemories(charId, (memories) =>
                memories.map((entry, at) => (at === dating ? { ...entry, date } : entry))
              )
            }
            onClose={() => setDating(null)}
          />
        )}
      </AnimatePresence>
    </>,
    host
  )
}
