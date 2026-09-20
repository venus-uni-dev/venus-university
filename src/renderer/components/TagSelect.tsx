import type { JSX } from 'react'

interface TagSelectOption {
  value: string
  label: string
}

export interface TagSelectProps {
  id: string
  values: readonly string[]
  options: readonly TagSelectOption[]
  onChange: (values: string[]) => void
  /** What the unopened dropdown says, e.g. `"Add a trait…"`. */
  placeholder?: string
}

/**
 * A closed-vocabulary multi-select: picked values are chips with an `×`, and what has not
 * been picked is a dropdown that appends. Chips and picker are `ChipListInput`'s and
 * `SelectField`'s shapes, so the two read as one family.
 */
export function TagSelect({
  id,
  values,
  options,
  onChange,
  placeholder
}: TagSelectProps): JSX.Element {
  const remaining = options.filter((option) => !values.includes(option.value))

  const labelOf = (value: string): string =>
    options.find((option) => option.value === value)?.label ?? value

  return (
    <div className="vu-chips vu-chips--picked">
      {values.map((value) => (
        <span key={value} className="vu-chip-tag">
          {labelOf(value)}
          <button
            className="vu-chip-x"
            type="button"
            aria-label={`Remove ${labelOf(value)}`}
            onClick={() => onChange(values.filter((entry) => entry !== value))}
          >
            ×
          </button>
        </span>
      ))}
      {/* Hidden once every option is picked. */}
      {remaining.length > 0 && (
        <span className="vu-chips-pick">
        <select
          id={id}
          className="vu-input vu-select vu-chips-picker"
          value=""
          onChange={(event) => onChange([...values, event.target.value])}
        >
          <option value="" disabled>
            {placeholder ?? 'Add…'}
          </option>
          {remaining.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        </span>
      )}
    </div>
  )
}
