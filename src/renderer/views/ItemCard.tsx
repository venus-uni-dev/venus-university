/**
 * One item, wherever one is drawn: a shelf card in the shop and a line of the reader's
 * inventory are the same component. **A card is a surface, not a control** — it wears no
 * gesture at all; only the button on it answers the pointer. The shop's added step, `Buy?`,
 * reuses the same grid cell the price and Buy already stand in.
 */
import type { JSX } from 'react'
import { AnimatePresence, motion } from 'motion/react'

import { formatMoney } from '@shared/money'
import type { ItemDef } from '@shared/shop'
import { chipLift, chipPress, gestures, quietPress, shopConfirm, shopQuietLift, slideInQuick } from './motion'
import '../vu_styles/ItemCard.css'

export interface ItemCardProps {
  item: ItemDef
  /** How many he is carrying, in the price's seat: the inventory's reading rather than a price. */
  count?: number
  /** The word on the one answer — `Buy` on a shelf, `Gift` in the inventory — and the question. */
  word: string
  /** **Absent says the card offers nothing**, which is what a shelf read without a turn is. */
  onAnswer?: () => void
  /** The shop's second step: this is the card being asked about, so the foot is the question. */
  asking?: boolean
  onCancel?: () => void
  onConfirm?: () => void
}

export function ItemCard({
  item,
  count,
  word,
  onAnswer,
  asking = false,
  onCancel,
  onConfirm
}: ItemCardProps): JSX.Element {
  return (
    // It deals itself in on the throw both callers want; the list above it owns the stagger.
    <motion.div className="vu-item vu-paper" variants={slideInQuick}>
      <span className="vu-item-pocket" aria-hidden="true">
        {item.emoji}
      </span>

      <div className="vu-item-body">
        <span className="vu-item-name">{item.name}</span>
        {/* The shop's own copy, and the whole of what the card sells: an item's categories and
            her side of the comparison are never drawn — either is the answer key. */}
        <p className="vu-item-desc">{item.description}</p>

        <div className="vu-item-foot">
          {/* One statement in two faces, so they are never both on the card and the cell they
              share keeps its height through the swap. `initial={false}`, or a card at rest
              would deal its own foot in a second time under the grid's. */}
          <AnimatePresence mode="wait" initial={false}>
            {asking ? (
              <motion.div
                key="ask"
                className="vu-item-answers"
                variants={shopConfirm}
                initial="from"
                animate="at"
                exit="out"
              >
                <span className="vu-item-price">{formatMoney(-item.price)}</span>
                <span className="vu-item-ask">{word}?</span>
                {/* The app's own Cancel, in the merchant's tone: a quiet fill and no paper
                    layer at all, which is how every modal in the app says `no`. */}
                <motion.button
                  className="vu-btn vu-btn--quiet vu-item-no"
                  type="button"
                  {...gestures(false, shopQuietLift, quietPress)}
                  onClick={onCancel}
                >
                  No
                </motion.button>
                <motion.button
                  className="vu-btn vu-btn--primary vu-paper vu-item-btn vu-item-yes"
                  type="button"
                  {...gestures(false, chipLift, chipPress)}
                  onClick={onConfirm}
                >
                  Yes
                </motion.button>
              </motion.div>
            ) : (
              <motion.div
                key="rest"
                className="vu-item-answers"
                variants={shopConfirm}
                initial="from"
                animate="at"
                exit="out"
              >
                {count === undefined ? (
                  <span className="vu-item-price">{formatMoney(item.price)}</span>
                ) : (
                  <span className="vu-item-count">&times;{count}</span>
                )}
                {onAnswer && (
                  <motion.button
                    className="vu-btn vu-btn--primary vu-paper vu-item-btn"
                    type="button"
                    {...gestures(false, chipLift, chipPress)}
                    onClick={onAnswer}
                  >
                    {word}
                  </motion.button>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  )
}
