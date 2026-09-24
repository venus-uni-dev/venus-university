import type { JSX } from 'react'
import { motion } from 'motion/react'
import { fieldDim } from '../views/motion'

export interface CheckFieldProps {
  id: string
  label: string
  /** What the box costs, said in mono beside the label — a render count. */
  meta?: string
  /** What turning it on costs, in prose under the label rather than as an aside beside it. */
  note?: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}

/**
 * The rounded-square checkbox, label and all — the whole row is the hit target. The input itself
 * stays the control the browser focuses and the keyboard toggles; the box the player sees is
 * drawn beside it in CSS, since a native checkbox cannot take the accent fill the design asks for.
 */
export function CheckField({
  id,
  label,
  meta,
  note,
  checked,
  onChange,
  disabled
}: CheckFieldProps): JSX.Element {
  return (
    // The disabled rule in CSS reaches buttons alone, so the row dims itself here instead.
    <motion.label
      className={`vu-check${note ? ' vu-check--noted' : ''}`}
      htmlFor={id}
      variants={fieldDim}
      initial={false}
      animate={disabled ? 'dead' : 'live'}
    >
      <input
        id={id}
        type="checkbox"
        className="vu-check-input"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="vu-check-box" aria-hidden="true" />
      {note ? (
        <span className="vu-check-text">
          <span className="vu-check-label">{label}</span>
          <span className="vu-check-note">{note}</span>
        </span>
      ) : (
        <>
          <span className="vu-check-label">{label}</span>
          {meta && <span className="vu-check-meta">{meta}</span>}
        </>
      )}
    </motion.label>
  )
}
