import { useRef, useState, type JSX, type WheelEvent as ReactWheelEvent } from 'react'
import { motion } from 'motion/react'
import { DeleteX } from './DeleteX'
import {
  cardSwell,
  dealt,
  gestures,
  quietLift,
  quietPress,
  rowLift,
  rowPress,
  slideInQuick
} from '../views/motion'
import { ChevronIcon } from '../views/screenIcons'
import { accumulateNotch, wheelNotches, type WheelTravel } from '../views/wheel'
import '../vu_styles/SavePages.css'

/** How many cells one page of saves holds: two columns of five. */
export const SAVE_PAGE_CELLS = 10

/** A page index on the ring of pages: one past the last is the first, one before the first the last. */
export function wrapPage(to: number, pageCount: number): number {
  return ((to % pageCount) + pageCount) % pageCount
}

/** One cell of a page: a save on disk, or the gap where one could be written. */
export type SaveGridEntry =
  | {
      kind: 'card'
      saveId: string
      /** The label hung over the cell's corner: which slot or which autosave it is. */
      sticker: string
      headline: string
      meta: string
      /** Why the save cannot be loaded, said under its meta. */
      reason?: string | null
      /** The picture in the card's round end, or null for an empty crop. */
      thumbSrc: string | null
      /** A save that cannot be opened: drawn, deletable, and not a button. */
      dead?: boolean
      deletable: boolean
    }
  | { kind: 'empty'; slot: number; sticker: string }

/** A cell holding a save. */
export type SaveGridCard = Extract<SaveGridEntry, { kind: 'card' }>

/** A cell holding nothing yet. */
export type SaveGridEmpty = Extract<SaveGridEntry, { kind: 'empty' }>

export interface SavePagesGridProps {
  id: string
  /** Whether a gap is a place to write a save or only a gap. */
  mode: 'load' | 'save'
  /** The page's cells in slot order, laid down the columns — exactly {@link SAVE_PAGE_CELLS} of them. */
  entries: SaveGridEntry[]
  page: number
  pageCount: number
  onPage: (page: number) => void
  onPick: (entry: SaveGridCard) => void
  onPickEmpty?: (entry: SaveGridEmpty) => void
  onDelete?: (entry: SaveGridCard) => void
  /** A write is running: every cell is dead and the wheel turns nothing. */
  busy?: boolean
  /** The panel around the page is still resizing to it, so the cells wait to be dealt. */
  held?: boolean
}

/** The page's cells dealing in with the page, quick and close together. */
const PAGE_DEAL = dealt(0, 0.02)

/**
 * A page of saves in two columns, with the arrows either side that turn it and a dot per page
 * under it. The wheel over any of it turns the page a notch at a time. The pages are a ring:
 * turning past either end lands on the other.
 */
export function SavePagesGrid({
  id,
  mode,
  entries,
  page,
  pageCount,
  onPage,
  onPick,
  onPickEmpty,
  onDelete,
  busy = false,
  held = false
}: SavePagesGridProps): JSX.Element {
  const travel = useRef<WheelTravel>({ sum: 0, at: 0 })

  /** Turns to a page, round the ring: past the last page is the first, before the first the last. */
  const turn = (to: number): void => {
    const next = wrapPage(to, pageCount)
    if (next !== page) onPage(next)
  }

  /** A notch down turns forward and a notch up turns back, once the notches add up to one. */
  const onWheel = (event: ReactWheelEvent<HTMLDivElement>): void => {
    if (busy) return
    const step = accumulateNotch(travel.current, wheelNotches(event.nativeEvent))
    if (step !== 0) turn(page + step)
  }

  return (
    <div id={id} className="vu-pages" onWheel={onWheel}>
      <div className="vu-pages-row">
        <motion.button
          id="save-page-prev"
          className="vu-pages-arrow"
          type="button"
          aria-label="Previous page"
          {...gestures(false, rowLift, rowPress)}
          onClick={() => turn(page - 1)}
        >
          <ChevronIcon back />
        </motion.button>

        <motion.ul
          key={page}
          className="vu-pages-grid"
          variants={PAGE_DEAL}
          initial="hidden"
          animate={held ? 'hidden' : 'shown'}
        >
          {entries.map((entry, index) => (
            <SaveCell
              // A cell is a place on the page, whatever it holds.
              key={index}
              entry={entry}
              mode={mode}
              busy={busy}
              onPick={onPick}
              onPickEmpty={onPickEmpty}
              onDelete={onDelete}
            />
          ))}
        </motion.ul>

        <motion.button
          id="save-page-next"
          className="vu-pages-arrow"
          type="button"
          aria-label="Next page"
          {...gestures(false, rowLift, rowPress)}
          onClick={() => turn(page + 1)}
        >
          <ChevronIcon />
        </motion.button>
      </div>

      <div id="save-page-dots" className="vu-pages-dots">
        {Array.from({ length: pageCount }, (_, index) =>
          index === page ? (
            <span key={index} className="vu-pages-dot vu-pages-dot--on" aria-current="true" />
          ) : (
            <motion.button
              key={index}
              id={`save-page-dot-${index}`}
              className="vu-pages-dot"
              type="button"
              aria-label={`Page ${index + 1}`}
              {...gestures(false, quietLift, quietPress)}
              onClick={() => turn(index)}
            />
          )
        )}
      </div>
    </div>
  )
}

