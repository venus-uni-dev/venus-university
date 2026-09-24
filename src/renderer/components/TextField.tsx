import { useRef, type JSX } from 'react'
import { useFitToText } from './useFitToText'

export interface TextFieldProps {
  id: string
  /** The mono label over the box; it is also what the field is called to a screen reader. */
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  /** The one line of body text under the label saying what shape the field wants. */
  hint?: string
  /** Caps how much the field takes, single-line or multiline; a name is 32. */
  maxLength?: number
  /** Fires when a single-line field is left, for whatever its value has to be checked against. */
  onBlur?: () => void
  multiline?: boolean
  rows?: number
  /** Grow the box to fit its text. */
  autoGrow?: boolean
  /** Takes focus when the field mounts — a form modal's first field. */
  autoFocus?: boolean
}

/**
 * A labelled text field: pill single-line, rounded box multiline. The layout is `base.css`'s,
 * shared by every form.
 */
export function TextField({
  id,
  label,
  value,
  onChange,
  placeholder,
  hint,
  maxLength,
  onBlur,
  multiline,
  rows = 3,
  autoGrow,
  autoFocus
}: TextFieldProps): JSX.Element {
  const area = useRef<HTMLTextAreaElement | null>(null)

  useFitToText(area, value, autoGrow ?? false)

  return (
    <label className="vu-field" htmlFor={id}>
      <span className="vu-field-label">{label}</span>
      {hint && <span className="vu-field-hint">{hint}</span>}
      {multiline ? (
        <textarea
          ref={area}
          id={id}
          className={`vu-input vu-input--multiline${autoGrow ? ' vu-input--grow' : ''}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={rows}
          maxLength={maxLength}
          autoFocus={autoFocus}
        />
      ) : (
        <input
          id={id}
          type="text"
          className="vu-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          maxLength={maxLength}
          onBlur={onBlur}
          autoFocus={autoFocus}
        />
      )}
    </label>
  )
}
