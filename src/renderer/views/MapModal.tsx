import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type JSX
} from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, type TargetAndTransition } from 'motion/react'
import mapUrl from '../../../assets/vu_map.png'
import mapNightUrl from '../../../assets/vu_map_night.png'
import { useModalShell } from '../components/useModalShell'
import { TitleTab } from '../components/TitleTab'
import { profileUrl, useSpriteVersion } from '../stores/characterStore'
import { useGameStore } from '../stores/gameStore'
import {
  knownWhereabouts,
  placeDestination,
  AWAY_PLACE_KEY,
  CLASS_PLACE_KEY,
  UNKNOWN_PLACE_KEY,
  type Whereabouts
} from '../stores/whereabouts'
import type { ScreenTheme } from './clockTheme'
import { anchorOf, placeBubbles, type PinBox } from './mapLayout'
import {
  bubbleFaces,
  bubbleHead,
  bubbleIn,
  dealt,
  dealtItem,
  faceBreath,
  gestures,
  lift,
  noteIn,
  panelUnderTab,
  press,
  typed,
  typedChar,
  veilIn
} from './motion'
import '../vu_styles/BunnyMap.css'

export interface MapModalProps {
  /** Drawn by the screen that opened this — a portal inherits no palette. */
  theme: ScreenTheme
  onClose: () => void
  /**
   * He may go somewhere. **Absent says the hour is not his**: with no handler the pins carry
   * no Go at all, rather than one that is dead.
   */
  onGo?: (locationId: string, placeLabel: string) => void
}

/** One bubble: a place, and the people the reader can put at it. */
interface Section {
  key: string
  label: string
  /** The one line the Go raises about the place; empty where there is none to raise. */
  blurb: string
  onCampus: boolean
  people: Whereabouts[]
}

/** The pins are dealt with the panel they arrive on, so no `startDelay` and a tight step. */
const PIN_DEAL = dealt(0, 0.05)

/** How much of the frame's edge a bubble keeps clear — its hover's own throw, and the float's. */
const EDGE = 18

/** How wide a row of faces reads well before it becomes two (the lineup's count, not a fit). */
const ONE_ROW = 3

/** How far the Go's card stands off the Go it is raised over. */
const GAP = 10

/** Folds the flat answer into its bubbles; first-seen order is `PLACE_ORDER`'s. */
function sectionsOf(rows: readonly Whereabouts[]): Section[] {
  const sections: Section[] = []
  for (const row of rows) {
    const existing = sections.find((section) => section.key === row.placeKey)
    if (existing) existing.people.push(row)
    else
      sections.push({
        key: row.placeKey,
        label: row.placeLabel,
        blurb: row.placeBlurb,
        onCampus: row.onCampus,
        people: [row]
      })
  }
  return sections
}

/**
 * How many faces a bubble puts in one row: up to three across, and past that two rows as square
 * as they come — 2×2, then 3+2, up to two rows of six. A count rather than a measurement, so
 * every bubble on the map is the same shape at the same size in every band.
 */
function columnsFor(count: number): number {
  return count <= ONE_ROW ? count : Math.ceil(count / 2)
}

/** The mark a place the reader has only ever run into her at wears. */
function GuessMark(): JSX.Element {
  return <span className="vu-map-guess">?</span>
}

/** Somebody the reader has left the city behind. */
function PlaneIcon(): JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4-9-9-4Z" />
    </svg>
  )
}

/** The phase a face takes when the map has none for her, held rather than rebuilt. */
const FACE_REST = faceBreath(0)

/**
 * Her `profile.png` in an archway, with the `?` on its corner where she is a guess. She is dealt
 * onto the bubble with the rest of her row; the picture inside breathes on its own phase, an
 * explicit target rather than a label, and the badge is the arch's other child and stands still.
 */
function Face({
  row,
  name,
  breath
}: {
  row: Whereabouts
  name: string
  breath: TargetAndTransition
}): JSX.Element {
  const version = useSpriteVersion(row.charId)
  return (
    <motion.div className="vu-map-who" variants={dealtItem}>
      <span className="vu-arch vu-map-face">
        <motion.span className="vu-crop" animate={breath}>
          <img className="vu-crop-img" src={profileUrl(row.charId, version)} alt="" />
        </motion.span>
        {row.source === 'remembered' && <GuessMark />}
      </span>
      <span className="vu-map-name">{name}</span>
    </motion.div>
  )
}

