import { useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'
import { cgLabelOf } from '@shared/customCgs'
import {
  afterOf,
  customCgSlotAt,
  customCgSlotNumber,
  customCgSlotOf,
  customCgSlotsIn,
  STOCK_CG_DISPLAY_ORDER,
  stockCgsFor,
  stockCgsInPlay
} from '@shared/positions'
import type { Position } from '@shared/types'
import { PageArrows, wrapPage } from '../components/PageArrows'
import { typingIn, useWindowKeydown } from '../components/useWindowKeydown'
import { useModalShell } from '../components/useModalShell'
import { TitleTab } from '../components/TitleTab'
import { spriteUrl, useSpriteVersion } from '../stores/characterStore'
import { useGameStore } from '../stores/gameStore'
import { matchCgBiologyOf, useSettingsStore } from '../stores/settingsStore'
import { cgKnownMissing } from '../stores/stageDisplay'
import type { ScreenTheme } from './clockTheme'
import { CG_PAGE_SLOTS, pageSlotNumbers, slotPageCount } from './customPages'
import {
  dealt,
  gestures,
  lift,
  panelUnderTab,
  press,
  quietLift,
  quietPress,
  slideInQuick,
  veilIn
} from './motion'
import '../vu_styles/ImageGallery.css'
import '../vu_styles/CgPicker.css'

/** One page of the picker: what its head calls it, and its CGs in grid order. */
interface CgPage {
  title: string
  positions: readonly Position[]
  /** Her own pairs, whose names are shown as she wrote them. */
  custom: boolean
}

/** The stock eight, with each `_after` under its act. */
const STOCK_PAGE: CgPage = { title: 'NSFW CG', positions: STOCK_CG_DISPLAY_ORDER, custom: false }

/**
 * The stock page where the character has the stock CGs, then her own pairs on as many pages as
 * her highest slot in use needs, at least one, each slot in the cell the Custom CG panel stands
 * it in with its `_after` under its main.
 */
function pagesFor(lastTaken: number, stock: boolean): CgPage[] {
  const custom = Array.from({ length: slotPageCount(lastTaken, CG_PAGE_SLOTS) }, (_, page) => {
    const slots = pageSlotNumbers(page, CG_PAGE_SLOTS).map(customCgSlotAt)
    return { title: 'Custom CG', positions: [...slots, ...slots.map(afterOf)], custom: true }
  })
  return stock ? [STOCK_PAGE, ...custom] : custom
}

/** A page's cells dealing in with the page, quick and close together. */
const PAGE_DEAL = dealt(0, 0.02)

export interface CgPickerModalProps {
  /** Drawn by the screen that opened this — a portal inherits neither palette nor state rules. */
  theme: ScreenTheme
  charId: string
  onClose: () => void
}

/**
 * One character's CGs a page at a time, the stock eight and then her own pairs, a male
 * character's own pairs alone. A click puts one over the whole stage and a second click on it
 * takes it off; a set not whole on disk is drawn as gaps.
 */
export function CgPickerModal({ theme, charId, onClose }: CgPickerModalProps): JSX.Element | null {
  const character = useGameStore((s) => s.characters[charId])
  const cgReady = useGameStore((s) => s.cgReady)
  const customCgReady = useGameStore((s) => s.customCgReady)
  const cgLock = useGameStore((s) => s.cgLock)
  // The stock eight draw the reader male, so they stand only where they match the reader.
  const stockCgs = stockCgsInPlay(
    useGameStore((s) => s.playerPronouns),
    useSettingsStore(matchCgBiologyOf)
  )
  const setCgLock = useGameStore((s) => s.setCgLock)
  const version = useSpriteVersion(charId)

  /** Whether a CG's whole set is on disk, which is what makes it hers to pick. */
  const pickable = (position: Position): boolean => {
    const slot = customCgSlotOf(position)
    return slot
      ? customCgReady[charId]?.includes(slot) === true
      : stockCgs && cgReady[charId] === true
  }
  // Her CG over the stage, as the stage draws it; pressed again, it comes off.
  const inForce =
    cgLock?.charId === charId &&
    !cgKnownMissing(charId, cgLock.position, { cgReady, customCgReady, stockCgs })
      ? cgLock.position
      : null

  // Her slots holding a record or a whole pair: what her pages are counted off.
  const taken = customCgSlotsIn([
    ...Object.keys(character?.customCgs ?? {}),
    ...(customCgReady[charId] ?? [])
  ])
  const pages = pagesFor(Math.max(0, ...taken.map(customCgSlotNumber)), stockCgsFor(character) && stockCgs)

  // Opens on the page holding her CG in force, else the first with anything to pick.
  const [page, setPage] = useState(() => {
    const held = inForce ? pages.findIndex((entry) => entry.positions.includes(inForce)) : -1
    if (held >= 0) return held
    return Math.max(0, pages.findIndex((entry) => entry.positions.some(pickable)))
  })

  /** The arrow keys turn the page, as the arrows beside it do. */
  useWindowKeydown((event) => {
    if (typingIn(event)) return
    if (event.key === 'ArrowLeft') setPage((current) => wrapPage(current - 1, pages.length))
    else if (event.key === 'ArrowRight') setPage((current) => wrapPage(current + 1, pages.length))
  })

  const { host, overlayProps } = useModalShell(onClose)
  if (!host || !character) return null

  // A page whose last pair left mid-view gives way to the last that stands.
  const shown = pages[Math.min(page, pages.length - 1)]

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
        id="cg-picker"
        className="vu-gallery vu-paper"
        role="dialog"
        aria-modal="true"
        aria-label="CG"
        variants={panelUnderTab}
      >
        <TitleTab>CG</TitleTab>

        <div className="vu-gallery-head">
          <span className="vu-cgpick-page">{shown.title}</span>
          <span className="vu-hint">
            Click a CG to put it on screen. Click it again to take it off.
          </span>
        </div>

        <PageArrows
          idPrefix="cg-page"
          page={Math.min(page, pages.length - 1)}
          pageCount={pages.length}
          onPage={setPage}
        >
          <motion.ul
            key={Math.min(page, pages.length - 1)}
            className={`vu-gallery-grid vu-cgpick-grid${shown.custom ? ' vu-cgpick-grid--custom' : ''}`}
            variants={PAGE_DEAL}
            initial="hidden"
            animate="shown"
          >
            {shown.positions.map((position) => {
              const label = cgLabelOf(character, position)
              const on = position === inForce
              return (
                <motion.li key={position} className="vu-gallery-item" variants={slideInQuick}>
                  {pickable(position) || on ? (
                    <motion.button
                      id={`cg-pick-${position}`}
                      className={`vu-gallery-cell${on ? ' vu-cgpick-cell--on' : ''}`}
                      type="button"
                      aria-pressed={on}
                      {...gestures(false, quietLift, quietPress)}
                      onClick={() => setCgLock(on ? null : { charId, position })}
                    >
                      <img
                        className="vu-gallery-img"
                        src={spriteUrl(charId, position, version)}
                        alt={label}
                        decoding="async"
                      />
                    </motion.button>
                  ) : (
                    <div className="vu-gallery-cell vu-gallery-cell--empty">
                      <span className="vu-gallery-empty">NOT GENERATED</span>
                    </div>
                  )}
                  <span className="vu-gallery-caption">{label}</span>
                </motion.li>
              )
            })}
          </motion.ul>
        </PageArrows>

        {/* A panel with nothing to spend has one answer. */}
        <div className="vu-foot">
          <motion.button
            id="cg-picker-close"
            className="vu-btn vu-btn--primary vu-paper vu-btn--panel"
            type="button"
            {...gestures(false, lift, press)}
            onClick={onClose}
          >
            Close
          </motion.button>
        </div>
      </motion.div>
    </motion.div>,
    host
  )
}
