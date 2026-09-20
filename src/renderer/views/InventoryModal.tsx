/**
 * What the reader is carrying, and the one panel that says it: "My stuff" on the shop's own
 * header, and the same panel in `gift` mode, opened by a scene's Gift button. **Not the shop's
 * modal** — it has two openers, so it is its own slice, wearing the app's surface and taking
 * `theme` like any other portalled modal.
 */
import { useMemo, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'

import { itemDefOf } from '@shared/shop'
import { useModalShell } from '../components/useModalShell'
import { TitleTab } from '../components/TitleTab'
import { useGameStore } from '../stores/gameStore'
import type { ScreenTheme } from './clockTheme'
import { ItemCard } from './ItemCard'
import { dealt, gestures, lift, panelUnderTab, press, veilIn } from './motion'
import '../vu_styles/Inventory.css'

/** The cards arrive with the panel — nothing here resizes, so no landing to wait on. */
const STUFF_DEAL = dealt(0, 0.03)

export interface InventoryModalProps {
  /** Drawn by the screen that opened this — a portal inherits no palette. */
  theme: ScreenTheme
  /** `stuff` is the reader looking at what he has; `gift` is him picking one to hand over. */
  mode?: 'stuff' | 'gift'
  onClose: () => void
  /** Called with the chosen item id in `gift` mode; nothing is spent until the message is sent. */
  onGift?: (itemId: string) => void
}

export function InventoryModal({
  theme,
  mode = 'stuff',
  onClose,
  onGift
}: InventoryModalProps): JSX.Element | null {
  const inventory = useGameStore((s) => s.inventory)
  const { host, overlayProps } = useModalShell(onClose)

  // An item id the catalog does not know is dropped: the def owns everything a card shows.
  const held = useMemo(
    () =>
      inventory.flatMap((entry) => {
        const item = itemDefOf(entry.itemId)
        return item ? [{ item, count: entry.count }] : []
      }),
    [inventory]
  )

  if (!host) return null

  const gifting = mode === 'gift'
  const title = gifting ? 'Give a gift' : 'My stuff'
  const carried = held.reduce((total, line) => total + line.count, 0)

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
        id="inventory"
        className="vu-inv vu-paper"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        variants={panelUnderTab}
      >
        <TitleTab>{title}</TitleTab>

        {held.length === 0 ? (
          <p className="vu-inv-empty">You aren&apos;t carrying anything.</p>
        ) : (
          <>
            <p className="vu-inv-count">
              {carried} {carried === 1 ? 'ITEM' : 'ITEMS'}
            </p>
            <motion.div className="vu-inv-grid" variants={STUFF_DEAL}>
              {held.map(({ item, count }) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  count={count}
                  word="Gift"
                  // Absent outside gift mode: a panel he is only looking at offers nothing.
                  onAnswer={gifting && onGift ? () => onGift(item.id) : undefined}
                />
              ))}
            </motion.div>
          </>
        )}

        {/* One answer: a panel that has committed nothing has nothing a Cancel could undo, and
            in gift mode picking a card *is* the commit (the modal-close rule). */}
        <div className="vu-foot">
          <motion.button
            id="inventory-close"
            className="vu-btn vu-btn--primary vu-btn--panel vu-paper"
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
