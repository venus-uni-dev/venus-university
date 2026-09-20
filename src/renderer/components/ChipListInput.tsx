import { useState, type JSX, type KeyboardEvent } from 'react'

export interface ChipListInputProps {
  id: string
  values: readonly string[]
  onChange: (values: string[]) => void
  placeholder?: string
}

/** Turns typed text into a booru tag: trimmed, whitespace runs closed up into underscores. */
function tagOf(value: string): string {
  return value.trim().replace(/\s+/g, '_')
}

/**
 * An editable list of booru tags shown as chips; its styling is `vu_styles/base.css`'s,
 * with the rest of the final design's form controls.
 */
export function ChipListInput({
  id,
  values,
  onChange,
  placeholder
}: ChipListInputProps): JSX.Element {
  const [draft, setDraft] = useState('')

  /** Appends every tag in `text`, dropping blanks and ones already listed. */
  const commit = (text: string): void => {
    const added = text
      .split(',')
      .map(tagOf)
      .filter((tag) => tag.length > 0 && !values.includes(tag))
    // Deduped against itself too: "a, a" is one tag, by the same rule.
    const next = [...values]
    for (const tag of added) if (!next.includes(tag)) next.push(tag)
    if (next.length !== values.length) onChange(next)
  }

  /** A comma ends a tag: everything before the last one commits as the change lands. */
  const onDraft = (text: string): void => {
    if (!text.includes(',')) {
      setDraft(text)
      return
    }
    const parts = text.split(',')
    // The tail is whatever follows the last comma — still being typed.
    const tail = parts.pop() ?? ''
    commit(parts.join(','))
    setDraft(tail)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      // Committing a tag must not also submit the surrounding form.
      event.preventDefault()
      commit(draft)
      setDraft('')
      return
    }
    // Backspace on an empty field takes the last chip back.
    if (event.key === 'Backspace' && draft.length === 0 && values.length > 0) {
      onChange(values.slice(0, -1))
    }
  }

  const remove = (tag: string): void => onChange(values.filter((entry) => entry !== tag))

  return (
    <div className="vu-chips">
      {values.map((tag) => (
        <span key={tag} className="vu-chip-tag">
          {tag}
          <button
            className="vu-chip-x"
            type="button"
            aria-label={`Remove ${tag}`}
            onClick={() => remove(tag)}
          >
            ×
          </button>
        </span>
      ))}
      <input
        id={id}
        type="text"
        className="vu-chips-draft"
        value={draft}
        placeholder={values.length === 0 ? placeholder : undefined}
        onChange={(e) => onDraft(e.target.value)}
        onKeyDown={onKeyDown}
        // Commits a half-typed tag on blur, so a Save click does not lose it.
        onBlur={() => {
          commit(draft)
          setDraft('')
        }}
      />
    </div>
  )
}
