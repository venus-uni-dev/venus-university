import { useState, type JSX, type KeyboardEvent } from 'react'

export interface ChipListInputProps {
  id: string
  values: readonly string[]
  onChange: (values: string[]) => void
  placeholder?: string
  /** Takes focus when the well mounts — a form modal's first field. */
  autoFocus?: boolean
  /**
   * Keeps each chip's spaces — trimmed, every run one space — rather than closing them up into
   * underscores, and drops a chip that differs from one already listed only in case.
   */
  phrases?: boolean
  /** Hears the half-typed text after every keystroke, so a caller can commit it without a blur. */
  onDraft?: (text: string) => void
}

/** Turns typed text into a booru tag: trimmed, whitespace runs closed up into underscores. */
function tagOf(value: string): string {
  return value.trim().replace(/\s+/g, '_')
}

/** Turns typed text into a phrase: trimmed, whitespace runs made one space. */
function phraseOf(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

/**
 * `values` with every tag in `text` appended, the way a well commits typed text: blanks and
 * ones already listed dropped, by the `phrases` rule where it is on.
 */
export function withTypedTags(
  values: readonly string[],
  text: string,
  phrases = false
): string[] {
  const clean = phrases ? phraseOf : tagOf
  // Two phrases differing only in case are one phrase.
  const key = (tag: string): string => (phrases ? tag.toLowerCase() : tag)
  // Deduped against itself too: "a, a" is one tag, by the same rule.
  const next = [...values]
  for (const tag of text.split(',').map(clean)) {
    if (tag.length > 0 && !next.some((value) => key(value) === key(tag))) next.push(tag)
  }
  return next
}

/**
 * An editable list of booru tags shown as chips; its styling is `vu_styles/base.css`'s,
 * with the rest of the final design's form controls.
 */
export function ChipListInput({
  id,
  values,
  onChange,
  placeholder,
  autoFocus,
  phrases,
  onDraft: heardDraft
}: ChipListInputProps): JSX.Element {
  const [draft, setDraftState] = useState('')

  /** Holds the draft and tells the caller what it now reads. */
  const setDraft = (text: string): void => {
    setDraftState(text)
    heardDraft?.(text)
  }

  /** Appends every tag in `text`, dropping blanks and ones already listed. */
  const commit = (text: string): void => {
    const next = withTypedTags(values, text, phrases)
    if (next.length !== values.length) onChange(next)
  }

  /** A comma ends a tag: everything before the last one commits as the change lands. */
  const onType = (text: string): void => {
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
        autoFocus={autoFocus}
        onChange={(e) => onType(e.target.value)}
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
