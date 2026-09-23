import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent
} from 'react'
import { createPortal } from 'react-dom'
import { placeUnder } from './popupPlace'
import '../vu_styles/PopList.css'

export interface ComboFieldProps {
  id: string
  /** The mono label over the box; it is also what the field is called to a screen reader. */
  label: string
  /** The one line of body text under the label saying what shape the field wants. */
  hint?: string
  value: string
  onChange: (value: string) => void
  /** What the list offers; the field stays free text whether or not any of it arrived. */
  options: readonly string[]
  /** The row above the suggestions standing for no value at all, e.g. `"None"`. */
  emptyOption?: string
  /** Fires when the field is left, for whatever its value has to be checked against. */
  onBlur?: () => void
  /** The layer inside the panel the floating list is portalled into; `null` until it resolves. */
  popupHost: HTMLElement | null
  placeholder?: string
}

/** One row of the floating list: the value it picks and the words it shows. */
interface ComboRow {
  value: string
  label: string
}

/** The air between the box and the list hung under it. */
const GAP = 6

/** The rows a shown text offers: the empty row while nothing is typed, then what it matches. */
function rowsFor(shown: string, options: readonly string[], emptyOption?: string): ComboRow[] {
  const rows: ComboRow[] = []
  if (shown === '' && emptyOption !== undefined) rows.push({ value: '', label: emptyOption })
  const needle = shown.trim().toLowerCase()
  for (const option of options) {
    if (option.toLowerCase().includes(needle)) rows.push({ value: option, label: option })
  }
  return rows
}

/**
 * A text field with suggestions: the same box as {@link TextField}, wearing the select's caret
 * while it is empty and has something to offer, over a floating list inside the panel that
 * opened it. Entering the field empties it; leaving it empty takes the old value back.
 */
export function ComboField({
  id,
  label,
  hint,
  value,
  onChange,
  options,
  emptyOption,
  onBlur,
  popupHost,
  placeholder
}: ComboFieldProps): JSX.Element {
  const [draft, setDraft] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  // What the field had when it was entered, handed back if it is left with nothing in it.
  const restore = useRef('')
  const input = useRef<HTMLInputElement | null>(null)
  const pop = useRef<HTMLDivElement | null>(null)
  const list = useRef<HTMLDivElement | null>(null)

  const shown = draft ?? value
  const rows = rowsFor(shown, options, emptyOption)
  const showList = open && rows.length > 0 && popupHost !== null
  const listId = `${id}-list`

  /** Entering the field empties the box and offers everything, remembering what was there. */
  function handleFocus(): void {
    restore.current = value
    setDraft('')
    setActive(-1)
    setOpen(true)
  }

  /** A click into a field that already has the focus — after a pick — enters it again. */
  function handleClick(): void {
    if (!open) handleFocus()
  }

  /** Typing is the value: the field reports every keystroke and filters the list by it. */
  function handleChange(text: string): void {
    setDraft(text)
    setActive(-1)
    setOpen(true)
    onChange(text)
  }

  /** Takes a row: the id becomes the value and what an empty box would be handed back. */
  function pick(picked: string): void {
    restore.current = picked
    setDraft(null)
    setActive(-1)
    setOpen(false)
    onChange(picked)
  }

  /** Leaving with nothing in the box takes the old value back, so a stray click loses no id. */
  function handleBlur(): void {
    if (shown === '' && restore.current !== '') onChange(restore.current)
    setDraft(null)
    setActive(-1)
    setOpen(false)
    onBlur?.()
  }

  /** The arrows walk the rows and wrap, and Enter takes the row they are on. */
  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (rows.length === 0) return
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      if (!open) {
        setOpen(true)
        setActive(step > 0 ? 0 : rows.length - 1)
        return
      }
      setActive((current) =>
        current < 0
          ? step > 0
            ? 0
            : rows.length - 1
          : (current + step + rows.length) % rows.length
      )
      return
    }
    if (event.key === 'Enter' && open && active >= 0 && active < rows.length) {
      event.preventDefault()
      pick(rows[active].value)
    }
  }

  /** Hangs the list under the box, at the box's own width. */
  const reposition = useCallback((): void => {
    const box = input.current
    const layer = pop.current
    const panel = popupHost?.parentElement
    if (!box || !layer || !panel) return
    placeUnder(box, layer, panel, GAP, true)
  }, [popupHost])

  useLayoutEffect(reposition, [reposition, showList, rows.length])

  // The list follows the column it hangs in and the window it is drawn on for as long as it is up.
  useEffect(() => {
    const panel = popupHost?.parentElement
    if (!showList || !panel) return
    panel.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      panel.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [showList, popupHost, reposition])

  // Keeps the row the arrows are on inside the capped list, which the pointer never needs.
  useEffect(() => {
    const scroller = list.current
    const row = active >= 0 ? scroller?.children[active] : null
    if (!scroller || !(row instanceof HTMLElement)) return
    const rowTop = row.offsetTop - scroller.offsetTop
    if (rowTop < scroller.scrollTop) scroller.scrollTop = rowTop
    else if (rowTop + row.offsetHeight > scroller.scrollTop + scroller.clientHeight)
      scroller.scrollTop = rowTop + row.offsetHeight - scroller.clientHeight
  }, [active])

  return (
    <label className="vu-field" htmlFor={id}>
      <span className="vu-field-label">{label}</span>
      {hint && <span className="vu-field-hint">{hint}</span>}
      <input
        ref={input}
        id={id}
        type="text"
        className={`vu-input vu-combo${shown === '' && rows.length > 0 ? ' vu-combo--caret' : ''}`}
        value={shown}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && active >= 0 ? `${id}-option-${active}` : undefined}
        onFocus={handleFocus}
        onClick={handleClick}
        onChange={(event) => handleChange(event.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
      />
      {showList &&
        popupHost !== null &&
        createPortal(
          /* The press is swallowed on the whole layer, so neither a row nor a drag of the
             list's own scrollbar takes the focus out of the box. */
          <div ref={pop} className="vu-pop" onMouseDown={(event) => event.preventDefault()}>
            <div ref={list} id={listId} className="vu-pop-list" role="listbox">
              {rows.map((row, index) => (
                <button
                  key={row.value}
                  id={`${id}-option-${index}`}
                  type="button"
                  className={`vu-pop-option${index === active ? ' vu-pop-option--on' : ''}`}
                  role="option"
                  aria-selected={row.value === value}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => pick(row.value)}
                >
                  {row.label}
                </button>
              ))}
            </div>
            <div className="vu-scroll-fade" />
          </div>,
          popupHost
        )}
    </label>
  )
}
