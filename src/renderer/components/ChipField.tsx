import { useState, type JSX } from 'react'
import { motion } from 'motion/react'
import { gestures, quietLift, quietPress } from '../views/motion'
import { CheckIcon, CopyIcon } from '../views/screenIcons'
import { ChipListInput } from './ChipListInput'

/** One modal's copy marks: which of its wells was copied last, and the copy itself. */
export interface CopyMark {
  copiedId: string | null
  copy: (id: string, values: readonly string[]) => void
}

/**
 * The copy marks of one modal. Only the last well copied wears the check, so a second copy
 * moves it, and the modal unmounting forgets it.
 */
export function useCopyMark(): CopyMark {
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const copy = (id: string, values: readonly string[]): void => {
    // Joined as a well splits a paste, so the text lands back as the same tags.
    void navigator.clipboard.writeText(values.join(', ')).then(
      () => setCopiedId(id),
      // Clipboard permission can be refused.
      () => setCopiedId(null)
    )
  }
  return { copiedId, copy }
}

export interface ChipFieldProps {
  id: string
  /** The mono label over the well; the copy mark names the well by it. */
  label: string
  /** The one line of body text under the label saying what shape the tags want. */
  hint?: string
  values: readonly string[]
  onChange: (values: string[]) => void
  placeholder?: string
  /** Takes focus when the well mounts — a form modal's first field. */
  autoFocus?: boolean
  /** The modal's copy marks, which this well's mark reads and writes. */
  mark: CopyMark
  /** Hears the half-typed text after every keystroke, so a caller can commit it without a blur. */
  onDraft?: (text: string) => void
}

/** A labelled chip well, its label followed by the mark that copies its tags while it holds any. */
export function ChipField({
  id,
  label,
  hint,
  values,
  onChange,
  placeholder,
  autoFocus,
  mark,
  onDraft
}: ChipFieldProps): JSX.Element {
  const copied = mark.copiedId === id

  return (
    <label className="vu-field" htmlFor={id}>
      <span className="vu-field-head">
        <span className="vu-field-label">{label}</span>
        {values.length > 0 && (
          <motion.button
            className={`vu-field-copy${copied ? ' vu-field-copy--done' : ''}`}
            type="button"
            aria-label={`Copy ${label} tags`}
            {...gestures(false, quietLift, quietPress)}
            onClick={() => mark.copy(id, values)}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </motion.button>
        )}
      </span>
      {hint && <span className="vu-field-hint">{hint}</span>}
      <ChipListInput
        id={id}
        values={values}
        onChange={onChange}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onDraft={onDraft}
      />
    </label>
  )
}
