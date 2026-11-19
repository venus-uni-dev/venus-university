import { useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'
import { ROMANCE_LEVELS as LEVELS } from '@shared/relationship'
import type { Gender, RomanceLevel, RomanceSetting } from '@shared/types'
import { StepSquare } from '../components/StepSquare'
import { TitleTab } from '../components/TitleTab'
import { useModalShell } from '../components/useModalShell'
import { gestures, lift, panelUnderTab, press, veilIn } from './motion'
import '../vu_styles/CharacterHeight.css'

export interface RomanceModalProps {
  theme: 'day' | 'night'
  /** The answer the steppers open on: the last one given, or the default. */
  initial: RomanceSetting
  onConfirm: (romance: RomanceSetting) => void
}

/** Each level as the stepper names it. */
const LEVEL_LABELS: Record<RomanceLevel, string> = {
  none: 'Not attracted to MC',
  sexuality: 'Follow sexuality',
  all: 'All attracted to MC',
  everyone: 'All attracted to all'
}

/** The two rows, female characters first. */
const ROWS: readonly { gender: Gender; label: string }[] = [
  { gender: 'female', label: 'Female characters' },
  { gender: 'male', label: 'Male characters' }
]

/**
 * Asks how each gender takes to the reader in the playthrough: a first semester's New Game
 * question, asked after the voices, on the note panel. **Dismissing it is confirming it**, as
 * the voices' is.
 */
export function RomanceModal({ theme, initial, onConfirm }: RomanceModalProps): JSX.Element | null {
  const [romance, setRomance] = useState<RomanceSetting>(initial)

  const { host, overlayProps } = useModalShell(() => onConfirm(romance))
  if (!host) return null

  const step = (gender: Gender, delta: -1 | 1): void =>
    setRomance((prev) => {
      const at = LEVELS.indexOf(prev[gender]) + delta
      return at < 0 || at >= LEVELS.length ? prev : { ...prev, [gender]: LEVELS[at] }
    })

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
      <motion.div
        id="romance-settings"
        className="vu-note vu-paper"
        role="dialog"
        aria-modal="true"
        aria-label="Romance"
        variants={panelUnderTab}
      >
        <TitleTab>Romance</TitleTab>

        {ROWS.map(({ gender, label }) => {
          const at = LEVELS.indexOf(romance[gender])
          return (
            <div className="vu-romance-row" key={gender}>
              <span className="vu-romance-label">{label}</span>
              <StepSquare
                id={`romance-${gender}-prev`}
                label={`Previous setting for ${label.toLowerCase()}`}
                dead={at <= 0}
                back
                onStep={() => step(gender, -1)}
              />
              <span className="vu-romance-level" id={`romance-${gender}`}>
                {LEVEL_LABELS[romance[gender]]}
              </span>
              <StepSquare
                id={`romance-${gender}-next`}
                label={`Next setting for ${label.toLowerCase()}`}
                dead={at >= LEVELS.length - 1}
                onStep={() => step(gender, 1)}
              />
            </div>
          )
        })}

        <p className="vu-heights-note">
          This setting determines who characters will interact with romantically. 
        </p>

        <div className="vu-foot">
          <motion.button
            id="romance-confirm"
            className="vu-btn vu-btn--primary vu-paper vu-btn--panel"
            type="button"
            {...gestures(false, lift, press)}
            onClick={() => onConfirm(romance)}
          >
            Save
          </motion.button>
        </div>
      </motion.div>
    </motion.div>,
    host
  )
}