/**
 * The BunnyMap: who the reader can place this hour, drawn as bubbles standing over
 * the drawing of Veridan. Everything it may say is `stores/whereabouts.ts`' answer; this view
 * decides only where a bubble fits (`mapLayout.ts`) and offers the one thing it can do about it.
 */
export function MapModal({ theme, onClose, onGo }: MapModalProps): JSX.Element | null {
  const date = useGameStore((s) => s.date)
  const time = useGameStore((s) => s.time)
  const characters = useGameStore((s) => s.characters)

  const { host, overlayProps } = useModalShell(onClose)

  const panel = useRef<HTMLDivElement>(null)
  const clip = useRef<HTMLDivElement>(null)
  const sheet = useRef<HTMLDivElement>(null)
  const tipBox = useRef<HTMLDivElement>(null)

  /** The section whose Go the pointer is on, which is the only thing that raises its card. */
  const [tip, setTip] = useState<string | null>(null)

  // The slot cannot turn over while the map is open, so the whole reading is taken once.
  const rows = useMemo(() => knownWhereabouts(date, time), [date, time])
  // Held in the order their anchors stand on the drawing, west to east: the deal below runs on
  // DOM order, so this is what starts the bubbles left to right across the city.
  const sections = useMemo(() => {
    const footers: readonly string[] = [AWAY_PLACE_KEY, UNKNOWN_PLACE_KEY]
    return sectionsOf(rows.filter((row) => !footers.includes(row.placeKey))).sort(
      (a, b) => anchorOf(a.key).x - anchorOf(b.key).x || a.key.localeCompare(b.key)
    )
  }, [rows])

  // One breath per girl on the map, minted with the sections and held for the life of the map:
  // every face in render order gets its own share of the cycle, so
  // no two — in one bubble or across several — rise together.
  const breaths = useMemo(() => {
    const faces = sections.flatMap((section) => section.people)
    const total = faces.length
    return new Map<string, TargetAndTransition>(
      faces.map((row, i) => [row.charId, faceBreath(i / total)])
    )
  }, [sections])

  const away = rows.filter((row) => row.placeKey === AWAY_PLACE_KEY)
  const unplaced = rows.filter((row) => row.placeKey === UNKNOWN_PLACE_KEY)

  const firstNameOf = (charId: string): string => characters[charId]?.firstName ?? ''
  const namesOf = (list: readonly Whereabouts[]): string =>
    list.map((row) => firstNameOf(row.charId)).join(', ')

  /**
   * Puts every bubble where it fits: the measurement is the frame, the sheet and each bubble's own
   * box, and what comes back is written straight onto the seats as custom properties — a position
   * per pin through React state would re-render the whole map for a number CSS can read itself.
   */
  const place = useCallback((): void => {
    const frame = clip.current
    const layer = sheet.current
    if (!frame || !layer) return

    const frameBox = frame.getBoundingClientRect()
    const layerBox = layer.getBoundingClientRect()
    if (layerBox.width === 0 || layerBox.height === 0) return

    // The rects are window pixels — the browser build zooms the stage, and the panel is still
    // scaling on the frame it arrives — while the seats' boxes and the numbers written below are
    // layout pixels, so every rect measure is put back through the sheet's own ratio.
    const scale = layerBox.width / layer.offsetWidth || 1
    const sheetW = layer.offsetWidth
    const sheetH = layer.offsetHeight

    const seats = [...layer.querySelectorAll<HTMLElement>('[data-pin]')]
    const boxes: PinBox[] = seats.map((seat) => {
      const anchor = anchorOf(seat.dataset.pin ?? '')
      return {
        key: seat.dataset.pin ?? '',
        ax: anchor.x * sheetW,
        ay: anchor.y * sheetH,
        // `offsetWidth` and not a rect: a bubble under the cursor is mid-hover, and a scaled box
        // would be measured at the size it is swelling to.
        w: seat.offsetWidth,
        h: seat.offsetHeight
      }
    })

    // The band of the picture the frame actually shows, in the picture's own pixels.
    const placed = placeBubbles(boxes, {
      left: Math.max(0, (frameBox.left - layerBox.left) / scale) + EDGE,
      top: Math.max(0, (frameBox.top - layerBox.top) / scale) + EDGE,
      right: Math.min(sheetW, (frameBox.right - layerBox.left) / scale) - EDGE,
      bottom: Math.min(sheetH, (frameBox.bottom - layerBox.top) / scale) - EDGE
    })

    for (const seat of seats) {
      const at = placed.get(seat.dataset.pin ?? '')
      if (!at) continue
      seat.style.setProperty('--x', `${Math.round(at.x)}px`)
      seat.style.setProperty('--y', `${Math.round(at.y)}px`)
    }
  }, [])

  /**
   * Before the paint that brings them, and again whenever the stage reflows under them. `host`
   * is a load-bearing dependency: it resolves after mount, so without it this would run once,
   * before the map exists, and never again.
   */
  const shape = sections.map((section) => `${section.key}:${section.people.length}`).join('|')
  useLayoutEffect(() => {
    place()
    const frame = clip.current
    if (!frame) return
    const watch = new ResizeObserver(() => place())
    watch.observe(frame)
    return () => watch.disconnect()
  }, [place, shape, host])

  /** The hovered section, and only while it has a line to say. */
  const tipped = sections.find((section) => section.key === tip && section.blurb !== '') ?? null

  // A Go leaves with the handler and with the sections, and motion reports no hover ending for a
  // control that unmounts under the cursor, so the hover is dropped with what it names. Keyed on
  // whether there is a handler, not on which: the screen hands down a new closure every render.
  const canGo = onGo !== undefined
  useEffect(() => {
    setTip(null)
  }, [canGo, shape])

  /**
   * Card position is written as `--tip-x`/`--tip-y`, centred over the Go and clamped within the
   * frame's width, always above the Go rather than flipping under it near the top. Runs in a
   * layout effect so the first frame is already placed.
   */
  useLayoutEffect(() => {
    const panelEl = panel.current
    const frame = clip.current
    const layer = sheet.current
    const box = tipBox.current
    if (tip === null || !panelEl || !frame || !layer || !box) return

    const seat = `[data-pin="${CSS.escape(tip)}"]`
    const go = layer.querySelector<HTMLElement>(`${seat} .vu-map-go`)
    if (!go) return

    // The panel is still scaling on the frame it arrives, so its rect is read for the scale it is
    // at and every measurement taken off it is put back into the layout pixels the panel is laid
    // out in — which is what the two properties below are read as.
    const panelRect = panelEl.getBoundingClientRect()
    const scale = panelRect.width / panelEl.offsetWidth || 1
    const goRect = go.getBoundingClientRect()
    const goCenterX = (goRect.left + goRect.width / 2 - panelRect.left) / scale
    const goTop = (goRect.top - panelRect.top) / scale

    const w = box.offsetWidth
    const h = box.offsetHeight
    const x = Math.min(
      Math.max(goCenterX - w / 2, frame.offsetLeft),
      frame.offsetLeft + frame.offsetWidth - w
    )
    const y = goTop - GAP - h

    box.style.setProperty('--tip-x', `${Math.round(x)}px`)
    box.style.setProperty('--tip-y', `${Math.round(y)}px`)
  }, [tip])

  if (!host) return null

  return createPortal(
    <motion.div
      className="vu-veil"
      data-theme={theme}
      variants={veilIn}
      initial="hidden"
      animate="shown"
      exit="gone"
      {...overlayProps}
    >
      <motion.div
        id="map"
        className="vu-map vu-paper"
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="BunnyMap"
        variants={panelUnderTab}
      >
        <TitleTab>BunnyMap</TitleTab>

        {/* What the mark means, said at rest rather than behind a hover. */}
        <div className="vu-map-legend">
          <GuessMark />
          <span>= Possible location, unconfirmed</span>
        </div>

        <div className="vu-map-clip" ref={clip}>
          {/* The deal runs under the veil's own `shown`: nothing here resizes, so there is no
              landing to wait on. */}
          <motion.div className="vu-map-sheet" ref={sheet} variants={PIN_DEAL}>
            {/* The drawing is a picture of the city rather than a surface of the app, so it has a
            second one for the other half of the day rather than a role that turns. Both are
            the same 2752×1536, which is what lets `MAP_ANCHORS` — shares of the drawing — hold a
            landmark in either. */}
            <img
              className="vu-map-img"
              src={theme === 'night' ? mapNightUrl : mapUrl}
              alt=""
              decoding="async"
            />

            {sections.map((section) => {
              const destination = placeDestination(section.key)
              // One bucket for every class, whoever is teaching it.
              const placeLabel =
                section.key === CLASS_PLACE_KEY ? 'In class' : `@ ${section.label}`
              return (
                /* A bubble is one sequence, and every wait in it is a wrapper holding its own
                   children back: the seat grows off its foot, the head types the place and then
                   pops Go, and the grid deals the faces. The bubble itself is the only variant
                   node between them — the paper is a plain box. */
                <motion.div
                  className="vu-map-seat"
                  key={section.key}
                  data-pin={section.key}
                  variants={bubbleIn}
                >
                  <div
                    className="vu-map-pin vu-paper"
                    style={{ '--cols': columnsFor(section.people.length) } as CSSProperties}
                  >
                    <motion.div className="vu-map-head" variants={bubbleHead}>
                      {/* The name is printed whole and typed in ink, one span a character, so
                          the box the layout measured is the box it stays. */}
                      <motion.span className="vu-map-place" variants={typed}>
                        {[...placeLabel].map((letter, index) => (
                          <motion.span key={index} variants={typedChar}>
                            {letter}
                          </motion.span>
                        ))}
                      </motion.span>
                      {onGo && destination && (
                        <motion.button
                          className="vu-btn vu-btn--primary vu-paper vu-map-go"
                          type="button"
                          aria-label={`Go to ${section.label}`}
                          variants={dealtItem}
                          {...gestures(false, lift, press)}
                          onPointerEnter={() => setTip(section.key)}
                          onPointerLeave={() => setTip(null)}
                          onClick={() => onGo(destination, section.label)}
                        >
                          Go
                        </motion.button>
                      )}
                    </motion.div>

                    <motion.div className="vu-map-grid" variants={bubbleFaces}>
                      {section.people.map((row) => (
                        <Face
                          key={row.charId}
                          row={row}
                          name={firstNameOf(row.charId)}
                          breath={breaths.get(row.charId) ?? FACE_REST}
                        />
                      ))}
                    </motion.div>
                  </div>
                </motion.div>
              )
            })}
          </motion.div>
        </div>

        <div className="vu-foot">
          {/* Nobody silently vanishes: the two lines that are not places, anchored left so
              the one that is there sits where the eye starts. */}
          <div className="vu-map-absent">
            {away.length > 0 && (
              <p className="vu-map-line">
                <PlaneIcon />
                Out of town — <span className="vu-map-names">{namesOf(away)}</span>
              </p>
            )}
            {unplaced.length > 0 && (
              <p className="vu-map-line">
                Whereabouts unknown — <span className="vu-map-names">{namesOf(unplaced)}</span>
              </p>
            )}
            {rows.length === 0 && <p className="vu-map-none">No updates.</p>}
          </div>

          <motion.button
            id="map-close"
            className="vu-btn vu-btn--primary vu-btn--panel vu-paper"
            type="button"
            {...gestures(false, lift, press)}
            onClick={onClose}
          >
            Close
          </motion.button>
        </div>

        {/* The one line about the place under the pointer's Go, standing at the panel's level
            rather than in the bubble, which the frame would clip. It says nothing the screen
            owes at rest, so it is the reader's rather than the screen reader's. */}
        <AnimatePresence>
          {tipped && (
            <motion.div
              key={tipped.key}
              ref={tipBox}
              className="vu-map-tip vu-paper"
              variants={noteIn}
              initial="hidden"
              animate="shown"
              exit="gone"
              aria-hidden="true"
            >
              {tipped.blurb}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>,
    host
  )
}
