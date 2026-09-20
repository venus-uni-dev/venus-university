/**
 * The BunnyShop: a browser with five tabs, one merchant's shelf behind each, and the reader's
 * balance in the corner. The shell is the app's; a shop owns its field, shapes, tab and
 * signature (`vu_styles/Shop.css`). `Yes` spends with no affordability check; else backs out.
 */
import { useCallback, useMemo, useState, type CSSProperties, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'

import { itemDefOf, itemsInShop, shopDefOf, SHOPS, type ItemDef } from '@shared/shop'
import { LettersFilter, lettersUrl } from '../components/LettersMark'
import { useModalShell } from '../components/useModalShell'
import { MoneyCard } from '../components/MoneyCard'
import { useGameStore } from '../stores/gameStore'
import type { ScreenTheme } from './clockTheme'
import { InventoryModal } from './InventoryModal'
import { ItemCard } from './ItemCard'
import {
  SHOP_TABS_DEAL,
  dealt,
  gestures,
  lift,
  press,
  quietLift,
  quietPress,
  shopDecor,
  shopDecorLate,
  shopHead,
  shopMoney,
  shopPane,
  shopRule,
  shopTab,
  tabPress,
  tabRaise,
  veilIn
} from './motion'
import { BackIcon } from './screenIcons'
import '../vu_styles/Shop.css'

/** The shelf arrives with the pane — nothing here resizes, so there is no landing to wait on. */
const SHELF_DEAL = dealt(0, 0.03)

/**
 * What each shop says about itself on the sticker at the end of its header. Shipped content, in
 * the merchant's own voice.
 */
const KICKERS: Record<string, string> = {
  vu_campus_store: 'OFFICIAL CAMPUS MERCHANDISE',
  veridan_delivery: 'SUPPORT SMALL BUSINESS',
  girltime: 'TREAT YOURSELF! ♡',
  luxurynow: 'ELEGANCE. CLASS. LUXURY.',
  merchmogul: 'WHILE SUPPLIES LAST'
}

/** What is scattered round GirlTime's masthead, in the band beside its kicker: a glyph, where it sits (px off the head's top-left), its size and its lean. Shipped content. */
const GIRLTIME_CHARMS: readonly { glyph: string; x: number; y: number; size: number; lean: number }[] = [
  { glyph: '💖', x: 236, y: -8, size: 30, lean: -12 },
  { glyph: '💋', x: 296, y: 22, size: 26, lean: 14 },
  { glyph: '💕', x: 356, y: -4, size: 22, lean: -6 },
  { glyph: '✨', x: 412, y: 20, size: 18, lean: 0 },
  { glyph: '💗', x: 466, y: -2, size: 20, lean: 8 }
]

/** MerchMogul's stub split at its last space, the perforation running between the two halves. */
function stubHalves(text: string): [string, string] {
  const at = text.lastIndexOf(' ')
  return at === -1 ? [text, ''] : [text.slice(0, at), text.slice(at + 1)]
}

/**
 * What breathes behind one merchant's goods — **its own, not a copy of one shared shape**. The
 * pair that moves is on one clock in opposite phase (`shopDecor`/`shopDecorLate`); a *pattern*
 * never joins them, since a field of dots that breathes reads as a wobble rather than an idle.
 */
function ShopDecor({ shopId }: { shopId: string }): JSX.Element | null {
  switch (shopId) {
    case 'vu_campus_store':
      return (
        <>
          <LettersFilter id="vu-shop-letters" inkClassName="vu-shop-letters-ink" />
          <motion.img className="vu-shop-letters" src={lettersUrl} alt="" variants={shopDecor} />
        </>
      )
    case 'veridan_delivery':
      return (
        <>
          <motion.span className="vu-shop-tape vu-shop-tape--a" variants={shopDecor} />
          <motion.span className="vu-shop-tape vu-shop-tape--b" variants={shopDecorLate} />
        </>
      )
    case 'girltime':
      return (
        <>
          <span className="vu-shop-dots" />
          <motion.span className="vu-shop-bubble vu-shop-bubble--a" variants={shopDecor} />
          <motion.span className="vu-shop-bubble vu-shop-bubble--b" variants={shopDecorLate} />
        </>
      )
    case 'merchmogul':
      return (
        <>
          <motion.span className="vu-shop-rays" variants={shopDecor} />
          <motion.span className="vu-shop-ring" variants={shopDecorLate} />
        </>
      )
    // LUXURYNOW draws nothing behind its goods, and its masthead's rule is the shelf's idle.
    default:
      return null
  }
}

export interface ShopModalProps {
  /** Drawn by the screen that opened this — a portal inherits no palette. */
  theme: ScreenTheme
  onClose: () => void
}

export function ShopModal({ theme, onClose }: ShopModalProps): JSX.Element | null {
  const money = useGameStore((s) => s.money)
  const inventory = useGameStore((s) => s.inventory)
  const { host, overlayProps } = useModalShell(onClose)

  const [shopId, setShopId] = useState(SHOPS[0].id)
  const [stuff, setStuff] = useState(false)
  /** The item being asked about, and the whole of the transaction's state. */
  const [pending, setPending] = useState<string | null>(null)
  /** What the balance stood at before the last purchase — what its count walks *from*. */
  const [spentFrom, setSpentFrom] = useState<number | undefined>(undefined)

  const items = useMemo(() => itemsInShop(shopId), [shopId])

  /**
   * The reader has walked away from the question. The functional form is what keeps a scroll on
   * a shelf with nothing pending from scheduling a render at all — React bails on an identical
   * value, and returning the same `null` is what makes that reliable rather than incidental.
   */
  const drop = useCallback((): void => {
    setPending((at) => (at === null ? at : null))
  }, [])

  if (!host) return null

  const shop = shopDefOf(shopId) ?? SHOPS[0]
  // A pending id came from the catalog a moment ago; `?? null` makes the impossible a non-event.
  const asked = pending ? (itemDefOf(pending) ?? null) : null
  const carried = inventory.reduce((total, line) => total + line.count, 0)

  function pickShop(id: string): void {
    drop()
    setShopId(id)
  }

  function openStuff(): void {
    drop()
    setStuff(true)
  }

  function confirm(item: ItemDef): void {
    setPending(null)
    setSpentFrom(money)
    // No affordability check: buying past the debt floor is the player's call, and it ends the
    // playthrough at the next slot opening — or, on the goodbye menu, on the next button —
    // rather than here.
    useGameStore.getState().buyItem(item.id, item.price)
  }

  return createPortal(
    <>
      <motion.div
        className="vu-veil vu-veil--bare"
        data-theme={theme}
        variants={veilIn}
        initial="hidden"
        animate="shown"
        exit="gone"
        {...overlayProps}
      >
        <div
          className="vu-shop"
          data-shop={shopId}
          role="dialog"
          aria-modal="true"
          aria-label="BunnyShop"
        >
          <motion.div className="vu-shop-header" variants={shopHead}>
            {/* A screen is left by its back circle, where a panel is left by a worded button. */}
            <motion.button
              className="vu-circle"
              type="button"
              aria-label="Close BunnyShop"
              {...gestures(false, quietLift, quietPress)}
              onClick={onClose}
            >
              <BackIcon />
            </motion.button>

            <div className="vu-title vu-shop-title">
              <h2 className="vu-title-text">BunnyShop</h2>
            </div>

            {/* Live at nothing: the panel answers the question in the app's own voice, and a
                dead button would be the screen refusing to say something it can say. */}
            <motion.button
              id="shop-stuff"
              className="vu-btn vu-btn--outline vu-btn--panel vu-paper"
              type="button"
              {...gestures(false, lift, press)}
              onClick={openStuff}
            >
              My stuff · {carried} {carried === 1 ? 'item' : 'items'}
            </motion.button>
          </motion.div>

          {/* The card is `components/MoneyCard.tsx`'s and it counts itself: this screen hands it
              the debit it is being asked about and says where it hangs. */}
          <motion.div className="vu-shop-money" variants={shopMoney}>
            <MoneyCard amount={money} from={spentFrom} asking={asked?.price} />
          </motion.div>

          <motion.div className="vu-shop-tabs" variants={SHOP_TABS_DEAL}>
            {SHOPS.map((entry) => {
              const on = entry.id === shopId
              return (
                <motion.button
                  key={entry.id}
                  className={`vu-shop-tab${on ? ' vu-shop-tab--on' : ''}`}
                  type="button"
                  aria-pressed={on}
                  variants={shopTab}
                  // The shelf he is already at answers nothing: its fill is a state, which a
                  // hover may never animate, and a rise on the tab he is standing on would be
                  // motion reporting an arrival that has already happened.
                  {...gestures(on, tabRaise, tabPress)}
                  onClick={() => pickShop(entry.id)}
                >
                  {entry.name}
                </motion.button>
              )
            })}
          </motion.div>

          <motion.div className="vu-shop-pane" variants={shopPane}>
            <ShopDecor shopId={shop.id} />

            {/* One DOM order and one reading order for five mastheads: what each shop changes is
                where its own grid puts these three, and what it draws around them. Veridan's is
                the one drawn as an object on the field, so it is the one that carries a paper
                layer — the class has to be here, since the layer is two pseudos and not a fill. */}
            <div className={shop.id === 'veridan_delivery' ? 'vu-shop-head vu-paper' : 'vu-shop-head'}>
              <span className="vu-shop-name">{shop.name}</span>
              <p className="vu-shop-blurb">{shop.blurb}</p>
              <span className="vu-shop-kicker">
                {shop.id === 'merchmogul'
                  ? stubHalves(KICKERS[shop.id]).map((half, i) => (
                      <span key={i} className={i === 0 ? 'vu-shop-stub-a' : 'vu-shop-stub-b'}>
                        {half}
                      </span>
                    ))
                  : KICKERS[shop.id]}
              </span>
              {shop.id === 'luxurynow' && (
                <motion.span className="vu-shop-underline" animate={shopRule} aria-hidden="true" />
              )}
              {shop.id === 'girltime' &&
                GIRLTIME_CHARMS.map((charm) => (
                  <span
                    key={charm.glyph}
                    className="vu-shop-charm"
                    aria-hidden="true"
                    style={
                      {
                        '--cx': `${charm.x}px`,
                        '--cy': `${charm.y}px`,
                        '--cs': `${charm.size}px`,
                        '--cl': `${charm.lean}deg`
                      } as CSSProperties
                    }
                  >
                    {charm.glyph}
                  </span>
                ))}
            </div>

            {/* Keyed on the shop, so changing shelves deals a new one rather than swapping the
                words inside the old. A scroll takes the question off the screen with the card
                it was about, so it puts it back. */}
            <motion.div
              key={shopId}
              className="vu-shop-grid"
              variants={SHELF_DEAL}
              initial="hidden"
              animate="shown"
              onScroll={drop}
            >
              {items.map((item) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  word="Buy"
                  asking={pending === item.id}
                  onAnswer={() => setPending(item.id)}
                  onCancel={drop}
                  onConfirm={() => confirm(item)}
                />
              ))}
            </motion.div>

            <span className="vu-shop-fade" />
          </motion.div>
        </div>
      </motion.div>

      {/* Rendered outside the veil so a click inside it does not reach the veil's own handler
          through the React tree, and `propagate` so it leaves when the shop is closed over it:
          the shop unmounts while this one's own condition never flips. */}
      <AnimatePresence propagate>
        {stuff && <InventoryModal key="stuff" theme={theme} onClose={() => setStuff(false)} />}
      </AnimatePresence>
    </>,
    host
  )
}
