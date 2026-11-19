import { useCallback, useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'
import type { CharacterSort } from '../stores/characterStore'
import { gestures, quietPress, toggleLift } from '../views/motion'
import { ChevronIcon } from '../views/screenIcons'
import { placeUnder } from './popupPlace'
import { useDismissLayer } from './useModalShell'
import '../vu_styles/PopList.css'

/** Each order as the list names it, in the order the list offers them. */
const SORT_LABELS: readonly { sort: CharacterSort; label: string }[] = [
  { sort: 'recent', label: 'Recently updated' },
  { sort: 'firstName', label: 'First name' },
  { sort: 'girlsFirst', label: 'Girls first' },
  { sort: 'guysFirst', label: 'Guys first' },
  { sort: 'customFirst', label: 'Custom first' }
]

/** The room between the pill and the list it hangs. */
const POP_GAP = 6

export interface CharacterSortPillProps {
  id: string
  value: CharacterSort
  onChange: (sort: CharacterSort) => void
  /** The layer the list is portalled into, whose parent it is placed against; `null` until it resolves. */
  popupHost: HTMLElement | null
}

/**
 * The order a character grid is dealt in, behind a pill naming it that opens a floating list of
 * the others. A pick never clears, so the pill keeps its chevron.
 */
export function CharacterSortPill({
  id,
  value,
  onChange,
  popupHost
}: CharacterSortPillProps): JSX.Element {
  const pill = useRef<HTMLButtonElement | null>(null)
  const pop = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  // The row under the pointer, tinted by that state as a suggestion list's is.
  const [hovered, setHovered] = useState(-1)
  const showList = open && popupHost !== null

  useDismissLayer(() => setOpen(false), showList)

  /** Hangs the list under the pill, or over it where the panel has no room below. */
  const reposition = useCallback((): void => {
    const box = pill.current
    const layer = pop.current
    const panel = popupHost?.parentElement
    if (!box || !layer || !panel) return
    layer.style.setProperty('min-width', `${Math.round(box.offsetWidth)}px`)
    placeUnder(box, layer, panel, POP_GAP, false)
  }, [popupHost])

  useLayoutEffect(reposition, [reposition, showList])

  useEffect(() => {
    if (!showList) return
    window.addEventListener('resize', reposition)
    return () => window.removeEventListener('resize', reposition)
  }, [showList, reposition])

  // A press on neither the pill nor the list itself takes the list down.
  useEffect(() => {
    if (!showList) return
    const handleMouseDown = (event: MouseEvent): void => {
      // A right-click is the layer's to answer, on its contextmenu.
      if (event.button !== 0) return
      const target = event.target
      if (!(target instanceof Node)) return
      if (pill.current?.contains(target) === true || pop.current?.contains(target) === true) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [showList])

  const current = SORT_LABELS.find((entry) => entry.sort === value) ?? SORT_LABELS[0]

  return (
    <>
      <motion.button
        ref={pill}
        id={id}
        className="vu-pill"
        type="button"
        aria-haspopup="listbox"
        aria-expanded={showList}
        {...gestures(false, toggleLift, quietPress)}
        onClick={() => {
          setHovered(-1)
          setOpen(!open)
        }}
      >
        Sort: {current.label}
        <ChevronIcon down />
      </motion.button>
      {showList &&
        createPortal(
          <div ref={pop} className="vu-pop">
            <div className="vu-pop-list" role="listbox" aria-label="Sort characters">
              {SORT_LABELS.map((entry, index) => (
                <button
                  key={entry.sort}
                  id={`${id}-${entry.sort}`}
                  type="button"
                  className={`vu-pop-option${index === hovered ? ' vu-pop-option--on' : ''}${entry.sort === value ? ' vu-pop-option--picked' : ''}`}
                  role="option"
                  aria-selected={entry.sort === value}
                  onMouseEnter={() => setHovered(index)}
                  onMouseLeave={() => setHovered(-1)}
                  onClick={() => {
                    setOpen(false)
                    if (entry.sort !== value) onChange(entry.sort)
                  }}
                >
                  {entry.label}
                </button>
              ))}
            </div>
            <div className="vu-scroll-fade" />
          </div>,
          popupHost
        )}
    </>
  )
}