/**
 * One cell: the save's face or the gap's, the sticker naming the slot over its corner, and the
 * ✕ its own hover reveals. The sticker and the ✕ are siblings of the face, never inside it.
 */
function SaveCell({
  entry,
  mode,
  busy,
  onPick,
  onPickEmpty,
  onDelete
}: {
  entry: SaveGridEntry
  mode: 'load' | 'save'
  busy: boolean
  onPick: (entry: SaveGridCard) => void
  onPickEmpty?: (entry: SaveGridEmpty) => void
  onDelete?: (entry: SaveGridCard) => void
}): JSX.Element {
  // The ✕ is revealed from React rather than by CSS, so focusing it reveals it too.
  const [hovered, setHovered] = useState(false)

  return (
    <motion.li
      className="vu-pages-cell"
      variants={slideInQuick}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
    >
      {entry.kind === 'card' ? (
        <CardFace
          // Keyed on the save, so a cell that changes hands mounts a new face rather than
          // carrying the last one's hover back onto it.
          key={entry.saveId}
          entry={entry}
          busy={busy}
          onPick={onPick}
        />
      ) : mode === 'save' ? (
        <motion.button
          key={`slot-${entry.slot}`}
          id={`save-slot-${entry.slot}`}
          className="vu-pages-card vu-pages-card--empty"
          type="button"
          {...gestures(busy, rowLift, rowPress)}
          disabled={busy}
          onClick={() => onPickEmpty?.(entry)}
        >
          <span className="vu-pages-empty">EMPTY</span>
        </motion.button>
      ) : (
        <div
          key={`slot-${entry.slot}`}
          id={`save-slot-${entry.slot}`}
          className="vu-pages-card vu-pages-card--empty"
        >
          <span className="vu-pages-empty">EMPTY</span>
        </div>
      )}

      <span className="vu-sticker vu-pages-sticker">{entry.sticker}</span>

      {entry.kind === 'card' && entry.deletable && onDelete && (
        <DeleteX
          className="vu-x vu-pages-x"
          hovered={hovered}
          label={`Delete the save: ${entry.headline}`}
          onDelete={() => onDelete(entry)}
        />
      )}
    </motion.li>
  )
}

/**
 * A save's face: its picture in the round end, then where it sits in the semester, when it was
 * written and why it cannot be opened. A save that cannot be opened is not a button, so it is
 * not a tab stop either and is handed no gesture.
 */
function CardFace({
  entry,
  busy,
  onPick
}: {
  entry: SaveGridCard
  busy: boolean
  onPick: (entry: SaveGridCard) => void
}): JSX.Element {
  const body = (
    <>
      <span className="vu-pages-crop">
        {entry.thumbSrc && <img className="vu-crop-img" src={entry.thumbSrc} alt="" />}
      </span>
      <span className="vu-pages-main">
        <span className="vu-pages-headline">{entry.headline}</span>
        <span className="vu-pages-meta">{entry.meta}</span>
        {entry.reason && <span className="vu-pages-reason">{entry.reason}</span>}
      </span>
    </>
  )

  if (entry.dead) {
    return (
      <div id={`save-card-${entry.saveId}`} className="vu-pages-card vu-pages-card--dead">
        {body}
      </div>
    )
  }

  return (
    <motion.button
      id={`save-card-${entry.saveId}`}
      className="vu-pages-card"
      type="button"
      {...gestures(busy, cardSwell, rowPress)}
      disabled={busy}
      onClick={() => onPick(entry)}
    >
      {body}
    </motion.button>
  )
}
