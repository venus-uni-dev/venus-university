import type { JSX } from 'react'

interface SelectFieldOption {
  value: string
  label: string
}

export interface SelectFieldProps {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  options: readonly SelectFieldOption[]
  /** The body-text line under the label saying what the choice means. */
  hint?: string
}

/**
 * A labelled closed picker in the final design — {@link TextField}'s sibling, and the
 * shape `TagSelect`'s own dropdown wears.
 */
export function SelectField({
  id,
  label,
  value,
  onChange,
  options,
  hint
}: SelectFieldProps): JSX.Element {
  return (
    <label className="vu-field" htmlFor={id}>
      <span className="vu-field-label">{label}</span>
      {hint && <span className="vu-field-hint">{hint}</span>}
      <select
        id={id}
        className="vu-input vu-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}
